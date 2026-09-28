"""Cámara de la Raspberry Pi.

Busca primero una cámara CSI (Raspberry Pi Camera Module) con Picamera2 y, si
no la hay, una webcam USB con OpenCV. La captura corre en segundo plano y
obtener_frame() devuelve siempre el último fotograma ya codificado en JPEG.
Si no hay ninguna cámara, iniciar() no falla y obtener_frame() devuelve None
(el servidor responde "camara_no_disponible" y la interfaz lo muestra).

Picamera2 se instala con apt (python3-picamera2), no con pip: si el rover se
ejecuta en un entorno virtual, este tiene que crearse con
--system-site-packages para poder verla.
"""

import io
import threading
import time

# 4:3, como el visor de la interfaz. Más resolución solo cuesta CPU y red.
RESOLUCION = (640, 480)
FPS = 15
CALIDAD_JPEG = 80
# Tiempo que se espera al primer fotograma tras arrancar.
ESPERA_PRIMER_FRAME = 3.0
# Si la cámara deja de dar fotogramas más de este tiempo, se da por perdida.
FRAME_CADUCADO = 2.0


# Hereda de io.BufferedIOBase porque la propia cámara es la salida del
# codificador de Picamera2, y su FileOutput solo acepta objetos de ese tipo
# ("Must pass io.BufferedIOBase").
class Camara(io.BufferedIOBase):
    def __init__(self, hardware=None):
        super().__init__()
        self.hardware = hardware
        self.iniciada = False
        # Formato de los fotogramas que devuelve obtener_frame(). El servidor
        # lo pone en cada parte del flujo MJPEG.
        self.tipo_mime = "image/jpeg"
        # "csi" o "usb" según la cámara encontrada.
        self.origen = None

        self._frame = None
        self._t_frame = 0.0
        self._nuevo = threading.Condition()
        self._picam = None
        self._usb = None
        self._hilo = None
        self._fin = threading.Event()

    def iniciar(self):
        """Arranca la captura con la primera cámara que encuentre."""
        if self.iniciada:
            return True
        if self._iniciar_csi() or self._iniciar_usb():
            self.iniciada = True
            print(f"Cámara {self.origen} iniciada ({RESOLUCION[0]}x{RESOLUCION[1]}, {FPS} fps)")
        else:
            print("Cámara: no se ha encontrado ninguna cámara (ni CSI ni USB)")
        return self.iniciada

    def obtener_frame(self):
        """Devuelve el último fotograma JPEG, o None si no hay cámara."""
        if not self.iniciada:
            return None
        with self._nuevo:
            if self._frame is None:
                self._nuevo.wait(ESPERA_PRIMER_FRAME)
            if self._frame is None or time.monotonic() - self._t_frame > FRAME_CADUCADO:
                return None
            return self._frame

    def detener(self):
        """Para la captura y libera la cámara."""
        self._fin.set()
        if self._picam is not None:
            try:
                self._picam.stop_recording()
                self._picam.close()
            except Exception as e:
                print(f"Cámara: error al cerrar Picamera2: {e}")
            self._picam = None
        if self._hilo is not None:
            self._hilo.join(timeout=2.0)
            self._hilo = None
        if self._usb is not None:
            self._usb.release()
            self._usb = None
        self.iniciada = False

    # ------------------------------------------------------------------
    # Fotogramas nuevos (llegan desde otro hilo)
    # ------------------------------------------------------------------
    def write(self, jpeg):
        """Guarda un fotograma JPEG. Picamera2 lo llama por cada fotograma
        codificado (esta clase hace de 'fichero' de salida del codificador)."""
        with self._nuevo:
            self._frame = bytes(jpeg)
            self._t_frame = time.monotonic()
            self._nuevo.notify_all()
        return len(self._frame)

    def writable(self):
        return True

    def flush(self):
        """FileOutput de Picamera2 llama a flush() tras cada write()."""

    # ------------------------------------------------------------------
    # Cámara CSI (Raspberry Pi Camera Module)
    # ------------------------------------------------------------------
    def _iniciar_csi(self):
        try:
            from picamera2 import Picamera2
            from picamera2.encoders import JpegEncoder, MJPEGEncoder
            from picamera2.outputs import FileOutput
        except ImportError:
            print("Cámara CSI: picamera2 no está instalado "
                  "(sudo apt install python3-picamera2)")
            return False

        try:
            picam = Picamera2()
            picam.configure(picam.create_video_configuration(
                main={"size": RESOLUCION}, controls={"FrameRate": FPS}))
            try:
                # Codificador por hardware de la Pi 4: casi no gasta CPU.
                picam.start_recording(MJPEGEncoder(), FileOutput(self))
            except Exception:
                # Pi 5 y otros modelos sin codificador MJPEG por hardware
                picam.start_recording(JpegEncoder(q=CALIDAD_JPEG), FileOutput(self))
        except Exception as e:
            print(f"Cámara CSI no disponible: {e}")
            return False

        self._picam = picam
        self.origen = "csi"
        return True

    # ------------------------------------------------------------------
    # Webcam USB
    # ------------------------------------------------------------------
    def _iniciar_usb(self):
        try:
            import cv2
        except ImportError:
            print("Cámara USB: OpenCV no está instalado (sudo apt install python3-opencv)")
            return False

        usb = cv2.VideoCapture(0)
        if not usb.isOpened():
            print("Cámara USB: no hay ninguna webcam conectada")
            return False
        usb.set(cv2.CAP_PROP_FRAME_WIDTH, RESOLUCION[0])
        usb.set(cv2.CAP_PROP_FRAME_HEIGHT, RESOLUCION[1])
        usb.set(cv2.CAP_PROP_FPS, FPS)

        self._usb = usb
        self.origen = "usb"
        self._fin.clear()
        self._hilo = threading.Thread(target=self._capturar_usb, args=(cv2,), daemon=True)
        self._hilo.start()
        return True

    def _capturar_usb(self, cv2):
        parametros = [int(cv2.IMWRITE_JPEG_QUALITY), CALIDAD_JPEG]
        while not self._fin.is_set():
            ok, imagen = self._usb.read()
            if not ok:
                time.sleep(0.1)
                continue
            ok, jpeg = cv2.imencode(".jpg", imagen, parametros)
            if ok:
                self.write(jpeg.tobytes())
