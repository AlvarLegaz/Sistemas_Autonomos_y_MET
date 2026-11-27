"""Planta REAL del contrato: traduce entre el contrato PCT23 v2.4 (tags en unidades de ingeniería) y el `Runtime` de la placa (canales de hardware).

Todas las correspondencias están verificadas contra `runtime.py`, `PCT23.md` y `pct23.html`. OJO con las INVERSIONES lógicas:
  stat_overtemp = NOT DigitalIn1   (el termostato cerrado = bien; abierto = sobretemperatura)
  ll_tank_b     = NOT DigitalIn4   (lógica negada: DI4 a 0 = nivel bajo)
  sol1_divert   = NOT DigitalOut3  (SOL1 sin activar manda el producto al desvío)
  sol2_feed_tank "A" = DigitalOut4 apagada, "B" = encendida
Lo que NO se puede leer hoy va como None (el contrato exige null, nunca omitir): l1_level_mm (el sensor de nivel no llega a ninguna entrada;
AnalogIn5 es la sonda T5, ver PCT23.md). Con la E/S caída (`io_ok` False) van todas a None: no se publican lecturas viejas como si fueran actuales.
"""
from contrato_pct23 import Planta

ESCALA_T_C_POR_V = 100.0                  # sondas T1-T4: 10 mV/°C, 1,5 V = 150 °C
F1_ML_MIN_POR_V_CONECTOR = 300.0          # enmienda E1: 0-5 V en el conector = 0-1500 mL/min
DIVISOR_ADC = 5.0 / 3.3                   # el MCP3008 ve el conector con un divisor de 5 V a 3,3 V
CICLOS_RAFAGA = 50                        # runtime.BURST_CICLOS: la resistencia se regula en pasos del 2 %


def _redondea(x, n=1):
    return None if x is None else round(x, n)


class PlantaRuntime(Planta):
    def __init__(self, runtime, config=None):
        self.runtime = runtime
        self.config = config if config is not None else {}      # mismo dict que usa el Controlador (config del contrato)

    # ------------------------------------------------------------------------------------------------- lecturas ----
    def viva(self):
        """Los hilos de E/S del runtime siguen en marcha (si han muerto, lo que hay en la imagen de proceso está congelado)."""
        return bool(self.runtime.diagnostico().get("running", True))

    def leer_sensores(self):
        diag = self.runtime.diagnostico()
        if not diag["io_ok"] or not diag.get("running", True) or not getattr(self.runtime, "_entradas_leidas", True):
            return {}                                            # sin E/S fiable: todo null
        an, di = self.runtime.readAnalogInput(), self.runtime.readDigitalInput()
        v = lambda n: an.get(f"AnalogIn{n}_value")
        d = lambda n: bool(di.get(f"DigitalIn{n}_value"))
        k_f1 = self.config.get("f1_ml_min_per_v")
        k_f1 = k_f1 if isinstance(k_f1, (int, float)) and not isinstance(k_f1, bool) and k_f1 > 0 else F1_ML_MIN_POR_V_CONECTOR
        lectura = {f"t{n}_c": _redondea(v(n) * ESCALA_T_C_POR_V) for n in (1, 2, 3, 4, 5)}   # AnalogIn5 es la sonda T5 (comprobado el 27/11)
        lectura["l1_level_mm"] = None                            # el nivel del tanque A no llega a ninguna entrada de la placa
        lectura["f1_flow_ml_min"] = _redondea(max(v(7) * DIVISOR_ADC * k_f1, 0.0))
        lectura["stat_overtemp"] = not d(1)
        lectura["hl_heat_unit"] = d(2)
        lectura["hl_tank_b"] = d(3)
        lectura["ll_tank_b"] = not d(4)
        # D5 como nivel del calefactor es un SUPUESTO sin comprobar (PCT23.md:29) y en la maqueta está a 0 con el depósito lleno: leído así, el
        # interlock interlock_low_level_heat bloqueaba N2 y la resistencia. Hasta confirmar qué es D5 va como null (no se puede leer).
        lectura["lvl_heat_unit"] = None
        return lectura

    def estado_actuadores(self):
        out = self.runtime.readOutputs()
        diag = self.runtime.diagnostico()
        resistencia_on = bool(out.get("TransistorOut3_value"))
        ciclos = round(min(max(float(out.get("AnalogOut1_value", 0.0)), 0.0), 100.0) * CICLOS_RAFAGA / 100)
        return {
            "sol1_divert": not out.get("DigitalOut3_value", False),
            "sol2_feed_tank": "B" if out.get("DigitalOut4_value") else "A",
            "sol3_cooling": bool(out.get("DigitalOut5_value")),
            "sol4_fill_a": bool(out.get("DigitalOut6_value")),
            "sol5_fill_b": bool(out.get("DigitalOut7_value")),
            "n1_on": bool(out.get("TransistorOut8_value")),
            "n1_speed_pct": int(round(out.get("PWMOut1_value", 0.0))),
            "n2_on": bool(out.get("TransistorOut7_value")),
            "n2_speed_pct": int(round(out.get("PWMOut2_value", 0.0))),
            "heater_pct": int(ciclos * 100 / CICLOS_RAFAGA) if resistencia_on else 0,     # lo que la ráfaga aplica de verdad (pasos del 2 %)
            "heater_inhibited": bool(diag["calefactor_bloqueado"]),
        }

    # ---------------------------------------------------------------------------------------------------- órdenes ----
    def aplicar(self, pedido):
        """Traduce un pedido del contrato a salidas del runtime. El runtime puede cambiarlo (PWM mínimo del 50 %, termostato abierto, sonda T2):
        lo que se devuelve es lo REALMENTE aplicado, que es lo que el contrato pone en `applied`."""
        salidas = {}
        for tag, valor in pedido.items():
            if tag == "sol1_divert":
                salidas["DigitalOut3_value"] = not valor
            elif tag == "sol2_feed_tank":
                salidas["DigitalOut4_value"] = valor == "B"
            elif tag == "sol3_cooling":
                salidas["DigitalOut5_value"] = valor
            elif tag == "sol4_fill_a":
                salidas["DigitalOut6_value"] = valor
            elif tag == "sol5_fill_b":
                salidas["DigitalOut7_value"] = valor
            elif tag == "n1_on":
                salidas["TransistorOut8_value"] = valor
            elif tag == "n1_speed_pct":
                salidas["PWMOut1_value"] = valor
            elif tag == "n2_on":
                salidas["TransistorOut7_value"] = valor
            elif tag == "n2_speed_pct":
                salidas["PWMOut2_value"] = valor
            elif tag == "heater_pct":
                if valor > 0:
                    salidas["AnalogOut1_value"] = valor
                    salidas["TransistorOut3_value"] = True      # AnalogOut1 sola no enciende: TransistorOut3 es la orden de encendido
                else:
                    salidas["TransistorOut3_value"] = False
        if salidas:
            self.runtime.update_outputs(salidas)
        return self.estado_actuadores()
