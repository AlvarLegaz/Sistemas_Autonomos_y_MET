import json
import paho.mqtt.client as mqtt
from .base import BaseComm

class MQTTComm(BaseComm):

    def __init__(self, broker):
        self.client = mqtt.Client()
        self.data = {}

        self.client.on_message = self.on_message
        self.client.connect(broker)

    def connect(self):
        self.client.subscribe("planta/state")
        self.client.loop_start()

    def on_message(self, client, userdata, msg):
        self.data = json.loads(msg.payload.decode())

    def read_data(self):
        return self.data

    def send_command(self, cmd: dict):
        self.client.publish("planta/cmd", json.dumps(cmd))

    def disconnect(self):
        self.client.loop_stop()