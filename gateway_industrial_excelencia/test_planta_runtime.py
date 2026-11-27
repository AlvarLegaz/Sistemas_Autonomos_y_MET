"""Pruebas de PlantaRuntime (contrato <-> runtime de la placa) y del gateway MQTT con un cliente falso. Sin hardware ni broker.

    python -m pytest test_planta_runtime.py -q        (desde gateway_industrial_excelencia)
"""
import json
import os
import tempfile
import time
import unittest
from types import SimpleNamespace

import argparse

from contrato_pct23 import Controlador, RelojSimulado, iso_utc
from gateway_pct23 import GatewayPCT23, broker, cargar_config, credenciales, guardar_config
from planta_runtime import PlantaRuntime
from runtime import Runtime


class RuntimeFalso:
    """Misma API que Runtime, con la imagen de proceso a mano."""

    def __init__(self):
        self.analog = {f"AnalogIn{i}_value": 0.0 for i in range(1, 9)}
        self.digital = {f"DigitalIn{i}_value": False for i in range(1, 9)}
        self.outputs = {**{f"DigitalOut{i}_value": False for i in range(1, 9)}, **{f"TransistorOut{i}_value": False for i in range(1, 9)},
                        "PWMOut1_value": 100.0, "PWMOut2_value": 100.0, "AnalogOut1_value": 100.0}
        self.io_ok, self.bloqueado, self.entradas_leidas, self.llamadas = True, False, True, []

    @property
    def _entradas_leidas(self):
        return self.entradas_leidas

    def diagnostico(self):
        return {"io_ok": self.io_ok, "calefactor_bloqueado": self.bloqueado}

    def readAnalogInput(self):
        return dict(self.analog)

    def readDigitalInput(self):
        return dict(self.digital)

    def readOutputs(self):
        return dict(self.outputs)

    def update_outputs(self, valores):
        self.llamadas.append(dict(valores))
        self.outputs.update(valores)
        return []

    def start(self):
        pass

    def stop(self):
        pass


def planta():
    rt = RuntimeFalso()
    rt.digital.update({"DigitalIn1_value": True, "DigitalIn4_value": True, "DigitalIn5_value": True})     # termostato cerrado, B con nivel, calefactor con nivel
    return rt, PlantaRuntime(rt)


class Sensores(unittest.TestCase):
    def test_temperaturas_voltios_por_100_t5_en_a5_y_l1_null(self):
        rt, p = planta(); rt.analog.update({"AnalogIn1_value": 0.5, "AnalogIn2_value": 0.7, "AnalogIn3_value": 0.25, "AnalogIn4_value": 0.526,
                                           "AnalogIn5_value": 0.2})
        s = p.leer_sensores()
        self.assertEqual((s["t1_c"], s["t2_c"], s["t3_c"], s["t4_c"], s["t5_c"]), (50.0, 70.0, 25.0, 52.6, 20.0))
        self.assertIsNone(s["l1_level_mm"])                # el nivel del tanque A no llega a ninguna entrada

    def test_caudal_f1_300_ml_min_por_voltio_del_conector(self):
        rt, p = planta()
        rt.analog["AnalogIn7_value"] = 1.65                        # 3,3 V a fondo de escala en el ADC = 5 V en el conector = 1500 mL/min
        self.assertAlmostEqual(p.leer_sensores()["f1_flow_ml_min"], 750.0, places=1)
        rt.analog["AnalogIn7_value"] = 3.3; self.assertAlmostEqual(p.leer_sensores()["f1_flow_ml_min"], 1500.0, places=1)
        p.config["f1_ml_min_per_v"] = 280.0; self.assertAlmostEqual(p.leer_sensores()["f1_flow_ml_min"], 1400.0, places=1)    # ajustable por config

    def test_inversiones_logicas_de_las_entradas_digitales(self):
        rt, p = planta()
        s = p.leer_sensores(); self.assertEqual((s["stat_overtemp"], s["ll_tank_b"], s["hl_tank_b"], s["hl_heat_unit"], s["lvl_heat_unit"]), (False, False, False, False, True))
        rt.digital["DigitalIn1_value"] = False; self.assertTrue(p.leer_sensores()["stat_overtemp"])            # termostato abierto = sobretemperatura
        rt.digital["DigitalIn4_value"] = False; self.assertTrue(p.leer_sensores()["ll_tank_b"])                # lógica negada
        rt.digital["DigitalIn3_value"] = True; self.assertTrue(p.leer_sensores()["hl_tank_b"])
        rt.digital["DigitalIn2_value"] = True; self.assertTrue(p.leer_sensores()["hl_heat_unit"])
        rt.digital["DigitalIn5_value"] = False; self.assertFalse(p.leer_sensores()["lvl_heat_unit"])

    def test_sin_io_o_sin_primer_scan_no_se_publica_nada_viejo(self):
        rt, p = planta(); rt.io_ok = False; self.assertEqual(p.leer_sensores(), {})
        rt.io_ok, rt.entradas_leidas = True, False; self.assertEqual(p.leer_sensores(), {})


class Actuadores(unittest.TestCase):
    def test_estado_con_inversiones(self):
        rt, p = planta(); a = p.estado_actuadores()
        self.assertEqual((a["sol1_divert"], a["sol2_feed_tank"], a["n1_on"], a["n2_on"], a["heater_pct"]), (True, "A", False, False, 0))   # SOL1 sin activar = desvío
        rt.outputs.update({"DigitalOut3_value": True, "DigitalOut4_value": True, "DigitalOut5_value": True, "DigitalOut6_value": True, "DigitalOut7_value": True,
                           "TransistorOut8_value": True, "TransistorOut7_value": True, "PWMOut1_value": 60.0, "PWMOut2_value": 70.0})
        a = p.estado_actuadores()
        self.assertEqual((a["sol1_divert"], a["sol2_feed_tank"], a["sol3_cooling"], a["sol4_fill_a"], a["sol5_fill_b"]), (False, "B", True, True, True))
        self.assertEqual((a["n1_on"], a["n1_speed_pct"], a["n2_on"], a["n2_speed_pct"]), (True, 60, True, 70))

    def test_resistencia_cuantizada_en_pasos_del_2_por_ciento(self):
        rt, p = planta(); rt.outputs["TransistorOut3_value"] = True
        for pedido, aplicado in ((100, 100), (60, 60), (50, 50), (45, 44), (3, 4), (1, 0), (0, 0)):
            rt.outputs["AnalogOut1_value"] = float(pedido)
            with self.subTest(pedido=pedido):
                self.assertEqual(p.estado_actuadores()["heater_pct"], aplicado)
        rt.outputs["TransistorOut3_value"] = False; rt.outputs["AnalogOut1_value"] = 80.0
        self.assertEqual(p.estado_actuadores()["heater_pct"], 0)             # AnalogOut1 sola no enciende

    def test_heater_inhibited_sale_del_bloqueo_del_runtime(self):
        rt, p = planta(); self.assertFalse(p.estado_actuadores()["heater_inhibited"]); rt.bloqueado = True; self.assertTrue(p.estado_actuadores()["heater_inhibited"])

    def test_aplicar_traduce_cada_tag_y_las_inversiones(self):
        rt, p = planta()
        p.aplicar({"sol1_divert": False, "sol2_feed_tank": "B", "sol3_cooling": True, "sol4_fill_a": True, "sol5_fill_b": True, "n1_on": True, "n1_speed_pct": 40,
                   "n2_on": True, "n2_speed_pct": 80})
        o = rt.outputs
        self.assertEqual((o["DigitalOut3_value"], o["DigitalOut4_value"], o["DigitalOut5_value"], o["DigitalOut6_value"], o["DigitalOut7_value"]), (True, True, True, True, True))
        self.assertEqual((o["TransistorOut8_value"], o["PWMOut1_value"], o["TransistorOut7_value"], o["PWMOut2_value"]), (True, 40, True, 80))
        p.aplicar({"sol1_divert": True, "sol2_feed_tank": "A"})
        self.assertEqual((rt.outputs["DigitalOut3_value"], rt.outputs["DigitalOut4_value"]), (False, False))

    def test_la_resistencia_enciende_el_transistor_y_pone_la_potencia(self):
        rt, p = planta(); p.aplicar({"heater_pct": 60})
        self.assertEqual((rt.outputs["TransistorOut3_value"], rt.outputs["AnalogOut1_value"]), (True, 60))
        p.aplicar({"heater_pct": 0}); self.assertFalse(rt.outputs["TransistorOut3_value"])

    def test_estado_seguro_completo_deja_sol2_y_sol3_sin_cambio(self):
        from contrato_pct23 import ESTADO_SEGURO
        rt, p = planta(); p.aplicar({"sol2_feed_tank": "B", "sol3_cooling": True, "n1_on": True, "n2_on": True, "heater_pct": 50, "sol1_divert": False})
        p.aplicar(dict(ESTADO_SEGURO))
        o = rt.outputs
        self.assertEqual((o["DigitalOut4_value"], o["DigitalOut5_value"]), (True, True))
        self.assertEqual((o["DigitalOut3_value"], o["TransistorOut8_value"], o["TransistorOut7_value"], o["TransistorOut3_value"], o["PWMOut1_value"]), (False, False, False, False, 0))


class ConRuntimeReal(unittest.TestCase):
    """Runtime de verdad en modo simulado (drivers simulados, hilos reales): el contrato de punta a punta sobre el código de la placa."""

    @classmethod
    def setUpClass(cls):
        cls.rt = Runtime(simular=True)
        cls.rt.start()
        cls.rt.digital_input_driver.read_inputs = lambda: {"DigitalIn1_value": True, "DigitalIn2_value": False, "DigitalIn3_value": False,
                                                           "DigitalIn4_value": True, "DigitalIn5_value": True, "DigitalIn6_value": False,
                                                           "DigitalIn7_value": False, "DigitalIn8_value": False}
        t0 = time.time()
        while not getattr(cls.rt, "_entradas_leidas", False) and time.time() - t0 < 3:
            time.sleep(0.05)
        time.sleep(0.25)

    @classmethod
    def tearDownClass(cls):
        cls.rt.stop()

    def test_pwm_minimo_se_refleja_en_applied(self):
        reloj = RelojSimulado(); msgs = []
        ctl = Controlador("real-01", PlantaRuntime(self.rt), reloj, lambda t, p, q, r: msgs.append((t, p)), habilitar_latido=False)
        ctl.conectar()
        ctl.on_message("pct23/real-01/cmd/n1_speed_pct", {"id": "a1", "ts": iso_utc(reloj.ahora()), "value": 30})
        ack = [p for t, p in msgs if t.endswith("n1_speed_pct/ack")][-1]
        self.assertEqual((ack["result"], ack["applied"]), ("accepted", 50))

    def test_resistencia_acepta_con_termostato_cerrado_y_quantiza(self):
        reloj = RelojSimulado(); msgs = []
        ctl = Controlador("real-01", PlantaRuntime(self.rt), reloj, lambda t, p, q, r: msgs.append((t, p)), habilitar_latido=False)
        ctl.conectar()
        ctl.on_message("pct23/real-01/cmd/heater_pct", {"id": "h1", "ts": iso_utc(reloj.ahora()), "value": 45})
        ack = [p for t, p in msgs if t.endswith("heater_pct/ack")][-1]
        self.assertEqual((ack["result"], ack["applied"]), ("accepted", 44))        # ráfagas de 50 ciclos: 45 % -> 22 ciclos = 44 %
        ctl.on_message("pct23/real-01/cmd/heater_pct", {"id": "h2", "ts": iso_utc(reloj.ahora()), "value": 0})
        self.assertEqual(self.rt.readOutputs()["TransistorOut3_value"], False)

    def test_sensors_reales_traducidos_t5_con_valor_y_l1_null(self):
        s = PlantaRuntime(self.rt).leer_sensores()
        self.assertIsInstance(s["t5_c"], float); self.assertIsNone(s["l1_level_mm"]); self.assertFalse(s["stat_overtemp"]); self.assertIsInstance(s["t1_c"], float)


class RuntimeRobusto(unittest.TestCase):
    """Hallazgo crítico de la revisión: un hilo del scan que muere dejaba la resistencia calentando a ciegas."""

    def test_un_driver_que_falla_con_cualquier_excepcion_no_mata_el_scan_y_apaga_la_resistencia(self):
        rt = Runtime(simular=True, caducidad_calefactor_s=30.0)
        rt.start()
        try:
            rt.digital_input_driver.read_inputs = lambda: {f"DigitalIn{i}_value": (i in (1, 4, 5)) for i in range(1, 9)}
            time.sleep(0.4)
            p = PlantaRuntime(rt); p.aplicar({"heater_pct": 60}); self.assertEqual(p.estado_actuadores()["heater_pct"], 60)
            def roto():
                raise RuntimeError("driver roto, no es un OSError")
            rt.analog_input_driver.read_inputs = roto
            time.sleep(0.5)
            d = rt.diagnostico()
            self.assertTrue(d["running"]); self.assertFalse(d["io_ok"])                                   # el hilo sigue vivo y avisa de la E/S caída
            self.assertEqual(p.leer_sensores(), {})                                                        # y no publica lecturas congeladas
            # La orden sigue en la imagen, pero sin lectura del termostato la resistencia NO conduce físicamente en ningún ciclo
            self.assertFalse(any(rt.niveles_potencia(k * 0.020)[2] for k in range(100)))
        finally:
            rt.stop()

    def test_la_caducidad_corta_tambien_desde_el_hilo_de_potencia(self):
        rt = Runtime(simular=True, caducidad_calefactor_s=0.2)
        rt.start()
        try:
            rt.digital_input_driver.read_inputs = lambda: {f"DigitalIn{i}_value": (i in (1, 4, 5)) for i in range(1, 9)}
            time.sleep(0.4)
            PlantaRuntime(rt).aplicar({"heater_pct": 60})
            rt.stop_event.set(); rt.threads[0].join()                                                      # muere el scan lento, el de potencia sigue
            rt.stop_event.clear()
            rt._calefactor_hasta = time.monotonic() - 1.0                                                  # la orden ya caducó
            rt._plan_potencia(0.0)
            self.assertFalse(rt.outputs["TransistorOut3_value"])
        finally:
            rt.stop_event.set()
            for h in rt.threads:
                h.join()
            rt._cerrar_drivers(); rt.running = False

    def test_planta_runtime_no_viva_cuando_los_hilos_no_estan(self):
        rt, p = planta()
        rt.diagnostico = lambda: {"io_ok": True, "calefactor_bloqueado": False, "running": False}
        self.assertFalse(p.viva()); self.assertEqual(p.leer_sensores(), {})


class FalsoCliente:
    def __init__(self):
        self.conectado, self.publicados, self.suscritos, self.will, self.usuario = False, [], [], None, None
        self.on_connect = self.on_disconnect = self.on_message = None

    def will_set(self, topic, payload, qos=0, retain=False):
        self.will = (topic, json.loads(payload), qos, retain)

    def username_pw_set(self, u, c):
        self.usuario = (u, c)

    def is_connected(self):
        return self.conectado

    def publish(self, topic, payload, qos=0, retain=False):
        self.publicados.append((topic, json.loads(payload), qos, retain))

    def subscribe(self, topic, qos=0):
        self.suscritos.append((topic, qos))

    def connect_async(self, *a, **k):
        pass

    def loop_start(self):
        pass

    def loop_stop(self):
        pass

    def disconnect(self):
        self.conectado = False


def mensaje(topic, payload):
    return SimpleNamespace(topic=topic, payload=json.dumps(payload).encode())


class Gateway(unittest.TestCase):
    def crear(self, **kw):
        rt = RuntimeFalso(); rt.digital.update({"DigitalIn1_value": True, "DigitalIn4_value": True, "DigitalIn5_value": True})
        cli = FalsoCliente(); reloj = RelojSimulado()
        g = GatewayPCT23("127.0.0.1", 1883, usuario="gw", clave="x", reloj=reloj, cliente=cli, runtime=rt, archivo_config=kw.pop("archivo_config", None), **kw)
        return g, cli, rt, reloj

    def conectar(self, g, cli):
        cli.conectado = True; g.on_connect(cli, None, None, SimpleNamespace(is_failure=False), None)

    def test_registra_el_last_will_y_las_credenciales(self):
        g, cli, *_ = self.crear()
        self.assertEqual(cli.will, ("pct23/real-01/status", {"state": "offline", "kind": "real", "instance_id": "real-01"}, 1, True)); self.assertEqual(cli.usuario, ("gw", "x"))

    def test_al_conectar_suscribe_y_publica_status_y_actuators_retenidos(self):
        g, cli, *_ = self.crear(); self.conectar(g, cli)
        self.assertEqual(cli.suscritos, [("pct23/real-01/cmd/+", 1), ("pct23/real-01/scada/heartbeat", 0), ("pct23/real-01/params", 1), ("pct23/real-01/config", 1)])
        tops = {t: (q, r) for t, _, q, r in cli.publicados}
        self.assertEqual(tops["pct23/real-01/status"], (1, True)); self.assertEqual(tops["pct23/real-01/actuators"], (1, True))

    def test_sin_conexion_no_se_encola_nada(self):
        g, cli, *_ = self.crear(); g.controlador.conectado = True; g.controlador.tick(); self.assertEqual(cli.publicados, [])

    def test_orden_por_mqtt_se_aplica_a_la_planta_y_responde_ack(self):
        g, cli, rt, reloj = self.crear(); self.conectar(g, cli)
        g.on_message(cli, None, mensaje("pct23/real-01/cmd/n2_on", {"id": "z1", "ts": iso_utc(reloj.ahora()), "value": True}))
        self.assertTrue(rt.outputs["TransistorOut7_value"])
        ack = [p for t, p, *_ in cli.publicados if t.endswith("n2_on/ack")][-1]; self.assertEqual((ack["id"], ack["result"]), ("z1", "accepted"))

    def test_pierde_el_broker_y_entra_en_estado_seguro(self):
        g, cli, rt, reloj = self.crear(); self.conectar(g, cli)
        g.on_message(cli, None, mensaje("pct23/real-01/cmd/heater_pct", {"id": "q1", "ts": iso_utc(reloj.ahora()), "value": 50}))
        cli.conectado = False; g.on_disconnect(cli, None, None, "perdida", None)
        self.assertTrue(g.controlador.safe_state); self.assertFalse(rt.outputs["TransistorOut3_value"])

    def test_parada_limpia_publica_offline(self):
        g, cli, *_ = self.crear(); self.conectar(g, cli); n = len(cli.publicados); g.controlador.detener()
        self.assertEqual(cli.publicados[n][:2], ("pct23/real-01/status", {"state": "offline", "kind": "real", "instance_id": "real-01"}))

    def test_la_config_se_guarda_en_disco_y_se_carga_al_arrancar(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "config.json")
            g, cli, *_ = self.crear(archivo_config=ruta); self.conectar(g, cli)
            g.on_message(cli, None, mensaje("pct23/real-01/config", {"ts": "x", "f1_ml_min_per_v": 280.0, "l1_low_mm": 12.0}))
            self.assertEqual(cargar_config(ruta), {"f1_ml_min_per_v": 280.0, "l1_low_mm": 12.0})
            g2, *_ = self.crear(archivo_config=ruta)
            self.assertEqual(g2.planta.config["f1_ml_min_per_v"], 280.0); self.assertIs(g2.planta.config, g2.controlador.config)

    def test_config_rota_se_ignora(self):
        with tempfile.TemporaryDirectory() as d:
            ruta = os.path.join(d, "c.json"); open(ruta, "w").write("{no es json"); self.assertEqual(cargar_config(ruta), {}); self.assertEqual(cargar_config(os.path.join(d, "no_existe")), {})


class GatewayConHoraDelServidor(unittest.TestCase):
    def test_pide_la_hora_al_servidor_y_el_status_dice_si_esta_sincronizada(self):
        from modulo_tiempo import RelojSincronizado, ServidorTiempo
        hora_servidor = RelojSimulado("2031-05-05T12:00:00.000Z")
        srv = ServidorTiempo(hora_servidor, host="127.0.0.1", puerto=0); srv.iniciar()
        try:
            reloj = RelojSincronizado("127.0.0.1", srv.puerto, hora_inicial="2026-01-01T00:00:00.000Z", periodo_s=60.0)
            rt = RuntimeFalso(); cli = FalsoCliente()
            g = GatewayPCT23("127.0.0.1", 1883, reloj=reloj, cliente=cli, runtime=rt, archivo_config=None)
            cli.conectado = True; g.on_connect(cli, None, None, SimpleNamespace(is_failure=False), None)
            status = [p for t, p, *_ in cli.publicados if t.endswith("/status")][-1]
            self.assertEqual(status["time_sync"]["synced"], False)                                        # aún no se ha pedido la hora
            self.assertTrue(reloj.sincronizar())                                                          # «siempre al arrancar» lo hace run() con arrancar()
            self.assertAlmostEqual(reloj.ahora(), hora_servidor.ahora(), delta=0.2)                      # la hora de la planta es la del servidor, 5 años después de la inicial
            g.controlador.conectado = True; g.controlador.tick()
            status = [p for t, p, *_ in cli.publicados if t.endswith("/status")][-1]
            self.assertEqual(status["time_sync"], {"synced": True, "server": f"127.0.0.1:{srv.puerto}"})
        finally:
            srv.detener()

    def test_sin_reloj_sincronizado_el_status_no_lleva_time_sync(self):
        rt = RuntimeFalso(); cli = FalsoCliente()
        g = GatewayPCT23("127.0.0.1", 1883, reloj=RelojSimulado(), cliente=cli, runtime=rt, archivo_config=None)
        cli.conectado = True; g.on_connect(cli, None, None, SimpleNamespace(is_failure=False), None)
        self.assertNotIn("time_sync", [p for t, p, *_ in cli.publicados if t.endswith("/status")][-1])


class Argumentos(unittest.TestCase):
    def test_broker_y_credenciales(self):
        self.assertEqual(broker("10.0.0.5:1884"), ("10.0.0.5", 1884)); self.assertEqual(broker("10.0.0.5"), ("10.0.0.5", 1883))
        with self.assertRaises(argparse.ArgumentTypeError): broker("usuario@clave")
        with self.assertRaises(argparse.ArgumentTypeError): broker("host:0")
        self.assertEqual(credenciales("gw@clave@con@arroba"), ("gw", "clave@con@arroba")); self.assertEqual(credenciales(None), (None, None))


if __name__ == "__main__":
    unittest.main()
