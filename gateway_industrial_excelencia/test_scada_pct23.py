"""Pruebas del lado SCADA del contrato MQTT PCT23 v2.4: traductor, hora de la planta, ciclo de órdenes, latido y servidor web en protocolo nuevo.
Incluye una integración con el núcleo del contrato (`contrato_pct23.Controlador`) por un bus en memoria. No necesitan broker ni hardware.

    python -m pytest -q test_scada_pct23.py
"""
import json
import unittest

import control_t1 as c
import modulo_control as mc
import scada_pct23 as sc
import servidor_web as web
from contrato_pct23 import Controlador, Planta, RelojSimulado, iso_utc, parse_iso


# ------------------------------------------------------------------------------------------------------------ ayudas ----
class Mono:
    """Reloj monotónico falso."""
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def cliente(instancia="real-01", local_ofsset=0.0, hora_local=None):
    """ClienteScada con relojes falsos y un registro de lo publicado: [(topic, payload, qos, retain)]."""
    mono, publicado = Mono(), []
    local = hora_local or (lambda: parse_iso("2026-11-24T10:00:00.000Z") + local_ofsset + (mono.t - 100.0))
    cl = sc.ClienteScada(instancia, lambda t, p, q, r: publicado.append((t, json.loads(json.dumps(p)), q, r)), reloj_local=local, reloj_mono=mono)
    cl.conectar()
    return cl, mono, publicado


def sensors(ts="2026-11-24T10:00:00.000Z", **cambios):
    d = {"ts": ts, "seq": 1, "t1_c": 52.0, "t2_c": 74.0, "t3_c": 28.0, "t4_c": 50.0, "t5_c": None, "l1_level_mm": None, "f1_flow_ml_min": 454.5,
         "ll_tank_b": False, "hl_tank_b": False, "lvl_heat_unit": True, "hl_heat_unit": False, "stat_overtemp": False}
    d.update(cambios)
    return d


def actuators(**cambios):
    d = {"ts": "2026-11-24T10:00:00.000Z", "seq": 1, "sol1_divert": True, "sol2_feed_tank": "A", "sol3_cooling": False, "sol4_fill_a": False, "sol5_fill_b": False,
         "n1_on": False, "n1_speed_pct": 50, "n2_on": False, "heater_pct": 0, "heater_kw": 0.0, "heater_inhibited": False}
    d.update(cambios)
    return d


def recibir(cl, sufijo, payload):
    return cl.on_message(f"pct23/{cl.id}/{sufijo}", json.dumps(payload))


def ack(cl, tag, oid, resultado="accepted", **extra):
    recibir(cl, f"cmd/{tag}/ack", {"id": oid, "ts": "2026-11-24T10:00:00.100Z", "result": resultado, **extra})


# ------------------------------------------------------------------------------------------------------- traductor ----
class TraductorSensores(unittest.TestCase):
    def test_temperaturas_en_voltios_y_caudal_en_voltios_del_adc(self):
        a = sc.sensores_a_antiguo(sensors(t1_c=52.0, f1_flow_ml_min=454.5))
        self.assertEqual((a["AnalogIn1_value"], a["AnalogIn2_value"], a["AnalogIn3_value"], a["AnalogIn4_value"]), (0.52, 0.74, 0.28, 0.5))
        self.assertAlmostEqual(a["AnalogIn7_value"], 1.0, places=3)             # 454,5 mL/min = 1 V en el ADC (enmienda E1)

    def test_los_null_se_omiten(self):
        a = sc.sensores_a_antiguo(sensors())
        self.assertNotIn("AnalogIn5_value", a)                                   # T5 null
        a = sc.sensores_a_antiguo(sensors(t2_c=None, f1_flow_ml_min=None, stat_overtemp=None))
        for clave in ("AnalogIn2_value", "AnalogIn7_value", "DigitalIn1_value"):
            self.assertNotIn(clave, a)

    def test_t5_va_a_analogin5_y_l1_no_tiene_canal(self):
        self.assertAlmostEqual(sc.sensores_a_antiguo(sensors(t5_c=20.0))["AnalogIn5_value"], 0.2, places=4)
        self.assertNotIn("AnalogIn5_value", sc.sensores_a_antiguo(sensors(l1_level_mm=125.0)))

    def test_inversiones_digitales(self):
        # DigitalIn1 = NOT stat_overtemp; DigitalIn4 = NOT ll_tank_b; el resto directas
        a = sc.sensores_a_antiguo(sensors(stat_overtemp=False, ll_tank_b=False, hl_tank_b=True, hl_heat_unit=True, lvl_heat_unit=False))
        self.assertEqual((a["DigitalIn1_value"], a["DigitalIn2_value"], a["DigitalIn3_value"], a["DigitalIn4_value"], a["DigitalIn5_value"]),
                         (True, True, True, True, False))
        a = sc.sensores_a_antiguo(sensors(stat_overtemp=True, ll_tank_b=True))
        self.assertEqual((a["DigitalIn1_value"], a["DigitalIn4_value"]), (False, False))


class TraductorActuadores(unittest.TestCase):
    def test_inversion_de_sol1_y_sol2(self):
        a = sc.actuadores_a_antiguo(actuators(sol1_divert=True, sol2_feed_tank="A"))
        self.assertEqual((a["DigitalOut3_value"], a["DigitalOut4_value"]), (False, False))     # SOL1 sin activar = desvío; A = DO4 apagada
        a = sc.actuadores_a_antiguo(actuators(sol1_divert=False, sol2_feed_tank="B"))
        self.assertEqual((a["DigitalOut3_value"], a["DigitalOut4_value"]), (True, True))

    def test_resto_de_salidas(self):
        a = sc.actuadores_a_antiguo(actuators(sol3_cooling=True, sol4_fill_a=True, sol5_fill_b=True, n1_on=True, n1_speed_pct=70, n2_on=True, n2_speed_pct=60))
        self.assertEqual((a["DigitalOut5_value"], a["DigitalOut6_value"], a["DigitalOut7_value"]), (True, True, True))
        self.assertEqual((a["TransistorOut8_value"], a["PWMOut1_value"], a["TransistorOut7_value"], a["PWMOut2_value"]), (True, 70, True, 60))

    def test_resistencia(self):
        a = sc.actuadores_a_antiguo(actuators(heater_pct=40))
        self.assertEqual((a["TransistorOut3_value"], a["AnalogOut1_value"]), (True, 40))
        a = sc.actuadores_a_antiguo(actuators(heater_pct=0))
        self.assertEqual(a["TransistorOut3_value"], False)
        self.assertNotIn("AnalogOut1_value", a)

    def test_canales_sin_uso_salen_apagados(self):
        a = sc.actuadores_a_antiguo(actuators())
        for canal in sc.SALIDAS_ANTIGUAS_SIN_USO:
            self.assertEqual(a[canal], False, canal)


class Diagnostico(unittest.TestCase):
    def test_en_marcha_y_sin_motivos(self):
        d = sc.diagnostico_a_antiguo({"state": "online", "safe_state": False, "control_mode": "remote"}, sensors(), {}, True)
        self.assertEqual((d["running"], d["io_ok"], d["calefactor_bloqueado"], d["motivos_bloqueo"], d["paro_emergencia"]), (True, True, False, [], False))

    def test_paro_de_emergencia_y_estado_seguro_por_latido(self):
        d = sc.diagnostico_a_antiguo({"safe_state": True, "safe_reason": "emergency_stop"}, sensors(), {}, True)
        self.assertEqual((d["paro_emergencia"], d["motivos_bloqueo"]), (True, ["paro_emergencia"]))
        d = sc.diagnostico_a_antiguo({"safe_state": True, "safe_reason": "watchdog"}, sensors(), {}, True)
        self.assertEqual((d["paro_emergencia"], d["motivos_bloqueo"], d["safe_state"]), (False, ["estado_seguro"], True))

    def test_termostato_por_sensor_o_por_alarma(self):
        self.assertIn("termostato_abierto", sc.diagnostico_a_antiguo({}, sensors(stat_overtemp=True), {}, True)["motivos_bloqueo"])
        self.assertIn("termostato_abierto", sc.diagnostico_a_antiguo({}, sensors(), {"overtemp": {}}, True)["motivos_bloqueo"])

    def test_sonda_t2_fuera_de_rango(self):
        for t2 in (None, 2.0, 150.0):
            self.assertIn("sonda_t2_fuera_de_rango", sc.diagnostico_a_antiguo({}, sensors(t2_c=t2), {}, True)["motivos_bloqueo"], t2)

    def test_sin_planta(self):
        d = sc.diagnostico_a_antiguo({"state": "offline"}, sensors(), {}, False)
        self.assertEqual((d["running"], d["io_ok"]), (False, False))


class OrdenesAntiguas(unittest.TestCase):
    def setUp(self):
        self.t = sc.TraductorOrdenes()

    def tr(self, orden, act=None):
        return self.t.traducir(orden, act)["ordenes"]

    def test_inversiones_y_mapa(self):
        r = self.tr({"DigitalOut3_value": True, "DigitalOut4_value": True, "DigitalOut5_value": False, "DigitalOut6_value": True, "DigitalOut7_value": False})
        self.assertEqual(r, [("sol1_divert", False), ("sol2_feed_tank", "B"), ("sol3_cooling", False), ("sol4_fill_a", True), ("sol5_fill_b", False)])
        self.assertEqual(self.tr({"DigitalOut3_value": False, "DigitalOut4_value": False}), [("sol1_divert", True), ("sol2_feed_tank", "A")])

    def test_bombas(self):
        self.assertEqual(self.tr({"TransistorOut8_value": True, "PWMOut1_value": 60.4, "TransistorOut7_value": False, "PWMOut2_value": 80}),
                         [("n1_on", True), ("n1_speed_pct", 60), ("n2_on", False), ("n2_speed_pct", 80)])

    def test_resistencia_usa_la_potencia_recordada(self):
        self.assertEqual(self.tr({"TransistorOut3_value": True}), [("heater_pct", 100)])           # 100 % por defecto, como el gateway antiguo
        self.assertEqual(self.tr({"AnalogOut1_value": 40}), [])                                    # potencia suelta con la resistencia apagada: solo se recuerda
        self.assertEqual(self.tr({"TransistorOut3_value": True}), [("heater_pct", 40)])
        self.assertEqual(self.tr({"TransistorOut3_value": False}), [("heater_pct", 0)])
        self.assertEqual(self.tr({"AnalogOut1_value": 70}, {"heater_pct": 40}), [("heater_pct", 70)])   # con la resistencia encendida se aplica
        self.assertEqual(self.tr({"TransistorOut3_value": True, "AnalogOut1_value": 55}), [("heater_pct", 55)])

    def test_paro_de_emergencia(self):
        self.assertEqual(self.tr({"paro_emergencia": True}), [("emergency_stop", True)])
        self.assertEqual(self.tr({"paro_emergencia": False}), [("reset_safe_state", True)])
        self.assertEqual(self.tr({"TransistorOut8_value": True, "paro_emergencia": True})[0], ("emergency_stop", True))   # la parada va la primera

    def test_ignoradas_e_invalidas(self):
        r = self.t.traducir({"DigitalOut1_value": True, "TransistorOut5_value": True, "AnalogOut2_value": 3, "DigitalOut5_value": "quizás", "PWMOut1_value": "x"})
        self.assertEqual(r["ordenes"], [])
        self.assertEqual(sorted(r["ignoradas"]), ["AnalogOut2_value", "DigitalOut1_value", "TransistorOut5_value"])
        self.assertEqual(sorted(r["invalidas"]), ["DigitalOut5_value", "PWMOut1_value"])

    def test_el_control_t1_se_traduce_entero(self):
        orden = {c.SALIDA_RES: True, c.SALIDA_N1: True, c.SALIDA_N2: True, c.SALIDA_VELOCIDAD_N1: 60.0}
        tags = dict(self.tr(orden))
        self.assertEqual(tags, {"heater_pct": 100, "n1_on": True, "n2_on": True, "n1_speed_pct": 60})


# ------------------------------------------------------------------------------------------------ hora de la planta ----
class HoraDeLaPlanta(unittest.TestCase):
    def test_sin_sensors_no_se_manda_ninguna_orden(self):
        cl, _, pub = cliente()
        self.assertIsNone(cl.hora_planta())
        r = cl.enviar_orden("heater_pct", 0)
        self.assertEqual((r["enviada"], r["motivo"]), (False, "sin_hora_planta"))
        self.assertEqual([p for p in pub if "/cmd/" in p[0]], [])

    def test_la_hora_de_las_ordenes_es_la_de_la_planta_no_la_del_pc(self):
        cl, mono, pub = cliente(local_ofsset=3600.0)            # el reloj del PC va una hora por delante de la planta
        recibir(cl, "sensors", sensors(ts="2026-11-24T10:00:00.000Z"))
        self.assertAlmostEqual(cl.hora_planta(), parse_iso("2026-11-24T10:00:00.000Z"), places=3)
        mono.t += 3.0
        cl.enviar_orden("sol3_cooling", True)
        orden = [p for p in pub if p[0].endswith("/cmd/sol3_cooling")][0]
        self.assertEqual(orden[1]["ts"], "2026-11-24T10:00:03.000Z")                # la hora de la planta, 3 s después
        self.assertEqual((orden[1]["value"], orden[1]["source"], orden[2], orden[3]), (True, "scada", 1, False))

    def test_se_toma_la_muestra_de_menos_retraso(self):
        cl, mono, _ = cliente()
        for retraso in (0.30, 0.05, 0.20):                     # el mensaje tarda 50 ms en el mejor caso
            ts = cl._local() - retraso
            recibir(cl, "sensors", sensors(ts=iso_utc(ts)))
        self.assertAlmostEqual(cl.hora_planta() - cl._local(), -0.05, places=2)

    def test_status_y_actuators_retenidos_no_estiman_el_desfase(self):
        cl, _, _ = cliente()
        recibir(cl, "status", {"ts": "2020-01-01T00:00:00.000Z", "state": "online"})
        recibir(cl, "actuators", actuators(ts="2020-01-01T00:00:00.000Z"))
        self.assertIsNone(cl.hora_planta())

    def test_los_ids_son_unicos(self):
        cl, _, pub = cliente()
        recibir(cl, "sensors", sensors())
        for _ in range(5):
            cl.enviar_orden("heater_pct", 0)
        ids = [p[1]["id"] for p in pub if "/cmd/" in p[0]]
        self.assertEqual(len(set(ids)), 5)

    def test_sin_conexion_no_se_manda_nada(self):
        cl, _, pub = cliente()
        recibir(cl, "sensors", sensors())
        cl.desconectar()
        self.assertEqual(cl.enviar_orden("heater_pct", 0)["motivo"], "sin_conexion")

    def test_la_parada_de_emergencia_sale_aunque_no_se_conozca_la_hora(self):
        cl, _, pub = cliente()
        r = cl.paro_emergencia(True)
        self.assertTrue(r["enviada"])
        orden = [p for p in pub if p[0].endswith("/cmd/emergency_stop")][0]
        self.assertEqual((orden[1]["value"], orden[1]["ts"], orden[2]), (True, sc.TS_SIN_HORA, 1))
        self.assertEqual(cl.paro_emergencia(False)["motivo"], "sin_hora_planta")       # rearmar sí necesita la hora

    def test_tag_desconocido(self):
        cl, _, _ = cliente()
        self.assertEqual(cl.enviar_orden("nada", 1)["motivo"], "tag_desconocido")


# --------------------------------------------------------------------------------------------------- ciclo de ordenes ----
class CicloDeOrdenes(unittest.TestCase):
    def setUp(self):
        self.cl, self.mono, self.pub = cliente()
        recibir(self.cl, "sensors", sensors())

    def cmds(self):
        return [p for p in self.pub if "/cmd/" in p[0]]

    def test_aceptada(self):
        oid = self.cl.enviar_orden("heater_pct", 40)["id"]
        self.assertEqual(self.cl.resultado(oid), "pendiente")
        ack(self.cl, "heater_pct", oid, applied=40)
        self.assertEqual(self.cl.resultado(oid), "aceptada")
        self.assertEqual(self.cl.resultados[-1]["applied"], 40)
        self.assertEqual(self.cl.rechazos_recientes(), [])

    def test_rechazada_por_interlock_no_se_reintenta(self):
        oid = self.cl.enviar_orden("heater_pct", 40)["id"]
        ack(self.cl, "heater_pct", oid, "rejected", reason="interlock_overtemp")
        self.assertEqual(self.cl.resultado(oid), "rechazada")
        self.assertEqual(self.cl.rechazos_recientes()[0]["reason"], "interlock_overtemp")
        n = len(self.cmds())
        for _ in range(20):                                     # por mucho que pase el tiempo, no se repite
            self.mono.t += 1.0
            self.cl.tick()
        self.assertEqual(len(self.cmds()), n)

    def test_sin_ack_se_reenvia_una_vez_con_el_mismo_id_y_ts(self):
        oid = self.cl.enviar_orden("sol3_cooling", True)["id"]
        primera = self.cmds()[0][1]
        self.mono.t += sc.ACK_ESPERA_S + 0.1
        self.cl.tick()
        self.mono.t += 0.5
        self.cl.tick()
        cmds = self.cmds()
        self.assertEqual(len(cmds), 2)                          # solo UN reenvío
        self.assertEqual(cmds[1][1], primera)
        ack(self.cl, "sol3_cooling", oid, "rejected", reason="duplicate")                  # la original sí llegó
        self.assertEqual(self.cl.resultado(oid), "recibida")

    def test_sin_ack_a_tiempo_se_da_por_perdida(self):
        oid = self.cl.enviar_orden("sol3_cooling", True)["id"]
        self.mono.t += sc.ACK_MAXIMO_S + 0.1
        self.cl.tick()
        self.assertEqual(self.cl.resultado(oid), "sin_respuesta")
        self.assertEqual(self.cl.rechazos_recientes()[-1]["estado"], "sin_respuesta")

    def test_un_ack_ajeno_se_ignora(self):
        ack(self.cl, "heater_pct", "otro-id")
        self.assertEqual(len(self.cl.resultados), 0)

    def test_ordenes_antiguas_resumen(self):
        r = self.cl.ordenes_antiguas({"DigitalOut5_value": True, "DigitalOut1_value": True, "PWMOut1_value": "x"})
        self.assertEqual((r["enviada"], len(r["enviadas"]), r["ignoradas"], r["invalidas"]), (True, 1, ["DigitalOut1_value"], ["PWMOut1_value"]))


class Latido(unittest.TestCase):
    def test_cada_2_s_qos_0_con_la_hora_de_la_planta(self):
        cl, mono, pub = cliente()
        recibir(cl, "sensors", sensors(ts="2026-11-24T10:00:00.000Z"))
        cl.tick()
        latidos = lambda: [p for p in pub if p[0] == "pct23/real-01/scada/heartbeat"]
        self.assertEqual(len(latidos()), 1)
        mono.t += 1.0
        cl.tick()
        self.assertEqual(len(latidos()), 1)
        mono.t += 1.0
        cl.tick()
        self.assertEqual(len(latidos()), 2)
        t, payload, qos, retain = latidos()[1]
        self.assertEqual((qos, retain, payload["client"]), (0, False, "pct23-scada"))
        self.assertEqual(payload["ts"], "2026-11-24T10:00:02.000Z")

    def test_sin_conexion_no_hay_latido(self):
        cl, mono, pub = cliente()
        cl.desconectar()
        cl.tick()
        self.assertEqual(pub, [])


class SaludDeLaPlanta(unittest.TestCase):
    def test_gateway_vivo(self):
        cl, mono, _ = cliente()
        self.assertFalse(cl.gateway_vivo())
        recibir(cl, "sensors", sensors())
        self.assertTrue(cl.gateway_vivo())
        mono.t += sc.GATEWAY_TIMEOUT_S + 0.1
        self.assertFalse(cl.gateway_vivo())
        recibir(cl, "sensors", sensors())
        self.assertTrue(cl.gateway_vivo())
        recibir(cl, "status", {"state": "offline", "kind": "real", "instance_id": "real-01"})      # el LWT
        self.assertFalse(cl.gateway_vivo())

    def test_alarmas(self):
        cl, _, _ = cliente()
        recibir(cl, "alarms", {"alarm": "overtemp", "event": "raised", "severity": "critical"})
        self.assertIn("overtemp", cl.alarmas)
        recibir(cl, "alarms", {"alarm": "overtemp", "event": "cleared"})
        self.assertNotIn("overtemp", cl.alarmas)

    def test_suscripciones_y_topics_ajenos(self):
        cl, _, _ = cliente()
        topics = [t for t, _ in cl.suscripciones()]
        self.assertEqual(topics, ["pct23/real-01/sensors", "pct23/real-01/actuators", "pct23/real-01/status", "pct23/real-01/alarms", "pct23/real-01/cmd/+/ack"])
        self.assertIsNone(cl.on_message("pct23/twin-001/sensors", json.dumps(sensors())))
        self.assertIsNone(cl.on_message("pct23/real-01/sensors", b"no es json"))

    def test_estado_antiguo_completo(self):
        cl, _, _ = cliente()
        self.assertIsNone(cl.estado_antiguo())
        recibir(cl, "sensors", sensors())
        recibir(cl, "actuators", actuators(heater_pct=30))
        recibir(cl, "status", {"state": "online", "safe_state": False, "control_mode": "remote", "instance_id": "real-01"})
        d = cl.estado_antiguo()
        self.assertEqual((d["AnalogIn2_value"], d["TransistorOut3_value"], d["AnalogOut1_value"], d["running"], d["DigitalIn1_value"]), (0.74, True, 30, True, True))


# ------------------------------------------------------------------------------------------------- servidor web (nuevo) ----
class ClienteMqttFalso:
    def __init__(self):
        self.publicado = []

    def publish(self, topic, payload, qos=0, retain=False):
        self.publicado.append((topic, json.loads(payload), qos, retain))
        return type("Info", (), {"rc": 0})()


class MensajeFalso:
    def __init__(self, topic, datos):
        self.topic, self.payload = topic, json.dumps(datos).encode("utf-8")


class ServidorNuevo(unittest.TestCase):
    def setUp(self):
        self.mqtt = ClienteMqttFalso()
        web.client, web.protocolo = self.mqtt, "nuevo"
        self.mono = Mono()
        web.scada = sc.ClienteScada("real-01", lambda t, p, q, r: self.mqtt.publish(t, json.dumps(p), q, r),
                                    reloj_local=lambda: parse_iso("2026-11-24T10:00:00.000Z") + (self.mono.t - 100.0), reloj_mono=self.mono)
        web.scada.conectar()
        web.control = mc.ModuloControl()
        web.res_deseado, web.ultima_orden_res, web.emergencia_pedida = False, 0.0, False
        web.estado.update(datos=None, recibido=0.0, broker=True, rechazo=None)
        self.http = web.app.test_client()

    def tearDown(self):
        web.protocolo, web.scada = "antiguo", None

    def llega(self, sufijo, datos):
        web.on_message(None, None, MensajeFalso(f"pct23/real-01/{sufijo}", datos))

    def ordenes(self):
        return [p for p in self.mqtt.publicado if "/cmd/" in p[0]]

    def test_nunca_publica_en_los_topics_antiguos(self):
        self.llega("sensors", sensors())
        self.llega("actuators", actuators())
        self.http.post("/api/salidas", json={c.SALIDA_RES: True, "DigitalOut5_value": True})
        self.http.post("/api/emergencia", json={"activo": True})
        self.http.post("/api/control", json={"activo": True})
        self.llega("sensors", sensors())
        web.refrescar_ordenes()
        web.scada.tick()
        self.assertTrue(self.mqtt.publicado)
        for topic, *_ in self.mqtt.publicado:
            self.assertTrue(topic.startswith("pct23/real-01/"), topic)
            self.assertFalse(topic.startswith("pct_23/"), topic)

    def test_los_datos_llegan_a_la_pagina_en_formato_antiguo(self):
        self.llega("sensors", sensors())
        self.llega("actuators", actuators(heater_pct=0, n1_on=True))
        i = web.instantanea()
        self.assertTrue(i["gateway"])
        self.assertEqual((i["datos"]["AnalogIn1_value"], i["datos"]["TransistorOut8_value"]), (0.52, True))
        self.assertTrue(i["hora_planta"])

    def test_sin_sensors_la_planta_no_responde_y_las_ordenes_dan_503(self):
        self.assertFalse(web.instantanea()["gateway"])
        r = self.http.post("/api/salidas", json={"DigitalOut5_value": True})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(self.ordenes(), [])

    def test_salidas_se_traducen_a_cmd_con_id(self):
        self.llega("sensors", sensors())
        r = self.http.post("/api/salidas", json={"DigitalOut3_value": True, "TransistorOut8_value": True})
        self.assertEqual(r.status_code, 200)
        por_tag = {p[0].rsplit("/", 1)[1]: p[1] for p in self.ordenes()}
        self.assertEqual((por_tag["sol1_divert"]["value"], por_tag["n1_on"]["value"]), (False, True))
        self.assertTrue(por_tag["n1_on"]["id"])
        self.assertEqual(self.http.post("/api/salidas", json={"DigitalOut1_value": True}).status_code, 400)       # nada válido

    def test_la_emergencia_manda_emergency_stop_y_el_rearme_reset_safe_state(self):
        self.llega("sensors", sensors())
        r = self.http.post("/api/emergencia", json={"activo": True})
        self.assertEqual((r.status_code, r.get_json()["enviado"]), (200, True))
        self.assertEqual([p[0] for p in self.ordenes()], ["pct23/real-01/cmd/emergency_stop"])
        self.assertTrue(web.emergencia_pedida)
        web.refrescar_ordenes()                                                    # se repite con id NUEVO hasta que la planta lo confirme
        ids = [p[1]["id"] for p in self.ordenes()]
        self.assertEqual(len(set(ids)), 2)
        self.llega("status", {"state": "online", "safe_state": True, "safe_reason": "emergency_stop"})
        self.assertFalse(web.emergencia_pedida)
        self.mqtt.publicado.clear()
        self.assertEqual(self.http.post("/api/emergencia", json={"activo": False}).status_code, 200)
        self.assertEqual([p[0] for p in self.ordenes()], ["pct23/real-01/cmd/reset_safe_state"])

    def test_la_parada_sale_aunque_aun_no_haya_sensors(self):
        r = self.http.post("/api/emergencia", json={"activo": True})
        self.assertEqual((r.status_code, r.get_json()["enviado"]), (200, True))

    def test_la_orden_de_calentar_se_renueva_con_id_nuevo_cada_vez(self):
        self.llega("sensors", sensors())
        self.http.post("/api/salidas", json={c.SALIDA_RES: True})
        web.refrescar_ordenes()
        calentar = [p for p in self.ordenes() if p[0].endswith("heater_pct")]
        self.assertEqual(len(calentar), 2)
        self.assertEqual({p[1]["value"] for p in calentar}, {100})
        self.assertEqual(len({p[1]["id"] for p in calentar}), 2)

    def test_si_se_pierde_la_planta_el_control_se_desactiva_y_manda_heater_0(self):
        self.llega("sensors", sensors(t1_c=22.0, t2_c=22.0))
        self.http.post("/api/control", json={"activo": True})
        self.llega("sensors", sensors(t1_c=22.0, t2_c=22.0))                       # frío: el módulo de control manda calentar
        self.assertEqual([p[1]["value"] for p in self.ordenes() if p[0].endswith("heater_pct")][-1], 100)
        self.mono.t += sc.GATEWAY_TIMEOUT_S + 1                                   # la planta deja de enviar sensors
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertFalse(web.control.activo)
        heater = [p[1]["value"] for p in self.ordenes() if p[0].endswith("heater_pct")]
        self.assertEqual(heater, [0])
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertEqual(self.ordenes(), [])                                       # y ya no insiste

    def test_el_modulo_repite_las_ordenes_cada_5_s_con_id_nuevo(self):
        web.control = mc.ModuloControl(reloj=self.mono)
        self.llega("sensors", sensors(t1_c=22.0, t2_c=22.0))
        self.http.post("/api/control", json={"activo": True})
        self.llega("sensors", sensors(t1_c=22.0, t2_c=22.0))
        n0 = len([p for p in self.ordenes() if p[0].endswith("heater_pct")])
        self.mono.t += 2; self.llega("sensors", sensors(t1_c=22.0, t2_c=22.0))
        self.assertEqual(len([p for p in self.ordenes() if p[0].endswith("heater_pct")]), n0)       # aún no toca
        self.mono.t += 4; self.llega("sensors", sensors(t1_c=22.0, t2_c=22.0))
        ids = [p[1]["id"] for p in self.ordenes() if p[0].endswith("heater_pct")]
        self.assertEqual(len(ids), n0 + 1); self.assertEqual(len(set(ids)), len(ids))

    def test_la_pagina_cambia_a_cascada_por_la_api_y_ve_su_estado(self):
        r = self.http.post("/api/control", json={"modo": "cascada", "consigna": 40, "kp": 2.0})
        j = r.get_json()
        self.assertEqual((r.status_code, j["modo"], j["variable"], j["consigna"], j["kp"]), (200, "cascada", "T1", 40.0, 2.0))
        self.llega("sensors", sensors(t1_c=30.0, t2_c=40.0))
        self.http.post("/api/control", json={"activo": True}); self.llega("sensors", sensors(t1_c=30.0, t2_c=40.0))
        self.assertIsNotNone(web.instantanea()["control"]["t2_objetivo"])                # la página ve la consigna de T2 que calcula el lazo externo
        self.assertEqual(self.http.post("/api/control", json={"modo": "pid"}).status_code, 400)

    def test_la_pagina_cambia_variable_y_consigna_por_la_api(self):
        r = self.http.post("/api/control", json={"variable": "T1", "consigna": 47})
        self.assertEqual((r.status_code, r.get_json()["variable"], r.get_json()["consigna"]), (200, "T1", 47.0))
        self.assertEqual(self.http.post("/api/control", json={"variable": "T9"}).status_code, 400)
        self.assertEqual(self.http.post("/api/control", json={"consigna": 5}).status_code, 400)

    def test_con_estado_seguro_o_overtemp_no_se_renueva(self):
        for aviso in ({"status": {"state": "online", "safe_state": True, "safe_reason": "watchdog"}},
                      {"alarms": {"alarm": "overtemp", "event": "raised", "severity": "critical"}}):
            self.setUp()
            self.llega("sensors", sensors())
            self.http.post("/api/salidas", json={c.SALIDA_RES: True})
            for sufijo, datos in aviso.items():
                self.llega(sufijo, datos)
            self.mqtt.publicado.clear()
            web.refrescar_ordenes()
            self.assertFalse(web.res_deseado, aviso)
            self.assertEqual([p[1]["value"] for p in self.ordenes() if p[0].endswith("heater_pct")], [0], aviso)

    def test_el_control_t1_se_desactiva_con_estado_seguro(self):
        self.llega("sensors", sensors())
        self.http.post("/api/control", json={"activo": True})
        self.llega("status", {"state": "online", "safe_state": True, "safe_reason": "watchdog"})
        self.llega("sensors", sensors())                                           # el siguiente paso del control ve el motivo «estado_seguro»
        self.assertFalse(web.control.activo)
        self.assertIn("Estado seguro", web.control.estado()["aviso"])

    def test_sin_hora_de_la_planta_no_se_anota_la_orden_de_encender(self):
        web.scada = sc.ClienteScada("real-01", lambda *a: None, reloj_mono=self.mono)
        web.scada.conectar()
        web.publicar({c.SALIDA_RES: True})
        self.assertFalse(web.res_deseado)


# ------------------------------------------------------------------------- integración con el núcleo del contrato ----
class PlantaDePrueba(Planta):
    def __init__(self):
        self.s = sensors()
        self.a = {"sol1_divert": True, "sol2_feed_tank": "A", "sol3_cooling": False, "sol4_fill_a": False, "sol5_fill_b": False, "n1_on": False,
                  "n1_speed_pct": 50, "n2_on": False, "heater_pct": 0, "heater_inhibited": False}

    def leer_sensores(self):
        return dict(self.s)

    def aplicar(self, pedido):
        self.a.update(pedido)
        return dict(self.a)

    def estado_actuadores(self):
        return dict(self.a)


class IntegracionConElNucleo(unittest.TestCase):
    """SCADA y tarjeta (Controlador) hablando por un bus en memoria, con relojes DISTINTOS: el PC va 1 hora por delante de la planta."""

    OFFSET_PC = 3600.0

    def setUp(self):
        self.planta, self.reloj = PlantaDePrueba(), RelojSimulado("2026-11-24T10:00:00.000Z")
        self.mono = Mono()
        self.tarjeta = Controlador("real-01", self.planta, self.reloj, self.de_tarjeta)
        self.scada = sc.ClienteScada("real-01", self.de_scada, reloj_local=lambda: self.reloj.ahora() + self.OFFSET_PC, reloj_mono=self.mono)
        self.acks = []
        self.tarjeta.conectar()
        self.scada.conectar()
        self.avanzar(1.0)

    def de_tarjeta(self, topic, payload, qos, retain):
        payload = json.loads(json.dumps(payload))
        if "/cmd/" in topic and topic.endswith("/ack"):
            self.acks.append((topic, payload))
        self.scada.on_message(topic, payload)

    def de_scada(self, topic, payload, qos, retain):
        self.tarjeta.on_message(topic, json.loads(json.dumps(payload)))

    def avanzar(self, segundos, paso=0.5):
        t = 0.0
        while t < segundos - 1e-9:
            self.reloj.avanzar(paso)
            self.mono.t += paso
            self.scada.tick()
            self.tarjeta.tick()
            t += paso

    def test_una_orden_con_la_hora_de_la_planta_se_acepta_aunque_el_pc_vaya_una_hora_adelantado(self):
        self.assertTrue(self.scada.gateway_vivo())
        oid = self.scada.ordenes_antiguas({"DigitalOut5_value": True})["enviadas"][0]
        self.assertEqual(self.scada.resultado(oid), "aceptada")
        self.assertTrue(self.planta.a["sol3_cooling"])
        self.assertTrue(self.scada.estado_antiguo()["DigitalOut5_value"])

    def test_con_la_hora_del_pc_la_tarjeta_la_rechazaria(self):
        self.tarjeta.on_message("pct23/real-01/cmd/sol3_cooling", {"id": "x1", "ts": iso_utc(self.reloj.ahora() + self.OFFSET_PC), "value": True})
        self.assertEqual(self.acks[-1][1]["reason"], "invalid_value")             # la hora del futuro (reloj desajustado)

    def test_la_resistencia_se_enciende_y_se_apaga(self):
        self.scada.ordenes_antiguas({c.SALIDA_RES: True})
        self.assertEqual(self.planta.a["heater_pct"], 100)
        self.scada.ordenes_antiguas({c.SALIDA_RES: False})
        self.assertEqual(self.planta.a["heater_pct"], 0)

    def test_un_interlock_se_rechaza_y_no_se_reintenta(self):
        self.planta.s["stat_overtemp"] = True
        self.avanzar(1.0)
        oid = self.scada.enviar_orden("heater_pct", 40)["id"]
        self.assertEqual(self.scada.resultado(oid), "rechazada")
        self.assertEqual(self.scada.rechazos_recientes()[-1]["reason"], "interlock_overtemp")
        n = len(self.acks)
        self.avanzar(10.0)
        self.assertEqual(len([a for a in self.acks if a[1]["id"] == oid]), 1)
        self.assertGreaterEqual(len(self.acks), n)

    def test_el_latido_evita_el_estado_seguro(self):
        self.avanzar(30.0)
        self.assertFalse(self.tarjeta.safe_state)
        self.assertTrue(self.scada.gateway_vivo())

    def test_sin_latido_la_tarjeta_pasa_a_estado_seguro_y_el_scada_lo_ve(self):
        self.scada.desconectar()                                                  # el SCADA calla (no publica latido)
        self.reloj.avanzar(11.0)
        self.tarjeta.tick()
        self.assertTrue(self.tarjeta.safe_state)
        d = self.scada.estado_antiguo()
        self.assertEqual((d["safe_state"], d["motivos_bloqueo"]), (True, ["estado_seguro"]))

    def test_emergencia_y_rearme_de_extremo_a_extremo(self):
        self.scada.ordenes_antiguas({c.SALIDA_RES: True, "TransistorOut8_value": True})
        self.assertEqual(self.planta.a["heater_pct"], 100)
        self.scada.paro_emergencia(True)
        self.assertTrue(self.tarjeta.safe_state)
        self.assertEqual((self.planta.a["heater_pct"], self.planta.a["n1_on"]), (0, False))
        d = self.scada.estado_antiguo()
        self.assertEqual((d["paro_emergencia"], d["TransistorOut3_value"]), (True, False))
        oid = self.scada.ordenes_antiguas({c.SALIDA_RES: True})["enviadas"][0]       # en estado seguro no se acepta calentar
        self.assertEqual(self.scada.resultado(oid), "rechazada")
        self.assertEqual(self.scada.rechazos_recientes()[-1]["reason"], "safe_state")
        self.scada.paro_emergencia(False)
        self.avanzar(0.5)
        self.assertFalse(self.tarjeta.safe_state)

    def test_la_emergencia_sirve_aunque_el_scada_no_conozca_la_hora(self):
        nuevo = sc.ClienteScada("real-01", self.de_scada, reloj_local=lambda: self.reloj.ahora() + self.OFFSET_PC, reloj_mono=self.mono)
        nuevo.conectar()                                                          # aún no ha recibido ningún sensors
        self.assertIsNone(nuevo.hora_planta())
        nuevo.paro_emergencia(True)
        self.assertTrue(self.tarjeta.safe_state)
        self.assertEqual(self.tarjeta.safe_reason, "emergency_stop")


if __name__ == "__main__":
    unittest.main(verbosity=2)


# ------------------------------------------------------------------------------- hora: servidor de tiempo y desfase monotónico ----
class RelojHoraFalso:
    def __init__(self, t, sincronizado=True):
        self.t, self.sincronizado = t, sincronizado

    def ahora(self):
        return self.t


class HoraDeLaPlanta(unittest.TestCase):
    def cl(self, **kw):
        mono = Mono(); publicado = []
        cli = sc.ClienteScada("real-01", lambda t, p, q, r: publicado.append((t, p)), reloj_local=lambda: 0.0, reloj_mono=mono, **kw)
        cli.conectar(); return cli, mono, publicado

    def sensors_con_ts(self, cli, ts):
        cli.on_message("pct23/real-01/sensors", {**sensors(), "ts": iso_utc(ts), "seq": 1})

    def test_con_servidor_de_tiempo_sincronizado_manda_su_hora(self):
        reloj = RelojHoraFalso(parse_iso("2030-01-01T00:00:00.000Z"))
        cli, mono, pub = self.cl(reloj_hora=reloj)
        self.assertEqual(cli.hora_planta(), reloj.t)                                   # sin recibir ningún sensors ya hay hora (antes: sin_hora_planta)
        self.assertTrue(cli.enviar_orden("sol3_cooling", True)["enviada"])
        self.assertEqual(pub[-1][1]["ts"], "2030-01-01T00:00:00.000Z")

    def test_si_no_esta_sincronizado_se_estima_con_los_sensors(self):
        cli, mono, _ = self.cl(reloj_hora=RelojHoraFalso(0.0, sincronizado=False))
        self.assertIsNone(cli.hora_planta())
        self.sensors_con_ts(cli, 5000.0); mono.t += 3.0
        self.assertAlmostEqual(cli.hora_planta(), 5003.0, places=3)

    def test_inmune_a_un_salto_de_la_hora_del_equipo(self):
        reloj_local = [1000.0]
        mono = Mono(); cli = sc.ClienteScada("real-01", lambda *a: None, reloj_local=lambda: reloj_local[0], reloj_mono=mono); cli.conectar()
        self.sensors_con_ts(cli, 5000.0)
        reloj_local[0] += 3600.0; mono.t += 1.0                                         # NTP adelanta el reloj del equipo una hora
        self.assertAlmostEqual(cli.hora_planta(), 5001.0, places=3)                    # la hora de la planta no se entera

    def test_si_la_planta_cambia_de_hora_el_desfase_se_reinicia(self):
        cli, mono, _ = self.cl()
        for k in range(5):
            mono.t += 1.0; self.sensors_con_ts(cli, 5000.0 + k)
        mono.t += 1.0; self.sensors_con_ts(cli, 90000.0)                                # la planta reinició con otra hora (o la sincronizó el servidor)
        self.assertAlmostEqual(cli.hora_planta(), 90000.0, places=3)                    # antes quedaba mal hasta 10 muestras

    def test_la_parada_sigue_saliendo_sin_hora_conocida(self):
        cli, _, pub = self.cl()
        self.assertTrue(cli.enviar_orden("emergency_stop", True)["enviada"]); self.assertFalse(cli.enviar_orden("sol3_cooling", True)["enviada"])
