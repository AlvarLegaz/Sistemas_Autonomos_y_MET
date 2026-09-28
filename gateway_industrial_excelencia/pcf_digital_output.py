from smbus2 import SMBus


class PCFDigitalOutput:
    """
    Driver simple para 8 salidas digitales usando PCF8574 / PCF8574A.

    Cada bit representa una salida:
        bit 0 -> DigitalOut1
        bit 1 -> DigitalOut2
        ...
        bit 7 -> DigitalOut8
    """

    def __init__(self, i2c_bus=1, address=0x39, active_high=True):
        self.i2c_bus = i2c_bus
        self.address = address
        self.active_high = active_high

        self.bus = SMBus(self.i2c_bus)
        self.state = 0x00

        self.write_byte(self.state)

    def write_byte(self, value):
        value = value & 0xFF
        
        

        output_value = (~value) & 0xFF

        self.bus.write_byte(self.address, output_value)

    def write_outputs(
        self,
        DigitalOut1_value,
        DigitalOut2_value,
        DigitalOut3_value,
        DigitalOut4_value,
        DigitalOut5_value,
        DigitalOut6_value,
        DigitalOut7_value,
        DigitalOut8_value,
    ):
        value = 0x00

        if DigitalOut1_value:
            value |= 1 << 0

        if DigitalOut2_value:
            value |= 1 << 1

        if DigitalOut3_value:
            value |= 1 << 2

        if DigitalOut4_value:
            value |= 1 << 3

        if DigitalOut5_value:
            value |= 1 << 4

        if DigitalOut6_value:
            value |= 1 << 5

        if DigitalOut7_value:
            value |= 1 << 6

        if DigitalOut8_value:
            value |= 1 << 7

        self.state = value
        self.write_byte(self.state)

    def write_channel(self, channel, value):
        """
        channel: 1..8
        value: True/False
        """
        channel = int(channel)

        if channel < 1 or channel > 8:
            raise ValueError("El canal debe estar entre 1 y 8")

        bit = channel - 1

        if value:
            self.state |= 1 << bit
        else:
            self.state &= ~(1 << bit)

        self.write_byte(self.state)

    def close(self):
        self.write_byte(0x00)
        self.bus.close()
