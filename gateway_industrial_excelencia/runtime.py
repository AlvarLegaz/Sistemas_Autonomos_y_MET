import time
import threading

from pwm import PWM
from pcf_digital_output import PCFDigitalOutput
from pcf_digital_input import PCFDigitalInput
from analog_inputs import MCP3008AnalogInput


TICK_US = 125
SLOW_SCAN_MS = 100
NUM_CHANNELS = 8


class Runtime:
    def __init__(self):
        self.running = False
        self.stop_event = threading.Event()
        self.thread = None
        self.lock = threading.Lock()

        self.pwm = PWM()
        self.digital_output_driver = PCFDigitalOutput( i2c_bus=1, address=0x39, active_high=True)
        self.digital_input_driver =  PCFDigitalInput(i2c_bus=1, address=0x38, active_high=True)
        self.analog_input_driver = MCP3008AnalogInput(bus=0, device=0, vref=3.3)

        # =========================
        # Entradas analógicas
        # =========================
        self.AnalogIn1_value = 0.0
        self.AnalogIn2_value = 0.0
        self.AnalogIn3_value = 0.0
        self.AnalogIn4_value = 0.0
        self.AnalogIn5_value = 0.0
        self.AnalogIn6_value = 0.0
        self.AnalogIn7_value = 0.0
        self.AnalogIn8_value = 0.0

        # =========================
        # Entradas digitales
        # =========================
        self.DigitalIn1_value = False
        self.DigitalIn2_value = False
        self.DigitalIn3_value = False
        self.DigitalIn4_value = False
        self.DigitalIn5_value = False
        self.DigitalIn6_value = False
        self.DigitalIn7_value = False
        self.DigitalIn8_value = False

        # =========================
        # Entradas de corriente
        # =========================
        self.CurrentIn1_value = 0.0
        self.CurrentIn2_value = 0.0
        self.CurrentIn3_value = 0.0
        self.CurrentIn4_value = 0.0
        self.CurrentIn5_value = 0.0
        self.CurrentIn6_value = 0.0
        self.CurrentIn7_value = 0.0
        self.CurrentIn8_value = 0.0

        # =========================
        # Entradas RTD
        # =========================
        self.RTDIn1_value = 0.0
        self.RTDIn2_value = 0.0
        self.RTDIn3_value = 0.0
        self.RTDIn4_value = 0.0
        self.RTDIn5_value = 0.0
        self.RTDIn6_value = 0.0
        self.RTDIn7_value = 0.0
        self.RTDIn8_value = 0.0

        # =========================
        # Salidas analógicas
        # =========================
        self.AnalogOut1_value = 0.0
        self.AnalogOut2_value = 0.0
        self.AnalogOut3_value = 0.0
        self.AnalogOut4_value = 0.0
        self.AnalogOut5_value = 0.0
        self.AnalogOut6_value = 0.0
        self.AnalogOut7_value = 0.0
        self.AnalogOut8_value = 0.0

        # =========================
        # Salidas PWM
        # =========================
        self.PWMOut1_value = 0.0
        self.PWMOut2_value = 0.0
        self.PWMOut3_value = 0.0
        self.PWMOut4_value = 0.0
        self.PWMOut5_value = 0.0
        self.PWMOut6_value = 0.0
        self.PWMOut7_value = 0.0
        self.PWMOut8_value = 0.0

        # =========================
        # Salidas digitales
        # =========================
        self.DigitalOut1_value = False
        self.DigitalOut2_value = False
        self.DigitalOut3_value = False
        self.DigitalOut4_value = False
        self.DigitalOut5_value = False
        self.DigitalOut6_value = False
        self.DigitalOut7_value = False
        self.DigitalOut8_value = False

    # ============================================================
    # Control del runtime
    # ============================================================

    def start(self):
        if self.running:
            print("Ya está arrancado")
            return

        print("Arrancando...")
        self.running = True
        self.stop_event.clear()

        self.thread = threading.Thread(target=self.run)
        self.thread.start()

    def stop(self):
        if not self.running:
            print("Ya está parado")
            return

        print("Parando...")
        self.stop_event.set()
        self.thread.join()

        self.pwm.close()

        self.running = False
        print("Parado")

    # ============================================================
    # API pública de lectura
    # ============================================================

    def readAnalogInput(self):
        with self.lock:
            return {
                "AnalogIn1_value": self.AnalogIn1_value,
                "AnalogIn2_value": self.AnalogIn2_value,
                "AnalogIn3_value": self.AnalogIn3_value,
                "AnalogIn4_value": self.AnalogIn4_value,
                "AnalogIn5_value": self.AnalogIn5_value,
                "AnalogIn6_value": self.AnalogIn6_value,
                "AnalogIn7_value": self.AnalogIn7_value,
                "AnalogIn8_value": self.AnalogIn8_value,
            }

    def readDigitalInput(self):
        with self.lock:
            return {
                "DigitalIn1_value": self.DigitalIn1_value,
                "DigitalIn2_value": self.DigitalIn2_value,
                "DigitalIn3_value": self.DigitalIn3_value,
                "DigitalIn4_value": self.DigitalIn4_value,
                "DigitalIn5_value": self.DigitalIn5_value,
                "DigitalIn6_value": self.DigitalIn6_value,
                "DigitalIn7_value": self.DigitalIn7_value,
                "DigitalIn8_value": self.DigitalIn8_value,
            }

    def readCurrentInput(self):
        with self.lock:
            return {
                "CurrentIn1_value": self.CurrentIn1_value,
                "CurrentIn2_value": self.CurrentIn2_value,
                "CurrentIn3_value": self.CurrentIn3_value,
                "CurrentIn4_value": self.CurrentIn4_value,
                "CurrentIn5_value": self.CurrentIn5_value,
                "CurrentIn6_value": self.CurrentIn6_value,
                "CurrentIn7_value": self.CurrentIn7_value,
                "CurrentIn8_value": self.CurrentIn8_value,
            }

    def readRTDInput(self):
        with self.lock:
            return {
                "RTDIn1_value": self.RTDIn1_value,
                "RTDIn2_value": self.RTDIn2_value,
                "RTDIn3_value": self.RTDIn3_value,
                "RTDIn4_value": self.RTDIn4_value,
                "RTDIn5_value": self.RTDIn5_value,
                "RTDIn6_value": self.RTDIn6_value,
                "RTDIn7_value": self.RTDIn7_value,
                "RTDIn8_value": self.RTDIn8_value,
            }

    # ============================================================
    # API pública de escritura
    # ============================================================

    def writeAnalogOutput(
        self,
        AnalogOut1_value,
        AnalogOut2_value,
        AnalogOut3_value,
        AnalogOut4_value,
        AnalogOut5_value,
        AnalogOut6_value,
        AnalogOut7_value,
        AnalogOut8_value,
    ):
        with self.lock:
            self.AnalogOut1_value = float(AnalogOut1_value)
            self.AnalogOut2_value = float(AnalogOut2_value)
            self.AnalogOut3_value = float(AnalogOut3_value)
            self.AnalogOut4_value = float(AnalogOut4_value)
            self.AnalogOut5_value = float(AnalogOut5_value)
            self.AnalogOut6_value = float(AnalogOut6_value)
            self.AnalogOut7_value = float(AnalogOut7_value)
            self.AnalogOut8_value = float(AnalogOut8_value)

    def writePWMOutput(
        self,
        PWMOut1_value,
        PWMOut2_value,
        PWMOut3_value,
        PWMOut4_value,
        PWMOut5_value,
        PWMOut6_value,
        PWMOut7_value,
        PWMOut8_value,
    ):
        with self.lock:
            self.PWMOut1_value = self._clamp_pwm(PWMOut1_value)
            self.PWMOut2_value = self._clamp_pwm(PWMOut2_value)
            self.PWMOut3_value = self._clamp_pwm(PWMOut3_value)
            self.PWMOut4_value = self._clamp_pwm(PWMOut4_value)
            self.PWMOut5_value = self._clamp_pwm(PWMOut5_value)
            self.PWMOut6_value = self._clamp_pwm(PWMOut6_value)
            self.PWMOut7_value = self._clamp_pwm(PWMOut7_value)
            self.PWMOut8_value = self._clamp_pwm(PWMOut8_value)

    def writeDigitalOutput(
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
        with self.lock:
            self.DigitalOut1_value = bool(DigitalOut1_value)
            self.DigitalOut2_value = bool(DigitalOut2_value)
            self.DigitalOut3_value = bool(DigitalOut3_value)
            self.DigitalOut4_value = bool(DigitalOut4_value)
            self.DigitalOut5_value = bool(DigitalOut5_value)
            self.DigitalOut6_value = bool(DigitalOut6_value)
            self.DigitalOut7_value = bool(DigitalOut7_value)
            self.DigitalOut8_value = bool(DigitalOut8_value)

    # ============================================================
    # Métodos auxiliares
    # ============================================================

    def _clamp_pwm(self, value):
        value = float(value)

        if value < 0:
            return 0.0

        if value > 100:
            return 100.0

        return value

    def set_pwm(self, duty):
        """
        Compatibilidad con el código anterior.
        Modifica solo PWMOut1.
        """
        with self.lock:
            self.PWMOut1_value = self._clamp_pwm(duty)

    # ============================================================
    # Scans internos
    # ============================================================

    def scan_rapido(self):
        """
        Tareas rápidas ejecutadas cada 125 us.

        Aquí se aplican salidas rápidas, por ejemplo PWM.
        De momento el PWM físico actual usa solo PWMOut1_value.
        """

        with self.lock:
            pwm_out_1 = self.PWMOut1_value

        #self.pwm.set_duty(pwm_out_1)
        #self.pwm.update()

    def slow_scan(self):
        """
        Tareas lentas ejecutadas cada 100 ms.

        Aquí se pueden actualizar entradas analógicas, digitales,
        corriente, RTD, salidas analógicas, diagnósticos, etc.
        """

        # Cargar entradas digitales en variables internas
        with self.lock:
            digital_out_1 = self.DigitalOut1_value
            digital_out_2 = self.DigitalOut2_value
            digital_out_3 = self.DigitalOut3_value
            digital_out_4 = self.DigitalOut4_value
            digital_out_5 = self.DigitalOut5_value
            digital_out_6 = self.DigitalOut6_value
            digital_out_7 = self.DigitalOut7_value
            digital_out_8 = self.DigitalOut8_value
            
        # Escribir salidas digitales
        self.digital_output_driver.write_outputs(
            digital_out_1,
            digital_out_2,
            digital_out_3,
            digital_out_4,
            digital_out_5,
            digital_out_6,
            digital_out_7,
            digital_out_8,
        )
        
        
        # Leer entradas digitales
        digital_inputs = self.digital_input_driver.read_inputs()

        # Guardar entradas digitales en variables internas
        with self.lock:
            self.DigitalIn1_value = digital_inputs["DigitalIn1_value"]
            self.DigitalIn2_value = digital_inputs["DigitalIn2_value"]
            self.DigitalIn3_value = digital_inputs["DigitalIn3_value"]
            self.DigitalIn4_value = digital_inputs["DigitalIn4_value"]
            self.DigitalIn5_value = digital_inputs["DigitalIn5_value"]
            self.DigitalIn6_value = digital_inputs["DigitalIn6_value"]
            self.DigitalIn7_value = digital_inputs["DigitalIn7_value"]
            self.DigitalIn8_value = digital_inputs["DigitalIn8_value"]
            
            
        # Leer entradas digitales     
        analog_inputs = self.analog_input_driver.read_inputs()
        
        # Guardar entradas analogicas en variables internas
        with self.lock:
            self.AnalogIn1_value = analog_inputs["AnalogIn1_value"]
            self.AnalogIn2_value = analog_inputs["AnalogIn2_value"]
            self.AnalogIn3_value = analog_inputs["AnalogIn3_value"]
            self.AnalogIn4_value = analog_inputs["AnalogIn4_value"]
            self.AnalogIn5_value = analog_inputs["AnalogIn5_value"]
            self.AnalogIn6_value = analog_inputs["AnalogIn6_value"]
            self.AnalogIn7_value = analog_inputs["AnalogIn7_value"]
            self.AnalogIn8_value = analog_inputs["AnalogIn8_value"]

        print("SCAN LENTO")

    # ============================================================
    # Bucle temporal
    # ============================================================

    def wait_until(self, target_ns):
        while time.monotonic_ns() < target_ns:
            if self.stop_event.is_set():
                return

    def run(self):
        tick_ns = TICK_US * 1_000
        slow_scan_ns = SLOW_SCAN_MS * 1_000_000

        next_tick = time.monotonic_ns()
        next_slow_scan = next_tick

        while not self.stop_event.is_set():
            now = time.monotonic_ns()

            if now >= next_slow_scan:
                self.slow_scan()
                next_slow_scan += slow_scan_ns

            self.scan_rapido()

            next_tick += tick_ns
            self.wait_until(next_tick)
