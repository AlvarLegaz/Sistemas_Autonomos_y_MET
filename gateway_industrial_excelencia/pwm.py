from gpiozero import DigitalOutputDevice


PWM_LEVELS = 16  # periodo = 16 ticks de 125 us = 2 ms (500 Hz)


class PWM:
    """PWM por software: update() se llama en cada tick del scan rapido."""

    def __init__(self, gpio_pin):
        self.slot = 0
        self.duty_percent = 0.0
        self.duty_level = 0
        self.output = 0

        self.pin = DigitalOutputDevice(gpio_pin)
        self.pin.off()

    def set_duty(self, duty_percent):
        self.duty_percent = min(max(float(duty_percent), 0.0), 100.0)
        self.duty_level = round((self.duty_percent / 100) * PWM_LEVELS)

    def update(self):
        new_output = 1 if self.slot < self.duty_level else 0

        # Solo se toca el GPIO cuando cambia el estado
        if new_output != self.output:
            self.output = new_output
            if new_output:
                self.pin.on()
            else:
                self.pin.off()

        self.slot = (self.slot + 1) % PWM_LEVELS

    def close(self):
        self.pin.off()
        self.pin.close()
