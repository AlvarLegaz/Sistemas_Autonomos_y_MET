"""API HTTP del submarino (Flask).

Expone el estado de los sensores y acepta consignas de control. No contiene
lógica del submarino: cada endpoint se limita a llamar a un método de
Submarino y devolver el resultado como JSON.
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

# El submarino que sirve las peticiones. Lo fija iniciar() al arrancar.
_submarino = None


def iniciar(submarino, host=HOST, puerto=PUERTO):
    """Arranca el servidor HTTP. Bloquea hasta que se para."""
    global _submarino
    _submarino = submarino
    app.run(host=host, port=puerto, threaded=True)


@app.get("/")
def get_interfaz():
    """Interfaz de control en el navegador (interfaz.html)."""
    return send_from_directory(AQUI, "interfaz.html")


@app.get("/three.min.js")
def get_threejs():
    """Copia local de Three.js para el visor 3D del simulador (pedido
    2026-09-27: "que el entorno sea muchísimo más real, tipo videojuego").

    Va vendida en el propio proyecto, no en un CDN: interfaz.html la pide a
    este mismo servidor como cualquier otro recurso (igual que /camara o
    /telemetria), así que sigue funcionando sin internet en el campo.
    """
    return send_from_directory(AQUI, "three.min.js")


@app.get("/imu")
def get_imu():
    return jsonify(_submarino.imu.leer())


@app.get("/profundidad")
def get_profundidad():
    return jsonify(_submarino.profundidad.leer())


@app.get("/bateria")
def get_bateria():
    return jsonify({"bateria": _submarino.hardware.leer_bateria()})


@app.get("/camara")
def get_camara():
    """Vídeo en directo como flujo MJPEG (multipart/x-mixed-replace).

    Lo entiende cualquier navegador con un simple <img src="/camara">. Cada
    parte lleva un fotograma completo; el cliente pinta el último recibido.
    """
    if _submarino.camara.obtener_frame() is None:
        return jsonify({"estado": "camara_no_disponible"}), 503
    return Response(_generar_mjpeg(), mimetype="multipart/x-mixed-replace; boundary=frame")


def _generar_mjpeg():
    """Genera las partes del flujo hasta que la cámara deje de dar fotogramas."""
    tipo = _submarino.camara.tipo_mime
    while True:
        frame = _submarino.camara.obtener_frame()
        if frame is None:
            return
        yield (b"--frame\r\nContent-Type: " + tipo.encode() + b"\r\n"
               + b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
               + frame + b"\r\n")
        time.sleep(1.0 / FPS_CAMARA)


def _mundo():
    """El mundo simulado, o None en el submarino real (no hay entrenamiento)."""
    return getattr(_submarino.hardware, "mundo", None)


@app.get("/telemetria")
def get_telemetria():
    datos = _submarino.obtener_telemetria()
    mundo = _mundo()
    if mundo is not None:
        # Solo en el simulador: corriente, aros de entrenamiento y vista.
        datos["mundo"] = mundo.entrenamiento()
    return jsonify(datos)


@app.post("/control")
def post_control():
    """Recibe {"izquierda": n, "derecha": n, "vertical": n} con n entre -100 y +100.

    izquierda y derecha van a los propulsores horizontales. vertical es la
    velocidad vertical deseada (positiva = subir): mueve la profundidad
    objetivo y el PID de a bordo la mantiene. Con vertical = 0 el submarino
    se queda a la profundidad que esté.

    Ojo: la orden caduca. Si no llega otra en WATCHDOG_TIMEOUT (0,5 s) el
    hardware para los cuatro motores y el submarino sube solo, así que el
    mando tiene que repetirla al menos dos veces por segundo, también cuando
    todo es 0, para que mantenga la profundidad.
    """
    datos = request.get_json(silent=True) or {}
    try:
        izquierda = float(datos["izquierda"])
        derecha = float(datos["derecha"])
        vertical = float(datos["vertical"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "se esperan los campos numericos izquierda, derecha y vertical"}), 400

    if not all(-100 <= v <= 100 for v in (izquierda, derecha, vertical)):
        return jsonify({"error": "los valores deben estar entre -100 y 100"}), 400

    # Se responde con el estado de control, con la misma forma que el bloque
    # "control" de /telemetria para que el cliente no parsee dos cosas.
    return jsonify(_submarino.mover(izquierda, derecha, vertical))


@app.post("/pid")
def post_pid():
    """Recibe {"activo": true|false} y activa o desactiva los PID de a bordo.

    Desactivados, "vertical" de /control va directo a los dos propulsores
    verticales (positivo = subir) y el submarino no mantiene profundidad: con
    vertical = 0 sube solo. El vigilante sigue actuando igual.
    """
    datos = request.get_json(silent=True) or {}
    activo = datos.get("activo")
    if not isinstance(activo, bool):
        return jsonify({"error": "se espera el campo activo con true o false"}), 400
    return jsonify(_submarino.fijar_pid(activo))


@app.post("/mundo")
def post_mundo():
    """Ajustes de entrenamiento, solo en el simulador (404 en el submarino real).

    Acepta, juntos o por separado:
      {"corriente": "ninguno" | "poco" | "mucho"}   velocidad del agua
      {"reiniciar_aros": true}                       vuelve a contar los aros
      {"vista": "primera" | "tercera"}               cámara de a bordo o de seguimiento
    Devuelve el bloque "mundo" de /telemetria.
    """
    mundo = _mundo()
    if mundo is None:
        return jsonify({"error": "no hay mundo simulado"}), 404
    datos = request.get_json(silent=True) or {}
    try:
        if "corriente" in datos:
            mundo.fijar_corriente(datos["corriente"])
        if datos.get("reiniciar_aros"):
            mundo.reiniciar_aros()
        if "vista" in datos:
            mundo.fijar_vista(datos["vista"])
    except (ValueError, TypeError) as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(mundo.entrenamiento())
