import json
import time
import signal
import threading

import paho.mqtt.client as mqtt

from runtime import Runtime


MQTT_BROKER_HOST = "192.168.99.53"
MQTT_BROKER_PORT = 1883

TOPIC_SALIDAS = "pct_23/salidas"
TOPIC_ENTRADAS = "pct_23/entradas"

PUBLISH_INTERVAL_S = 0.1


class MQTTApp:
    def __init__(self):
        self.running = False
        self.stop_event = threading.Event()

        self.runtime = Runtime()

        self.client = mqtt.Client(client_id="pct_23_mqtt_app")
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message

    # ============================================================
    # MQTT callbacks
    # ============================================================

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            print("MQTT conectado")
            client.subscribe(TOPIC_SALIDAS)
            print(f"Subscrito a {TOPIC_SALIDAS}")
        else:
            print(f"Error conectando a MQTT. rc={rc}")

    def on_message(self, client, userdata, msg):
        """
        Recibe comandos de salidas desde MQTT.

        Topic:
            pct_23/salidas

        Payload esperado, ejemplo:
            {
                "DigitalOut1_value": true,
                "DigitalOut2_value": false,
                ...
                "PWMOut1_value": 50,
                ...
                "AnalogOut1_value": 1.5,
                ...
            }
        """

        try:
            payload = msg.payload.decode("utf-8")
            data = json.loads(payload)

            print(f"MQTT recibido en {msg.topic}: {data}")

            self.update_outputs_from_mqtt(data)

        except Exception as e:
            print(f"Error procesando mensaje MQTT: {e}")

    # ============================================================
    # Aplicar salidas recibidas por MQTT al Runtime
    # ============================================================

    def update_outputs_from_mqtt(self, data):
        """
        Actualiza las salidas del Runtime a partir del JSON recibido por MQTT.
        """

        self.runtime.writeDigitalOutput(
            data.get("DigitalOut1_value", self.runtime.DigitalOut1_value),
            data.get("DigitalOut2_value", self.runtime.DigitalOut2_value),
            data.get("DigitalOut3_value", self.runtime.DigitalOut3_value),
            data.get("DigitalOut4_value", self.runtime.DigitalOut4_value),
            data.get("DigitalOut5_value", self.runtime.DigitalOut5_value),
            data.get("DigitalOut6_value", self.runtime.DigitalOut6_value),
            data.get("DigitalOut7_value", self.runtime.DigitalOut7_value),
            data.get("DigitalOut8_value", self.runtime.DigitalOut8_value),
        )


        self.runtime.writeAnalogOutput(
            data.get("AnalogOut1_value", self.runtime.AnalogOut1_value),
            data.get("AnalogOut2_value", self.runtime.AnalogOut2_value),
            data.get("AnalogOut3_value", self.runtime.AnalogOut3_value),
            data.get("AnalogOut4_value", self.runtime.AnalogOut4_value),
            data.get("AnalogOut5_value", self.runtime.AnalogOut5_value),
            data.get("AnalogOut6_value", self.runtime.AnalogOut6_value),
            data.get("AnalogOut7_value", self.runtime.AnalogOut7_value),
            data.get("AnalogOut8_value", self.runtime.AnalogOut8_value),
        )

    # ============================================================
    # Publicar entradas leídas desde Runtime
    # ============================================================

    def build_inputs_payload(self):
        payload = {}

        payload.update(self.runtime.readAnalogInput())
        payload.update(self.runtime.readDigitalInput())
        payload.update(self.runtime.readCurrentInput())
        payload.update(self.runtime.readRTDInput())

        payload["timestamp"] = time.time()
        payload["running"] = self.runtime.running

        return payload

    def publish_inputs(self):
        payload = self.build_inputs_payload()

        self.client.publish(
            TOPIC_ENTRADAS,
            json.dumps(payload),
            qos=0,
            retain=False,
        )

    # ============================================================
    # Ciclo principal app MQTT
    # ============================================================

    def start(self):
        if self.running:
            return

        print("Arrancando Runtime...")
        self.runtime.start()

        print("Conectando MQTT...")
        self.client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, 60)
        self.client.loop_start()

        self.running = True

        print("MQTTApp arrancada")

        while not self.stop_event.is_set():
            self.publish_inputs()
            time.sleep(PUBLISH_INTERVAL_S)

    def stop(self):
        if not self.running:
            return

        print("Parando MQTTApp...")

        self.stop_event.set()

        self.client.loop_stop()
        self.client.disconnect()

        self.runtime.stop()

        self.running = False
        print("MQTTApp parada")


app = MQTTApp()


def handle_signal(sig, frame):
    app.stop()


signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)


if __name__ == "__main__":
    try:
        app.start()
    finally:
        app.stop()