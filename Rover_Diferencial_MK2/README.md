# Rover Diferencial MK2

Rover diferencial autónomo sobre Raspberry Pi 4: dos motores por lado gobernados por un L298, IMU por I2C, GPS por UART y cámara, con interfaz web para manejarlo desde el PC o el móvil.

| Carpeta | Qué es |
| --- | --- |
| [`rover/`](rover) | Software del rover real, para la Raspberry Pi. Ver [ARQUITECTURA.md](rover/ARQUITECTURA.md). |
| [`rover_sim/`](rover_sim) | Gemelo digital: el mismo software con un mundo simulado (`mundo.py`) para desarrollar sin hardware. Ver [ARQUITECTURA.md](rover_sim/ARQUITECTURA.md). |

En las dos carpetas se arranca igual y la interfaz queda en `http://<ip>:5000/`:

```bash
pip install -r requirements.txt
python main.py
```

## Pinout de la Raspberry Pi 4

![Pinout de la Raspberry Pi 4](rover/Raspberry-Pi-4-Pinout-scaled.webp)

Los pines se nombran por su número **GPIO (BCM)**, que es el que se usa en el código, no por su posición en el conector. Todos trabajan a **3,3 V**: no admiten 5 V en entrada.

### Pines usados por el rover

Definidos al principio de [`rover/hardware.py`](rover/hardware.py); es el único sitio que hay que cambiar si cambia el cableado.

| Función | Constante | GPIO | Pin físico |
| --- | --- | --- | --- |
| L298 ENA (velocidad izquierda, PWM) | `MOTOR_IZQ_ENA` | 12 (PWM0) | 32 |
| L298 IN1 (sentido izquierda) | `MOTOR_IZQ_IN1` | 5 | 29 |
| L298 IN2 (sentido izquierda) | `MOTOR_IZQ_IN2` | 6 | 31 |
| L298 ENB (velocidad derecha, PWM) | `MOTOR_DER_ENB` | 13 (PWM1) | 33 |
| L298 IN3 (sentido derecha) | `MOTOR_DER_IN3` | 19 | 35 |
| L298 IN4 (sentido derecha) | `MOTOR_DER_IN4` | 16 | 36 |
| I2C SDA (IMU) | `I2C_BUS = 1` | 2 | 3 |
| I2C SCL (IMU) | `I2C_BUS = 1` | 3 | 5 |
| UART TX → RX del GPS | `GPS_PUERTO` | 14 | 8 |
| UART RX ← TX del GPS | `GPS_PUERTO` | 15 | 10 |

Los 6 pines del L298 están agrupados entre el pin físico 29 y el 36, en la parte baja del conector. La cámara va por su conector CSI y no ocupa pines del GPIO.

### Pines libres para ampliar

| GPIO | Pin físico | Notas |
| --- | --- | --- |
| 4 | 7 | Libre |
| 17 | 11 | Libre |
| 27 | 13 | Libre |
| 22 | 15 | Libre |
| 25 | 22 | Libre |
| 26 | 37 | Libre |
| 23, 24 | 16, 18 | Libres |
| 20, 21 | 38, 40 | Libres |
| 7, 8, 9, 10, 11 | 26, 24, 21, 19, 23 | SPI0 (CE1, CE0, MISO, MOSI, SCLK). Libres mientras no se active SPI; resérvalos si se añade un ADC para la batería |
| 18 | 12 | Libre como GPIO, pero **no como PWM independiente**: comparte canal con GPIO12 (PWM0), que ya usa el motor izquierdo |

### No usar

| GPIO | Pin físico | Motivo |
| --- | --- | --- |
| 0, 1 | 27, 28 | ID_SD / ID_SC: reservados para la EEPROM de las placas HAT |
| 2, 3 | 3, 5 | Ocupados por el I2C; se pueden compartir con más dispositivos I2C (con otra dirección) |
| 14, 15 | 8, 10 | Ocupados por la UART del GPS |

### Alimentación

| Tipo | Pines físicos |
| --- | --- |
| 3,3 V | 1, 17 |
| 5 V | 2, 4 |
| GND | 6, 9, 14, 20, 25, 30, 34, 39 |

El GND de la Raspberry tiene que estar unido al GND del L298 y de la batería de los motores; si no, las señales de control no tienen referencia común.
