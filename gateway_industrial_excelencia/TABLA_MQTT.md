# Variables MQTT del gateway PCT23

Topics: `pct_23/entradas` (se lee, cada 100 ms) y `pct_23/salidas` (se ordena). Broker `192.168.99.11:1883`.

| Variable | Tipo | Función | Qué es | Unidad / valores | Canal en bruto |
|---|---|---|---|---|---|
| `T1` | analógica | sensor | Temperatura salida del tubo de residencia | °C | `AnalogIn1_value` (V × 100) |
| `T2` | analógica | sensor | Temperatura agua caliente (heat unit) | °C | `AnalogIn2_value` |
| `T3` | analógica | sensor | Temperatura producto final | °C | `AnalogIn3_value` |
| `T4` | analógica | sensor | Temperatura salida del calentamiento | °C | `AnalogIn4_value` |
| `F1` | analógica | sensor | Caudal del producto | ml/min | `AnalogIn7_value` (V / 3,3 × 1500) |
| `L1` | analógica | sensor | Nivel tanque A (**sin confirmar**) | mm | `AnalogIn5_value` (V / 3,3 × 250) |
| `TERM` | digital | sensor | Termostato heat unit | `true` = cerrado (bien), `false` = sobretemperatura | `DigitalIn1_value` |
| `HLC` | digital | sensor | Nivel alto heat unit | `true` = nivel alto | `DigitalIn2_value` |
| `HL` | digital | sensor | Nivel alto tanque B | `true` = nivel alto | `DigitalIn3_value` |
| `LL` | digital | sensor | Nivel bajo tanque B | lógica negada: `false` = no hay nivel | `DigitalIn4_value` |
| `LVLC` | digital | sensor | Nivel tanque calefactor (supuesto) | `true` = nivel alto | `DigitalIn5_value` |
| `SOL1` | digital | actuador | Electroválvula desvío de producto | `true` = abierta/activa | `DigitalOut3_value` |
| `SOL2` | digital | actuador | Electroválvula depósitos A/B | apagada = tanque A, encendida = tanque B | `DigitalOut4_value` |
| `SOL3` | digital | actuador | Electroválvula agua fría | `true` = abierta | `DigitalOut5_value` |
| `SOL4` | digital | actuador | Electroválvula ramal depósito A | `true` = abierta | `DigitalOut6_value` |
| `SOL5` | digital | actuador | Electroválvula ramal depósito B | `true` = abierta | `DigitalOut7_value` |
| `N1` | digital | actuador | Bomba feed unit: marcha/paro | `true` = marcha | `TransistorOut8_value` |
| `N2` | digital | actuador | Bomba heat unit: marcha/paro | `true` = marcha | `TransistorOut7_value` |
| `RES` | digital | actuador | Resistencia: marcha/paro (hay que renovarla cada ≤ 5 s) | `true` = calentar | `TransistorOut3_value` |
| `N1_sentido`, `N2_sentido` | digital | actuador | Sentido de giro de las bombas | solo `false` (adelante); `true` se rechaza | `TransistorOut6_value`, `TransistorOut5_value` |
| `N1_pct` | analógica | actuador | Velocidad de N1 (PWM) | 0–100 % (mínimo 50 % si está en marcha) | `PWMOut1_value` |
| `N2_pct` | analógica | actuador | Velocidad de N2 (PWM) | 0–100 % (mínimo 50 % si está en marcha) | `PWMOut2_value` |
| `RES_pct` | analógica | actuador | Potencia de la resistencia (ráfagas) | 0–100 % | `AnalogOut1_value` |

Los sensores solo se leen; los actuadores se leen en `pct_23/entradas` y se ordenan en `pct_23/salidas`. Paro de emergencia aparte: `{"paro_emergencia": true}` o `false`.
