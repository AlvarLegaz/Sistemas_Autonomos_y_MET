"""Cámara de la Raspberry Pi.

Todavía no se usa Picamera2 ni OpenCV. Las llamadas funcionan aunque no exista
cámara: iniciar() no falla y obtener_frame() devuelve None.
"""


class Camara:
    def __init__(self, hardware=None):
        self.hardware = hardware
        self.iniciada = False
        # Formato de los fotogramas que devuelve obtener_frame(). El servidor
        # lo pone en cada parte del flujo MJPEG.
        self.tipo_mime = "image/jpeg"

    def iniciar(self):
        """Arranca la captura. Sin cámara solo marca el estado."""
        # TODO(cámara real): crear Picamera2, configurar resolución y arrancar.
        self.iniciada = True
        return self.iniciada

    def obtener_frame(self):
        """Devuelve el último fotograma, o None si no hay cámara."""
        # TODO(cámara real): capture_array() y codificar a JPEG para el servidor.
        return None

    def detener(self):
        """Para la captura y libera la cámara."""
        # TODO(cámara real): stop() y close().
        self.iniciada = False
