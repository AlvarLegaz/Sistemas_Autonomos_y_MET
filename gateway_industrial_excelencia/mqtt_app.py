import json
import signal
import threading
import time

import paho.mqtt.client as mqtt

from runtime import Runtime


MQTT_BROKER_HOST = "192.168.99.53"
MQTT_BROKER_PORT = 1883
MQTT_CLIENT_ID = "pct_23_mqtt_app"

TOPIC_SALIDAS = "pct_23/salidas"
TOPIC_ENTRADAS = "pct_23/entradas"

PUBLISH_INTERVAL_S = 0.1


class MQTTApp:
    def __init__(self):
        self.stop_event = threading.Event()
        self.runtime = Runtime()

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=MQTT_CLIENT_ID)
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
            print(f"Conectando MQTT a {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}...")
            self.client.connect_async(MQTT_BROKER_HOST, MQTT_BROKER_PORT, keepalive=60)
            self.client.loop_start()
            print("MQTTApp arrancada")

            while not self.stop_event.wait(PUBLISH_INTERVAL_S):
                if self.client.is_connected():
                    self.publish_inputs()
        finally:
            print("Parando MQTTApp...")
            self.client.disconnect()
            self.client.loop_stop()
            self.runtime.stop()
            print("MQTTApp parada")

    def stop(self):
        self.stop_event.set()


if __name__ == "__main__":
    app = MQTTApp()
    signal.signal(signal.SIGINT, lambda sig, frame: app.stop())
    signal.signal(signal.SIGTERM, lambda sig, frame: app.stop())
    app.run()
