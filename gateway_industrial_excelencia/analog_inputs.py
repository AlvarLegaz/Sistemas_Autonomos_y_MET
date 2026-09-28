import spidev


class MCP3008AnalogInput:
    """
    Driver para MCP3008.

    CH0 -> AnalogIn1
    CH1 -> AnalogIn2
    ...
    CH7 -> AnalogIn8

    Resolucion: 10 bits
    Valor ADC: 0 - 1023
    Referencia: normalmente 3.3V
    """

    def __init__(self, bus=0, device=0, vref=3.3):
        self.bus = bus
        self.device = device
        self.vref = vref

        self.spi = spidev.SpiDev()
        self.spi.open(self.bus, self.device)

        # MCP3008 soporta hasta ~1.35 MHz a 2.7V.
        # A 3.3V puedes usar mas, pero 1 MHz es seguro.
        self.spi.max_speed_hz = 1000000
        self.spi.mode = 0

    def read_raw(self, channel):
        """
        Lee un canal del MCP3008.
        channel: 0 a 7
        devuelve: 0 a 1023
        """

        if channel < 0 or channel > 7:
            raise ValueError("El canal debe estar entre 0 y 7")

        # Protocolo MCP3008:
        # Start bit + single ended + canal
        adc = self.spi.xfer2([
            1,
            (8 + channel) << 4,
            0
        ])

        value = ((adc[1] & 3) << 8) | adc[2]

        return value

    def read_voltage(self, channel):
        raw = self.read_raw(channel)
        voltage = (raw * self.vref) / 1023.0
        return voltage

    def read_inputs(self):
        """
        Devuelve las 8 entradas analogicas en voltios.
        """

        return {
            "AnalogIn1_value": self.read_voltage(0),
            "AnalogIn2_value": self.read_voltage(1),
            "AnalogIn3_value": self.read_voltage(2),
            "AnalogIn4_value": self.read_voltage(3),
            "AnalogIn5_value": self.read_voltage(4),
            "AnalogIn6_value": self.read_voltage(5),
            "AnalogIn7_value": self.read_voltage(6),
            "AnalogIn8_value": self.read_voltage(7),
        }

    def close(self):
        self.spi.close()
