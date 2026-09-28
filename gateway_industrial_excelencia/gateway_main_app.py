"""Gateway de E/S: runtime de la placa + pasarela MQTT.

    python3 gateway_main_app.py [ip:puerto] [usuario@clave]

Con solo "usuario" la contraseña se toma de la variable de entorno
MQTT_PASSWORD o se pide por teclado (asi no queda en el historial).
"""
import argparse
import getpass
import json
import os
import signal
import threading
import time

import paho.mqtt.client as mqtt

from runtime import Runtime


BROKER_POR_DEFECTO = "192.168.99.53:1883"
MQTT_CLIENT_ID = "pct_23_gateway"

TOPIC_SALIDAS = "pct_23/salidas"
TOPIC_ENTRADAS = "pct_23/entradas"

PUBLISH_INTERVAL_S = 0.1


def broker(texto):
    host, sep, puerto = texto.rpartition(":")
    if not sep:
        host, puerto = texto, "1883"
    if "@" in texto:
        raise argparse.ArgumentTypeError("el broker va primero: ip:puerto usuario@clave")
    if not host or not puerto.isdigit() or not 0 < int(puerto) < 65536:
        raise argparse.ArgumentTypeError(f"se esperaba ip:puerto, no {texto!r}")
    return host, int(puerto)


def credenciales(texto):
    """'usuario@clave' -> (usuario, clave). Se parte en la PRIMERA @: la clave puede llevar @."""
    if not texto:
        return None, None
    usuario, sep, clave = texto.partition("@")
    if not sep:
        clave = os.environ.get("MQTT_PASSWORD")
        if clave is None:
            clave = getpass.getpass(f"Contraseña MQTT de {usuario}: ")
    return usuario, clave


class Gateway:
    def __init__(self, host, puerto, usuario=None, clave=None):
        self.host, self.puerto = host, puerto
        self.stop_event = threading.Event()
        self.runtime = Runtime()

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=MQTT_CLIENT_ID)
        if usuario:
            self.client.username_pw_set(usuario, clave)
        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message

    # ============================================================
    # MQTT callbacks
    # ============================================================

    def on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            print(f"Error conectando a MQTT: {reason_code}")
            return
        print("MQTT conectado")
        client.subscribe(TOPIC_SALIDAS)
        print(f"Subscrito a {TOPIC_SALIDAS}")

    def on_disconnect(self, client, userdata, flags, reason_code, properties):
        if not self.stop_event.is_set():
            print(f"MQTT desconectado ({reason_code}); reintentando...")

    def on_message(self, client, userdata, msg):
        """
        Recibe comandos de salidas en pct_23/salidas. Solo se aplican las
        claves presentes; el resto de salidas conserva su valor. Ejemplo:
            {"DigitalOut1_value": true, "PWMOut1_value": 50, "AnalogOut1_value": 1.5}
        """
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("se esperaba un objeto JSON")
            ignoradas = self.runtime.update_outputs(data)
        except (ValueError, TypeError) as e:
            print(f"Mensaje MQTT descartado en {msg.topic}: {e}")
            return

        print(f"MQTT recibido en {msg.topic}: {data}")
        if ignoradas:
            print(f"  claves desconocidas ignoradas: {', '.join(ignoradas)}")

    # ============================================================
    # Publicar entradas leídas desde Runtime
    # ============================================================

    def build_inputs_payload(self):
        payload = {}
        payload.update(self.runtime.readAnalogInput())
        payload.update(self.runtime.readDigitalInput())
        payload.update(self.runtime.readOutputs())
        payload.update(self.runtime.diagnostico())
        payload["timestamp"] = time.time()
        return payload

    def publish_inputs(self):
        self.client.publish(TOPIC_ENTRADAS, json.dumps(self.build_inputs_payload()), qos=0, retain=False)

    # ============================================================
    # Ciclo principal app MQTT
    # ============================================================

    def run(self):
        self.runtime.start()
        try:
            # Conexion en segundo plano: si el broker no esta, el bucle de red
            # reintenta solo y el runtime sigue funcionando.
            print(f"Conectando MQTT a {self.host}:{self.puerto}...")
            self.client.connect_async(self.host, self.puerto, keepalive=60)
            self.client.loop_start()
            print("Gateway arrancado")

            while not self.stop_event.wait(PUBLISH_INTERVAL_S):
                if self.client.is_connected():
                    self.publish_inputs()
        finally:
            print("Parando gateway...")
            self.client.disconnect()
            self.client.loop_stop()
            self.runtime.stop()
            print("Gateway parado")

    def stop(self):
        self.stop_event.set()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("broker", nargs="?", type=broker, default=broker(BROKER_POR_DEFECTO),
                    help=f"broker MQTT como ip:puerto (por defecto {BROKER_POR_DEFECTO})")
    ap.add_argument("credenciales", nargs="?", help="usuario@clave, o solo usuario (sin autenticacion si se omite)")
    args = ap.parse_args()

    usuario, clave = credenciales(args.credenciales)
    app = Gateway(*args.broker, usuario=usuario, clave=clave)
    signal.signal(signal.SIGINT, lambda sig, frame: app.stop())
    signal.signal(signal.SIGTERM, lambda sig, frame: app.stop())
    app.run()


if __name__ == "__main__":
    main()
