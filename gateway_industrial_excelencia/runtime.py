import threading
import time

from analog_inputs import MCP3008AnalogInput
from pcf_digital_input import PCFDigitalInput
from pcf_digital_output import PCFDigitalOutput
from pwm import PWM


TICK_US = 125
SLOW_SCAN_MS = 100
NUM_CHANNELS = 8

# PWM por software aun sin mapear. Con un GPIO (BCM) se activa el scan rapido,
# p. ej. 17 = pin fisico 11. Con None no se crea el hilo ni se gasta CPU.
PWM_GPIO_PIN = None


def _canales(prefijo, valor_inicial):
    return {f"{prefijo}{i}_value": valor_inicial for i in range(1, NUM_CHANNELS + 1)}


def _a_bool(valor):
    if isinstance(valor, str):
        texto = valor.strip().lower()
        if texto in ("1", "true", "on"):
            return True
        if texto in ("0", "false", "off"):
            return False
        raise ValueError(f"valor digital no valido: {valor!r}")
    return bool(valor)


class Runtime:
    """Imagen de proceso + ciclo de E/S, al estilo de un PLC.

    MQTT y la consola solo leen/escriben la imagen (protegida con lock). El
    scan lento (100 ms) la intercambia con el hardware por I2C/SPI; el scan
    rapido (125 us) solo existe si hay un GPIO de PWM configurado.
    """

    def __init__(self, pwm_pin=PWM_GPIO_PIN):
        self.pwm_pin = pwm_pin
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.threads = []
        self.drivers = []
        self.pwm = None
        self.running = False

        self.scan_overruns = 0
        self.io_errors = 0
        self.io_ok = True

        # Corriente y RTD: sin hardware todavia, se quedan a 0.
        self.inputs = {**_canales("AnalogIn", 0.0), **_canales("DigitalIn", False),
                       **_canales("CurrentIn", 0.0), **_canales("RTDIn", 0.0)}
        # Salidas analogicas y PWMOut2..8: aun sin hardware.
        self.outputs = {**_canales("AnalogOut", 0.0), **_canales("PWMOut", 0.0),
                        **_canales("DigitalOut", False)}

    # ============================================================
    # Control del runtime
    # ============================================================

    def start(self):
        if self.running:
            print("Ya está arrancado")
            return

        print("Arrancando...")
        self._abrir_drivers()
        self.stop_event.clear()

        self.threads = [threading.Thread(target=self._bucle_lento, name="scan_lento", daemon=True)]
        if self.pwm is not None:
            self.threads.append(threading.Thread(target=self._bucle_rapido, name="scan_rapido", daemon=True))

        self.running = True
        for hilo in self.threads:
            hilo.start()

    def stop(self):
        if not self.running:
            print("Ya está parado")
            return

        print("Parando...")
        self.stop_event.set()
        for hilo in self.threads:
            hilo.join()
        self._cerrar_drivers()

        self.running = False
        print("Parado")

    def _abrir_drivers(self):
        try:
            self.digital_output_driver = PCFDigitalOutput(i2c_bus=1, address=0x39, active_high=False)
            self.drivers.append(self.digital_output_driver)
            self.digital_input_driver = PCFDigitalInput(i2c_bus=1, address=0x38, active_high=True)
            self.drivers.append(self.digital_input_driver)
            self.analog_input_driver = MCP3008AnalogInput(bus=0, device=0)
            self.drivers.append(self.analog_input_driver)
            if self.pwm_pin is not None:
                self.pwm = PWM(self.pwm_pin)
                self.drivers.append(self.pwm)
        except Exception:
            self._cerrar_drivers()
            raise

    def _cerrar_drivers(self):
        # En orden inverso: las salidas digitales se cierran las ultimas y
        # quedan todas apagadas.
        for driver in reversed(self.drivers):
            try:
                driver.close()
            except OSError as e:
                print(f"Error cerrando {type(driver).__name__}: {e}")
        self.drivers = []
        self.pwm = None

    # ============================================================
    # API pública de lectura
    # ============================================================

    def _leer(self, prefijo):
        with self.lock:
            return {k: v for k, v in self.inputs.items() if k.startswith(prefijo)}

    def readAnalogInput(self):
        return self._leer("AnalogIn")

    def readDigitalInput(self):
        return self._leer("DigitalIn")

    def readCurrentInput(self):
        return self._leer("CurrentIn")

    def readRTDInput(self):
        return self._leer("RTDIn")

    def readOutputs(self):
        """Estado actual de las salidas con hardware (DigitalOut1..8 y PWMOut1)."""
        with self.lock:
            return {k: v for k, v in self.outputs.items()
                    if k.startswith("DigitalOut") or k == "PWMOut1_value"}

    def diagnostico(self):
        # Un hilo muerto por un error inesperado no debe seguir publicandose como en marcha.
        en_marcha = self.running and all(hilo.is_alive() for hilo in self.threads)
        return {"running": en_marcha, "io_ok": self.io_ok,
                "io_errors": self.io_errors, "scan_overruns": self.scan_overruns}

    # ============================================================
    # API pública de escritura
    # ============================================================

    def update_outputs(self, valores):
        """Aplica solo las salidas presentes en `valores` (dict nombre -> valor).

        Valida todo antes de tocar la imagen: o se aplica entero o nada.
        Devuelve las claves que no son salidas conocidas.
        """
        nuevos = {}
        ignoradas = []
        for nombre, valor in valores.items():
            if nombre not in self.outputs:
                ignoradas.append(nombre)
            elif nombre.startswith("DigitalOut"):
                nuevos[nombre] = _a_bool(valor)
            elif nombre.startswith("PWMOut"):
                nuevos[nombre] = min(max(float(valor), 0.0), 100.0)
            else:
                nuevos[nombre] = float(valor)

        with self.lock:
            self.outputs.update(nuevos)
        return ignoradas

    def _escribir_grupo(self, prefijo, valores):
        if len(valores) != NUM_CHANNELS:
            raise ValueError(f"se esperan {NUM_CHANNELS} valores")
        self.update_outputs({f"{prefijo}{i}_value": v for i, v in enumerate(valores, 1)})

    def writeAnalogOutput(self, *valores):
        self._escribir_grupo("AnalogOut", valores)

    def writePWMOutput(self, *valores):
        self._escribir_grupo("PWMOut", valores)

    def writeDigitalOutput(self, *valores):
        self._escribir_grupo("DigitalOut", valores)

    def set_pwm(self, duty):
        """Solo PWMOut1, el unico canal con GPIO."""
        self.update_outputs({"PWMOut1_value": duty})

    # ============================================================
    # Scan lento: E/S por I2C y SPI cada 100 ms
    # ============================================================

    def _bucle_lento(self):
        periodo = SLOW_SCAN_MS / 1000
        siguiente = time.monotonic()

        while not self.stop_event.is_set():
            self._scan_lento()

            siguiente += periodo
            ahora = time.monotonic()
            if ahora > siguiente:
                # Se paso de tiempo: se cuenta y se reprograma desde ahora, sin
                # encadenar scans atrasados.
                self.scan_overruns += 1
                siguiente = ahora
            self.stop_event.wait(siguiente - ahora if siguiente > ahora else 0)

    def _scan_lento(self):
        with self.lock:
            salidas = [self.outputs[f"DigitalOut{i}_value"] for i in range(1, NUM_CHANNELS + 1)]

        try:
            self.digital_output_driver.write_outputs(*salidas)
            digitales = self.digital_input_driver.read_inputs()
            analogicas = self.analog_input_driver.read_inputs()
        except OSError as e:
            # Un fallo del bus no para el runtime: se reintenta en el siguiente
            # scan y la imagen conserva los ultimos valores buenos.
            self.io_errors += 1
            if self.io_ok:
                print(f"Error de E/S en el scan lento: {e}")
            self.io_ok = False
            return

        if not self.io_ok:
            print("E/S recuperada")
        self.io_ok = True

        with self.lock:
            self.inputs.update(digitales)
            self.inputs.update(analogicas)

    # ============================================================
    # Scan rápido: PWM por software cada 125 us
    # ============================================================

    def _bucle_rapido(self):
        tick_ns = TICK_US * 1_000
        siguiente = time.perf_counter_ns()
        duty = None

        while not self.stop_event.is_set():
            with self.lock:
                nuevo = self.outputs["PWMOut1_value"]
            if nuevo != duty:
                duty = nuevo
                self.pwm.set_duty(duty)
            self.pwm.update()

            siguiente += tick_ns
            if time.perf_counter_ns() > siguiente:
                siguiente = time.perf_counter_ns()
            else:
                while time.perf_counter_ns() < siguiente:
                    pass
