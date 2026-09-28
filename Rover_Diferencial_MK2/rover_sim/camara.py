"""Cámara del gemelo digital.

Misma clase y mismos métodos que en el rover real. El fotograma lo dibuja el
mundo simulado desde la posición del rover; el servidor lo sirve por el mismo
flujo MJPEG que servirá la cámara de la Raspberry.
"""


class Camara:
    def __init__(self, hardware=None):
        self.hardware = hardware
        self.iniciada = False
        # El mundo codifica en PNG (librería estándar); la cámara real dará JPEG.
        self.tipo_mime = "image/png"

    def iniciar(self):
        """Arranca la captura."""
        self.iniciada = True
        return self.iniciada

    def obtener_frame(self):
        """Devuelve el último fotograma codificado, o None si está parada."""
        if not self.iniciada:
            return None
        return self.hardware.mundo.fotograma()

    def detener(self):
        """Para la captura."""
        self.iniciada = False
