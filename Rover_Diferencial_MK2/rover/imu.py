"""IMU conectada por I2C.

Todavía no se habla con el bus: los métodos devuelven valores simulados para
poder probar el resto del sistema desde WSL.
"""


class IMU:
    def __init__(self, hardware=None):
        # El hardware se guarda porque es quien tendrá el bus I2C abierto.
        self.hardware = hardware

    def leer(self):
        """Lectura completa de la IMU."""
        return {
            "orientacion": self.orientacion(),
            "aceleracion": self.aceleracion(),
            "giroscopio": self.giroscopio(),
        }

    def orientacion(self):
        """Ángulos en grados."""
        # TODO(I2C real): leer el sensor y fusionar para obtener los ángulos.
        return {"roll": 0.0, "pitch": 0.0, "yaw": 0.0}

    def aceleracion(self):
        """Aceleración en m/s^2 por eje."""
        # TODO(I2C real): leer el acelerómetro.
        return {"x": 0.0, "y": 0.0, "z": 0.0}

    def giroscopio(self):
        """Velocidad angular en grados/s por eje."""
        # TODO(I2C real): leer el giróscopo.
        return {"x": 0.0, "y": 0.0, "z": 0.0}
