"""PWM de las bombas por flancos: frecuencia, precision, carga del bus I2C y limites.

Se ejecuta el bucle de potencia REAL del runtime (`_bucle_potencia`) sobre una Raspberry simulada con reloj propio:
cada escritura I2C tarda lo que tardaria en el bus (0,4 ms) y cada espera se alarga lo que suele retrasarse un hilo de
Python en Linux. Al no depender del reloj del PC, las medidas son exactas y repetibles.

Lo que NO puede comprobar: la puntualidad real del hilo en la Raspberry. Para eso el runtime publica en su diagnostico
`retraso_potencia_ms`, `retraso_potencia_max_ms` y `escrituras_potencia_s`.

Ejecutar:  python test_pwm_bombas.py
"""
import random
import time
import unittest

import runtime
from runtime import (ESPERA_MAXIMA_S, OUT_BOMBA_FEED, OUT_BOMBA_HEAT, OUT_RESISTENCIA, PWM_BOMBAS_HZ, PWM_BOMBAS_HZ_MAX,
                     Runtime, frecuencia_pwm_valida, pwm_por_flancos)

L298_CONMUTACION_HZ = 25_000      # frecuencia de conmutacion tipica del L298 (hoja de datos; 40 kHz maximo)
I2C_ESCRITURAS_S_MAX = 2000       # un byte al PCF8574 a 100 kHz son ~0,3-0,5 ms: no caben mas de ~2000 por segundo
T_ESCRITURA_S = 0.0004


def canal(n):
    return f"TransistorOut{n}_value"


class Banco:
    """Raspberry simulada alrededor del bucle de potencia real."""

    def __init__(self, hz, t_escritura=0.0, retraso=None, duracion=2.0, al_esperar=None):
        self.rt = Runtime(simular=True, pwm_bombas_hz=hz)
        self.rt._entradas_leidas = True                   # termostato cerrado y sonda T2 en rango: la resistencia puede conducir
        self.rt.inputs[runtime.ENTRADA_TERMOSTATO] = True
        self.rt.inputs[runtime.ENTRADA_SONDA_T2] = 0.5
        self.t = self.t0 = time.monotonic() + 10.0      # reloj simulado (ya pasado el arranque a tope)
        self.t_escritura = t_escritura
        self.retraso = retraso or (lambda: 0.0)
        self.duracion = duracion
        self.al_esperar = al_esperar
        self.escrituras = []                              # (instante, niveles)
        self.rt._reloj = lambda: self.t
        self.rt._esperar = self._esperar
        self.rt.transistor_output_driver = self

    # -- lo que el bucle usa de la Raspberry ---------------------------------
    def write_outputs(self, *niveles):
        self.t += self.t_escritura                        # el pin cambia al terminar la escritura
        self.escrituras.append((self.t, list(niveles)))

    def _esperar(self, segundos):
        self.t += segundos + self.retraso()
        if self.al_esperar:
            self.al_esperar(self)
        if self.t - self.t0 >= self.duracion:
            self.rt.stop_event.set()

    # -- ordenes y medidas ---------------------------------------------------
    def encender(self, **valores):
        self.rt.update_outputs(valores)
        self.rt._bomba_inicio.clear()                     # sin arranque a tope: se mide el regimen

    def correr(self):
        self.rt._bucle_potencia()
        return self

    def _tramos(self, salida, desde):
        """[(inicio, fin, nivel)] de la salida desde `desde` (segundos desde el arranque) hasta el final."""
        desde += self.t0
        fin = self.t0 + self.duracion
        nivel, t_ant, tramos = False, desde, []
        for t, niveles in self.escrituras:
            nuevo = niveles[salida - 1]
            if t <= desde:
                nivel = nuevo
                continue
            if t >= fin:
                break
            if nuevo != nivel:
                tramos.append((t_ant, t, nivel))
                nivel, t_ant = nuevo, t
        tramos.append((t_ant, fin, nivel))
        return tramos

    def ciclo(self, salida, desde=0.2):
        tramos = self._tramos(salida, desde)
        return sum(b - a for a, b, n in tramos if n) / sum(b - a for a, b, n in tramos)

    def frecuencia(self, salida, desde=0.2):
        tramos = self._tramos(salida, desde)
        subidas = sum(1 for (_, _, antes), (_, _, ahora) in zip(tramos, tramos[1:]) if ahora and not antes)
        return subidas / (self.duracion - desde)

    def escrituras_por_segundo(self):
        return len(self.escrituras) / self.duracion


def pi_real(semilla=1):
    """Retraso tipico al despertar un hilo de Python en una Raspberry: entre 0,05 y 0,25 ms."""
    azar = random.Random(semilla)
    return lambda: azar.uniform(0.00005, 0.00025)


class Flancos(unittest.TestCase):
    """La funcion pura que decide el nivel y el proximo flanco."""

    def test_reparto_exacto_en_un_periodo(self):
        periodo = 0.005
        for p in range(0, 101, 5):
            activas = sum(pwm_por_flancos((k + 0.5) * periodo / 200, p, periodo)[0] for k in range(200))
            self.assertEqual(activas, round(p * 2), p)

    def test_el_proximo_flanco_siempre_esta_en_el_futuro(self):
        azar = random.Random(7)
        for _ in range(20000):
            periodo = 1.0 / azar.choice((10, 100, 200, 333, 500))
            t = azar.uniform(0, 5000)
            _, cambio = pwm_por_flancos(t, azar.choice((0, 50, 55, 73.3, 99, 100)), periodo)
            self.assertGreater(cambio, t)
            self.assertLessEqual(cambio - t, periodo + 1e-5)

    def test_justo_en_los_flancos_no_se_queda_clavado(self):
        periodo = 0.010
        for n in range(1000):                               # en el inicio exacto de cada periodo y en cada bajada
            for t in (n * periodo, n * periodo + 0.6 * periodo):
                _, cambio = pwm_por_flancos(t, 60, periodo)
                self.assertGreater(cambio, t + 1e-7, t)

    def test_0_y_100_no_tienen_flancos(self):
        self.assertEqual(pwm_por_flancos(0.0123, 100, 0.010)[0], True)
        self.assertEqual(pwm_por_flancos(0.0123, 0, 0.010)[0], False)


class Limites(unittest.TestCase):
    def test_la_frecuencia_por_defecto_esta_dentro_de_los_limites(self):
        self.assertEqual(frecuencia_pwm_valida(PWM_BOMBAS_HZ), PWM_BOMBAS_HZ)

    def test_no_se_puede_pasar_del_tope(self):
        self.assertEqual(frecuencia_pwm_valida(20_000), PWM_BOMBAS_HZ_MAX)
        self.assertEqual(Runtime(simular=True, pwm_bombas_hz=20_000).pwm_bombas_hz, PWM_BOMBAS_HZ_MAX)
        self.assertGreater(Runtime(simular=True, pwm_bombas_hz=0).pwm_bombas_hz, 0)

    def test_el_tope_queda_muy_por_debajo_del_limite_del_l298(self):
        self.assertLessEqual(PWM_BOMBAS_HZ_MAX * 50, L298_CONMUTACION_HZ)

    def test_el_tope_cabe_en_el_bus_i2c(self):
        # peor caso: una subida comun y una bajada por bomba en cada periodo, mas la resistencia y el refresco
        self.assertLessEqual(3 * PWM_BOMBAS_HZ_MAX + 60, I2C_ESCRITURAS_S_MAX)
        self.assertLess(3 * PWM_BOMBAS_HZ_MAX * T_ESCRITURA_S, 0.7)       # el bus ocupado menos del 70 % del tiempo


class Frecuencia(unittest.TestCase):
    def test_reloj_ideal_frecuencia_y_ciclo_exactos(self):
        for hz in (10, 50, 100, 200, 400, 500):
            for p in (50, 60, 75, 90):
                b = Banco(hz)
                b.encender(**{canal(OUT_BOMBA_FEED): True, "PWMOut1_value": p})
                b.correr()
                self.assertAlmostEqual(b.frecuencia(OUT_BOMBA_FEED), hz, delta=hz * 0.01 + 1, msg=(hz, p))
                self.assertAlmostEqual(b.ciclo(OUT_BOMBA_FEED), p / 100, delta=0.005, msg=(hz, p))

    def test_como_en_la_raspberry_a_100_hz(self):
        self._medir(100, tolerancia=0.03)

    def test_como_en_la_raspberry_a_200_hz(self):
        self._medir(200, tolerancia=0.05)

    def test_como_en_la_raspberry_a_400_hz(self):
        self._medir(400, tolerancia=0.10)

    def _medir(self, hz, tolerancia):
        for p in (50, 60, 75, 90):
            b = Banco(hz, t_escritura=T_ESCRITURA_S, retraso=pi_real())
            b.encender(**{canal(OUT_BOMBA_HEAT): True, "PWMOut2_value": p})
            b.correr()
            self.assertAlmostEqual(b.frecuencia(OUT_BOMBA_HEAT), hz, delta=hz * 0.02 + 1, msg=(hz, p))
            self.assertAlmostEqual(b.ciclo(OUT_BOMBA_HEAT), p / 100, delta=tolerancia, msg=(hz, p))
            self.assertEqual(b.rt.scan_overruns, 0)

    def test_cada_bomba_lleva_su_velocidad(self):
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=pi_real())
        b.encender(**{canal(OUT_BOMBA_HEAT): True, canal(OUT_BOMBA_FEED): True, "PWMOut2_value": 70, "PWMOut1_value": 90})
        b.correr()
        self.assertAlmostEqual(b.ciclo(OUT_BOMBA_HEAT), 0.70, delta=0.05)
        self.assertAlmostEqual(b.ciclo(OUT_BOMBA_FEED), 0.90, delta=0.05)
        self.assertAlmostEqual(b.frecuencia(OUT_BOMBA_HEAT), 200, delta=5)
        self.assertAlmostEqual(b.frecuencia(OUT_BOMBA_FEED), 200, delta=5)

    def test_velocidades_casi_iguales_no_se_estorban(self):
        # las dos bajadas caen a 0,1 ms una de otra: la segunda espera a que termine la escritura de la primera
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=pi_real())
        b.encender(**{canal(OUT_BOMBA_HEAT): True, canal(OUT_BOMBA_FEED): True, "PWMOut2_value": 60, "PWMOut1_value": 62})
        b.correr()
        self.assertAlmostEqual(b.ciclo(OUT_BOMBA_HEAT), 0.60, delta=0.05)
        self.assertAlmostEqual(b.ciclo(OUT_BOMBA_FEED), 0.62, delta=0.10)

    def test_al_100_por_100_no_hay_flancos(self):
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=pi_real())
        b.encender(**{canal(OUT_BOMBA_HEAT): True, canal(OUT_BOMBA_FEED): True})
        b.correr()
        self.assertGreater(b.ciclo(OUT_BOMBA_FEED), 0.999)
        self.assertEqual(b.frecuencia(OUT_BOMBA_FEED), 0)
        self.assertLess(b.escrituras_por_segundo(), 15)       # solo el refresco de cada 100 ms

    def test_arranque_a_tope_y_luego_la_consigna(self):
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=pi_real(), duracion=1.5)
        b.rt.update_outputs({canal(OUT_BOMBA_FEED): True, "PWMOut1_value": 60})
        b.rt._bomba_inicio[OUT_BOMBA_FEED] = b.t0             # recien encendida en el reloj simulado
        b.correr()
        fin = b.t0 + runtime.ARRANQUE_A_TOPE_S
        activo = sum(min(f, fin) - a for a, f, n in b._tramos(OUT_BOMBA_FEED, 0.0) if n and a < fin)
        self.assertGreater(activo, runtime.ARRANQUE_A_TOPE_S * 0.97)
        self.assertAlmostEqual(b.ciclo(OUT_BOMBA_FEED, desde=0.5), 0.60, delta=0.05)


class Bus(unittest.TestCase):
    def test_escrituras_por_segundo_dentro_del_bus(self):
        for hz in (100, 200, 400, PWM_BOMBAS_HZ_MAX):
            b = Banco(hz, t_escritura=T_ESCRITURA_S, retraso=pi_real())
            b.encender(**{canal(OUT_BOMBA_HEAT): True, canal(OUT_BOMBA_FEED): True, canal(OUT_RESISTENCIA): True,
                          "PWMOut2_value": 60, "PWMOut1_value": 80, "AnalogOut1_value": 50})
            b.correr()
            self.assertLessEqual(b.escrituras_por_segundo(), 3 * hz + 60, hz)
            self.assertLess(b.escrituras_por_segundo(), I2C_ESCRITURAS_S_MAX, hz)
            self.assertLess(b.escrituras_por_segundo() * T_ESCRITURA_S, 0.7, hz)      # queda bus para el scan lento

    def test_el_diagnostico_cuenta_las_escrituras_y_el_retraso(self):
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=pi_real())
        b.encender(**{canal(OUT_BOMBA_FEED): True, "PWMOut1_value": 60})
        b.correr()
        d = b.rt.diagnostico()
        self.assertEqual(d["pwm_bombas_hz"], 200)
        self.assertAlmostEqual(d["escrituras_potencia_s"], 400, delta=40)
        self.assertGreater(d["retraso_potencia_ms"], 0.03)
        self.assertLess(d["retraso_potencia_max_ms"], 0.7)

    def test_un_fallo_del_bus_no_para_el_pwm(self):
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=pi_real(), duracion=3.0)
        escribir = b.write_outputs

        def con_fallo(*niveles):
            if 1.0 < b.t - b.t0 < 1.5:
                raise OSError(121, "Remote I/O error (emulado)")
            escribir(*niveles)
        b.write_outputs = con_fallo
        b.encender(**{canal(OUT_BOMBA_FEED): True, "PWMOut1_value": 60})
        b.correr()
        self.assertGreater(b.rt.io_errors, 0)
        self.assertAlmostEqual(b.ciclo(OUT_BOMBA_FEED, desde=2.0), 0.60, delta=0.05)


class Seguridad(unittest.TestCase):
    def test_nunca_se_espera_mas_de_5_ms_para_revisar_las_ordenes(self):
        rt = Runtime(simular=True, pwm_bombas_hz=10)
        azar = random.Random(3)
        for _ in range(5000):
            t = azar.uniform(0, 1000)
            _, siguiente = rt._plan_potencia(t)
            self.assertGreater(siguiente, t)
            self.assertLessEqual(siguiente - t, ESPERA_MAXIMA_S + 1e-9)

    def test_el_paro_de_emergencia_corta_en_menos_de_10_ms(self):
        for hz in (10, 100, 400):
            estado = {}

            def pulsar(b):
                if "paro" not in estado and b.t - b.t0 >= 1.0:
                    estado["paro"] = b.t
                    b.rt.paro_emergencia(True)
            b = Banco(hz, t_escritura=T_ESCRITURA_S, retraso=pi_real(), al_esperar=pulsar)
            b.encender(**{canal(OUT_BOMBA_HEAT): True, canal(OUT_BOMBA_FEED): True, "PWMOut1_value": 60})
            b.correr()
            apagado = next(t for t, niveles in b.escrituras if t >= estado["paro"] and not any(niveles))
            self.assertLess(apagado - estado["paro"], 0.010, hz)
            self.assertFalse(any(any(niveles) for t, niveles in b.escrituras if t > apagado), hz)

    def test_un_atasco_del_sistema_se_cuenta_y_se_recupera(self):
        estado = {}

        def atasco():
            if "hecho" not in estado and b.t - b.t0 >= 1.0:
                estado["hecho"] = True
                return 0.030                                   # Linux se queda 30 ms sin atender al hilo
            return 0.00015
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=atasco, duracion=3.0)
        b.encender(**{canal(OUT_BOMBA_FEED): True, "PWMOut1_value": 60})
        b.correr()
        self.assertEqual(b.rt.scan_overruns, 1)
        self.assertGreater(b.rt.retraso_potencia_max_ms, 25)
        self.assertAlmostEqual(b.ciclo(OUT_BOMBA_FEED, desde=1.5), 0.60, delta=0.05)     # sin rafaga de recuperacion
        self.assertAlmostEqual(b.frecuencia(OUT_BOMBA_FEED, desde=1.5), 200, delta=5)


class Resistencia(unittest.TestCase):
    """Las rafagas de la resistencia comparten hilo con el PWM: no deben notar la frecuencia de las bombas."""

    def test_rafagas_al_50_con_las_bombas_a_200_hz(self):
        b = Banco(200, t_escritura=T_ESCRITURA_S, retraso=pi_real(), duracion=3.2)
        b.encender(**{canal(OUT_RESISTENCIA): True, "AnalogOut1_value": 50,
                      canal(OUT_BOMBA_HEAT): True, canal(OUT_BOMBA_FEED): True, "PWMOut2_value": 70, "PWMOut1_value": 55})
        b.correr()
        self.assertAlmostEqual(b.ciclo(OUT_RESISTENCIA), 0.50, delta=0.02)
        self.assertAlmostEqual(b.frecuencia(OUT_RESISTENCIA), 25, delta=1)     # un ciclo de red si, uno no

    def test_rafagas_enteras_de_un_ciclo_de_red(self):
        b = Banco(400, t_escritura=T_ESCRITURA_S, retraso=pi_real())
        b.encender(**{canal(OUT_RESISTENCIA): True, "AnalogOut1_value": 20, canal(OUT_BOMBA_FEED): True, "PWMOut1_value": 60})
        b.correr()
        conduce = [f - a for a, f, n in b._tramos(OUT_RESISTENCIA, 0.2)[1:-1] if n]
        self.assertTrue(conduce)
        for duracion in conduce:
            self.assertAlmostEqual(duracion, 0.020, delta=0.0015)


if __name__ == "__main__":
    unittest.main()
