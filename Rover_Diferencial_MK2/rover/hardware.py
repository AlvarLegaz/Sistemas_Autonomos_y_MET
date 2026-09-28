"""Acceso al hardware físico de la Raspberry Pi.

Esta capa es la única que en el futuro hablará con el hardware real: GPIO, PWM,
el driver L298, el bus I2C, el puerto serie del GPS y la lectura de batería.
Hoy no hay nada de eso: los métodos guardan el estado y devuelven valores
simulados para que el sistema completo se pueda ejecutar y probar desde un PC,
sin Raspberry Pi.
"""

import threading
import time

# ============================================================================
# Pines y buses. Numeracion BCM (GPIOxx), no la del conector fisico.
# Valores de partida: ajustar al cableado real del rover.
# ============================================================================

# --- Driver L298: motores izquierdos (canal A) ---
MOTOR_IZQ_ENA = 12      # PWM de velocidad. GPIO12 = PWM0 por hardware (pin fisico 32)
MOTOR_IZQ_IN1 = 5       # sentido (pin fisico 29)
MOTOR_IZQ_IN2 = 6       # sentido (pin fisico 31)

# --- Driver L298: motores derechos (canal B) ---
# Agrupados con los izquierdos: los 6 pines del L298 quedan entre el 29 y el 36.
MOTOR_DER_ENB = 13      # PWM de velocidad. GPIO13 = PWM1 por hardware (pin fisico 33)
MOTOR_DER_IN3 = 19      # sentido (pin fisico 35); se usa como GPIO normal, no como PWM
MOTOR_DER_IN4 = 16      # sentido (pin fisico 36)

# Frecuencia del PWM de los motores. El L298 conmuta mal por encima de ~20 kHz.
MOTOR_PWM_FRECUENCIA_HZ = 1000

# --- Bus I2C (IMU) ---
# SDA = GPIO2 (pin fisico 3), SCL = GPIO3 (pin fisico 5).
I2C_BUS = 1             # /dev/i2c-1
IMU_DIRECCION_I2C = 0x68  # MPU6050 / MPU9250 (0x69 si AD0 esta a 3,3 V)

# --- Puerto serie (GPS) ---
# TX = GPIO14 (pin fisico 8), RX = GPIO15 (pin fisico 10).
GPS_PUERTO = "/dev/serial0"
GPS_BAUDIOS = 9600      # por defecto en los NEO-6M / NEO-M8N

# ============================================================================

# Rango aceptado por set_motores(): -100 retroceso, 0 parado, +100 avance.
VELOCIDAD_MIN = -100
VELOCIDAD_MAX = 100

# Si no llega una orden nueva en este tiempo, los motores se paran solos.
# Protege contra que se corte la red o se cuelgue el mando: sin esto el rover
# seguiría con la última consigna indefinidamente.
WATCHDOG_TIMEOUT = 0.5
# Cada cuánto comprueba el vigilante. Muy por debajo del timeout para que el
# corte no llegue tarde.
WATCHDOG_INTERVALO = 0.05

# Valor devuelto por leer_bateria() mientras no exista lectura real.
BATERIA_SIMULADA = 100


class Hardware:
    def __init__(self):
        self.configurado = False
        # Es False cuando corremos en un PC: no hay GPIO.
        self.raspberry = False
        # Última consigna aplicada a cada lado del rover.
        self.izquierda = 0
        self.derecha = 0
        # True cuando el vigilante ha cortado por falta de órdenes.
        self.watchdog_activado = False
        # Momento de la última orden recibida, en reloj monótono.
        self.ultima_orden = 0.0
        # El vigilante corre en su propio hilo y toca las mismas variables que
        # las peticiones del servidor, así que todo pasa por el cerrojo.
        self._cerrojo = threading.Lock()
        self._fin = threading.Event()
        self._hilo = None

    def configurar(self):
        """Prepara el hardware y arranca el vigilante de órdenes."""
        # TODO(hardware real): detectar la Raspberry, inicializar GPIO/PWM para
        # el L298 (MOTOR_*), abrir I2C_BUS y GPS_PUERTO a GPS_BAUDIOS.
        self.configurado = True
        if self._hilo is None or not self._hilo.is_alive():
            self._fin.clear()
            # Daemon: si el programa muere, el hilo no lo mantiene vivo.
            self._hilo = threading.Thread(target=self._vigilar, daemon=True)
            self._hilo.start()
        return self.configurado

    def set_motores(self, izquierda, derecha):
        """Fija la velocidad de cada lado y devuelve lo realmente aplicado.

        Los dos motores de un lado van siempre con la misma consigna: el rover
        es diferencial y cada lado se gobierna como una unidad. Cada llamada
        rearma el vigilante, incluso si la consigna es 0.
        """
        with self._cerrojo:
            self.ultima_orden = time.monotonic()
            self.watchdog_activado = False
            return self._aplicar(izquierda, derecha)

    def _aplicar(self, izquierda, derecha):
        """Único punto que escribe en los motores. Llamar con el cerrojo cogido."""
        # El recorte vive aquí, en la capa que manda al hardware, para que
        # nadie pueda enviar una consigna fuera de rango por otro camino.
        self.izquierda = max(VELOCIDAD_MIN, min(VELOCIDAD_MAX, int(izquierda)))
        self.derecha = max(VELOCIDAD_MIN, min(VELOCIDAD_MAX, int(derecha)))
        # TODO(hardware real): traducir a PWM en ENA/ENB y sentido en IN1..IN4.
        return {"izquierda": self.izquierda, "derecha": self.derecha}

    def _vigilar(self):
        """Para los motores si pasa WATCHDOG_TIMEOUT sin una orden nueva."""
        while not self._fin.wait(WATCHDOG_INTERVALO):
            with self._cerrojo:
                if self.watchdog_activado:
                    continue  # ya cortado: no hay nada que hacer hasta la próxima orden
                if time.monotonic() - self.ultima_orden > WATCHDOG_TIMEOUT:
                    self._aplicar(0, 0)
                    self.watchdog_activado = True

    def estado_control(self):
        """Consigna vigente de cada lado, leída de una pieza."""
        with self._cerrojo:
            return {
                "izquierda": self.izquierda,
                "derecha": self.derecha,
                "watchdog": self.watchdog_activado,
            }

    def leer_bateria(self):
        """Devuelve el porcentaje de batería. Simulado por ahora."""
        # TODO(hardware real): leer el divisor de tensión por ADC y convertir.
        return BATERIA_SIMULADA

    def cerrar(self):
        """Para el vigilante, deja el rover parado y libera el hardware."""
        # Primero el hilo: si no, seguiría tocando los motores mientras cerramos.
        self._fin.set()
        if self._hilo is not None:
            self._hilo.join(timeout=1.0)
            self._hilo = None
        self.set_motores(0, 0)
        # TODO(hardware real): GPIO.cleanup(), cerrar I2C y el puerto serie.
        self.configurado = False
