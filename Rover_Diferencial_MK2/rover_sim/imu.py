"""IMU del gemelo digital.

Misma clase y mismos métodos que en el rover real, pero en vez de leer el bus
I2C lee el mundo simulado a través del hardware (que es quien lo tiene, igual
que en el real tendrá el bus abierto). Devuelve valores con ruido de sensor.
"""


class IMU:
    def __init__(self, hardware=None):
        self.hardware = hardware

    def leer(self):
        """Lectura completa de la IMU."""
        return self.hardware.mundo.leer_imu()

    def orientacion(self):
        """Ángulos en grados."""
        return self.leer()["orientacion"]

    def aceleracion(self):
        """Aceleración en m/s^2 por eje."""
        return self.leer()["aceleracion"]

    def giroscopio(self):
        """Velocidad angular en grados/s por eje."""
        return self.leer()["giroscopio"]
