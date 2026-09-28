"""Punto de entrada: monta el rover y arranca el servidor web."""

import servidor_web
from hardware import Hardware
from imu import IMU
from gps import GPS
from camara import Camara
from rover import Rover


def main():
    hardware = Hardware()
    hardware.configurar()

    imu = IMU(hardware)
    gps = GPS(hardware)
    camara = Camara(hardware)
    camara.iniciar()

    rover = Rover(hardware=hardware, imu=imu, gps=gps, camara=camara)

    print("Servidor Rover iniciado")
    print(f"http://{servidor_web.HOST}:{servidor_web.PUERTO}")
    try:
        servidor_web.iniciar(rover)
    except KeyboardInterrupt:
        pass
    finally:
        # Pase lo que pase, el rover se queda parado y el hardware liberado.
        camara.detener()
        hardware.cerrar()
        print("Rover detenido")


if __name__ == "__main__":
    main()
