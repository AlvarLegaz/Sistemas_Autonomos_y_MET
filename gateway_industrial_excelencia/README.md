# Gateway industrial de E/S sobre Raspberry Pi

Pasarela que funciona como un pequeño PLC: lee entradas y escribe salidas físicas en un ciclo fijo y las intercambia con un SCADA por MQTT.

El proyecto son dos programas que no se hablan directamente, sino a través de un broker MQTT:

```text
PC: control_remoto.py  ──►  broker MQTT (ip:puerto)  ◄──  Raspberry Pi: gateway_main_app.py
```

## Puesta en marcha

### 1. Raspberry Pi: `gateway_main_app.py`

Solo la primera vez:

```bash
sudo raspi-config                       # Interface Options: activar I2C y SPI, y reiniciar
sudo apt install git python3-dev python3-venv python3-lgpio i2c-tools
git clone https://github.com/AlvarLegaz/Sistemas_Autonomos_y_MET.git
cd Sistemas_Autonomos_y_MET/gateway_industrial_excelencia
python3 -m venv --system-site-packages venv
source venv/bin/activate
pip install -r requirements.txt
i2cdetect -y 1                          # deben aparecer 38 y 39
```

El usuario tiene que estar en los grupos `i2c`, `spi` y `gpio` (compruébalo con `groups`). `--system-site-packages` hace que `gpiozero` encuentre `lgpio`, la librería de pines de Raspberry Pi OS, y `python3-dev` hace falta para compilar `spidev`.

Cada vez:

```bash
cd Sistemas_Autonomos_y_MET/gateway_industrial_excelencia
source venv/bin/activate
python3 gateway_main_app.py 192.168.99.53:1883 usuario@clave
```

Para actualizar el código: `git pull` en la carpeta del repositorio.

### 2. PC: `control_remoto/control_remoto.py`

Solo la primera vez (Tkinter ya viene con Python):

```bash
pip install -r control_remoto/requirements.txt
```

Cada vez:

```bash
python control_remoto/control_remoto.py 192.168.99.53:1883 usuario@clave
```

### Parámetros (iguales en los dos programas)

| Parámetro | Formato | Si se omite |
| --- | --- | --- |
| Broker | `ip:puerto` (el puerto es opcional, 1883 por defecto) | En el gateway, `192.168.99.53:1883`; en el control remoto es obligatorio |
| Credenciales | `usuario@clave` | Conexión sin autenticación |

- La clave se separa en la **primera** `@`, así que puede contener `@` y `:`.
- Si pones solo `usuario`, la contraseña se toma de la variable de entorno `MQTT_PASSWORD` o se pide por teclado sin mostrarla. Así no queda en el historial de la terminal ni visible en la lista de procesos, lo que es preferible en la Raspberry.
- El broker va siempre primero: `ip:puerto usuario@clave`.

Si el broker no responde, los dos programas arrancan igualmente y reintentan la conexión solos. El gateway se para con `Ctrl+C` o `SIGTERM` y deja las salidas apagadas.

## Tópicos MQTT

```text
pct_23/
├── salidas     PC/SCADA → gateway    órdenes: JSON solo con las salidas a cambiar
│   ├── DigitalOut1_value … DigitalOut8_value   true/false, 1/0, "on"/"off"
│   ├── PWMOut1_value                            0-100 %
│   └── PWMOut2..8_value, AnalogOut1..8_value    se aceptan, sin hardware todavía
└── entradas    gateway → PC/SCADA    estado completo cada 100 ms
    ├── DigitalIn1_value … DigitalIn8_value      true/false
    ├── AnalogIn1_value … AnalogIn8_value        voltios
    ├── DigitalOut1_value … DigitalOut8_value    estado real de las salidas
    ├── PWMOut1_value                            duty actual (%)
    ├── running, io_ok, io_errors, scan_overruns diagnóstico del runtime
    └── timestamp                                segundos Unix
```

Ejemplo de orden en `pct_23/salidas`. Las salidas que no aparecen conservan su valor; si algún valor no es válido, se descarta el mensaje entero:

```json
{"DigitalOut1_value": true, "DigitalOut2_value": 0, "PWMOut1_value": 50}
```

Ejemplo de estado en `pct_23/entradas`:

```json
{"AnalogIn1_value": 1.234, "...": "...", "DigitalIn1_value": true, "...": "...",
 "DigitalOut1_value": false, "...": "...", "PWMOut1_value": 0.0,
 "running": true, "io_ok": true, "io_errors": 0, "scan_overruns": 0, "timestamp": 1790000000.0}
```

Los nombres de los tópicos están en `TOPIC_SALIDAS` y `TOPIC_ENTRADAS`, al principio de `gateway_main_app.py` y de `control_remoto.py`; si se cambian, hay que cambiarlos en los dos.

## App de control remoto

Muestra el estado del broker y del gateway (en marcha, error de E/S, sin datos), las 8 entradas digitales, las 8 analógicas y los contadores de diagnóstico. Permite conmutar las 8 salidas digitales, apagarlas todas y fijar el PWM 1. Los botones muestran el estado real que publica el gateway, no el último clic. Si el broker rechaza las credenciales, se indica en la barra superior.

## Arquitectura del gateway

```text
  SCADA / cliente MQTT
        │ pct_23/salidas (JSON)              ▲ pct_23/entradas (JSON cada 100 ms)
        ▼                                    │
  gateway_main_app.py ── Gateway ────────────┘
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

## Pruebas en la placa sin MQTT

```bash
python3 test_runtime.py   # consola: arrancar, parar, read_ai, read_di, diag, write_do 1 0 0 0 0 0 0 0 ...
python3 test_analog.py    # tabla RAW/voltaje de los 8 canales del MCP3008
```

## Mapear el PWM

1. Poner el GPIO (numeración BCM) en `PWM_GPIO_PIN` de `runtime.py`, por ejemplo `17` (pin físico 11).
2. `PWMOut1_value` controla el duty: 16 niveles, periodo de 2 ms (500 Hz).

El PWM por software en Python tiene jitter: depende de la carga de la CPU y de los otros hilos (MQTT), y la espera activa ocupa un núcleo. Si hace falta precisión, es mejor un PWM por hardware (GPIO 12/13/18/19) o `gpiozero.PWMOutputDevice`, que genera la señal fuera de Python.
