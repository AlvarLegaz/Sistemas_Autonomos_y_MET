"""Drivers simulados con la misma interfaz que los reales, para probar el gateway
sin Raspberry Pi (sin I2C ni SPI).

Las entradas digitales reflejan las salidas digitales (DigitalInN = DigitalOutN)
y las analogicas son ondas senoidales desfasadas entre 0 y ADC_VREF.
"""
import math
import time

ADC_VREF = 3.3
NUM_CANALES = 8


class PCFDigitalOutputSim:
    def __init__(self, **_):
        self.valores = (False,) * NUM_CANALES

    def write_outputs(self, *valores):
        self.valores = tuple(bool(v) for v in valores)

    def close(self):
        self.valores = (False,) * NUM_CANALES


class PCFDigitalInputSim:
    def __init__(self, salidas, **_):
        self.salidas = salidas
        self.termostato_ok = True      # DigitalIn1 (termostato): True = cerrado; una prueba puede ponerlo a False

    def read_inputs(self):
        entradas = {f"DigitalIn{i + 1}_value": v for i, v in enumerate(self.salidas.valores)}
        entradas["DigitalIn1_value"] = self.termostato_ok
        return entradas

    def close(self):
        pass


class MCP3008AnalogInputSim:
    def __init__(self, **_):
        self.t0 = time.monotonic()
        self.t2_v = 0.5     # AnalogIn2 (sonda T2): 50 °C fijos; una prueba puede cambiarlo para simular un fallo de sonda

    def read_inputs(self):
        t = time.monotonic() - self.t0
        lecturas = {f"AnalogIn{ch + 1}_value":
                    round(ADC_VREF * (0.5 + 0.5 * math.sin(t * (0.3 + 0.15 * ch) + ch)), 3)
                    for ch in range(NUM_CANALES)}
        lecturas["AnalogIn2_value"] = self.t2_v
        return lecturas

    def close(self):
        pass
