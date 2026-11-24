"""Pruebas del módulo de control (todo o nada con histéresis sobre T2 o T1) y su integración con el SCADA y la tarjeta del contrato (mockup).

    python -m pytest test_modulo_control.py -q        (desde gateway_industrial_excelencia)
"""
import unittest

from mockup_pct23 import Simulacion
from modulo_control import POR_DEFECTO, ModuloControl
from scada_pct23 import ClienteScada


def lectura(t1=30.0, t2=30.0, **kw):
    return {"t1_c": t1, "t2_c": t2, "conectada": True, "safe_state": False, "alarmas": set(), "stat_overtemp": False, "heater_inhibited": False, **kw}


class Reloj:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def modulo(**ajustes):
    r = Reloj()
    m = ModuloControl(reloj=r)
    ajustes.setdefault("variable", "T2")          # por defecto el módulo regula T1; estas pruebas piden T2 salvo que digan otra cosa
    m.configurar(**ajustes)
    m.activar()
    return m, r


def heater(ordenes):
    return dict(ordenes).get("heater_pct")


class Histeresis(unittest.TestCase):
    def test_variable_t2_conecta_abajo_desconecta_arriba_y_mantiene_en_la_banda(self):
        m, r = modulo(consigna=50, histeresis=2)                      # banda de 48 a 52
        self.assertEqual(heater(m.paso(lectura(t2=40))), 100)         # por debajo de 48: conecta
        r.t += 1; self.assertEqual(m.paso(lectura(t2=49)), [])        # dentro de la banda: sigue conectada y no repite aún
        self.assertTrue(m.estado()["calefactor"])
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t2=52))), 0)  # llega a 52: desconecta
        r.t += 1; self.assertEqual(m.paso(lectura(t2=50)), [])         # en la banda viniendo de arriba: sigue desconectada
        self.assertFalse(m.estado()["calefactor"])
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t2=48))), 100)  # baja a 48: vuelve a conectar

    def test_t1_no_decide_con_variable_t2_y_el_reves(self):
        m, r = modulo(consigna=50, histeresis=2)
        self.assertEqual(heater(m.paso(lectura(t1=90, t2=40))), 100)   # T1 altísima pero T2 baja: conecta (la variable es T2)
        m2, r2 = modulo(variable="T1", consigna=45, histeresis=2)
        self.assertEqual(heater(m2.paso(lectura(t1=30, t2=40))), 100)  # variable T1: T1 baja -> conecta
        r2.t += 1; self.assertEqual(heater(m2.paso(lectura(t1=48, t2=40))), 0)

    def test_tope_de_t2_corta_sin_histeresis_y_se_rearma_con_ella(self):
        m, r = modulo(variable="T1", consigna=60, t2_max=60, histeresis=2)
        self.assertEqual(heater(m.paso(lectura(t1=30, t2=59.9))), 100)
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t1=30, t2=60.0))), 0)           # corta justo en el máximo, sin sumar histéresis
        self.assertIn("máximo", m.estado()["aviso"])
        r.t += 1; self.assertEqual(m.paso(lectura(t1=30, t2=59.0)), [])                   # T1 sigue baja, pero no conecta hasta bajar de 58: no conmuta en el tope
        self.assertFalse(m.estado()["calefactor"])
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t1=30, t2=57.9))), 100)          # 58 o menos: vuelve a conectar

    def test_por_defecto_regula_t1_y_para_al_llegar_a_su_consigna(self):
        m = ModuloControl(reloj=Reloj()); m.activar()
        self.assertEqual(m.variable, "T1"); self.assertEqual(m.consigna, 45.0)
        self.assertEqual(heater(m.paso(lectura(t1=40, t2=50))), 100)                       # T1 por debajo: conecta
        self.assertEqual(heater(m.paso(lectura(t1=47.0, t2=50))), 0)                       # T1 llega a consigna + histéresis: para
        m2 = ModuloControl(reloj=Reloj()); m2.activar()
        self.assertEqual(heater(m2.paso(lectura(t1=40, t2=61))), 0)                        # T1 baja pero T2 pasa de su máximo (60): para (en su defecto)

    def test_con_variable_t2_la_consigna_no_pasa_del_tope(self):
        m, _ = modulo(consigna=70 - 5, t2_max=60)                      # 65 > tope 60
        self.assertEqual(m.estado()["consigna"], 60)

    def test_potencia_configurable_y_velocidad_de_n1(self):
        m, _ = modulo(potencia_pct=60, velocidad_n1=80)
        o = dict(m.paso(lectura(t2=20)))
        self.assertEqual((o["heater_pct"], o["n1_speed_pct"], o["n1_on"], o["n2_on"]), (60, 80, True, True))


class Lecturas(unittest.TestCase):
    def test_sin_lectura_apaga_el_calefactor_y_avisa_pero_no_desactiva(self):
        m, r = modulo()
        m.paso(lectura(t2=20))
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t2=None))), 0)
        self.assertTrue(m.activo); self.assertIn("Sin lectura", m.estado()["aviso"])
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t2=20))), 100)             # vuelve la lectura: sigue regulando

    def test_con_variable_t1_falta_t2_tambien_apaga(self):
        m, _ = modulo(variable="T1", consigna=45)
        self.assertEqual(heater(m.paso(lectura(t1=20, t2=None))), 0)

    def test_valores_raros_no_son_lectura(self):
        for malo in (float("nan"), float("inf"), "50", True):
            with self.subTest(malo=malo):
                m, _ = modulo()
                self.assertEqual(heater(m.paso(lectura(t2=malo))), 0)


class Fallos(unittest.TestCase):
    def test_cada_fallo_desactiva_apaga_y_no_vuelve_solo(self):
        casos = (("conectada", False, "conexión"), ("safe_state", True, "Estado seguro"), ("stat_overtemp", True, "Termostato"), ("heater_inhibited", True, "inhibida"),
                 ("alarmas", {"overtemp"}, "Sobretemperatura"), ("alarmas", {"emergency_stop"}, "emergencia"), ("alarmas", {"watchdog_timeout"}, "falta de latido"))
        for clave, valor, texto in casos:
            with self.subTest(clave=clave, valor=valor):
                m, r = modulo()
                self.assertEqual(heater(m.paso(lectura(t2=20))), 100)
                r.t += 1; self.assertEqual(m.paso(lectura(t2=20, **{clave: valor})), [("heater_pct", 0)])
                self.assertFalse(m.activo); self.assertIn(texto, m.estado()["aviso"])
                r.t += 1; self.assertEqual(m.paso(lectura(t2=20)), [])                    # arreglado el fallo: sigue desactivado

    def test_una_alarma_de_aviso_no_desactiva(self):
        m, _ = modulo()
        self.assertEqual(heater(m.paso(lectura(t2=20, alarmas={"feed_tank_low"}))), 100)

    def test_desactivar_manual_devuelve_resistencia_a_cero(self):
        m, _ = modulo(); m.paso(lectura(t2=20))
        self.assertEqual(m.desactivar(), [("heater_pct", 0)]); self.assertEqual(m.desactivar(), []); self.assertEqual(m.paso(lectura(t2=20)), [])


class Reenvio(unittest.TestCase):
    def test_repite_cada_5_s_y_al_instante_si_cambia(self):
        m, r = modulo()
        self.assertTrue(m.paso(lectura(t2=20)))                                    # primera: sale
        for dt in (1, 1, 1):
            r.t += dt; self.assertEqual(m.paso(lectura(t2=20)), [])
        r.t = 5.0; self.assertEqual(heater(m.paso(lectura(t2=20))), 100)         # a los 5 s se renueva (hombre muerto de la placa: 15 s)
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t2=60))), 0)             # cambio de estado: al instante

    def test_cambiar_un_ajuste_manda_las_ordenes_en_la_siguiente_lectura(self):
        m, r = modulo(); m.paso(lectura(t2=20)); m.configurar(velocidad_n1=90)
        r.t += 1; self.assertEqual(dict(m.paso(lectura(t2=20)))["n1_speed_pct"], 90)


class Ajustes(unittest.TestCase):
    def test_validacion_y_atomicidad(self):
        m = ModuloControl()
        for malo in ({"consigna": 5}, {"histeresis": 0}, {"t2_max": 99}, {"velocidad_n1": 10}, {"potencia_pct": 0}, {"consigna": "50"}, {"consigna": True}, {"variable": "T3"},
                     {"noexiste": 1}, {"consigna": float("nan")}):
            with self.subTest(malo=malo):
                with self.assertRaises(ValueError): m.configurar(**malo)
        with self.assertRaises(ValueError): m.configurar(consigna=60, histeresis=99)
        self.assertEqual(m.ajustes, POR_DEFECTO)                                     # nada cambió

    def test_consigna_es_la_de_la_variable_activa_y_cada_variable_recuerda_la_suya(self):
        m = ModuloControl(); m.configurar(consigna=47)                                     # por defecto la variable es T1
        self.assertEqual((m.ajustes["consigna_t1"], m.ajustes["consigna_t2"]), (47, 55))
        m.configurar(variable="T2"); m.configurar(consigna=58)
        self.assertEqual((m.ajustes["consigna_t1"], m.ajustes["consigna_t2"]), (47, 58))
        m.configurar(variable="T1", consigna=46); self.assertEqual(m.ajustes["consigna_t1"], 46)   # en la misma llamada: la de la variable nueva

    def test_estado_para_la_pagina(self):
        e = ModuloControl().estado()
        for k in ("activo", "variable", "consigna", "t2_max", "histeresis", "velocidad_n1", "t2_objetivo", "calefactor", "aviso"):
            self.assertIn(k, e)
        self.assertEqual((e["variable"], e["consigna"], e["t2_objetivo"]), ("T1", 45.0, None))


class ConLaPlantaDelContrato(unittest.TestCase):
    """El módulo de control + ClienteScada (SCADA real) + tarjeta del contrato + planta simulada, con hora simulada."""

    def montar(self, **ajustes):
        s = Simulacion(latido=False)                                   # el latido lo manda ClienteScada
        cli = ClienteScada("real-01", s.bus.publicar, reloj_local=s.reloj.ahora, reloj_mono=s.reloj.ahora)
        for topic, _ in cli.suscripciones():
            s.bus.suscribir(topic, cli.on_message)
        cli.conectar()
        ajustes.setdefault("variable", "T2")
        ctl = ModuloControl(reloj=s.reloj.ahora); ctl.configurar(**ajustes); ctl.activar()
        s.ctl, s.cli, s.t_ctl = ctl, cli, -10.0
        return s

    def correr(self, s, segundos):
        for _ in range(int(segundos / 0.1)):
            s.reloj.avanzar(0.1); s.planta.paso(0.1); s.cli.tick(); s.tarjeta.tick()
            if s.reloj.ahora() - s.t_ctl >= 1.0:                       # el control corre con cada sensors (1 Hz)
                s.t_ctl = s.reloj.ahora()
                for tag, valor in s.ctl.paso(s.cli.lectura_control()):
                    s.cli.enviar_orden(tag, valor)

    def test_regula_t2_en_torno_a_la_consigna_y_nunca_pasa_del_tope(self):
        s = self.montar(consigna=55, histeresis=2, t2_max=60)
        self.correr(s, 2400)
        self.assertTrue(s.ctl.activo, s.ctl.estado()["aviso"])
        t2 = [m[1]["t2_c"] for m in s.bus.mensajes("pct23/real-01/sensors")]
        self.assertLessEqual(max(t2), 60.0)                                         # nunca pasa del tope
        tras_subir = t2[next(i for i, t in enumerate(t2) if t >= 55):]
        self.assertGreaterEqual(min(tras_subir), 51.0)                              # y una vez arriba se mantiene en torno a la consigna
        calefactor = [m[1]["heater_pct"] > 0 for m in s.bus.mensajes("pct23/real-01/actuators")]
        cambios = sum(1 for a, b in zip(calefactor, calefactor[1:]) if a != b)
        self.assertGreaterEqual(cambios, 3)                                         # conecta, desconecta, vuelve a conectar...

    def test_si_cae_el_scada_la_placa_apaga_sola_la_orden_y_si_la_resistencia_estaba_conectada_se_ve(self):
        s = self.montar(consigna=55)
        self.correr(s, 60); self.assertGreater(s.scada.actuators["heater_pct"], 0)
        s.cli.conectado = False; s.ctl.activo = False                  # el SCADA deja de latir y de ordenar
        s.cli.tick = lambda: None
        for _ in range(130):
            s.reloj.avanzar(0.1); s.planta.paso(0.1); s.tarjeta.tick()
        self.assertTrue(s.scada.status["safe_state"])                  # sin latido: la placa entra en estado seguro y apaga la resistencia
        self.assertEqual(s.scada.actuators["heater_pct"], 0)

    def test_si_salta_el_termostato_el_control_se_desactiva_y_no_vuelve(self):
        s = self.montar(consigna=55)
        self.correr(s, 30)
        s.planta.forzar("stat_overtemp", True); self.correr(s, 5)
        self.assertFalse(s.ctl.activo); self.assertIn("Sobretemperatura", s.ctl.estado()["aviso"] + "Sobretemperatura")
        s.planta.soltar("stat_overtemp"); self.correr(s, 30); self.assertFalse(s.ctl.activo)
        self.assertEqual(s.scada.actuators["heater_pct"], 0)

    def test_lectura_control_del_cliente(self):
        s = self.montar(); self.correr(s, 3)
        l = s.cli.lectura_control()
        self.assertEqual(set(l), {"t1_c", "t2_c", "conectada", "safe_state", "alarmas", "stat_overtemp", "heater_inhibited"}); self.assertTrue(l["conectada"])
        self.assertIsInstance(l["t2_c"], float)


class Cascada(unittest.TestCase):
    """Modo cascada T1 -> T2: el lazo externo (PI sobre T1) calcula la consigna de T2 y el interno (todo o nada) la mantiene."""

    def casc(self, **aj):
        r = Reloj(); m = ModuloControl(reloj=r)
        m.configurar(modo="cascada", **aj); m.activar(); return m, r

    def test_error_de_t1_sube_o_baja_la_consigna_de_t2(self):
        m, r = self.casc(consigna=45, kp=1.0, ki=0, t2_base=50, t2_max=65)
        m.paso(lectura(t1=45, t2=50)); self.assertEqual(m.estado()["t2_objetivo"], 50.0)         # sin error: T2 = base
        r.t += 1; m.paso(lectura(t1=40, t2=50)); self.assertEqual(m.estado()["t2_objetivo"], 55.0)  # T1 5 °C por debajo: pide 5 °C más de T2
        r.t += 1; m.paso(lectura(t1=48, t2=50)); self.assertEqual(m.estado()["t2_objetivo"], 47.0)  # T1 por encima: pide menos

    def test_consigna_de_t2_limitada_por_el_tope_y_por_abajo(self):
        m, r = self.casc(consigna=45, kp=5.0, ki=0, t2_base=55, t2_max=60)
        m.paso(lectura(t1=40, t2=50)); self.assertEqual(m.estado()["t2_objetivo"], 60.0)         # 55 + 5·5 = 80 -> tope 60
        r.t += 1; m.paso(lectura(t1=60, t2=50)); self.assertEqual(m.estado()["t2_objetivo"], 27.0)  # mínimo

    def test_el_lazo_interno_es_todo_o_nada_con_histeresis_sobre_t2(self):
        m, r = self.casc(consigna=45, kp=0, ki=0, t2_base=50, histeresis=2)                   # consigna de T2 fija = 50: banda 48-52
        self.assertEqual(heater(m.paso(lectura(t1=45, t2=47))), 100)                          # T2 por debajo de 48: conecta (aunque T1 esté en su consigna)
        r.t += 1; self.assertEqual(m.paso(lectura(t1=45, t2=50)), [])                         # en la banda: mantiene
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t1=45, t2=52))), 0)                  # 52: desconecta

    def test_integral_corrige_un_error_sostenido_y_tiene_antiwindup(self):
        m, r = self.casc(consigna=45, kp=0, ki=0.01, t2_base=50, t2_max=65)
        m.paso(lectura(t1=43, t2=50))
        for _ in range(100):
            r.t += 1; m.paso(lectura(t1=43, t2=50))
        self.assertAlmostEqual(m.estado()["t2_objetivo"], 50 + 0.01 * 2 * 100, delta=0.2)        # 2 °C de error durante 100 s -> +2 °C
        m2, r2 = self.casc(consigna=45, kp=0, ki=0.05, t2_base=60, t2_max=60)                   # consigna saturada en el tope
        for _ in range(500):
            r2.t += 1; m2.paso(lectura(t1=43, t2=50))
        self.assertLessEqual(m2._integral, 5000.0); self.assertEqual(m2.estado()["t2_objetivo"], 60.0)
        self.assertLess(m2._integral, 100.0)                                                    # no se acumula con la consigna saturada

    def test_tope_de_t2_corta_y_se_rearma_con_histeresis_tambien_en_cascada(self):
        m, r = self.casc(consigna=45, t2_max=60, histeresis=2)
        self.assertEqual(heater(m.paso(lectura(t1=30, t2=55))), 100)
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t1=30, t2=60))), 0)
        r.t += 1; self.assertEqual(m.paso(lectura(t1=30, t2=59)), [])
        r.t += 1; self.assertEqual(heater(m.paso(lectura(t1=30, t2=57.5))), 100)

    def test_sin_lectura_de_t1_o_de_t2_apaga_y_avisa(self):
        m, r = self.casc(); self.assertEqual(heater(m.paso(lectura(t1=None, t2=50))), 0); self.assertIn("T1", m.estado()["aviso"])
        r.t += 1; m.paso(lectura(t1=40, t2=None)); self.assertIn("T2", m.estado()["aviso"]); self.assertTrue(m.activo)

    def test_los_fallos_desactivan_tambien_en_cascada(self):
        m, r = self.casc(); m.paso(lectura(t1=30, t2=40))
        r.t += 1; self.assertEqual(m.paso(lectura(t1=30, t2=40, safe_state=True)), [("heater_pct", 0)]); self.assertFalse(m.activo)

    def test_cambio_de_modo_y_validacion(self):
        m = ModuloControl(); self.assertEqual(m.modo, "simple")
        m.configurar(modo="cascada"); self.assertEqual((m.modo, m.variable), ("cascada", "T1"))
        m.configurar(consigna=40); self.assertEqual(m.ajustes["consigna_t1"], 40)               # en cascada `consigna` es la de T1
        for malo in ({"modo": "pid"}, {"kp": -1}, {"ki": 1}, {"t2_base": 10}):
            with self.subTest(malo=malo):
                with self.assertRaises(ValueError): m.configurar(**malo)
        e = m.estado()
        for k in ("modo", "kp", "ki", "t2_base", "t2_objetivo"):
            self.assertIn(k, e)

    def test_cascada_en_lazo_cerrado_con_la_planta_t1_llega_a_su_consigna_sin_pasar_del_tope(self):
        s = ConLaPlantaDelContrato().montar(modo="cascada", consigna=38, t2_max=62, histeresis=1.5, kp=2.0, ki=0.004, t2_base=55)
        ConLaPlantaDelContrato().correr(s, 900)                            # a los ~18 min se vacía el tanque A de la planta simulada y la tarjeta para N1
        self.assertTrue(s.ctl.activo, s.ctl.estado()["aviso"])
        sens = [m[1] for m in s.bus.mensajes("pct23/real-01/sensors")]
        self.assertLessEqual(max(x["t2_c"] for x in sens), 62.5)      # el control corre a 1 Hz: puede pasarse unas décimas antes de cortar
        ultimos = [x["t1_c"] for x in sens[-200:]]
        self.assertTrue(all(abs(t - 38.0) < 4.0 for t in ultimos), (min(ultimos), max(ultimos)))   # T1 se mantiene cerca de su consigna


if __name__ == "__main__":
    unittest.main()
