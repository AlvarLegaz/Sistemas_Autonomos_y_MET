from PySide6.QtCore import QObject, Signal, Slot
import time

class CommWorker(QObject):

    data_ready = Signal(dict)

    def __init__(self, comm):
        super().__init__()
        self.comm = comm
        self.running = True

    @Slot()
    def run(self):
        while self.running:
            data = self.comm.read_data()

            if data:
                self.data_ready.emit(data)

            time.sleep(0.5)  # frecuencia

    def stop(self):
        self.running = False