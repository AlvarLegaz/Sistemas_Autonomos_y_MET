"""Enclavamiento del termostato: la resistencia solo conduce si el termostato (DigitalIn1) esta cerrado.

Se prueba con el runtime simulado (sin Raspberry). Ejecutar:  python test_seguridad_calefactor.py
"""
import time
import unittest

from runtime import (MOTIVO_TERMOSTATO_ABIERTO, MOTIVO_TERMOSTATO_SIN_LECTURA, OUT_RESISTENCIA, SALIDA_RESISTENCIA, Runtime)


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
