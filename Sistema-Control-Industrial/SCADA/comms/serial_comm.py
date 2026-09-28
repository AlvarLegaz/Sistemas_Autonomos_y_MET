from .base import BaseComm

class SerialComm(BaseComm):

    def connect(self):
        print("Serial conectado")

    def disconnect(self):
        pass

    def read_data(self):
        return {}

    def send_command(self, cmd: dict):
        pass