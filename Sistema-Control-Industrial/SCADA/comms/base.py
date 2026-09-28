from abc import ABC, abstractmethod

class BaseComm(ABC):

    @abstractmethod
    def connect(self):
        pass

    @abstractmethod
    def disconnect(self):
        pass

    @abstractmethod
    def read_data(self):
        pass

    @abstractmethod
    def send_command(self, cmd: dict):
        pass