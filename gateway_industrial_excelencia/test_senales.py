"""Nombres de la planta (T1, SOL1, N1...) frente a los canales en bruto del gateway.

Ejecutar:  python -m unittest test_senales
"""
import unittest

from gateway_main_app import Gateway
from senales import CONSIGNAS, DIGITALES, SALIDAS, TEMPERATURAS, a_crudo, amigables


class Lectura(unittest.TestCase):
    def test_temperaturas_en_grados(self):
        r = amigables({"AnalogIn1_value": 0.25, "AnalogIn2_value": 0.5, "AnalogIn3_value": 1.0, "AnalogIn4_value": 1.5})
        self.assertEqual((r["T1"], r["T2"], r["T3"], r["T4"]), (25.0, 50.0, 100.0, 150.0))

    def test_caudal_a_fondo_de_escala_y_a5_es_t5(self):
        r = amigables({"AnalogIn7_value": 3.3, "AnalogIn5_value": 0.2})
        self.assertEqual(r["F1"], 1500.0)
        self.assertEqual(r["T5"], 20.0)                    # AnalogIn5 es la sonda T5
        self.assertNotIn("L1", r)                          # el nivel del tanque A no llega a ninguna entrada

    def test_digitales_salidas_y_consignas(self):
        crudo = {"DigitalIn1_value": True, "DigitalIn4_value": False, "DigitalOut3_value": True, "TransistorOut8_value": True,
                 "PWMOut1_value": 80.0, "AnalogOut1_value": 60.0}
        r = amigables(crudo)
        self.assertIs(r["TERM"], True)
        self.assertIs(r["LL"], False)
        self.assertIs(r["SOL1"], True)
        self.assertIs(r["N1"], True)
        self.assertEqual((r["N1_velocidad"], r["RES_potencia"]), (80.0, 60.0))

    def test_solo_salen_las_senales_con_lectura(self):
        self.assertEqual(amigables({}), {})
        self.assertNotIn("T2", amigables({"AnalogIn1_value": 0.2}))

    def test_los_nombres_no_se_repiten_ni_chocan_con_los_canales(self):
        nombres = [*TEMPERATURAS, "F1", *DIGITALES, *SALIDAS, *CONSIGNAS]
        self.assertEqual(len(nombres), len(set(nombres)))
        self.assertFalse(any(n.endswith("_value") for n in nombres))

    def test_cada_canal_ordenable_existe_en_el_gateway(self):
        from runtime import Runtime
        rt = Runtime(simular=True)
        for nombre, canal in {**SALIDAS, **CONSIGNAS}.items():
            self.assertIn(canal, rt.outputs, nombre)
        for nombre, canal in {**DIGITALES, **TEMPERATURAS}.items():
            self.assertIn(canal, rt.inputs, nombre)


class Ordenes(unittest.TestCase):
    def test_traduce_las_claves_amigables(self):
        self.assertEqual(a_crudo({"SOL1": True, "N1": True, "N1_velocidad": 80, "RES": True, "RES_potencia": 60}),
                         {"DigitalOut3_value": True, "TransistorOut8_value": True, "PWMOut1_value": 80,
                          "TransistorOut3_value": True, "AnalogOut1_value": 60})

    def test_deja_pasar_las_claves_en_bruto_y_el_paro(self):
        orden = {"DigitalOut3_value": True, "paro_emergencia": True, "ClaveRara": 1}
        self.assertEqual(a_crudo(orden), orden)

    def test_si_llegan_las_dos_formas_manda_la_de_bruto(self):
        self.assertEqual(a_crudo({"SOL1": True, "DigitalOut3_value": False}), {"DigitalOut3_value": False})

    def test_una_lectura_no_es_una_orden(self):
        self.assertEqual(a_crudo({"T1": 25.0}), {"T1": 25.0})      # T1 no es ordenable: pasa y el gateway lo ignora


class EnElGateway(unittest.TestCase):
    def setUp(self):
        self.gw = Gateway("127.0.0.1", 1883, simular=True)

    def test_el_payload_lleva_los_dos_juegos_de_nombres(self):
        self.gw.runtime.start()
        try:
            import time
            time.sleep(0.4)
            p = self.gw.build_inputs_payload()
        finally:
            self.gw.runtime.stop()
        for clave in ("AnalogIn1_value", "T1", "T2", "F1", "TERM", "SOL1", "N1", "N1_velocidad", "RES_potencia", "paro_emergencia", "timestamp"):
            self.assertIn(clave, p)
        self.assertEqual(p["T1"], round(p["AnalogIn1_value"] * 100, 2))
        self.assertEqual(p["SOL1"], p["DigitalOut3_value"])

    def test_una_orden_con_nombres_amigables_llega_a_las_salidas(self):
        class Msg:
            topic = "pct_23/salidas"
            payload = b'{"SOL1": true, "SOL3": true}'
        self.gw.on_message(None, None, Msg)
        self.assertTrue(self.gw.runtime.outputs["DigitalOut3_value"])
        self.assertTrue(self.gw.runtime.outputs["DigitalOut5_value"])
        self.assertFalse(self.gw.runtime.outputs["DigitalOut4_value"])



class EnElServidorWeb(unittest.TestCase):
    def test_la_orden_amigable_de_calentar_se_renueva_como_la_de_bruto(self):
        import servidor_web
        for orden in ({"RES": True}, {"TransistorOut3_value": True}):
            servidor_web.res_deseado = False
            servidor_web.registrar_orden(orden)
            self.assertTrue(servidor_web.res_deseado, orden)
            servidor_web.registrar_orden({"RES": False} if "RES" in orden else {"TransistorOut3_value": False})
            self.assertFalse(servidor_web.res_deseado)


if __name__ == "__main__":
    unittest.main()
