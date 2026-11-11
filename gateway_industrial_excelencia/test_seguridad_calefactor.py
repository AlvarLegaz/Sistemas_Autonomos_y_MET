"""Enclavamiento del termostato: la resistencia solo conduce si el termostato (DigitalIn1) esta cerrado.

Se prueba con el runtime simulado (sin Raspberry). Ejecutar:  python test_seguridad_calefactor.py
"""
import time
import unittest

from runtime import (MOTIVO_PARO, MOTIVO_SONDA_T2, MOTIVO_TERMOSTATO_ABIERTO, MOTIVO_TERMOSTATO_SIN_LECTURA, OUT_RESISTENCIA,
                     SALIDA_RESISTENCIA, Runtime)


def conduce(rt):
    """True si la resistencia conduce en algun tick de una ventana de rafagas completa (100 % de potencia)."""
    return any(rt.transistores_efectivos(tick)[OUT_RESISTENCIA - 1] for tick in range(0, 400, 4))


def esperar_scan(segundos=0.35):
    time.sleep(segundos)          # el scan lento es de 100 ms


class Termostato(unittest.TestCase):
    def setUp(self):
        self.rt = Runtime(simular=True)
        self.rt.start()
        esperar_scan()

    def tearDown(self):
        if self.rt.running:
            self.rt.stop()

    def termostato(self, cerrado):
        self.rt.digital_input_driver.termostato_ok = cerrado
        esperar_scan()

    def test_con_el_termostato_cerrado_la_resistencia_conduce(self):
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.assertTrue(conduce(self.rt))
        self.assertEqual(self.rt.diagnostico()["motivos_bloqueo"], [])
        self.assertFalse(self.rt.diagnostico()["calefactor_bloqueado"])

    def test_si_el_termostato_se_abre_la_resistencia_se_apaga(self):
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.termostato(False)
        self.assertFalse(conduce(self.rt))
        self.assertFalse(self.rt.readOutputs()[SALIDA_RESISTENCIA])      # la orden queda borrada
        d = self.rt.diagnostico()
        self.assertTrue(d["calefactor_bloqueado"])
        self.assertEqual(d["motivos_bloqueo"], [MOTIVO_TERMOSTATO_ABIERTO])

    def test_con_el_termostato_abierto_no_se_acepta_la_orden_de_calentar(self):
        self.termostato(False)
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.assertFalse(self.rt.readOutputs()[SALIDA_RESISTENCIA])
        self.assertFalse(conduce(self.rt))

    def test_al_cerrarse_el_termostato_no_se_rearma_sola(self):
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.termostato(False)
        self.termostato(True)
        self.assertFalse(self.rt.diagnostico()["calefactor_bloqueado"])      # el bloqueo se levanta...
        self.assertFalse(conduce(self.rt))                                   # ...pero sigue apagada
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})                   # hay que ordenarlo de nuevo
        self.assertTrue(conduce(self.rt))

    def test_no_afecta_a_las_bombas(self):
        self.rt.update_outputs({"TransistorOut7_value": True, "TransistorOut8_value": True, SALIDA_RESISTENCIA: True})
        self.termostato(False)
        self.assertTrue(self.rt.readOutputs()["TransistorOut7_value"] and self.rt.readOutputs()["TransistorOut8_value"])


class SinLectura(unittest.TestCase):
    def test_antes_del_primer_scan_no_conduce(self):
        rt = Runtime(simular=True)                       # sin arrancar: nunca se ha leido el termostato
        rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.assertFalse(conduce(rt))
        self.assertEqual(rt.diagnostico()["motivos_bloqueo"], [MOTIVO_TERMOSTATO_SIN_LECTURA])
        self.assertTrue(rt.readOutputs()[SALIDA_RESISTENCIA])             # la orden se conserva: solo falta saber el estado

    def test_si_falla_el_bus_no_se_fia_de_la_ultima_lectura(self):
        rt = Runtime(simular=True)
        rt.start()
        try:
            esperar_scan()
            rt.update_outputs({SALIDA_RESISTENCIA: True})
            self.assertTrue(conduce(rt))
            with rt.lock:
                rt.io_ok = False                         # un fallo de I2C deja el termostato sin vigilar
            self.assertFalse(conduce(rt))
            self.assertEqual(rt.diagnostico()["motivos_bloqueo"], [MOTIVO_TERMOSTATO_SIN_LECTURA])
        finally:
            rt.stop()


class SondaT2(unittest.TestCase):
    """Sin una lectura creible de T2 (5 a 145 °C) no se calienta."""

    def setUp(self):
        self.rt = Runtime(simular=True)
        self.rt.start()
        esperar_scan()

    def tearDown(self):
        self.rt.stop()

    def sonda(self, voltios):
        self.rt.analog_input_driver.t2_v = voltios
        esperar_scan()

    def test_lectura_normal_deja_calentar(self):
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.assertTrue(conduce(self.rt))

    def test_sonda_desconectada_o_en_corto_apaga_y_no_rearma(self):
        for voltios in (0.0, 0.02):                      # 0 V: desconectada o en corto (0 °C)
            self.rt.update_outputs({SALIDA_RESISTENCIA: True})
            self.sonda(voltios)
            self.assertFalse(conduce(self.rt), voltios)
            self.assertFalse(self.rt.readOutputs()[SALIDA_RESISTENCIA], voltios)
            self.assertEqual(self.rt.diagnostico()["motivos_bloqueo"], [MOTIVO_SONDA_T2])
            self.rt.update_outputs({SALIDA_RESISTENCIA: True})                 # con la sonda mal no se acepta calentar
            self.assertFalse(self.rt.readOutputs()[SALIDA_RESISTENCIA], voltios)
            self.sonda(0.5)                                                   # la sonda vuelve: sigue apagada hasta nueva orden
            self.assertFalse(conduce(self.rt))
            self.assertEqual(self.rt.diagnostico()["motivos_bloqueo"], [])

    def test_lectura_demasiado_alta_apaga(self):
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.sonda(1.6)                                  # 160 °C: sonda rota o agua muy por encima de lo posible
        self.assertFalse(conduce(self.rt))
        self.assertEqual(self.rt.diagnostico()["motivos_bloqueo"], [MOTIVO_SONDA_T2])


class CaducidadDeLaOrden(unittest.TestCase):
    def test_si_nadie_renueva_la_orden_la_resistencia_se_apaga(self):
        rt = Runtime(simular=True, caducidad_calefactor_s=0.6)
        rt.start()
        try:
            esperar_scan()
            rt.update_outputs({SALIDA_RESISTENCIA: True})
            self.assertTrue(conduce(rt))
            time.sleep(0.4)
            rt.update_outputs({SALIDA_RESISTENCIA: True})        # renovada: el plazo empieza de nuevo
            time.sleep(0.4)
            self.assertTrue(conduce(rt))
            time.sleep(0.8)                                       # ya nadie la renueva
            self.assertFalse(conduce(rt))
            self.assertFalse(rt.readOutputs()[SALIDA_RESISTENCIA])
            self.assertFalse(rt.diagnostico()["calefactor_bloqueado"])         # no es un fallo: basta con ordenar de nuevo
            rt.update_outputs({SALIDA_RESISTENCIA: True})
            self.assertTrue(conduce(rt))
        finally:
            rt.stop()

    def test_sin_caducidad_configurada_no_caduca(self):
        rt = Runtime(simular=True)
        rt.start()
        try:
            esperar_scan()
            rt.update_outputs({SALIDA_RESISTENCIA: True})
            time.sleep(0.8)
            self.assertTrue(conduce(rt))
        finally:
            rt.stop()


class ParoDeEmergencia(unittest.TestCase):
    def setUp(self):
        self.rt = Runtime(simular=True)
        self.rt.start()
        esperar_scan()

    def tearDown(self):
        self.rt.stop()

    def test_apaga_todo_y_rechaza_encendidos(self):
        self.rt.update_outputs({SALIDA_RESISTENCIA: True, "TransistorOut7_value": True, "TransistorOut8_value": True,
                                "DigitalOut3_value": True, "DigitalOut5_value": True})
        self.rt.paro_emergencia(True)
        salidas = self.rt.readOutputs()
        self.assertFalse(any(v for k, v in salidas.items() if k.startswith(("DigitalOut", "TransistorOut"))))
        self.assertFalse(any(self.rt.transistores_efectivos(t)[i] for t in range(0, 400, 4) for i in range(8)))
        self.rt.update_outputs({SALIDA_RESISTENCIA: True, "TransistorOut7_value": True, "DigitalOut3_value": True})
        salidas = self.rt.readOutputs()
        self.assertFalse(any(v for k, v in salidas.items() if k.startswith(("DigitalOut", "TransistorOut"))))
        d = self.rt.diagnostico()
        self.assertTrue(d["paro_emergencia"])
        self.assertIn(MOTIVO_PARO, d["motivos_bloqueo"])

    def test_rearmar_no_enciende_nada(self):
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})
        self.rt.paro_emergencia(True)
        self.rt.paro_emergencia(False)
        self.assertFalse(self.rt.diagnostico()["paro_emergencia"])
        self.assertFalse(conduce(self.rt))
        self.assertFalse(self.rt.readOutputs()[SALIDA_RESISTENCIA])
        self.rt.update_outputs({SALIDA_RESISTENCIA: True})                # hay que ordenarlo de nuevo
        self.assertTrue(conduce(self.rt))

    def test_los_reles_tampoco_salen_durante_el_paro(self):
        self.rt.paro_emergencia(True)
        self.rt.update_outputs({"DigitalOut3_value": True})
        esperar_scan()
        self.assertFalse(any(self.rt.digital_output_driver.valores))


class OrdenesPorMqtt(unittest.TestCase):
    """El gateway entiende la orden especial {"paro_emergencia": true/false}."""

    def setUp(self):
        import gateway_main_app as g
        self.g = g.Gateway.__new__(g.Gateway)
        self.g.runtime = Runtime(simular=True)

    def mensaje(self, cuerpo):
        import json
        return type("Mensaje", (), {"payload": json.dumps(cuerpo).encode("utf-8"), "topic": "pct_23/salidas"})()

    def test_paro_y_rearme(self):
        self.g.on_message(None, None, self.mensaje({"paro_emergencia": True}))
        self.assertTrue(self.g.runtime.diagnostico()["paro_emergencia"])
        self.g.on_message(None, None, self.mensaje({"paro_emergencia": False}))
        self.assertFalse(self.g.runtime.diagnostico()["paro_emergencia"])

    def test_el_paro_puede_ir_con_otras_salidas(self):
        self.g.on_message(None, None, self.mensaje({"paro_emergencia": True, "TransistorOut8_value": True}))
        self.assertFalse(self.g.runtime.readOutputs()["TransistorOut8_value"])

    def test_un_valor_que_no_es_booleano_se_descarta(self):
        self.g.on_message(None, None, self.mensaje({"paro_emergencia": "false"}))      # "false" como texto es verdadero en Python: se descarta
        self.assertFalse(self.g.runtime.diagnostico()["paro_emergencia"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
