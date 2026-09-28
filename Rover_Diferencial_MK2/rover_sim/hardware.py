"""Hardware del gemelo digital.

Misma clase Hardware, con los mismos métodos y el mismo vigilante de órdenes
que el rover real. La diferencia es qué hay debajo: en vez de GPIO y un L298,
un mundo simulado (mundo.py). set_motores() escribe la consigna en el mundo y
leer_bateria() la lee de él. Los sensores acceden al mundo a través de este
objeto, igual que en el real accederán al bus I2C y al puerto serie.
"""

import threading
import time

from mundo import Mundo

# Rango aceptado por set_motores(): -100 retroceso, 0 parado, +100 avance.
VELOCIDAD_MIN = -100
VELOCIDAD_MAX = 100

# Si no llega una orden nueva en este tiempo, los motores se paran solos.
# Se mantiene en el simulador a propósito: el alumno tiene que aprender que
# el rover real se para si el mando deja de enviar.
WATCHDOG_TIMEOUT = 0.5
WATCHDOG_INTERVALO = 0.05


class Hardware:
    def __init__(self):
        self.configurado = False
        # Es False siempre: el simulador corre en un PC.
        self.raspberry = False
        # El mundo hace el papel del hardware físico.
        self.mundo = Mundo()
        # Última consigna aplicada a cada lado del rover.
        self.izquierda = 0
        self.derecha = 0
        # True cuando el vigilante ha cortado por falta de órdenes.
        self.watchdog_activado = False
        # Momento de la última orden recibida, en reloj monótono.
        self.ultima_orden = 0.0
        self._cerrojo = threading.Lock()
        self._fin = threading.Event()
        self._hilo = None

    def configurar(self):
        """Arranca el mundo y el vigilante de órdenes."""
        self.mundo.arrancar()
        self.configurado = True
        if self._hilo is None or not self._hilo.is_alive():
            self._fin.clear()
            self._hilo = threading.Thread(target=self._vigilar, daemon=True)
            self._hilo.start()
        return self.configurado

    def set_motores(self, izquierda, derecha):
        """Fija la velocidad de cada lado y devuelve lo realmente aplicado.

        Cada llamada rearma el vigilante, incluso si la consigna es 0.
        """
        with self._cerrojo:
            self.ultima_orden = time.monotonic()
            self.watchdog_activado = False
            return self._aplicar(izquierda, derecha)

    def _aplicar(self, izquierda, derecha):
        """Único punto que escribe en los motores. Llamar con el cerrojo cogido."""
        self.izquierda = max(VELOCIDAD_MIN, min(VELOCIDAD_MAX, int(izquierda)))
        self.derecha = max(VELOCIDAD_MIN, min(VELOCIDAD_MAX, int(derecha)))
        # Donde el real escribe PWM + sentido en el L298, aquí se escribe en el mundo.
        self.mundo.fijar_consigna(self.izquierda, self.derecha)
        return {"izquierda": self.izquierda, "derecha": self.derecha}

    def _vigilar(self):
        """Para los motores si pasa WATCHDOG_TIMEOUT sin una orden nueva."""
        while not self._fin.wait(WATCHDOG_INTERVALO):
            with self._cerrojo:
                if self.watchdog_activado:
                    continue
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
        """Porcentaje de batería del mundo, que se gasta con el uso."""
        return int(round(self.mundo.leer_bateria()))

    def cerrar(self):
        """Para el vigilante y el mundo, y deja el rover parado."""
        self._fin.set()
        if self._hilo is not None:
            self._hilo.join(timeout=1.0)
            self._hilo = None
        self.set_motores(0, 0)
        self.mundo.parar()
        self.configurado = False
