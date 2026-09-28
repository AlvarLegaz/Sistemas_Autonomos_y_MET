# Runtime PWM en Raspberry Pi

Proyecto Python para generar una señal PWM por software sobre un GPIO de Raspberry Pi, gestionada desde un runtime con hilo propio y una interfaz de comandos por terminal.

## Descripción

El proyecto implementa un pequeño runtime cíclico que ejecuta una actualización rápida cada **125 µs** y un escaneo lento cada **100 ms**. En cada tick rápido se actualiza una salida PWM software con resolución de **16 niveles**.

La señal PWM se genera en el pin **GPIO BCM 17**, que corresponde al **pin físico 11** de la Raspberry Pi.

## Estructura del proyecto

```text
.
├── pwm.py           # Clase PWM y control del GPIO físico
├── runtime.py       # Runtime cíclico con hilo, tick rápido y scan lento
└── test_runtime.py  # Interfaz CLI para arrancar, parar y cambiar el duty cycle
```

## Requisitos

- Raspberry Pi con acceso a GPIO.
- Python 3.
- Librería `gpiozero`.

Instalación de dependencias:

```bash
pip install gpiozero
```

En Raspberry Pi OS también puede estar disponible mediante `apt`:

```bash
sudo apt install python3-gpiozero
```

## Uso

Ejecuta la interfaz de prueba:

```bash
python3 test_runtime.py
```

Al arrancar verás los comandos disponibles:

```text
Comandos:
  arrancar
  parar
  pwm <0..100>
  salir
```

### Comandos disponibles

| Comando | Descripción |
| --- | --- |
| `arrancar` | Inicia el runtime en un hilo independiente. |
| `parar` | Detiene el runtime y libera el GPIO. |
| `pwm <0..100>` | Cambia el duty cycle de la señal PWM. |
| `salir` | Detiene el runtime y sale del programa. |

Ejemplo:

```text
> arrancar
Arrancando...
SCAN LENTO
> pwm 25
Nuevo duty PWM: 25.0% (nivel 4/16)
> pwm 75
Nuevo duty PWM: 75.0% (nivel 12/16)
> parar
Parando...
Parado
> salir
```

## Funcionamiento interno

### PWM software

La clase `PWM` divide cada periodo PWM en **16 slots**. El duty cycle indicado en porcentaje se convierte a un nivel entero entre `0` y `16`:

```python
duty_level = round((duty_percent / 100) * PWM_LEVELS)
```

Durante cada llamada a `update()`, la salida se activa si el slot actual es menor que el nivel de duty configurado. Después se avanza al siguiente slot.

Con la configuración actual:

- Tick rápido: `125 µs`.
- Niveles PWM: `16`.
- Periodo PWM aproximado: `125 µs × 16 = 2 ms`.
- Frecuencia PWM aproximada: `500 Hz`.

### Runtime

La clase `Runtime` crea un hilo dedicado que ejecuta el bucle principal. En ese bucle:

1. Se comprueba si toca ejecutar el scan lento.
2. Se actualiza el PWM.
3. Se espera hasta el siguiente tick usando `time.monotonic_ns()`.

Constantes principales:

```python
TICK_US = 125
SLOW_SCAN_MS = 100
```

## GPIO utilizado

Por defecto, el proyecto usa:

```python
PWM_GPIO_PIN = 17
```

Esto corresponde a:

- Numeración BCM: `GPIO 17`.
- Pin físico Raspberry Pi: `11`.

Para cambiar el GPIO, modifica la constante en `pwm.py` o instancia la clase `PWM` con otro pin.

## Consideraciones

- Este PWM se genera por software, por lo que la precisión depende del sistema operativo, la carga de CPU y la planificación de hilos.
- El método `wait_until()` realiza espera activa, lo que puede consumir CPU.
- Para señales PWM críticas o frecuencias altas, conviene valorar PWM hardware o librerías específicas como `pigpio`.
- El proyecto está orientado a pruebas, aprendizaje o control simple de salidas digitales.

## Posibles mejoras

- Añadir tests automáticos con mocks de `gpiozero`.
- Permitir configurar el GPIO desde línea de comandos.
- Sustituir la espera activa por una estrategia menos costosa para CPU.
- Añadir logs configurables en lugar de `print()`.
- Gestionar errores al introducir valores no numéricos en `pwm <0..100>`.

## Licencia

Añade aquí la licencia del proyecto si aplica.
