import spidev


ADC_VREF = 3.3        # tension de referencia del MCP3008 (V); unica fuente de verdad
ADC_SPEED_HZ = 1_000_000


class MCP3008AnalogInput:
    """
    Driver para MCP3008 en SPI0 de la Raspberry Pi.

        GPIO 11 / SCLK -> CLK      GPIO 9 / MISO -> DOUT
        GPIO 10 / MOSI -> DIN      GPIO 8 / CE0  -> CS/SHDN

    CH0 -> AnalogIn1 ... CH7 -> AnalogIn8
    Resolucion: 10 bits (0 - 1023)
    """

    def __init__(self, bus=0, device=0, vref=ADC_VREF, speed_hz=ADC_SPEED_HZ):
        self.bus = bus
        self.device = device
        self.vref = vref

        self.spi = spidev.SpiDev()
        self.spi.open(self.bus, self.device)
        # MCP3008 soporta hasta ~1.35 MHz a 2.7V; 1 MHz es seguro a 3.3V.
        self.spi.max_speed_hz = speed_hz
        self.spi.mode = 0

    def read_raw(self, channel):
        """
        Lee un canal del MCP3008.
        channel: 0 a 7
        devuelve: 0 a 1023
        """

        if channel < 0 or channel > 7:
            raise ValueError("El canal debe estar entre 0 y 7")

        # Start bit + single ended + canal
        adc = self.spi.xfer2([
            1,
            (8 + channel) << 4,
            0
        ])

        return ((adc[1] & 3) << 8) | adc[2]

    def raw_to_voltage(self, raw):
        return (raw * self.vref) / 1023.0

    def read_voltage(self, channel):
        return self.raw_to_voltage(self.read_raw(channel))

    def read_inputs(self):
        """
        Devuelve las 8 entradas analogicas en voltios.
        """
        return {f"AnalogIn{ch + 1}_value": self.read_voltage(ch) for ch in range(8)}

    def close(self):
        self.spi.close()
