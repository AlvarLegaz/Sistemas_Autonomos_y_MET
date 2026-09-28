import time
import json
import spidev


class MCP3008AnalogInput:
    """
    Test completo para MCP3008.

    Raspberry Pi SPI0:
        GPIO 11 / SCLK  -> MCP3008 CLK
        GPIO 10 / MOSI  -> MCP3008 DIN
        GPIO 9  / MISO  -> MCP3008 DOUT
        GPIO 8  / CE0   -> MCP3008 CS/SHDN

    MCP3008:
        CH0 -> AnalogIn1
        CH1 -> AnalogIn2
        CH2 -> AnalogIn3
        CH3 -> AnalogIn4
        CH4 -> AnalogIn5
        CH5 -> AnalogIn6
        CH6 -> AnalogIn7
        CH7 -> AnalogIn8
    """

    def __init__(self, bus=0, device=0, vref=3.3, speed_hz=1000000):
        self.bus = bus
        self.device = device
        self.vref = vref
        self.speed_hz = speed_hz

        self.spi = spidev.SpiDev()
        self.spi.open(self.bus, self.device)
        self.spi.max_speed_hz = self.speed_hz
        self.spi.mode = 0

    def read_raw(self, channel):
        if channel < 0 or channel > 7:
            raise ValueError("El canal debe estar entre 0 y 7")

        # MCP3008 single-ended:
        # byte 1: start bit
        # byte 2: single-ended + canal
        # byte 3: dummy para recibir datos
        response = self.spi.xfer2([
            0x01,
            (0x08 + channel) << 4,
            0x00
        ])

        raw = ((response[1] & 0x03) << 8) | response[2]
        return raw

    def raw_to_voltage(self, raw):
        return (raw * self.vref) / 1023.0

    def read_voltage(self, channel):
        raw = self.read_raw(channel)
        voltage = self.raw_to_voltage(raw)
        return raw, voltage

    def read_all(self):
        data = {}

        for channel in range(8):
            raw, voltage = self.read_voltage(channel)
            index = channel + 1

            data[f"AnalogIn{index}_raw"] = raw
            data[f"AnalogIn{index}_value"] = voltage

        return data

    def close(self):
        self.spi.close()

def print_table(data):
    print()
    print("CANAL       RAW        VOLTAJE")
    print("--------------------------------")

    for i in range(1, 9):
        raw = data[f"AnalogIn{i}_raw"]
        voltage = data[f"AnalogIn{i}_value"]

        print(f"AI{i:<2}        {raw:<4}       {voltage:.4f} V")

    print("--------------------------------")


def print_json(data):
    json_data = {}

    for i in range(1, 9):
        json_data[f"AnalogIn{i}_value"] = round(data[f"AnalogIn{i}_value"], 4)

    print(json.dumps(json_data, indent=2))


if __name__ == "__main__":
    adc = MCP3008AnalogInput(
        bus=0,
        device=0,
        vref=3.1,
        speed_hz=1000
    )

    print("Test MCP3008 iniciado")
    print("Pulsa CTRL+C para salir")
    print()
    print("Comprueba conexiones:")
    print("  CHx a GND    -> RAW cerca de 0, voltaje cerca de 0.00 V")
    print("  CHx a 3.3 V  -> RAW cerca de 1023, voltaje cerca de 3.30 V")
    print("  CHx a 1.65 V -> RAW cerca de 512, voltaje cerca de 1.65 V")
    print()
   
    try:
        while True:

            values = adc.read_all()
            print_table(values)
            time.sleep(1)

    finally:
        adc.close()
        print("SPI cerrado")


