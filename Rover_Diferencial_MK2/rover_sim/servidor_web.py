"""API HTTP del rover (Flask).

Expone el estado de los sensores y acepta consignas de control. No contiene
lógica del rover: cada endpoint se limita a llamar a un método de Rover y
devolver el resultado como JSON.
"""

import os
import time

from flask import Flask, Response, jsonify, request, send_from_directory

HOST = "0.0.0.0"
PUERTO = 5000
# Fotogramas por segundo que se envían por GET /camara.
FPS_CAMARA = 10

# Carpeta del proyecto: de aquí se sirve interfaz.html.
AQUI = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)

# El rover que sirve las peticiones. Lo fija iniciar() al arrancar.
_rover = None


def iniciar(rover, host=HOST, puerto=PUERTO):
    """Arranca el servidor HTTP. Bloquea hasta que se para."""
    global _rover
    _rover = rover
    app.run(host=host, port=puerto, threaded=True)


@app.get("/")
def get_interfaz():
    """Interfaz de control en el navegador (interfaz.html)."""
    return send_from_directory(AQUI, "interfaz.html")


@app.get("/imu")
def get_imu():
    return jsonify(_rover.imu.leer())


@app.get("/gps")
def get_gps():
    return jsonify(_rover.gps.leer())


@app.get("/bateria")
def get_bateria():
    return jsonify({"bateria": _rover.hardware.leer_bateria()})


@app.get("/camara")
def get_camara():
    """Vídeo en directo como flujo MJPEG (multipart/x-mixed-replace).

    Lo entiende cualquier navegador con un simple <img src="/camara">. Cada
    parte lleva un fotograma completo; el cliente pinta el último recibido.
    """
    if _rover.camara.obtener_frame() is None:
        return jsonify({"estado": "camara_no_disponible"}), 503
    return Response(_generar_mjpeg(), mimetype="multipart/x-mixed-replace; boundary=frame")


def _generar_mjpeg():
    """Genera las partes del flujo hasta que la cámara deje de dar fotogramas."""
    tipo = _rover.camara.tipo_mime
    while True:
        frame = _rover.camara.obtener_frame()
        if frame is None:
            return
        yield (b"--frame\r\nContent-Type: " + tipo.encode() + b"\r\n"
               + b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
               + frame + b"\r\n")
        time.sleep(1.0 / FPS_CAMARA)


@app.get("/telemetria")
def get_telemetria():
    return jsonify(_rover.obtener_telemetria())


@app.post("/control")
def post_control():
    """Recibe {"izquierda": n, "derecha": n} con n entre -100 y +100.

    Ojo: la orden caduca. Si no llega otra en WATCHDOG_TIMEOUT (0,5 s) el
    hardware para los motores, así que el mando tiene que repetirla al menos
    dos veces por segundo para mantener el rover en marcha.
    """
    datos = request.get_json(silent=True) or {}
    try:
        izquierda = float(datos["izquierda"])
        derecha = float(datos["derecha"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "se esperan los campos numericos izquierda y derecha"}), 400

    if not (-100 <= izquierda <= 100 and -100 <= derecha <= 100):
        return jsonify({"error": "los valores deben estar entre -100 y 100"}), 400

    _rover.mover(izquierda, derecha)
    # Se responde con el estado leído del hardware, con la misma forma que el
    # bloque "control" de /telemetria para que el cliente no parsee dos cosas.
    return jsonify(_rover.hardware.estado_control())
