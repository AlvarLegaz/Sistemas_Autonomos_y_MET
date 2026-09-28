import requests
from .base import BaseComm

class RestComm(BaseComm):

    def __init__(self, url):
        self.url = url

    def connect(self):
        print("REST conectado")

    def disconnect(self):
        pass

    def read_data(self):
        try:
            r = requests.get(f"{self.url}/state", timeout=1)
            return r.json()
        except:
            return {}

    def send_command(self, cmd: dict):
        try:
            requests.post(f"{self.url}/command", json=cmd, timeout=1)
        except:
            pass