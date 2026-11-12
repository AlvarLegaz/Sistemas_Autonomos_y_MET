"""Proteccion del driver de las bombas: sin cambio de sentido con la bomba girando y arranque a tope y PWM minimo del 50 %.

Se prueba con el runtime simulado (sin Raspberry). Ejecutar:  python test_proteccion_bombas.py
"""
import time
import unittest

import runtime
from runtime import (BOMBAS, ESPERA_CAMBIO_SENTIDO_S, OUT_BOMBA_FEED, OUT_BOMBA_HEAT, OUT_SENTIDO_FEED, OUT_SENTIDO_HEAT,
                     ARRANQUE_A_TOPE_S, PWM_MINIMO_BOMBA, RAMPA_PARADA_S, Runtime)


def canal(n):
    return f"TransistorOut{n}_value"


def ciclos_activos(rt, ahora, salida):
    """De 20 muestras repartidas por un periodo de PWM completo, cuantas estan activas en el instante `ahora`."""
    periodo = 1.0 / rt.pwm_bombas_hz
    return sum(rt.niveles_potencia((k + 0.5) * periodo / 20, ahora)[salida - 1] for k in range(20))


class Bombas(unittest.TestCase):
    def setUp(self):
        self.rt = Runtime(simular=True)     # sin start(): solo la logica de las ordenes
        # estas pruebas comprueban la proteccion del cambio de sentido, asi que se permite el sentido inverso (por defecto no se permite)
        self._antes = runtime.SENTIDO_INVERSO_PERMITIDO
        runtime.SENTIDO_INVERSO_PERMITIDO = True
        self.addCleanup(lambda: setattr(runtime, "SENTIDO_INVERSO_PERMITIDO", self._antes))

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
        self.assertFalse(any(self.rt.niveles_potencia(t / 1000)[i] for t in range(20) for i in range(8)))
        self.rt.paro_emergencia(False)
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})       # recien parada: se espera
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_FEED)])

    def test_arranca_a_tope_y_luego_va_a_su_consigna(self):
        self.rt.update_outputs({"PWMOut1_value": 60.0})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        t0 = self.rt._bomba_inicio[OUT_BOMBA_FEED]
        self.assertEqual(ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED), 20)                   # pico corto al 100 %
        self.assertEqual(ciclos_activos(self.rt, t0 + ARRANQUE_A_TOPE_S + 0.05, OUT_BOMBA_FEED), 12)

    def test_el_arranque_a_tope_es_corto(self):
        self.assertLessEqual(ARRANQUE_A_TOPE_S, 0.5)

    def test_no_se_acepta_pwm_de_bomba_por_debajo_del_minimo(self):
        self.rt.update_outputs({"PWMOut1_value": 25.0, "PWMOut2_value": 1.0})
        self.assertEqual(self.rt.outputs["PWMOut1_value"], PWM_MINIMO_BOMBA)
        self.assertEqual(self.rt.outputs["PWMOut2_value"], PWM_MINIMO_BOMBA)

    def test_pwm_cero_deja_la_bomba_sin_tension(self):
        self.rt.update_outputs({"PWMOut1_value": 0.0, canal(OUT_BOMBA_FEED): True})
        self.assertEqual(self.rt.outputs["PWMOut1_value"], 0.0)
        self.assertEqual(ciclos_activos(self.rt, time.monotonic() + 10, OUT_BOMBA_FEED), 0)

    def test_el_minimo_vale_aunque_se_fuerce_la_imagen(self):
        self.rt.update_outputs({canal(OUT_BOMBA_HEAT): True})
        self.rt.outputs["PWMOut2_value"] = 20.0                        # como si algo hubiera escrito la imagen a mano
        t0 = self.rt._bomba_inicio[OUT_BOMBA_HEAT]
        self.assertEqual(ciclos_activos(self.rt, t0 + 1, OUT_BOMBA_HEAT), 10)

    def test_la_resistencia_no_tiene_minimo(self):
        self.rt.update_outputs({"AnalogOut1_value": 10.0})
        self.assertEqual(self.rt.outputs["AnalogOut1_value"], 10.0)

    def test_al_reencender_vuelve_a_arrancar_a_tope(self):
        self.rt.update_outputs({"PWMOut1_value": 50.0, canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.assertNotIn(OUT_BOMBA_FEED, self.rt._bomba_inicio)
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        t0 = self.rt._bomba_inicio[OUT_BOMBA_FEED]
        self.assertEqual(ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED), 20)

    def test_rampa_de_parada_baja_hasta_el_minimo_y_corta(self):
        self.rt.update_outputs({"PWMOut1_value": 100.0, canal(OUT_BOMBA_FEED): True})
        self.rt._bomba_inicio.pop(OUT_BOMBA_FEED)                      # ya pasado el arranque
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.assertFalse(self.rt.outputs[canal(OUT_BOMBA_FEED)])       # la imagen ya dice apagada
        t0 = self.rt._bomba_frenando[OUT_BOMBA_FEED][0]
        antes = ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED)
        mitad = ciclos_activos(self.rt, t0 + RAMPA_PARADA_S / 2, OUT_BOMBA_FEED)
        casi = ciclos_activos(self.rt, t0 + RAMPA_PARADA_S * 0.95, OUT_BOMBA_FEED)
        despues = ciclos_activos(self.rt, t0 + RAMPA_PARADA_S + 0.1, OUT_BOMBA_FEED)
        self.assertGreaterEqual(antes, 19)
        self.assertEqual(mitad, 15)
        self.assertIn(casi, (10, 11))                                  # 52,5 %: nunca por debajo del 50 %
        self.assertEqual(despues, 0)
        self.assertNotIn(OUT_BOMBA_FEED, self.rt._bomba_frenando)

    def test_en_el_minimo_se_para_sin_rampa(self):
        self.rt.update_outputs({"PWMOut2_value": 50.0, canal(OUT_BOMBA_HEAT): True})
        self.rt._bomba_inicio.pop(OUT_BOMBA_HEAT)
        self.rt.update_outputs({canal(OUT_BOMBA_HEAT): False})
        self.assertNotIn(OUT_BOMBA_HEAT, self.rt._bomba_frenando)
        self.assertEqual(ciclos_activos(self.rt, time.monotonic() + 0.01, OUT_BOMBA_HEAT), 0)

    def test_parar_durante_el_arranque_baja_desde_el_100(self):
        self.rt.update_outputs({"PWMOut1_value": 60.0, canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.assertEqual(self.rt._bomba_frenando[OUT_BOMBA_FEED][1], 100.0)

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
        self.assertEqual(ciclos_activos(self.rt, t0 + 0.01, OUT_BOMBA_FEED), 20)          # arranca de nuevo a tope

    def test_el_sentido_no_cambia_mientras_frena(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True})
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): False})
        self.rt.update_outputs({canal(OUT_SENTIDO_FEED): True})
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_FEED)])     # sigue la espera de 1,5 s, mayor que la rampa
        self.assertGreater(ESPERA_CAMBIO_SENTIDO_S, RAMPA_PARADA_S)

    def test_apagada_no_conduce_nunca(self):
        self.assertEqual(ciclos_activos(self.rt, time.monotonic() + 10, OUT_BOMBA_FEED), 0)


class SentidoFijo(unittest.TestCase):
    """Por defecto las bombas solo giran hacia delante: ninguna orden de sentido inverso llega a las salidas."""

    def setUp(self):
        self.rt = Runtime(simular=True)

    def test_por_defecto_el_sentido_inverso_no_esta_permitido(self):
        self.assertFalse(runtime.SENTIDO_INVERSO_PERMITIDO)

    def test_se_rechaza_el_sentido_inverso_de_las_dos_bombas(self):
        for sentido in (OUT_SENTIDO_FEED, OUT_SENTIDO_HEAT):
            self.rt.update_outputs({canal(sentido): True})
            self.assertFalse(self.rt.outputs[canal(sentido)])

    def test_el_resto_de_la_orden_si_se_aplica(self):
        self.rt.update_outputs({canal(OUT_BOMBA_FEED): True, canal(OUT_SENTIDO_FEED): True})
        self.assertTrue(self.rt.outputs[canal(OUT_BOMBA_FEED)])
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_FEED)])

    def test_ni_forzando_la_imagen_se_activa_el_pin_de_sentido(self):
        self.rt.outputs[canal(OUT_SENTIDO_FEED)] = True          # como si algo hubiera escrito la imagen a mano
        self.rt.outputs[canal(OUT_BOMBA_FEED)] = True
        self.assertFalse(any(self.rt.niveles_potencia(t / 1000, time.monotonic() + 10)[OUT_SENTIDO_FEED - 1] for t in range(20)))

    def test_el_sentido_a_delante_se_acepta(self):
        self.rt.update_outputs({canal(OUT_SENTIDO_HEAT): False})
        self.assertFalse(self.rt.outputs[canal(OUT_SENTIDO_HEAT)])


if __name__ == "__main__":
    unittest.main()
