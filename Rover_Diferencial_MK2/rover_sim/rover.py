"""El rover completo: coordina hardware, IMU, GPS y cámara.

Es la única clase que los demás módulos necesitan conocer. El servidor web y,
más adelante, el servidor UDP hablan con el rover, nunca con el hardware ni con
los sensores directamente.
"""

from hardware import Hardware
from imu import IMU
from gps import GPS
from camara import Camara


class Rover:
    def __init__(self, hardware=None, imu=None, gps=None, camara=None):
        # Se puede inyectar cada componente (útil para probar) o dejar que el
        # rover los cree. Los sensores reciben el hardware porque de él saldrán
        # el bus I2C y el puerto serie cuando se implementen.
        self.hardware = hardware or Hardware()
        self.imu = imu or IMU(self.hardware)
        self.gps = gps or GPS(self.hardware)
        self.camara = camara or Camara(self.hardware)
        # La consigna vigente NO se guarda aquí: la tiene el hardware, que es
        # quien la puede cambiar solo cuando salta el vigilante de órdenes. Una
        # copia en el rover quedaría desfasada y la telemetría mentiría.

    # ---- movimiento ----

    def mover(self, izquierda, derecha):
        """Aplica una consigna a cada lado y devuelve la realmente aplicada.

        El recorte a -100..+100 lo hace el hardware, así que se devuelve lo que
        él ha aplicado y no una copia de la petición. Cada llamada rearma el
        vigilante: si no llega otra en WATCHDOG_TIMEOUT, los motores se paran.
        """
        return self.hardware.set_motores(izquierda, derecha)

    def avanzar(self, velocidad):
        return self.mover(velocidad, velocidad)

    def retroceder(self, velocidad):
        return self.mover(-velocidad, -velocidad)

    def girar_izquierda(self, velocidad):
        """Giro sobre el sitio: un lado avanza y el otro retrocede."""
        return self.mover(-velocidad, velocidad)

    def girar_derecha(self, velocidad):
        return self.mover(velocidad, -velocidad)

    def parar(self):
        return self.mover(0, 0)

    # ---- navegación: pendiente ----

    def girar_grados(self, grados):
        """Gira los grados indicados usando el yaw de la IMU."""
        # TODO(navegación): control en lazo cerrado sobre imu.orientacion().
        pass

    def ir_a(self, latitud, longitud):
        """Va hasta una coordenada."""
        # TODO(navegación): rumbo objetivo desde gps.posicion() y seguimiento.
        pass

    # ---- estado ----

    def obtener_telemetria(self):
        """Todo el estado disponible del rover en un solo diccionario."""
        return {
            "gps": self.gps.leer(),
            "imu": self.imu.leer(),
            "bateria": self.hardware.leer_bateria(),
            "control": self.hardware.estado_control(),
        }
