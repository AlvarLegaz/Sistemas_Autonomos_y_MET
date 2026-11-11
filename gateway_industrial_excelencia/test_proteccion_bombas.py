"""Proteccion del driver de las bombas: sin cambio de sentido con la bomba girando y con rampa de arranque.

Se prueba con el runtime simulado (sin Raspberry). Ejecutar:  python test_proteccion_bombas.py
"""
import time
import unittest

from runtime import (BOMBAS, ESPERA_CAMBIO_SENTIDO_S, OUT_BOMBA_FEED, OUT_BOMBA_HEAT, OUT_SENTIDO_FEED, OUT_SENTIDO_HEAT,
                     RAMPA_ARRANQUE_S, RAMPA_PARADA_S, Runtime)


def canal(n):
    return f"TransistorOut{n}_value"


def ciclos_activos(rt, ahora, salida):
    """Ticks activos de una ventana de PWM completa (20 ticks) en el instante `ahora`."""
    return sum(rt.transistores_efectivos(t, ahora)[salida - 1] for t in range(20))


class Bombas(unittest.TestCase):
    def setUp(self):
        self.rt = Runtime(simular=True)     # sin start(): solo la logica de las ordenes

    def test_las_bombas_y_sus_sentidos(self):
        self.assertEqual(BOMBAS, {OUT_BOMBA_HEAT: OUT_SENTIDO_HEAT, OUT_BOMBA_FEED: OUT_SENTIDO_FEED})

    def test_con_la_bomba_parada_se_puede_cambiar_el_sentido(self):
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})
        self.assertTrue(self.rt.outputs[canal(OUT_SENTIDO_FEED)])

    def test_con_la_bomba_girando_no_cambia_el_sentido(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_FEED)])

    def test_cambio_de_sentido_junto_con_el_apagado_tambien_se_rechaza(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False, canal(OUT_SENTIDO_FEED): True})
        self.assertFalse(self.rt.outputs[canal(OUT_BOMBA_FEED)])      # el apagado si se acepta
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_FEED)])    # y el sentido no

    def test_tras_parar_hay_que_esperar_para_cambiar_el_sentido(self):
        self.rt.update_outputs({canal(OUT_BOMBA_HEAT): True})
        self.rt.update_outputs({canal(OUT_BOMBA_HEAT): False})
        self.rt.update_outputs({canal(OUT_SENTIDO_HEAT): True})
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_HEAT)])
        self.rt._bomba_parada[OUT_BOMBA_HEAT] -= ESPERA_CAMBIO_SENTIDO_S + 0.1   # como si hubiera pasado el tiempo
        self.rt.update_outputs({canal(OUT_SENTIDO_HEAT): True})
        self.assertTrue(self.rt.outputs[canal(OUT_SENTIDO_HEAT)])

    def test_una_bomba_no_bloquea_el_sentido_de_la_otra(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_SENTIDO_HEAT): True})
        self.assertTrue(self.rt.outputs[canal(OUT_SENTIDO_HEAT)])

    def test_repetir_el_mismo_sentido_con_la_bomba_girando_no_molesta(self):
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})
        self.assertTrue(self.rt.outputs[canal(OUT_SENTIDO_FEED)])

    def test_el_paro_de_emergencia_para_las_bombas_y_las_enclava(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.paro_emergencia(True)
        self.assertFalse(any(self.rt.transistores_efectivos(t)[i] for t in range(20) for i in range(8)))
        self.rt.paro_emergencia(False)
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})       # recien parada: se espera
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_FEED)])

    def test_rampa_de_arranque(self):
        self.rt.update_outputs({"PWMOut1_value": 100.0})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        t0 = self.rt._bomba_inicio[OUT_BOMBA_FEED]
        antes = ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED)
        mitad = ciclos_activos(self.rt, t0 + RAMPA_ARRANQUE_S / 2, OUT_BOMBA_FEED)
        final = ciclos_activos(self.rt, t0 + RAMPA_ARRANQUE_S + 0.1, OUT_BOMBA_FEED)
        self.assertLessEqual(antes, 1)
        self.assertEqual(mitad, 10)
        self.assertEqual(final, 20)

    def test_la_rampa_respeta_la_velocidad_elegida(self):
        self.rt.update_outputs({"PWMOut2_value": 50.0})
        self.rt.update_outputs({canal(OUT_BOMBA_HEAT): True})
        t0 = self.rt._bomba_inicio[OUT_BOMBA_HEAT]
        self.assertEqual(ciclos_activos(self.rt, t0 + RAMPA_ARRANQUE_S + 1, OUT_BOMBA_HEAT), 10)

    def test_al_reencender_la_rampa_empieza_de_nuevo(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.assertNotIn(OUT_BOMBA_FEED, self.rt._bomba_inicio)
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        t0 = self.rt._bomba_inicio[OUT_BOMBA_FEED]
        self.assertLessEqual(ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED), 1)

    def test_rampa_de_parada(self):
        self.rt.update_outputs({"PWMOut1_value": 100.0, canal(OUT_BOMBA_FEED): True})
        self.rt._bomba_inicio.pop(OUT_BOMBA_FEED)                      # ya pasada la rampa de arranque
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.assertFalse(self.rt.outputs[canal(OUT_BOMBA_FEED)])       # la imagen ya dice apagada
        t0 = self.rt._bomba_frenando[OUT_BOMBA_FEED][0]
        antes = ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED)
        mitad = ciclos_activos(self.rt, t0 + RAMPA_PARADA_S / 2, OUT_BOMBA_FEED)
        casi = ciclos_activos(self.rt, t0 + RAMPA_PARADA_S * 0.9, OUT_BOMBA_FEED)
        despues = ciclos_activos(self.rt, t0 + RAMPA_PARADA_S + 0.1, OUT_BOMBA_FEED)
        self.assertGreaterEqual(antes, 19)
        self.assertEqual(mitad, 10)
        self.assertLessEqual(casi, 3)
        self.assertEqual(despues, 0)
        self.assertNotIn(OUT_BOMBA_FEED, self.rt._bomba_frenando)

    def test_la_rampa_de_parada_parte_de_la_velocidad_elegida(self):
        self.rt.update_outputs({"PWMOut2_value": 50.0, canal(OUT_BOMBA_HEAT): True})
        self.rt._bomba_inicio.pop(OUT_BOMBA_HEAT)
        self.rt.update_outputs({canal(OUT_BOMBA_HEAT): False})
        t0 = self.rt._bomba_frenando[OUT_BOMBA_HEAT][0]
        self.assertEqual(ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_HEAT), 10)
        self.assertEqual(ciclos_activos(self.rt, t0 + RAMPA_PARADA_S / 2, OUT_BOMBA_HEAT), 5)

    def test_parar_a_medio_arrancar_baja_desde_donde_iba(self):
        self.rt.update_outputs({"PWMOut1_value": 100.0, canal(OUT_BOMBA_FEED): True})
        t_inicio = self.rt._bomba_inicio[OUT_BOMBA_FEED]
        self.rt._bomba_inicio[OUT_BOMBA_FEED] = time.monotonic() - RAMPA_ARRANQUE_S / 2     # va por la mitad de la rampa
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        t0 = self.rt._bomba_frenando[OUT_BOMBA_FEED][0]
        self.assertAlmostEqual(self.rt._bomba_frenando[OUT_BOMBA_FEED][1], 50.0, delta=3.0)
        self.assertLessEqual(ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED), 11)

    def test_el_paro_de_emergencia_corta_en_seco_sin_rampa(self):
        self.rt.update_outputs({"PWMOut1_value": 100.0, canal(OUT_BOMBA_FEED): True})
        self.rt._bomba_inicio.pop(OUT_BOMBA_FEED)
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})         # empieza a frenar...
        self.rt.paro_emergencia(True)                                  # ...y el paro corta ya
        self.assertEqual(self.rt._bomba_frenando, {})
        self.assertEqual(ciclos_activos(self.rt, time.monotonic() + 0.01, OUT_BOMBA_FEED), 0)

    def test_volver_a_encender_durante_la_parada_cancela_la_rampa_de_parada(self):
        self.rt.update_outputs({"PWMOut1_value": 100.0, canal(OUT_BOMBA_FEED): True})
        self.rt._bomba_inicio.pop(OUT_BOMBA_FEED)
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.assertNotIn(OUT_BOMBA_FEED, self.rt._bomba_frenando)
        t0 = self.rt._bomba_inicio[OUT_BOMBA_FEED]
        self.assertLessEqual(ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED), 1)        # arranca de nuevo con rampa

    def test_el_sentido_no_cambia_mientras_frena(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_FEED)])     # sigue la espera de 1,5 s, mayor que la rampa
        self.assertGreater(ESPERA_CAMBIO_SENTIDO_S, RAMPA_PARADA_S)

    def test_apagada_no_conduce_nunca(self):
        self.assertEqual(ciclos_activos(self.rt, time.monotonic() + 10, OUT_BOMBA_FEED), 0)


if __name__ == "__main__":
    unittest.main()
