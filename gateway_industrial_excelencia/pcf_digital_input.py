from smbus2 import SMBus


class PCFDigitalInput:
    """
    Driver simple para 8 entradas digitales usando PCF8574 / PCF8574A.

    Cada bit representa una entrada:
        bit 0 -> DigitalIn1
        bit 1 -> DigitalIn2
        ...
        bit 7 -> DigitalIn8

    En PCF8574, para usar un pin como entrada, normalmente se escribe un 1
    para dejarlo en estado alto débil y luego se lee el pin.
    """

    def __init__(self, i2c_bus=1, address=0x38, active_high=True):
        self.i2c_bus = i2c_bus
        self.address = address
        self.active_high = active_high

        self.bus = SMBus(self.i2c_bus)

        # Deja todos los pines en alto para poder leerlos como entradas
        self.bus.write_byte(self.address, 0xFF)

        self.state = 0xFF

    def read_byte(self):
        value = self.bus.read_byte(self.address) & 0xFF
        self.state = value
        return value

    def read_inputs(self):
        value = self.read_byte()

        if not self.active_high:
            value = (~value) & 0xFF

        return {
            "DigitalIn1_value": bool(value & (1 << 0)),
            "DigitalIn2_value": bool(value & (1 << 1)),
            "DigitalIn3_value": bool(value & (1 << 2)),
            "DigitalIn4_value": bool(value & (1 << 3)),
            "DigitalIn5_value": bool(value & (1 << 4)),
            "DigitalIn6_value": bool(value & (1 << 5)),
            "DigitalIn7_value": bool(value & (1 << 6)),
            "DigitalIn8_value": bool(value & (1 << 7)),
        }

    def close(self):
        self.bus.close()
