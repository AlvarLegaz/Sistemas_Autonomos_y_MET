"""GPS conectado por UART / puerto serie.

Todavía no se lee el puerto ni se parsea NMEA: los métodos devuelven valores
simulados para poder probar el resto del sistema sin hardware.
"""


class GPS:
    def __init__(self, hardware=None):
        # El hardware se guarda porque es quien tendrá el puerto serie abierto.
        self.hardware = hardware

    def leer(self):
        """Última posición conocida. fix=False mientras no haya GPS real."""
        # TODO(serie real): leer tramas NMEA del puerto y parsear GGA/RMC.
        return {"lat": 0.0, "lon": 0.0, "alt": 0.0, "fix": False}

    def posicion(self):
        """Latitud, longitud y altitud."""
        d = self.leer()
        return {"lat": d["lat"], "lon": d["lon"], "alt": d["alt"]}

    def velocidad(self):
        """Velocidad sobre el suelo en m/s."""
        # TODO(serie real): campo de velocidad de la trama RMC.
        return 0.0

    def rumbo(self):
        """Rumbo sobre el suelo en grados (0 = norte)."""
        # TODO(serie real): campo de rumbo de la trama RMC.
        return 0.0
