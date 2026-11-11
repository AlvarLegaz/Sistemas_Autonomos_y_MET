"""Interfaz web del gateway por MQTT.

    python3 servidor_web.py [ip:puerto] [usuario@clave] [--puerto 8080]

Hace de puente entre el navegador y el broker: recibe pct_23/entradas y se lo
reenvia al navegador por SSE, y publica en pct_23/salidas lo que mande la
pagina. Se abre en http://<ip-de-esta-maquina>:8080/ (tambien desde el movil).
"""
import argparse
import json
import queue
import threading
import time

import paho.mqtt.client as mqtt
from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory

from control_t1 import ControlT1
from gateway_main_app import (BROKER_POR_DEFECTO, TOPIC_ENTRADAS, TOPIC_SALIDAS,
                              broker, credenciales)


PUERTO_WEB = 8080
GATEWAY_TIMEOUT_S = 1.0     # sin datos durante este tiempo -> gateway sin respuesta
CLIENT_ID = "pct_23_web"

app = Flask(__name__)
estado = {"datos": None, "recibido": 0.0, "broker": False, "rechazo": None}
suscriptores = set()
lock = threading.Lock()
client = None
control = ControlT1()     # control de T1 por cascada: corre aquí, no en el navegador (se activa desde la página)


def instantanea():
    """Lo que ve el navegador: el ultimo estado del gateway y la salud de las conexiones."""
    with lock:
        edad = time.time() - estado["recibido"] if estado["datos"] else None
        return {"broker": estado["broker"], "rechazo": estado["rechazo"],
                "gateway": edad is not None and edad < GATEWAY_TIMEOUT_S,
                "datos": estado["datos"], "control": control.estado()}


def publicar(ordenes):
    """Manda al gateway las órdenes del control (si las hay)."""
    if ordenes and client is not None:
        client.publish(TOPIC_SALIDAS, json.dumps(ordenes), qos=0)


def difundir():
    texto = json.dumps(instantanea())
    with lock:
        for cola in suscriptores:
            try:
                cola.put_nowait(texto)
            except queue.Full:
                pass    # navegador lento: se queda con el siguiente


def on_connect(c, userdata, flags, reason_code, properties):
    with lock:
        estado["broker"] = not reason_code.is_failure
        estado["rechazo"] = str(reason_code) if reason_code.is_failure else None
    if not reason_code.is_failure:
        c.subscribe(TOPIC_ENTRADAS)
    difundir()


def on_disconnect(c, userdata, flags, reason_code, properties):
    with lock:
        estado["broker"] = False
    difundir()


def on_message(c, userdata, msg):
    try:
        datos = json.loads(msg.payload.decode("utf-8"))
    except ValueError:
        return
    with lock:
        estado["datos"], estado["recibido"] = datos, time.time()
        ordenes = control.paso(datos) if isinstance(datos, dict) else {}
    publicar(ordenes)
    difundir()


@app.get("/")
def pagina():
    return send_file("interfaz.html")


@app.get("/pct23")
def sinoptico_pct23():
    return send_file("pct23.html")


@app.get("/img/<path:nombre>")
def imagen(nombre):
    """Logo y favicon del centro, compartidos con el simulador del aula."""
    return send_from_directory("simulador_pct23/img", nombre)


# Código de las gráficas del simulador que reutiliza el sinóptico (solo estos archivos).
JS_GRAFICAS = {"utilidades/modulos.js", "interfaz/dom.js", "interfaz/escala_grafica.js",
               "interfaz/grafica.js", "interfaz/grafica_activaciones.js"}


@app.get("/sim/<path:nombre>")
def js_simulador(nombre):
    if nombre not in JS_GRAFICAS:
        abort(404)
    return send_from_directory("simulador_pct23/js", nombre)


@app.get("/api/estado")
def api_estado():
    return jsonify(instantanea())


@app.get("/api/eventos")
def eventos():
    cola = queue.Queue(maxsize=20)
    with lock:
        suscriptores.add(cola)

    def flujo():
        try:
            yield f"data: {json.dumps(instantanea())}\n\n"
            while True:
                try:
                    yield f"data: {cola.get(timeout=GATEWAY_TIMEOUT_S)}\n\n"
                except queue.Empty:
                    # Sin datos: se reenvia el estado para que la pagina vea
                    # que el gateway ha dejado de responder.
                    yield f"data: {json.dumps(instantanea())}\n\n"
        finally:
            with lock:
                suscriptores.discard(cola)

    return Response(flujo(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/salidas")
def api_salidas():
    """Reenvia al gateway un JSON con solo las salidas a cambiar; el gateway valida los valores."""
    orden = request.get_json(silent=True)
    if not isinstance(orden, dict) or not orden:
        return jsonify(error="se esperaba un objeto JSON con salidas"), 400
    info = client.publish(TOPIC_SALIDAS, json.dumps(orden), qos=0)
    if info.rc != mqtt.MQTT_ERR_SUCCESS:
        return jsonify(error="broker no disponible"), 503
    return jsonify(ok=True)


@app.post("/api/control")
def api_control():
    """Ajustes del control de T1 y su activación: {"activo": bool, "consigna_t1", "t2_max", "histeresis", "velocidad_n1"}."""
    cuerpo = request.get_json(silent=True)
    if not isinstance(cuerpo, dict) or not cuerpo:
        return jsonify(error="se esperaba un objeto JSON con ajustes"), 400
    activo = cuerpo.pop("activo", None)
    if activo is not None and not isinstance(activo, bool):
        return jsonify(error="activo debe ser true o false"), 400
    if activo and not estado["broker"]:
        return jsonify(error="broker no disponible"), 503
    with lock:
        try:
            control.configurar(**cuerpo)
        except ValueError as e:
            return jsonify(error=str(e)), 400
        ordenes = {}
        if activo is True:
            control.activar()
        elif activo is False:
            ordenes = control.desactivar()
    publicar(ordenes)
    difundir()
    return jsonify(control.estado())


def main():
    global client
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("broker", nargs="?", type=broker, default=broker(BROKER_POR_DEFECTO),
                    help=f"broker MQTT como ip:puerto (por defecto {BROKER_POR_DEFECTO})")
    ap.add_argument("credenciales", nargs="?", help="usuario@clave, o solo usuario")
    ap.add_argument("--puerto", type=int, default=PUERTO_WEB, help=f"puerto web (por defecto {PUERTO_WEB})")
    args = ap.parse_args()

    usuario, clave = credenciales(args.credenciales)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=CLIENT_ID)
    if usuario:
        client.username_pw_set(usuario, clave)
    client.on_connect, client.on_disconnect, client.on_message = on_connect, on_disconnect, on_message
    client.connect_async(*args.broker, keepalive=30)
    client.loop_start()

    print(f"Interfaz web en http://0.0.0.0:{args.puerto}/  (broker {args.broker[0]}:{args.broker[1]})")
    try:
        app.run(host="0.0.0.0", port=args.puerto, threaded=True)
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    main()
