import time

from analog_inputs import MCP3008AnalogInput


def print_table(adc):
    print()
    print("CANAL       RAW        VOLTAJE")
    print("--------------------------------")

    for channel in range(8):
        raw = adc.read_raw(channel)
        print(f"AI{channel + 1:<2}        {raw:<4}       {adc.raw_to_voltage(raw):.4f} V")

    print("--------------------------------")


if __name__ == "__main__":
    # Mismo driver y misma Vref que el runtime (ADC_VREF en analog_inputs.py).
    adc = MCP3008AnalogInput(bus=0, device=0)

    print("Test MCP3008 iniciado")
    print("Pulsa CTRL+C para salir")
    print()
    print("Comprueba conexiones:")
    print("  CHx a GND        -> RAW cerca de 0, voltaje cerca de 0.00 V")
    print(f"  CHx a Vref       -> RAW cerca de 1023, voltaje cerca de {adc.vref:.2f} V")
    print(f"  CHx a Vref / 2   -> RAW cerca de 512, voltaje cerca de {adc.vref / 2:.2f} V")
    print()

    try:
        while True:
            print_table(adc)
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        adc.close()
        print("SPI cerrado")
