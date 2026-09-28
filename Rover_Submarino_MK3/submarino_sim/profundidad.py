"""Profundidad y distancia al fondo del simulador del submarino.

Sustituye al GPS del rover: bajo el agua no hay GPS. Lo que sí hay es un
sensor de presión, que da la profundidad con precisión de centímetros, y una
ecosonda apuntando hacia abajo, que da la distancia al fondo. En el real esta
clase leerá el sensor de presión por I2C y la ecosonda por serie; aquí lee el
mundo simulado a través del hardware.
"""


class Profundidad:
    def __init__(self, hardware=None):
        self.hardware = hardware

    def leer(self):
        """Profundidad (m) y distancia al fondo (m, o None si no hay eco)."""
        d = self.hardware.mundo.leer_profundidad()
        return {"profundidad": d["profundidad"], "fondo": d["fondo"]}

    def profundidad(self):
        """Metros bajo la superficie, del sensor de presión."""
        return self.leer()["profundidad"]

    def distancia_fondo(self):
        """Metros hasta el fondo, de la ecosonda. None si no hay eco."""
        return self.leer()["fondo"]
