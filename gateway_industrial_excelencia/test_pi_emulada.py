"""Prueba del gateway emulando una Raspberry Pi: smbus2 (I2C) y spidev (SPI) falsos.

Se ejecutan los drivers reales (PCFDigitalOutput, PCFDigitalInput, MCP3008AnalogInput)
y el Runtime con simular=False; solo el bus y el SPI son de mentira. Cada escritura
I2C queda registrada con su instante, y de esa linea de tiempo se miden el reparto
de las rafagas (OUT03) y el PWM de las bombas (OUT07 y OUT08).

Ejecutar:  python test_pi_emulada.py      (tarda unos 15 s)
"""
import sys
import threading
import time
import types
import unittest

# ---------------------------------------------------------------------------
# Raspberry Pi emulada
# ---------------------------------------------------------------------------
ESCRITURAS = []            # (instante, direccion, byte) de todo lo que sale por I2C
ENTRADAS_I2C = {0x38: 0xFF}
FALLO_I2C = threading.Event()   # mientras este activo, el bus lanza OSError
_lock = threading.Lock()


class SMBusFalso:
    def __init__(self, bus):
        self.bus = bus

    def write_byte(self, direccion, valor):
        if FALLO_I2C.is_set():
            raise OSError(121, "Remote I/O error (emulado)")
        with _lock:
            ESCRITURAS.append((time.monotonic(), direccion, valor))

    def read_byte(self, direccion):
        if FALLO_I2C.is_set():
            raise OSError(121, "Remote I/O error (emulado)")
        return ENTRADAS_I2C.get(direccion, 0xFF)

    def close(self):
        pass


class SpiFalso:
    """MCP3008 emulado: todos los canales a media escala (512)."""
    max_speed_hz = 0
    mode = 0

    def open(self, bus, device):
        pass

    def xfer2(self, datos):
        raw = 512
        return [0, (raw >> 8) & 3, raw & 0xFF]

    def close(self):
        pass


sys.modules["smbus2"] = types.SimpleNamespace(SMBus=SMBusFalso)
sys.modules["spidev"] = types.SimpleNamespace(SpiDev=SpiFalso)

import runtime as rt  # noqa: E402  (despues de instalar los modulos falsos)

DIR_TRANSISTORES = 0x3A
DIR_RELES = 0x39


def nivel(byte, salida):
    """True si OUTnn esta activa. Las placas son activas a nivel bajo (active_high=False)."""
    return not (byte >> (salida - 1)) & 1


def tramos(salida, desde, hasta, direccion=DIR_TRANSISTORES):
    """Tiempo activo y total de la salida en [desde, hasta], a partir de las escrituras I2C."""
    with _lock:
        eventos = [(t, v) for t, d, v in ESCRITURAS if d == direccion]
    previo = [v for t, v in eventos if t <= desde]
    actual = nivel(previo[-1], salida) if previo else False
    activo, t_anterior = 0.0, desde
    for t, v in eventos:
        if t <= desde:
            continue
        if t > hasta:
            break
        if actual:
            activo += t - t_anterior
        t_anterior, actual = t, nivel(v, salida)
    if actual:
        activo += hasta - t_anterior
    return activo, hasta - desde


def ciclo_de_trabajo(salida, segundos):
    t0 = time.monotonic()
    time.sleep(segundos)
    activo, total = tramos(salida, t0, time.monotonic())
    return activo / total


class PiEmulada(unittest.TestCase):
    def setUp(self):
        ESCRITURAS.clear()
        FALLO_I2C.clear()
        self.rt = rt.Runtime(simular=False)
        self.rt.start()

    def tearDown(self):
        FALLO_I2C.clear()
        if self.rt.running:
            self.rt.stop()

    # -- valores iniciales ---------------------------------------------------
    def test_por_defecto_al_100(self):
        s = self.rt.readOutputs()
        self.assertEqual((s["PWMOut1_value"], s["PWMOut2_value"], s["AnalogOut1_value"]), (100.0, 100.0, 100.0))
        self.assertFalse(any(s[f"TransistorOut{i}_value"] for i in range(1, 9)))

    # -- rafagas en OUT03 ----------------------------------------------------
    def test_resistencia_100_por_100_siempre_activa(self):
        self.rt.update_outputs({"TransistorOut3_value": True})
        time.sleep(0.3)
        self.assertGreater(ciclo_de_trabajo(3, 2.0), 0.97)

    def test_resistencia_50_por_100_son_25_ciclos_de_50(self):
        self.rt.update_outputs({"TransistorOut3_value": True, "AnalogOut1_value": 50})
        time.sleep(0.3)
        self.assertAlmostEqual(ciclo_de_trabajo(3, 3.0), 0.50, delta=0.10)

    def test_resistencia_apagada_aunque_haya_potencia(self):
        self.rt.update_outputs({"AnalogOut1_value": 100})   # orden de encendido (OUT03) sin dar
        self.assertLess(ciclo_de_trabajo(3, 1.0), 0.01)

    def test_resistencia_0_por_100_no_conduce(self):
        self.rt.update_outputs({"TransistorOut3_value": True, "AnalogOut1_value": 0})
        time.sleep(0.3)
        self.assertLess(ciclo_de_trabajo(3, 1.5), 0.01)

    # -- PWM de las bombas en OUT07 (heat) y OUT08 (feed) --------------------
    def test_pwm_independiente_en_cada_bomba(self):
        self.rt.update_outputs({"TransistorOut7_value": True, "TransistorOut8_value": True,
                                "PWMOut2_value": 100, "PWMOut1_value": 25})
        time.sleep(0.3)
        t0 = time.monotonic()
        time.sleep(3.0)
        t1 = time.monotonic()
        heat = tramos(7, t0, t1)
        feed = tramos(8, t0, t1)
        self.assertGreater(heat[0] / heat[1], 0.97)                      # heat unit al 100 %
        self.assertAlmostEqual(feed[0] / feed[1], 0.25, delta=0.10)      # feed unit al 25 %

    def test_bomba_sin_orden_no_gira_aunque_pwm_al_100(self):
        self.assertLess(ciclo_de_trabajo(8, 1.0), 0.01)

    # -- seguridad -----------------------------------------------------------
    def test_al_parar_todo_queda_apagado(self):
        self.rt.update_outputs({"TransistorOut3_value": True, "TransistorOut7_value": True,
                                "TransistorOut8_value": True, "DigitalOut3_value": True})
        time.sleep(0.4)
        self.rt.stop()
        with _lock:
            ultimo_transistores = [v for t, d, v in ESCRITURAS if d == DIR_TRANSISTORES][-1]
            ultimo_reles = [v for t, d, v in ESCRITURAS if d == DIR_RELES][-1]
        self.assertEqual(ultimo_transistores, 0xFF)   # activas a nivel bajo: 0xFF = todo apagado
        self.assertEqual(ultimo_reles, 0xFF)

    def test_fallo_i2c_se_marca_y_se_recupera(self):
        self.rt.update_outputs({"TransistorOut8_value": True})
        time.sleep(0.3)
        FALLO_I2C.set()
        time.sleep(0.5)
        d = self.rt.diagnostico()
        self.assertFalse(d["io_ok"])
        self.assertGreater(d["io_errors"], 0)
        self.assertTrue(d["running"])                  # el runtime sigue vivo
        FALLO_I2C.clear()
        time.sleep(0.5)
        self.assertTrue(self.rt.diagnostico()["io_ok"])
        self.assertGreater(ciclo_de_trabajo(8, 1.0), 0.97)   # y la salida se restablece

    # -- el resto del gateway sigue funcionando ------------------------------
    def test_entradas_analogicas_y_digitales(self):
        time.sleep(0.4)
        ai = self.rt.readAnalogInput()
        self.assertAlmostEqual(ai["AnalogIn1_value"], 512 * 3.3 / 1023, places=3)
        self.assertTrue(all(self.rt.readDigitalInput()[f"DigitalIn{i}_value"] for i in range(1, 9)))


# ---------------------------------------------------------------------------
# Funciones puras: reparto exacto de ciclos y ticks
# ---------------------------------------------------------------------------
class Reparto(unittest.TestCase):
    def test_burst_numero_de_ciclos(self):
        for p in range(0, 101):
            esperado = round(p * rt.BURST_CICLOS / 100)
            self.assertEqual(sum(rt.burst_activo(c, p) for c in range(rt.BURST_CICLOS)), esperado, p)

    def test_burst_enunciado(self):
        self.assertEqual(sum(rt.burst_activo(c, 100) for c in range(50)), 50)
        self.assertEqual(sum(rt.burst_activo(c, 50) for c in range(50)), 25)

    def test_burst_repartido_sin_huecos_largos(self):
        # al 50 % conduce un ciclo si, uno no; al 20 % uno de cada cinco.
        self.assertEqual([int(rt.burst_activo(c, 50)) for c in range(6)], [0, 1, 0, 1, 0, 1])
        pos = [c for c in range(50) if rt.burst_activo(c, 20)]
        self.assertTrue(all(b - a == 5 for a, b in zip(pos, pos[1:])))

    def test_burst_se_repite_cada_ventana(self):
        self.assertEqual([rt.burst_activo(c, 37) for c in range(50)],
                         [rt.burst_activo(c + 50, 37) for c in range(50)])

    def test_burst_fuera_de_rango(self):
        self.assertEqual(sum(rt.burst_activo(c, 250) for c in range(50)), 50)
        self.assertEqual(sum(rt.burst_activo(c, -5) for c in range(50)), 0)

    def test_pwm_ticks(self):
        for p in range(0, 101, 5):
            self.assertEqual(sum(rt.pwm_activo(t, p) for t in range(rt.PWM_PERIODO_TICKS)),
                             round(p * rt.PWM_PERIODO_TICKS / 100), p)


if __name__ == "__main__":
    unittest.main(verbosity=2)
