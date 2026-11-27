# Variables MQTT del gateway PCT23

## Topics

| Topic | Sentido | QoS | Retain | Frecuencia | Contenido |
|---|---|---|---|---|---|
| `pct_23/entradas` | gateway → cliente (se lee) | 0 | no | cada 100 ms | JSON con el estado completo: sensores (`T1`, `F1`, `TERM`...), estado de los actuadores (`SOL1`, `N1`, `N1_velocidad`...), canales en bruto, diagnóstico y `timestamp` |
| `pct_23/salidas` | cliente → gateway (se ordena) | 1 | no | cuando haga falta | JSON con solo las claves a cambiar, por ejemplo `{"SOL1": true, "N1_velocidad": 80}`; también `{"paro_emergencia": true}` |

Broker `192.168.99.11:1883`, sin usuario ni TLS. Client IDs ya usados: `pct_23_gateway` y `pct_23_web` (usa otro distinto).

## Variables

| Variable | Tipo | Función | Qué es | Unidad / valores | Canal en bruto |
|---|---|---|---|---|---|
| `T1` | analógica | sensor | Temperatura salida del tubo de residencia | °C | `AnalogIn1_value` (V × 100) |
| `T2` | analógica | sensor | Temperatura agua caliente (heat unit) | °C | `AnalogIn2_value` |
| `T3` | analógica | sensor | Temperatura producto final | °C | `AnalogIn3_value` |
| `T4` | analógica | sensor | Temperatura salida del calentamiento | °C | `AnalogIn4_value` |
| `F1` | analógica | sensor | Caudal del producto | ml/min | `AnalogIn7_value` (V / 3,3 × 1500) |
| `T5` | analógica | sensor | Temperatura T5 (comprobado el 27/11 que AnalogIn5 es esta sonda) | °C | `AnalogIn5_value` (V × 100) |
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
| `N1_velocidad` | analógica | actuador | Velocidad de N1 (PWM) | 0–100 % (mínimo 50 % si está en marcha) | `PWMOut1_value` |
| `N2_velocidad` | analógica | actuador | Velocidad de N2 (PWM) | 0–100 % (mínimo 50 % si está en marcha) | `PWMOut2_value` |
| `RES_potencia` | analógica | actuador | Potencia de la resistencia (ráfagas) | 0–100 % | `AnalogOut1_value` |

Los sensores solo se leen; los actuadores se leen en `pct_23/entradas` y se ordenan en `pct_23/salidas`. Paro de emergencia aparte: `{"paro_emergencia": true}` o `false`.

## Cómo hablarle (resumen)

1. Conéctate a `192.168.99.11:1883` y suscríbete a `pct_23/entradas`: llega un JSON cada 100 ms con todos los sensores y el estado de los actuadores.
2. Ordena publicando en `pct_23/salidas` **solo las claves a cambiar**, por ejemplo `{"SOL1": true, "N1": true, "N1_velocidad": 80}`. Las demás salidas conservan su valor.
3. **El gateway no responde a las órdenes.** Para saber si se aplicó, mira el siguiente mensaje de `pct_23/entradas`: si el valor no cambió, la orden se rechazó por seguridad (reglas de abajo).
4. Si dejan de llegar mensajes de `pct_23/entradas` durante más de 1 s (o `timestamp` no avanza), el gateway está caído: avisa al usuario y no des por buenos los últimos valores.
5. Para parar todo en cualquier momento: `{"paro_emergencia": true}`.

## Reglas que el gateway aplica siempre (y por qué)

Valen para cualquier cliente (SCADA, consola, otro programa): rechazan órdenes **sin avisar**, así que conviene conocerlas.

| Regla | Qué ocurre | Por qué |
|---|---|---|
| Orden de calentar caduca a los 15 s | `{"RES": true}` hay que **reenviarlo cada 5 s como máximo**; si no, la resistencia se apaga sola | Si el SCADA, la red o el broker se caen, la resistencia no puede quedarse calentando sin control. Es una seguridad que no depende del SCADA |
| Termostato abierto (`TERM` = `false`) | `RES` rechazada, se borra la orden anterior y **no se rearma sola**: hay que dejar enfriar y volver a ordenar a mano | El termostato salta a 70 °C por sobretemperatura. Evita volver a calentar justo después de un disparo, aunque el SCADA lo pida |
| Sonda T2 fuera de 5–145 °C | `RES` rechazada (`sonda_t2_fuera_de_rango`) | Sonda desconectada, en corto o rota: sin saber la temperatura del agua se calentaría a ciegas |
| Sin lectura válida de entradas (`io_ok` = `false`) | `RES` no conduce, pero la orden no se borra | No se sabe si el termostato está cerrado: por seguridad, apagada |
| Paro de emergencia | `{"paro_emergencia": true}` apaga todas las salidas y rechaza cualquier encendido hasta `{"paro_emergencia": false}`. Rearmar **no enciende nada**. Repite la orden hasta ver `paro_emergencia` = `true` en las entradas | Enclavamiento: tras rearmar hay que volver a ordenar cada cosa a propósito, para que nada arranque solo. Se pierde si se reinicia `gateway-io` |
| Velocidad de bomba mínima del 50 % | `N1_velocidad`/`N2_velocidad` entre 1 y 49 se suben a 50; `0` deja la bomba sin tensión | Un motor con poca tensión no gira y se queda bloqueado consumiendo la corriente máxima: así se quemó el driver L298P |
| Sentido solo hacia delante | `N1_sentido`/`N2_sentido` = `true` se rechaza. No usar | Invertir el giro con la bomba en marcha produce una contracorriente que destruye el driver |
| Arranque y parada de bombas | Al encender, va al 100 % durante 0,3 s y luego baja a su velocidad; al apagar, baja al 50 % en 1 s y se corta (el paro de emergencia corta en seco) | Despegar el rotor sin dejarlo bloqueado y parar sin golpes |
| Un solo control sobre las mismas salidas | Si el SCADA controla por MQTT, no uses a la vez el control automático del servidor web (`/api/control`) | Dos controles mandando a las mismas salidas se pisan |
