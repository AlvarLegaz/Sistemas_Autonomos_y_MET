# Gateway industrial de E/S sobre Raspberry Pi

Pasarela que funciona como un pequeño PLC: lee entradas y escribe salidas físicas en un ciclo fijo y las intercambia con un SCADA por MQTT.

## Arquitectura

```text
  SCADA / cliente MQTT
        │ pct_23/salidas (JSON)              ▲ pct_23/entradas (JSON cada 100 ms)
        ▼                                    │
  gateway.py ── Gateway ─────────────────────┘
        │ update_outputs() / read*Input() / diagnostico()
        ▼
  runtime.py ── Runtime (imagen de proceso)
        │ hilo scan lento, 100 ms        │ hilo scan rápido, 125 µs (solo con PWM mapeado)
        ▼                                ▼
  pcf_digital_output  I2C 0x39       pwm.py  GPIO (sin mapear todavía)
  pcf_digital_input   I2C 0x38
  analog_inputs       SPI0 MCP3008
```

- **Imagen de proceso**: `Runtime` guarda en dos diccionarios (`inputs` y `outputs`) el valor de cada canal. MQTT y la consola solo leen y escriben esa imagen, protegida con un `lock`; nunca tocan el hardware.
- **Scan lento (100 ms, hilo propio)**: escribe las 8 salidas digitales, lee las 8 entradas digitales y las 8 analógicas. Duerme entre ciclos, no consume CPU esperando. Si un ciclo se pasa de 100 ms se cuenta en `scan_overruns` y el siguiente se reprograma desde ese momento, sin encadenar ciclos atrasados.
- **Scan rápido (125 µs, hilo propio)**: genera el PWM por software. Solo arranca si hay un GPIO configurado en `PWM_GPIO_PIN`; mientras sea `None` no existe el hilo.
- **Fallos de E/S**: un error del bus I2C/SPI no detiene el runtime. Se cuenta en `io_errors`, `io_ok` pasa a `false`, la imagen conserva los últimos valores buenos y se reintenta en el siguiente ciclo.
- **Parada segura**: al parar se cierran I2C, SPI y GPIO, y todas las salidas digitales quedan apagadas. Se puede volver a arrancar.

## Hardware

| Señal | Chip | Bus | Dirección | Estado |
| --- | --- | --- | --- | --- |
| 8 salidas digitales | PCF8574A | I2C-1 | 0x39 | En uso. Activas a nivel bajo (`active_high=False`) |
| 8 entradas digitales | PCF8574A | I2C-1 | 0x38 | En uso |
| 8 entradas analógicas | MCP3008 (10 bits) | SPI0 CE0 | — | En uso. Vref en `ADC_VREF` (`analog_inputs.py`) |
| PWMOut1 | GPIO por software | — | — | Sin mapear: `PWM_GPIO_PIN = None` en `runtime.py` |
| PWMOut2-8, salidas analógicas | — | — | — | Solo en la imagen, sin hardware |
| Entradas de corriente y RTD | — | — | — | Sin uso por ahora; no se publican |

Conexión del MCP3008: GPIO 11/SCLK → CLK, GPIO 10/MOSI → DIN, GPIO 9/MISO → DOUT, GPIO 8/CE0 → CS.

## Instalación

En la Raspberry Pi:

1. Activar I2C y SPI: `sudo raspi-config` → Interface Options (y reiniciar).
2. Comprobar que el usuario está en los grupos `i2c`, `spi` y `gpio` (`groups`).
3. Instalar las dependencias del sistema y crear el entorno virtual:

```bash
sudo apt install python3-dev python3-venv python3-lgpio i2c-tools
python3 -m venv --system-site-packages venv
source venv/bin/activate
pip install -r requirements.txt
```

`--system-site-packages` hace que `gpiozero` encuentre `lgpio` (la librería de pines de Raspberry Pi OS). `python3-dev` hace falta para compilar `spidev`.

4. Comprobar que se ven los chips: `i2cdetect -y 1` debe mostrar `38` y `39`.

## Uso

### Pasarela MQTT

```bash
python3 gateway.py
```

Se para con `Ctrl+C` o `SIGTERM`. Si el broker no está disponible, el runtime sigue funcionando y la conexión se reintenta sola.

Configuración al principio de `gateway.py`: `MQTT_BROKER_HOST`, `MQTT_BROKER_PORT`, `TOPIC_SALIDAS`, `TOPIC_ENTRADAS` y `PUBLISH_INTERVAL_S`.

**Salidas** (`pct_23/salidas`): JSON con solo las salidas que se quieren cambiar; el resto conserva su valor. Si algún valor no es válido, se descarta el mensaje entero.

```json
{"DigitalOut1_value": true, "DigitalOut2_value": 0, "PWMOut1_value": 50, "AnalogOut1_value": 1.5}
```

Las salidas digitales aceptan `true/false`, `1/0` o las cadenas `"true"/"false"`, `"on"/"off"`, `"1"/"0"`. El PWM se limita a 0-100 %.

**Entradas** (`pct_23/entradas`): cada 100 ms. Incluye también el estado actual de las salidas digitales y de `PWMOut1`, para que cualquier cliente vea el estado real aunque otro las haya cambiado.

```json
{"AnalogIn1_value": 1.234, "...": "...", "DigitalIn1_value": true, "...": "...",
 "DigitalOut1_value": false, "...": "...", "PWMOut1_value": 0.0,
 "running": true, "io_ok": true, "io_errors": 0, "scan_overruns": 0, "timestamp": 1790000000.0}
```

### App de control remoto

En `control_remoto/` hay una app de escritorio (Tkinter) para manejar la placa desde cualquier PC de la red, a través del mismo broker MQTT. El broker se indica al arrancar:

```bash
pip install -r control_remoto/requirements.txt
python control_remoto/control_remoto.py 192.168.99.53:1883
```

Muestra el estado del broker y del gateway (en marcha, error de E/S, sin datos), las 8 entradas digitales, las 8 analógicas y los contadores de diagnóstico. Permite conmutar las 8 salidas digitales, apagarlas todas y fijar el PWM 1. Los botones muestran el estado real que publica el gateway, no el último clic. Si el broker no responde, la app abre igualmente y reintenta la conexión.

### Pruebas sin MQTT

```bash
python3 test_runtime.py   # consola: arrancar, parar, read_ai, read_di, diag, write_do 1 0 0 0 0 0 0 0 ...
python3 test_analog.py    # tabla RAW/voltaje de los 8 canales del MCP3008
```

## Mapear el PWM

1. Poner el GPIO (numeración BCM) en `PWM_GPIO_PIN` de `runtime.py`, por ejemplo `17` (pin físico 11).
2. `PWMOut1_value` controla el duty: 16 niveles, periodo de 2 ms (500 Hz).

El PWM por software en Python tiene jitter: depende de la carga de la CPU y de los otros hilos (MQTT), y la espera activa ocupa un núcleo. Si hace falta precisión, es mejor un PWM por hardware (GPIO 12/13/18/19) o `gpiozero.PWMOutputDevice`, que genera la señal fuera de Python.
