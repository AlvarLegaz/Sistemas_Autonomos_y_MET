"""Hardware del simulador del submarino.

Misma clase Hardware, con los mismos métodos y el mismo vigilante de órdenes
que tendrá el submarino real. La diferencia es qué hay debajo: en vez de
cuatro ESC por PWM, un mundo simulado (mundo.py). set_motores() escribe las
cuatro consignas en el mundo y leer_bateria() la lee de él. Los sensores
acceden al mundo a través de este objeto, igual que en el real accederán al
bus I2C y al sensor de presión.

Cuatro propulsores: izquierda y derecha (horizontales, a popa) y proa y popa
(verticales, en la línea de crujía). Consigna vertical positiva = empuja
hacia abajo (sumerge).
"""

import threading
import time

from mundo import Mundo

# Rango aceptado por set_motores(): -100..0..+100.
VELOCIDAD_MIN = -100
VELOCIDAD_MAX = 100

# Si no llega una orden nueva en este tiempo, los cuatro motores se paran
# solos. En un submarino con flotabilidad positiva eso significa que sube
# despacio a la superficie: es la conducta segura si se pierde el enlace.
WATCHDOG_TIMEOUT = 0.5
WATCHDOG_INTERVALO = 0.05

MOTORES = ("izquierda", "derecha", "proa", "popa")


class Hardware:
    def __init__(self):
        self.configurado = False
        # Es False siempre: el simulador corre en un PC.
        self.raspberry = False
        # El mundo hace el papel del hardware físico.
        self.mundo = Mundo()
        # Última consigna aplicada a cada propulsor.
        self.motores = {m: 0 for m in MOTORES}
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

    def set_motores(self, izquierda, derecha, proa, popa):
        """Fija la consigna de los cuatro propulsores y devuelve lo aplicado.

        Cada llamada rearma el vigilante, incluso si las consignas son 0.
        """
        with self._cerrojo:
            self.ultima_orden = time.monotonic()
            self.watchdog_activado = False
            return self._aplicar(izquierda, derecha, proa, popa)

    def _aplicar(self, izquierda, derecha, proa, popa):
        """Único punto que escribe en los motores. Llamar con el cerrojo cogido."""
        for nombre, valor in zip(MOTORES, (izquierda, derecha, proa, popa)):
            self.motores[nombre] = max(VELOCIDAD_MIN, min(VELOCIDAD_MAX, int(round(valor))))
        # Donde el real escribe el PWM de cada ESC, aquí se escribe en el mundo.
        self.mundo.fijar_consigna(*(self.motores[m] for m in MOTORES))
        return dict(self.motores)

    def _vigilar(self):
        """Para los motores si pasa WATCHDOG_TIMEOUT sin una orden nueva."""
        while not self._fin.wait(WATCHDOG_INTERVALO):
            with self._cerrojo:
                if self.watchdog_activado:
                    continue
                if time.monotonic() - self.ultima_orden > WATCHDOG_TIMEOUT:
                    self._aplicar(0, 0, 0, 0)
                    self.watchdog_activado = True

    def estado_control(self):
        """Consigna vigente de cada propulsor, leída de una pieza."""
        with self._cerrojo:
            estado = dict(self.motores)
            estado["watchdog"] = self.watchdog_activado
            return estado

    def leer_bateria(self):
        """Porcentaje de batería del mundo, que se gasta con el uso."""
        return int(round(self.mundo.leer_bateria()))

    def cerrar(self):
        """Para el vigilante y el mundo, y deja los motores parados."""
        self._fin.set()
        if self._hilo is not None:
            self._hilo.join(timeout=1.0)
            self._hilo = None
        self.set_motores(0, 0, 0, 0)
        self.mundo.parar()
        self.configurado = False
