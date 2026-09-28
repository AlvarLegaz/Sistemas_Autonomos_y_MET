"""Acceso al hardware físico de la Raspberry Pi.

Esta capa es la única que en el futuro hablará con el hardware real: GPIO, PWM,
el driver L298, el bus I2C, el puerto serie del GPS y la lectura de batería.
Hoy no hay nada de eso: los métodos guardan el estado y devuelven valores
simulados para que el sistema completo se pueda ejecutar y probar desde un PC,
sin Raspberry Pi.
"""

import threading
import time

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
        # el L298, abrir el bus I2C y el puerto serie del GPS.
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
        # TODO(hardware real): traducir a PWM + sentido en los pines del L298.
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
