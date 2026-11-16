"""Nombres de la planta PCT23 para los clientes MQTT (SCADA): T1 en lugar de AnalogIn1_value.

El gateway sigue publicando y aceptando los nombres en bruto (AnalogIn1_value, DigitalOut3_value...), porque el sinoptico
actual y el control automatico los usan. Ademas publica estos nombres, ya en unidades de ingenieria, y acepta ordenes con
ellos. Es la unica tabla de equivalencias del gateway: la misma que la tabla MAPA de pct23.html.
"""

ADC_VREF = 3.3                    # V a fondo de escala del MCP3008 (el mismo valor que analog_inputs.ADC_VREF)

# Sondas de temperatura: 10 mV/°C (°C = V x 100).
GRADOS_POR_VOLTIO = 100.0
TEMPERATURAS = {                  # nombre -> canal en bruto (V)
    "T1": "AnalogIn1_value",      # salida del tubo de residencia
    "T2": "AnalogIn2_value",      # agua caliente (heat unit)
    "T3": "AnalogIn3_value",      # producto final
    "T4": "AnalogIn4_value",      # salida del calentamiento
}
# Caudal y nivel: (canal, valor a fondo de escala (3,3 V), unidad).
F1_CANAL, F1_FONDO = "AnalogIn7_value", 1500.0        # ml/min
L1_CANAL, L1_FONDO = "AnalogIn5_value", 250.0         # mm (sin confirmar: en la prueba no midio nivel)

DIGITALES = {                     # entradas digitales: True = entrada activa
    "TERM": "DigitalIn1_value",   # termostato heat unit: True = cerrado (bien), False = sobretemperatura
    "HLC": "DigitalIn2_value",    # nivel alto heat unit
    "HL": "DigitalIn3_value",     # nivel alto tanque B
    "LL": "DigitalIn4_value",     # nivel bajo tanque B (logica negada: False = no hay nivel)
    "LVLC": "DigitalIn5_value",   # nivel tanque calefactor (supuesto)
}

SALIDAS = {                       # nombre -> canal en bruto (orden de encendido, bool)
    "SOL1": "DigitalOut3_value",  # desvio de producto
    "SOL2": "DigitalOut4_value",  # depositos A/B (apagada = tanque A)
    "SOL3": "DigitalOut5_value",  # agua fria
    "SOL4": "DigitalOut6_value",  # ramal deposito A
    "SOL5": "DigitalOut7_value",  # ramal deposito B
    "N1": "TransistorOut8_value",           # bomba feed unit
    "N2": "TransistorOut7_value",           # bomba heat unit
    "RES": "TransistorOut3_value",          # resistencia
    "N1_sentido": "TransistorOut6_value",   # solo hacia delante (False): el gateway rechaza True
    "N2_sentido": "TransistorOut5_value",
}
CONSIGNAS = {                     # nombre -> canal en bruto (0-100 %)
    "N1_velocidad": "PWMOut1_value",
    "N2_velocidad": "PWMOut2_value",
    "RES_potencia": "AnalogOut1_value",
}
ORDENABLES = {**SALIDAS, **CONSIGNAS}


def amigables(crudo):
    """Diccionario con los nombres de la planta a partir de la lectura en bruto (T1 en °C, F1 en ml/min, L1 en mm...).
    Solo incluye las senales cuyo canal este en `crudo`."""
    fuera = {}
    for nombre, canal in TEMPERATURAS.items():
        if isinstance(crudo.get(canal), (int, float)):
            fuera[nombre] = round(crudo[canal] * GRADOS_POR_VOLTIO, 2)
    for nombre, canal, fondo in (("F1", F1_CANAL, F1_FONDO), ("L1", L1_CANAL, L1_FONDO)):
        if isinstance(crudo.get(canal), (int, float)):
            fuera[nombre] = round(min(max(crudo[canal], 0.0), ADC_VREF) / ADC_VREF * fondo, 2)
    for nombre, canal in {**DIGITALES, **ORDENABLES}.items():
        if canal in crudo:
            fuera[nombre] = crudo[canal]
    return fuera


def a_crudo(orden):
    """Traduce las claves amigables de una orden (SOL1, N1, N1_velocidad...) a los canales en bruto. Las claves en bruto, el paro de
    emergencia y las desconocidas pasan igual; si llegan las dos formas del mismo canal, manda la de bruto."""
    traducida = {}
    for clave, valor in orden.items():
        canal = ORDENABLES.get(clave)
        if canal is None:
            traducida[clave] = valor
        elif canal not in orden:
            traducida[canal] = valor
    return traducida
