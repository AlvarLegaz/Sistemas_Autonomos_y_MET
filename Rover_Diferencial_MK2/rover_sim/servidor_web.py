"""API HTTP del rover (Flask), más el WebSocket de control (flask-sock).

Expone el estado de los sensores y acepta consignas de control. No contiene
lógica del rover: cada endpoint se limita a llamar a un método de Rover y
devolver el resultado como JSON.
"""

import json
import os
import time

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_sock import Sock

HOST = "0.0.0.0"
PUERTO = 5000
# Fotogramas por segundo que se envían por GET /camara.
FPS_CAMARA = 10

# Carpeta del proyecto: de aquí se sirve interfaz.html.
AQUI = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
sock = Sock(app)

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
    error = _aplicar_consigna(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400
    # Se responde con el estado leído del hardware, con la misma forma que el
    # bloque "control" de /telemetria para que el cliente no parsee dos cosas.
    return jsonify(_rover.hardware.estado_control())


@sock.route("/control_ws")
def control_ws(ws):
    """Lo mismo que POST /control, pero por un WebSocket abierto todo el rato.

    Es la vía de la interfaz: un navegador no puede mandar UDP, y así no se
    abre una petición por orden ni se solapan varias por la WiFi (llegaban en
    ráfagas y desordenadas). Cada mensaje es un JSON {"izquierda", "derecha"};
    no se responde a los buenos, y a los malos con {"error": ...}. La orden
    caduca igual que por HTTP.
    """
    try:
        while True:
            try:
                datos = json.loads(ws.receive())
            except (TypeError, ValueError):
                datos = {}
            error = _aplicar_consigna(datos if isinstance(datos, dict) else {})
            if error:
                ws.send(json.dumps({"error": error}))
    finally:
        # Si se cae la conexión, se para ya en vez de esperar al vigilante.
        _rover.mover(0, 0)


def _aplicar_consigna(datos):
    """Valida {"izquierda": n, "derecha": n} y se lo pasa al rover.

    Devuelve None si se aplicó, o el texto del error si no.
    """
    try:
        izquierda = float(datos["izquierda"])
        derecha = float(datos["derecha"])
    except (KeyError, TypeError, ValueError):
        return "se esperan los campos numericos izquierda y derecha"
    if not (-100 <= izquierda <= 100 and -100 <= derecha <= 100):
        return "los valores deben estar entre -100 y 100"
    _rover.mover(izquierda, derecha)
    return None
