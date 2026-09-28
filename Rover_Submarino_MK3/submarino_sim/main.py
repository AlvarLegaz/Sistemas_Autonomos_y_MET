"""Punto de entrada: monta el submarino y arranca el servidor web."""

import servidor_web
from hardware import Hardware
from imu import IMU
from profundidad import Profundidad
from camara import Camara
from submarino import Submarino


def main():
    hardware = Hardware()
    hardware.configurar()

    imu = IMU(hardware)
    profundidad = Profundidad(hardware)
    camara = Camara(hardware)
    camara.iniciar()

    submarino = Submarino(hardware=hardware, imu=imu, profundidad=profundidad, camara=camara)
    submarino.iniciar()

    print("Servidor Submarino iniciado")
    print(f"http://{servidor_web.HOST}:{servidor_web.PUERTO}")
    try:
        servidor_web.iniciar(submarino)
    except KeyboardInterrupt:
        pass
    finally:
        # Pase lo que pase, el submarino se queda parado y el hardware liberado.
        submarino.detener()
        camara.detener()
        hardware.cerrar()
        print("Submarino detenido")


if __name__ == "__main__":
    main()
