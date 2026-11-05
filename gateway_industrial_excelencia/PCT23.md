# Gateway y maqueta PCT23: lo que sabemos

Resumen del cableado entre la placa *Industrial Gateway* (esquemas KiCad de Antonio Rosa Rodríguez, CIFP Politécnico Cartagena) y la maqueta Armfield PCT23 (Process Plant Trainer), y de cómo lo usa el software. Lo marcado como **supuesto** no está confirmado.

## Bus I2C y SPI de la placa

| Dispositivo | Bus / dirección | Función | Estado en el gateway |
| --- | --- | --- | --- |
| PCF8574A | I2C `0x38` | 8 entradas digitales (conector J4) | En uso |
| PCF8574A | I2C `0x39` | 8 salidas a relé, K1-K8 (conectores J9 y J6) | En uso (`DigitalOut1-8`) |
| PCF8574A | I2C `0x3A` | 8 salidas a transistor, TBD62783A (conector J7) | En uso (`TransistorOut1-8`) |
| ADS1115 | I2C `0x48` | 2 entradas 4-20 mA (J8) | Responde en el bus; sin driver |
| MCP4728 | I2C `0x60` | 4 salidas analógicas 0-10 V (J5) | **No respondió** en la Pi (error 5); sin driver |
| MCP3008 | SPI0 CE0 | 8 entradas analógicas de la PCT23 (J3) | En uso (`AnalogIn1-8`) |
| MAX31865 x2 | SPI0 CE1 | 2 sondas RTD (J8) | Sin driver |

Las salidas por PCF8574A + inversor 74HC14 son **activas a nivel bajo** en el chip: el bit a 0 activa la salida. El software lo gestiona con `active_high=False`; al arrancar y al parar quedan todas apagadas.

## Entradas digitales (J4, PCF 0x38)

El esquema define P0 = LL, P1 = HL, P2 = LVL, P3 = STAT. El cableado real que se usa con la maqueta es este:

| Canal | Señal |
| --- | --- |
| `DigitalIn1` (D1) | Termostato del heat unit (abre si hay sobretemperatura) |
| `DigitalIn2` (D2) | Nivel alto (HL) del heat unit |
| `DigitalIn3` (D3) | Nivel alto (HL) del tanque B |
| `DigitalIn4` (D4) | Nivel bajo (LL) del tanque B |
| `DigitalIn5` (D5) | Nivel del tanque calefactor (LVL) — **supuesto** |

Cada entrada pasa por un divisor (10 kΩ en serie, 20 kΩ a masa) y un zener de 3,9 V. Si una entrada llega y se lee a 0, mide con el polímetro en el conector y en el pin del chip: una vez la causa fue una resistencia del divisor rota (D2).

## Entradas analógicas (J3, MCP3008, Vref 3,3 V)

| Canal | Señal | Escala |
| --- | --- | --- |
| `AnalogIn1-5` | Sondas de temperatura T1-T5 | 0-1,5 V = 0-150 °C, es decir **grados = voltios x 100** |
| `AnalogIn6` | Caudal F1 | 0-5 V (divisor a 3,3 V) = 0-1500 ml/min |
| `AnalogIn7` | Nivel L1 del tanque A | 0-5 V (divisor a 3,3 V) = 0-250 mm |
| `AnalogIn8` | Sin conectar | — |

## Salidas

**Relés (`DigitalOut1-8`, K1-K8):** las electroválvulas SOL1-SOL5 están en `DigitalOut3` a `DigitalOut7` (relés K3-K7, SOL1 = D3 = K3). `DigitalOut1`, `2` y `8` sin asignar.

**Transistor (`TransistorOut1-8` = OUT01-OUT08 del conector J7):**

| Salida | Función |
| --- | --- |
| OUT08 | Acción de la bomba peristáltica del **feed unit** (N1 en el esquema) |
| OUT07 | Acción de la bomba peristáltica del **heat unit** (N2) |
| OUT05 | Sentido de giro del **heat unit**: se invierte cambiando el valor de la salida (0/1) |
| OUT06 | Sentido de giro del **feed unit**: igual que OUT05. **Supuesto**: no se sabe qué valor es adelante |
| OUT04 | Resistencia de calefacción del heat unit (on/off), el pin junto a los de los motores |
| OUT01-OUT03 | Sin asignar |

**Potencia (hilo `scan_potencia` de `runtime.py`, cada 10 ms, sobre el expansor de OUT01-OUT08):** `TransistorOut4/7/8` son la orden de encendido y la señal física se modula así.

| Salida | Control | Detalle |
| --- | --- | --- |
| OUT04 resistencia | Ráfagas, `AnalogOut1_value` (%) | Ventana de 50 ciclos de red (1 s): 100 % = 50 ciclos, 50 % = 25, repartidos de forma uniforme. Las dos resistencias de 120 V c.a. van en serie y forman una sola a 230 V |
| OUT07 heat unit | PWM lento, `PWMOut2_value` (%) | Periodo de 200 ms, pasos del 5 % |
| OUT08 feed unit | PWM lento, `PWMOut1_value` (%) | Igual que OUT07 |

`AnalogOut1`, `PWMOut1` y `PWMOut2` arrancan al **100 %**. El PWM sale por el expansor I2C, así que es lento (5 Hz): vale para ajustar caudal medio, no para un motor que necesite frecuencia alta. La ráfaga se reparte por tiempo, sin sincronizar con el paso por cero de la red; con un relé de estado sólido de paso por cero, la conmutación la hace él. `PWM_GPIO_PIN` sigue en `None` en `runtime.py` (PWM por GPIO de `PWMOut1`, sin usar).

## Interfaces web

El servicio `gateway-web` sirve dos páginas en el puerto 8080:

| URL | Contenido |
| --- | --- |
| `/` | Vista de canales: entradas, salidas a relé, salidas a transistor y diagnóstico |
| `/pct23` | SCADA de la planta: esquema con las lecturas en vivo, barra superior con el estado de la conexión (broker, gateway y E/S) y el botón **Parar todo** siempre a la vista (en móvil, abajo), aviso si se pierde la conexión o salta el termostato, y columna lateral con pestañas *Controles* (bombas, calefacción y electroválvulas SOL1-SOL5) y *Lecturas* (T1-T5, F1, L1 y entradas de protección). Mismo diseño que el simulador, en claro u oscuro según el sistema |

La asignación de canales del sinóptico está en la tabla `MAPA`, al principio del script de `pct23.html`.

## Despliegue en la Raspberry (192.168.99.11, usuario `admin`)

- `mosquitto`, `gateway-io` y `gateway-web` están habilitados en systemd: arrancan solos al reiniciar la Pi, con el código que ya haya en ella (no se actualiza solo).
- Para actualizar: `git pull` en `~/Sistemas_Autonomos_y_MET`. Si solo cambian las páginas HTML basta con eso; si cambia código Python, además `sudo systemctl restart gateway-io gateway-web`.
- El DNS de la Pi está fijado a 8.8.8.8 y 1.1.1.1, porque el del router no resolvía nombres.

## Pendiente

1. Confirmar qué valor (0 o 1) de OUT05 y OUT06 gira hacia adelante.
2. Comprobar el MCP4728 (0x60) para poder manejar las resistencias de calentamiento.
3. Probar en la placa real el PWM de las bombas (200 ms) y las ráfagas de la resistencia; `test_pi_emulada.py` solo los comprueba con un bus I2C emulado.
4. Decidir dónde dibujar T5 (no aparece en el esquema de la placa de la PCT23).
5. Confirmar D5 como nivel del tanque calefactor.
