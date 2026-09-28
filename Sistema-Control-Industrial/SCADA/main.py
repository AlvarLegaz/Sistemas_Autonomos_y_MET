import sys
from PySide6.QtWidgets import QApplication
from ui.scada_window import SCADA


def main():
    app = QApplication(sys.argv)

    # Aquí podrías cargar config, logs, etc.
    window = SCADA()
    #window.showFullScreen() Pantalla completa

    window.setFixedSize(1024, 600) # version para 10 pulgadas
    window.show()                  # version para 10 pulgadas

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())