"""Interfaz web del gateway por MQTT.

    python3 servidor_web.py [ip:puerto] [usuario@clave] [--puerto 8080] [--instancia real-01] [--protocolo nuevo|antiguo]

Por defecto el broker es 127.0.0.1:1883 (misma Raspberry Pi). Variables de entorno equivalentes: PCT23_BROKER, PCT23_INSTANCIA, PCT23_MQTT_USUARIO y
MQTT_PASSWORD. Para pasar a un broker remoto basta cambiar la dirección.

Hace de puente entre el navegador y el broker. Dos protocolos (una SOLA vía de órdenes: se elige con --protocolo, nunca los dos a la vez):
  - nuevo (por defecto): contrato MQTT PCT23 v2.4. Suscribe pct23/<instancia>/{sensors,actuators,status,alarms,cmd/+/ack}, publica el latido
    scada/heartbeat cada 2 s y manda cmd/<tag> con id y hora de la planta (scada_pct23.py). Traduce todo al formato antiguo para el navegador.
  - antiguo: pct_23/entradas y pct_23/salidas, como antes (para la transición con el gateway antiguo).
Se abre en http://<ip-de-esta-maquina>:8080/ (tambien desde el movil).
"""
import argparse
import json
import os
import queue
import threading
import time

import paho.mqtt.client as mqtt
from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory

from control_t1 import SALIDA_RES, ControlT1
from modulo_control import ModuloControl
from modulo_tiempo import RelojSincronizado
from senales import a_crudo
from gateway_main_app import TOPIC_ENTRADAS, TOPIC_SALIDAS, broker, credenciales
from scada_pct23 import GATEWAY_TIMEOUT_S as GATEWAY_TIMEOUT_NUEVO_S
from scada_pct23 import ClienteScada


PUERTO_WEB = 8080
GATEWAY_TIMEOUT_ANTIGUO_S = 1.0   # protocolo antiguo: entradas llegaba cada 0,1 s
GATEWAY_TIMEOUT_S = GATEWAY_TIMEOUT_NUEVO_S   # protocolo nuevo: sensors llega cada 1 s, sin datos durante este tiempo -> planta sin respuesta
CLIENT_ID = "pct_23_web"
# Gateway, broker y este servidor van hoy en la misma Raspberry Pi (127.0.0.1); mañana el broker y el SCADA estarán en otra máquina: nada fijo en el código.
# Cada dato se puede dar por línea de comandos o por variable de entorno (la línea de comandos manda).
BROKER_POR_DEFECTO = os.environ.get("PCT23_BROKER", "127.0.0.1:1883")          # PCT23_BROKER=ip:puerto
INSTANCIA_POR_DEFECTO = os.environ.get("PCT23_INSTANCIA", "real-01")            # PCT23_INSTANCIA=id de la planta
SERVIDOR_HORA_POR_DEFECTO = os.environ.get("PCT23_SERVIDOR_HORA", "127.0.0.1:123")        # servidor de tiempo (modulo_tiempo.py): la misma hora que usa la planta
USUARIO_POR_DEFECTO = os.environ.get("PCT23_MQTT_USUARIO")                      # PCT23_MQTT_USUARIO=usuario (la clave: MQTT_PASSWORD, o usuario@clave)
PERIODO_LATIDO_TICK_S = 0.5       # cada cuánto se llama a scada.tick() (el latido sale cada 2 s)

app = Flask(__name__)
estado = {"datos": None, "recibido": 0.0, "broker": False, "rechazo": None}
suscriptores = set()
lock = threading.Lock()
client = None
protocolo = "nuevo"       # "nuevo" (contrato v2.4) o "antiguo" (pct_23/*); lo fija main() con --protocolo
scada = None              # ClienteScada (solo en el protocolo nuevo)
control = ControlT1()     # control de temperatura: corre aquí (en el SCADA), no en el navegador ni en la placa. Protocolo nuevo: ModuloControl (todo o nada sobre T2 o T1);
                          # protocolo antiguo: el ControlT1 de siempre (main() lo cambia según --protocolo)

# La orden de calentar caduca en el gateway (15 s): mientras la resistencia deba estar encendida, este servidor la repite.
REFRESCO_CALEFACTOR_S = 5.0
ESPERA_ORDEN_S = 3.0        # tras una orden, margen antes de fiarse de que el gateway aun la muestra apagada
res_deseado = False         # la resistencia deberia estar encendida (orden de la pagina o del control)
ultima_orden_res = 0.0
emergencia_pedida = False   # paro de emergencia pedido: se repite hasta que el gateway lo confirme


def _timeout_s():
    return GATEWAY_TIMEOUT_S if protocolo == "nuevo" else GATEWAY_TIMEOUT_ANTIGUO_S


def instantanea():
    """Lo que ve el navegador: el ultimo estado del gateway y la salud de las conexiones."""
    with lock:
        if protocolo == "nuevo" and scada is not None:
            gateway = estado["datos"] is not None and scada.gateway_vivo()
            extra = {"hora_planta": scada.hora_planta() is not None,
                     "ordenes_rechazadas": [{k: r[k] for k in ("tag", "estado", "reason")} for r in scada.rechazos_recientes()]}
        else:
            edad = time.time() - estado["recibido"] if estado["datos"] else None
            gateway, extra = edad is not None and edad < GATEWAY_TIMEOUT_ANTIGUO_S, {}
        return {"broker": estado["broker"], "rechazo": estado["rechazo"], "gateway": gateway,
                "datos": estado["datos"], "control": control.estado(), "emergencia_pedida": emergencia_pedida, **extra}


def _verdadero(valor):
    return valor is True or valor in (1, "1", "true", "on", "True")


def registrar_orden(orden):
    """Recuerda si la resistencia debe estar encendida, para ir renovando la orden. Llamar con el lock cogido."""
    global res_deseado, ultima_orden_res
    orden = a_crudo(orden) if isinstance(orden, dict) else orden       # tambien vale {"RES": true}
    if isinstance(orden, dict) and SALIDA_RES in orden:
        res_deseado, ultima_orden_res = _verdadero(orden[SALIDA_RES]), time.time()


def sincronizar_con_gateway(datos):
    """Si el gateway dice que la resistencia esta apagada (fallo, termostato, paro o caducidad), se deja de insistir. Lock cogido."""
    global res_deseado, emergencia_pedida
    if not isinstance(datos, dict):
        return
    if res_deseado and datos.get(SALIDA_RES) is False and time.time() - ultima_orden_res > ESPERA_ORDEN_S:
        res_deseado = False
    if datos.get("paro_emergencia") is True:
        res_deseado = False
        if emergencia_pedida:
            emergencia_pedida = False          # el gateway ya esta en paro: no hace falta repetir


def _enviar_antiguo(ordenes, qos=0):
    info = client.publish(TOPIC_SALIDAS, json.dumps(ordenes), qos=qos)
    return info.rc == mqtt.MQTT_ERR_SUCCESS


def publicar(ordenes, qos=0):
    """Manda al gateway las órdenes del control (formato antiguo; en el protocolo nuevo se traducen a cmd/*)."""
    if not ordenes or client is None:
        return
    if protocolo == "nuevo":
        resumen = scada.ordenes_antiguas(ordenes)
        if resumen["enviada"] or not _verdadero(ordenes.get(SALIDA_RES)):    # una orden de ENCENDER que no salió (sin hora de la planta, sin broker) no se anota
            with lock:
                registrar_orden(ordenes)
        return
    with lock:
        registrar_orden(ordenes)
    client.publish(TOPIC_SALIDAS, json.dumps(ordenes), qos=qos)


def publicar_contrato(ordenes):
    """Protocolo nuevo: manda las órdenes (tag, valor) del módulo de control como cmd/*. El módulo ya las repite cada 5 s, así que no se anotan en
    `res_deseado` (el refresco de la resistencia es solo para las órdenes manuales de la página)."""
    if not ordenes or scada is None:
        return
    for tag, valor in ordenes:
        scada.enviar_orden(tag, valor)


def _ajustes_de_control(cuerpo):
    """La página manda `consigna`, `variable` y `potencia_pct`; el ControlT1 del protocolo antiguo solo conoce `consigna_t1`."""
    if isinstance(control, ModuloControl):
        return cuerpo
    antiguo = {k: v for k, v in cuerpo.items() if k not in ("variable", "potencia_pct", "consigna_t2", "modo", "kp", "ki", "t2_base")}
    if "consigna" in antiguo:
        antiguo["consigna_t1"] = antiguo.pop("consigna")
    return antiguo


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
        if protocolo == "nuevo":
            scada.conectar()
            c.subscribe(scada.suscripciones())
        else:
            c.subscribe(TOPIC_ENTRADAS)
    difundir()


def on_disconnect(c, userdata, flags, reason_code, properties):
    with lock:
        estado["broker"] = False
    if protocolo == "nuevo" and scada is not None:
        scada.desconectar()
    difundir()


def _on_message_nuevo(msg):
    evento = scada.on_message(msg.topic, msg.payload)
    if evento is None:
        return
    datos = scada.estado_antiguo()
    with lock:
        estado["datos"] = datos
        if evento == "sensors":
            estado["recibido"] = time.time()
        ordenes = control.paso(scada.lectura_control()) if evento == "sensors" else []     # el módulo de control corre a 1 Hz con cada sensors
        sincronizar_con_gateway(datos)
    publicar_contrato(ordenes)
    difundir()


def on_message(c, userdata, msg):
    if protocolo == "nuevo":
        return _on_message_nuevo(msg)
    try:
        datos = json.loads(msg.payload.decode("utf-8"))
    except ValueError:
        return
    with lock:
        estado["datos"], estado["recibido"] = datos, time.time()
        ordenes = control.paso(datos) if isinstance(datos, dict) else {}
        sincronizar_con_gateway(datos)
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
                    yield f"data: {cola.get(timeout=_timeout_s())}\n\n"
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
    """Reenvia al gateway un JSON con solo las salidas a cambiar (formato antiguo; en el protocolo nuevo se traduce a cmd/*); el gateway valida los valores."""
    orden = request.get_json(silent=True)
    if not isinstance(orden, dict) or not orden:
        return jsonify(error="se esperaba un objeto JSON con salidas"), 400
    if protocolo == "nuevo":
        if client is None or scada is None or not estado["broker"]:
            return jsonify(error="broker no disponible"), 503
        resumen = scada.ordenes_antiguas(orden)
        if resumen["sin_hora"]:
            return jsonify(error="aún no se conoce la hora de la planta: espera al primer mensaje de sensores"), 503
        if resumen["sin_conexion"]:
            return jsonify(error="broker no disponible"), 503
        if not resumen["enviada"]:
            return jsonify(error="ninguna salida válida", ignoradas=resumen["ignoradas"], invalidas=resumen["invalidas"]), 400
        with lock:
            registrar_orden(orden)
        return jsonify(ok=True, ordenes=resumen["enviadas"], ignoradas=resumen["ignoradas"], invalidas=resumen["invalidas"])
    info = client.publish(TOPIC_SALIDAS, json.dumps(orden), qos=0)
    if info.rc != mqtt.MQTT_ERR_SUCCESS:
        return jsonify(error="broker no disponible"), 503
    with lock:
        registrar_orden(orden)
    return jsonify(ok=True)


@app.post("/api/control")
def api_control():
    """Ajustes del control y su activación: {"activo": bool, "variable": "T2"|"T1", "consigna", "t2_max", "histeresis", "velocidad_n1", "potencia_pct"}."""
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
            control.configurar(**_ajustes_de_control(cuerpo))
        except ValueError as e:
            return jsonify(error=str(e)), 400
        ordenes = []
        if activo is True:
            control.activar()
        elif activo is False:
            ordenes = control.desactivar()
    if isinstance(ordenes, list):
        publicar_contrato(ordenes)
    else:
        publicar(ordenes)
    difundir()
    return jsonify(control.estado())


@app.post("/api/emergencia")
def api_emergencia():
    """Paro de emergencia: {"activo": true} apaga todo en el gateway y desactiva el control; {"activo": false} lo rearma.
    Protocolo nuevo: cmd/emergency_stop (value true) y cmd/reset_safe_state."""
    global res_deseado, emergencia_pedida
    cuerpo = request.get_json(silent=True)
    if not isinstance(cuerpo, dict) or not isinstance(cuerpo.get("activo"), bool):
        return jsonify(error="se esperaba {\"activo\": true|false}"), 400
    activo = cuerpo["activo"]
    with lock:
        if activo:
            emergencia_pedida, res_deseado = True, False    # se sigue pidiendo hasta que el gateway lo confirme
            control.desactivar()
        else:
            emergencia_pedida = False
    enviado = False
    if client is not None:
        if protocolo == "nuevo":
            enviado = scada is not None and scada.paro_emergencia(activo)["enviada"]
        else:
            enviado = _enviar_antiguo({"paro_emergencia": activo}, qos=1)
    if not activo and not enviado:
        return jsonify(error="broker no disponible" if protocolo == "antiguo" else "no se pudo enviar el rearme (sin broker o sin hora de la planta)"), 503
    difundir()
    return jsonify(activo=activo, enviado=enviado)


def _calentar_debe_parar():
    """Protocolo nuevo: ¿hay que dejar de renovar la orden de calentar? Sí si se pierde la planta, está en estado seguro o salta la alarma overtemp."""
    if scada is None or not scada.gateway_vivo():
        return True
    return bool(scada.status.get("safe_state")) or "overtemp" in scada.alarmas or scada.sensors.get("stat_overtemp") is True


def refrescar_ordenes():
    """Una pasada del refresco: repite el paro pendiente y renueva la orden de calentar (para que no caduque). También desactiva el módulo de control
    si se pierde la planta: sin `sensors` no hay pasos del módulo que lo detecten."""
    if protocolo == "nuevo" and scada is not None and isinstance(control, ModuloControl):
        with lock:
            perdida = control.activo and _calentar_debe_parar()
            ordenes = control.desactivar() if perdida else []
        publicar_contrato(ordenes)
    if client is None or not estado["broker"]:
        return
    global res_deseado
    with lock:
        paro, calentar = emergencia_pedida, res_deseado
    if protocolo == "nuevo":
        if paro:
            scada.paro_emergencia(True)                  # id nuevo en cada repetición: un id repetido se rechazaría como duplicate
        elif calentar:
            if _calentar_debe_parar():                   # no se insiste a ciegas: se apaga, se desactiva el control y se avisa a la planta
                with lock:
                    res_deseado = False
                    control.desactivar()
                scada.enviar_orden("heater_pct", 0)
            else:
                scada.ordenes_antiguas({SALIDA_RES: True})
        return
    if paro:
        client.publish(TOPIC_SALIDAS, json.dumps({"paro_emergencia": True}), qos=1)
    elif calentar:
        client.publish(TOPIC_SALIDAS, json.dumps({SALIDA_RES: True}), qos=0)


def bucle_refresco():
    while True:
        time.sleep(REFRESCO_CALEFACTOR_S)
        try:
            refrescar_ordenes()
        except Exception as e:     # un fallo aqui no debe tumbar el servidor
            print(f"Error en el refresco de ordenes: {e}")


def bucle_latido():
    """Protocolo nuevo: el latido del SCADA (cada 2 s) y la gestión de los ack. Sin latido la tarjeta pasa a estado seguro a los 10 s."""
    while True:
        time.sleep(PERIODO_LATIDO_TICK_S)
        try:
            scada.tick()
        except Exception as e:
            print(f"Error en el latido: {e}")


def _publicar_mqtt(topic, payload, qos, retain):
    client.publish(topic, json.dumps(payload), qos=qos, retain=retain)


def main():
    global client, protocolo, scada, control
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("broker", nargs="?", type=broker, default=broker(BROKER_POR_DEFECTO),
                    help=f"broker MQTT como ip:puerto (por defecto {BROKER_POR_DEFECTO}; variable PCT23_BROKER)")
    ap.add_argument("credenciales", nargs="?", default=USUARIO_POR_DEFECTO, help="usuario@clave, o solo usuario (por defecto PCT23_MQTT_USUARIO)")
    ap.add_argument("--puerto", type=int, default=PUERTO_WEB, help=f"puerto web (por defecto {PUERTO_WEB})")
    ap.add_argument("--instancia", default=INSTANCIA_POR_DEFECTO, help=f"id de la planta (por defecto {INSTANCIA_POR_DEFECTO}; variable PCT23_INSTANCIA)")
    ap.add_argument("--servidor-hora", default=SERVIDOR_HORA_POR_DEFECTO, help=f"servidor de tiempo ip:puerto (por defecto {SERVIDOR_HORA_POR_DEFECTO}; variable PCT23_SERVIDOR_HORA)")
    ap.add_argument("--sin-servidor-hora", action="store_true", help="no usar servidor de tiempo: la hora de la planta se estima con los sensors")
    ap.add_argument("--periodo-hora", type=float, default=60.0, help="cada cuántos segundos se pide la hora al servidor de tiempo (por defecto 60)")
    ap.add_argument("--protocolo", choices=("nuevo", "antiguo"), default="nuevo",
                    help="nuevo = contrato v2.4 (por defecto); antiguo = pct_23/entradas y pct_23/salidas")
    args = ap.parse_args()

    usuario, clave = credenciales(args.credenciales)
    protocolo = args.protocolo
    control = ModuloControl() if protocolo == "nuevo" else ControlT1()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=CLIENT_ID)
    if protocolo == "nuevo":
        reloj_hora = None
        if not args.sin_servidor_hora:
            host_hora, puerto_hora = broker(args.servidor_hora if ":" in args.servidor_hora else f"{args.servidor_hora}:123")
            reloj_hora = RelojSincronizado(host_hora, puerto_hora, periodo_s=args.periodo_hora)
            ok = reloj_hora.arrancar(periodo_s=args.periodo_hora, bloquear_hasta=2.0)      # SIEMPRE al arrancar y luego cada periodo; si no hay servidor se estima con los sensors
            print(f"Hora del servidor de tiempo {args.servidor_hora}: " + ("sincronizada" if ok else "sin sincronizar (se estima con los sensors y se sigue intentando)"))
        scada = ClienteScada(args.instancia, _publicar_mqtt, client_id="pct23-scada-web", reloj_hora=reloj_hora)
    if usuario:
        client.username_pw_set(usuario, clave)
    client.on_connect, client.on_disconnect, client.on_message = on_connect, on_disconnect, on_message
    client.connect_async(*args.broker, keepalive=30)
    client.loop_start()
    threading.Thread(target=bucle_refresco, name="refresco_ordenes", daemon=True).start()
    if protocolo == "nuevo":
        threading.Thread(target=bucle_latido, name="latido_scada", daemon=True).start()

    print(f"Interfaz web en http://0.0.0.0:{args.puerto}/  (broker {args.broker[0]}:{args.broker[1]}, protocolo {protocolo}"
          + (f", instancia {args.instancia})" if protocolo == "nuevo" else ")"))
    try:
        app.run(host="0.0.0.0", port=args.puerto, threaded=True)
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == "__main__":
    main()
