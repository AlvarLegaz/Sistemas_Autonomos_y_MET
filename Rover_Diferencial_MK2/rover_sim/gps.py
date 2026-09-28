"""GPS del gemelo digital.

Misma clase y mismos métodos que en el rover real. En vez de parsear NMEA del
puerto serie lee la posición del mundo simulado a través del hardware, con el
comportamiento de un receptor real: 1 lectura por segundo, error de metros y
unos segundos sin fix al arrancar.
"""


class GPS:
    def __init__(self, hardware=None):
        self.hardware = hardware

    def leer(self):
        """Última posición conocida. fix=False mientras el receptor no la tenga."""
        d = self.hardware.mundo.leer_gps()
        return {"lat": d["lat"], "lon": d["lon"], "alt": d["alt"], "fix": d["fix"]}

    def posicion(self):
        """Latitud, longitud y altitud."""
        d = self.leer()
        return {"lat": d["lat"], "lon": d["lon"], "alt": d["alt"]}

    def velocidad(self):
        """Velocidad sobre el suelo en m/s."""
        return self.hardware.mundo.leer_gps()["velocidad"]

    def rumbo(self):
        """Rumbo sobre el suelo en grados (0 = norte). Parado conserva el último."""
        return self.hardware.mundo.leer_gps()["rumbo"]
