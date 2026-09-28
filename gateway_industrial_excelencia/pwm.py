from gpiozero import DigitalOutputDevice


PWM_LEVELS = 16  # 4 bits reales: 0..16

PWM_GPIO_PIN = 17 # GPIO BCM 17, pin físico 11 PWM generado en una patilla


class PWM:
    def __init__(self, gpio_pin=17):
        self.slot = 0
        self.duty_percent = 50
        self.duty_level = 8
        self.output = 0

        # GPIO físico de prueba
        self.pin = DigitalOutputDevice(gpio_pin)
        self.pin.off()

    def set_duty(self, duty_percent):
        duty_percent = float(duty_percent)

        if duty_percent < 0:
            duty_percent = 0

        if duty_percent > 100:
            duty_percent = 100

        self.duty_percent = duty_percent

        # Conversión 0..100% -> 0..16
        self.duty_level = round((duty_percent / 100) * PWM_LEVELS)

        print(
            f"Nuevo duty PWM: {self.duty_percent:.1f}% "
            f"(nivel {self.duty_level}/{PWM_LEVELS})"
        )

    def write_output(self, value):
        """
        Activa/desactiva la patilla física.
        """
        if value == 1:
            self.pin.on()
        else:
            self.pin.off()

    def update(self):
        """
        Se llama cada 125 us desde el runtime.
        """

        if self.slot < self.duty_level:
            new_output = 1
        else:
            new_output = 0

        # Solo cambiamos GPIO si cambia el estado
        if new_output != self.output:
            self.output = new_output
            self.write_output(self.output)

        self.slot += 1

        if self.slot >= PWM_LEVELS:
            self.slot = 0

    def close(self):
        self.pin.off()
        self.pin.close()