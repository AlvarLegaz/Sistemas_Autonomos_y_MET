import math
import threading
import time

TICK_US = 125
SLOW_SCAN_MS = 100
NUM_CHANNELS = 8

# PWM por software aun sin mapear. Con un GPIO (BCM) se activa el scan rapido,
# p. ej. 17 = pin fisico 11. Con None no se crea el hilo ni se gasta CPU.
PWM_GPIO_PIN = None

# Salidas de potencia por el expansor de transistores (J7, PCF8574A 0x3A). Un hilo
# propio las modula por flancos: no despierta a pasos fijos, sino justo cuando una salida tiene que cambiar (el inicio de
# cada periodo de PWM, el flanco de bajada de cada bomba y cada ciclo de red de la resistencia). Asi el PWM de las bombas
# sube de 10 Hz a cientos de Hz con el mismo hardware: el limite ya no es el paso sino el bus I2C (PCF8574 a 100 kHz,
# 0,3-0,5 ms por escritura) y la puntualidad del hilo.
PWM_BOMBAS_HZ = 400.0        # frecuencia del PWM de las bombas (OUT07 y OUT08). Si en la maqueta regula mal, bajar a 200 o 100
PWM_BOMBAS_HZ_MAX = 500.0    # tope por software: a 500 Hz ya son hasta 1500 escrituras/s, el limite del bus I2C. El L298
                             # conmuta hasta 25 kHz (40 kHz maximo), asi que por ese lado sobra un factor 50.
PWM_BOMBAS_HZ_MIN = 5.0
CICLO_RED_S = 0.020          # un ciclo de red (50 Hz)
BURST_CICLOS = 50            # ventana de rafaga: 50 ciclos = 1 s
ESPERA_MAXIMA_S = 0.005      # el hilo de potencia revisa las ordenes (paro, apagados) como mucho cada 5 ms
RETRASO_GRAVE_S = 0.002      # un despertar mas tardio que esto se cuenta en scan_overruns
_EPS = 1e-6                  # 1 us: margen para que un flanco calculado nunca quede en el pasado por redondeo
OUT_RESISTENCIA = 3          # OUT03 (J7 pin 4, PCF P2): resistencia (230 V, dos de 120 V en serie), por rafagas
OUT_BOMBA_HEAT = 7           # OUT07: bomba heat unit, PWM = PWMOut2
OUT_BOMBA_FEED = 8           # OUT08: bomba feed unit, PWM = PWMOut1
OUT_SENTIDO_HEAT = 5         # OUT05: sentido de giro de la bomba heat unit
OUT_SENTIDO_FEED = 6         # OUT06: sentido de giro de la bomba feed unit
# Proteccion del driver de las bombas (puente en H): no se invierte el sentido con la bomba girando (la contracorriente del motor
# es muy alta) y el motor nunca se deja con un PWM tan bajo que no llegue a girar: un motor parado con tension es un rotor
# bloqueado y se come la corriente maxima de forma continua. Por eso se arranca a tope (un pico corto que el motor vence
# enseguida) y el PWM de una bomba en marcha nunca baja de PWM_MINIMO_BOMBA.
BOMBAS = {OUT_BOMBA_HEAT: OUT_SENTIDO_HEAT, OUT_BOMBA_FEED: OUT_SENTIDO_FEED}   # OUT de encendido -> OUT de sentido
ARRANQUE_A_TOPE_S = 0.3      # al encender una bomba va al 100 % este tiempo (despega el rotor) y luego pasa a su consigna
PWM_MINIMO_BOMBA = 50.0      # % minimo de PWM con la bomba en marcha: por debajo el motor puede quedarse clavado
RAMPA_PARADA_S = 1.0         # al apagar una bomba (parada normal) su PWM baja hasta PWM_MINIMO_BOMBA en este tiempo y luego se corta;
                             # el paro de emergencia no la usa
ESPERA_CAMBIO_SENTIDO_S = 1.5  # tras apagar una bomba, hasta que se acepta cambiar su sentido
SENTIDO_INVERSO_PERMITIDO = False   # las bombas N1 y N2 solo giran hacia delante: se rechaza cualquier orden de sentido inverso (protege el driver)
PWM_DE_BOMBA = {OUT_BOMBA_HEAT: "PWMOut2_value", OUT_BOMBA_FEED: "PWMOut1_value"}   # canal PWM de cada bomba
POTENCIA_POR_DEFECTO = 100.0  # PWMOut1, PWMOut2 y AnalogOut1 (potencia de la resistencia) arrancan al 100 %

# Seguridad de la resistencia. DigitalIn1 es el termostato de la heat unit: cerrado (True) = todo bien, abierto (False) = sobretemperatura.
# La resistencia SOLO puede conducir si se sabe que el termostato esta cerrado; es un enclavamiento del gateway, vale para
# cualquier origen de la orden (mandos manuales, control automatico, consola). No sustituye al termostato fisico de la maqueta.
ENTRADA_TERMOSTATO = "DigitalIn1_value"
SALIDA_RESISTENCIA = f"TransistorOut{OUT_RESISTENCIA}_value"
MOTIVO_TERMOSTATO_ABIERTO = "termostato_abierto"
MOTIVO_TERMOSTATO_SIN_LECTURA = "termostato_sin_lectura"
# Sonda T2 (AnalogIn2, 10 mV/°C): una lectura fuera de 5 a 145 °C es una sonda desconectada, en corto o rota; sin saber T2 no se calienta.
ENTRADA_SONDA_T2 = "AnalogIn2_value"
SONDA_T2_MIN_V, SONDA_T2_MAX_V = 0.05, 1.45
MOTIVO_SONDA_T2 = "sonda_t2_fuera_de_rango"
MOTIVO_PARO = "paro_emergencia"
# Con estos motivos hay un fallo real: se borra la orden de calentar, se rechazan las nuevas y no se rearma sola.
# (termostato_sin_lectura solo impide conducir mientras dure, sin borrar la orden.)
MOTIVOS_DE_FALLO = (MOTIVO_TERMOSTATO_ABIERTO, MOTIVO_SONDA_T2, MOTIVO_PARO)


def burst_activo(ciclo, porcentaje, ciclos=BURST_CICLOS):
    """Control por rafagas: de cada ventana de `ciclos` ciclos de red conduce
    round(porcentaje * ciclos / 100), repartidos de forma uniforme.
    100 % -> 50 de 50 ciclos; 50 % -> 25 de 50, alternos."""
    n = round(min(max(float(porcentaje), 0.0), 100.0) * ciclos / 100)
    k = ciclo % ciclos
    return (k + 1) * n // ciclos > k * n // ciclos


def frecuencia_pwm_valida(hz):
    """La frecuencia pedida, dentro de lo que el bus I2C puede dar (y muy por debajo del limite del L298)."""
    return min(max(float(hz), PWM_BOMBAS_HZ_MIN), PWM_BOMBAS_HZ_MAX)


def pwm_por_flancos(t, porcentaje, periodo_s):
    """PWM por tiempo. Devuelve (activo, instante del proximo cambio de esta salida) en el instante `t` (segundos).
    Cada periodo empieza activo y baja al cumplirse el porcentaje; al 0 % y al 100 % no hay flancos."""
    fraccion = min(max(float(porcentaje), 0.0), 100.0) / 100.0
    inicio = math.floor((t + _EPS) / periodo_s) * periodo_s
    fin_periodo = inicio + periodo_s
    if fraccion <= 0.0:
        return False, fin_periodo
    if fraccion >= 1.0:
        return True, fin_periodo
    bajada = inicio + fraccion * periodo_s
    if t + _EPS < bajada:
        return True, bajada
    return False, fin_periodo


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

    def __init__(self, pwm_pin=PWM_GPIO_PIN, simular=False, caducidad_calefactor_s=None, pwm_bombas_hz=None):
        """caducidad_calefactor_s: si no es None, la orden de calentar caduca a los N segundos de la ultima vez que se
        recibio (quien la manda tiene que repetirla): si cae el servidor o el broker, la resistencia se apaga sola."""
        self.pwm_pin = pwm_pin
        self.pwm_bombas_hz = frecuencia_pwm_valida(PWM_BOMBAS_HZ if pwm_bombas_hz is None else pwm_bombas_hz)
        self._reloj = time.monotonic      # reloj y espera del hilo de potencia (las pruebas los sustituyen)
        self._esperar = None              # None = stop_event.wait
        self.retraso_potencia_ms = 0.0    # media movil de lo tarde que despierta el hilo de potencia
        self.retraso_potencia_max_ms = 0.0
        self.escrituras_potencia_s = 0.0  # escrituras por segundo al expansor de transistores (ultimo segundo)
        self.simular = simular
        self.caducidad_calefactor_s = caducidad_calefactor_s
        self._calefactor_hasta = 0.0
        self._paro_emergencia = False     # enclavado hasta que alguien lo rearme
        self._bomba_inicio = {}           # OUT de la bomba -> instante (monotonic) en que se encendio
        self._bomba_parada = {}           # OUT de la bomba -> instante en que se apago
        self._bomba_frenando = {}         # OUT de la bomba -> (instante de la orden de parar, PWM que llevaba): rampa de parada en curso
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.threads = []
        self.drivers = []
        self.pwm = None
        self.running = False

        self.scan_overruns = 0
        self.io_errors = 0
        self.io_ok = True
        self._entradas_leidas = False     # hasta el primer scan correcto no se sabe en que estado esta el termostato

        # Corriente y RTD: sin hardware todavia, se quedan a 0.
        self.inputs = {**_canales("AnalogIn", 0.0), **_canales("DigitalIn", False),
                       **_canales("CurrentIn", 0.0), **_canales("RTDIn", 0.0)}
        # Salidas analogicas y PWMOut2..8: aun sin hardware.
        # TransistorOut1..8 = OUT01..OUT08 del conector J7 (PCF8574A 0x3A + TBD62783A).
        self.outputs = {**_canales("AnalogOut", 0.0), **_canales("PWMOut", 0.0),
                        **_canales("DigitalOut", False), **_canales("TransistorOut", False)}
        # TransistorOut3/7/8 son la orden de encendido; la senal fisica sale del hilo
        # de potencia: OUT03 por rafagas (AnalogOut1, %), OUT07 y OUT08 por PWM
        # (PWMOut2 heat unit, PWMOut1 feed unit). Por defecto al 100 %.
        self.outputs["AnalogOut1_value"] = POTENCIA_POR_DEFECTO
        self.outputs["PWMOut1_value"] = POTENCIA_POR_DEFECTO
        self.outputs["PWMOut2_value"] = POTENCIA_POR_DEFECTO

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

        self.threads = [threading.Thread(target=self._bucle_lento, name="scan_lento", daemon=True),
                        threading.Thread(target=self._bucle_potencia, name="scan_potencia", daemon=True)]
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
        # Los drivers reales se importan aqui para que el modo simulado funcione
        # en un PC sin smbus2, spidev ni gpiozero.
        try:
            if self.simular:
                from simulacion import MCP3008AnalogInputSim, PCFDigitalInputSim, PCFDigitalOutputSim
                self.digital_output_driver = PCFDigitalOutputSim()
                self.transistor_output_driver = PCFDigitalOutputSim()
                self.digital_input_driver = PCFDigitalInputSim(self.digital_output_driver)
                self.analog_input_driver = MCP3008AnalogInputSim()
                self.drivers += [self.digital_output_driver, self.transistor_output_driver,
                                 self.digital_input_driver, self.analog_input_driver]
                return

            from analog_inputs import MCP3008AnalogInput
            from pcf_digital_input import PCFDigitalInput
            from pcf_digital_output import PCFDigitalOutput

            self.digital_output_driver = PCFDigitalOutput(i2c_bus=1, address=0x39, active_high=False)
            self.drivers.append(self.digital_output_driver)
            self.transistor_output_driver = PCFDigitalOutput(i2c_bus=1, address=0x3A, active_high=False)
            self.drivers.append(self.transistor_output_driver)
            self.digital_input_driver = PCFDigitalInput(i2c_bus=1, address=0x38, active_high=True)
            self.drivers.append(self.digital_input_driver)
            self.analog_input_driver = MCP3008AnalogInput(bus=0, device=0)
            self.drivers.append(self.analog_input_driver)
            if self.pwm_pin is not None:
                from pwm import PWM
                self.pwm = PWM(self.pwm_pin)
                self.drivers.append(self.pwm)
        except Exception:
            self._cerrar_drivers()
            raise

    def _cerrar_drivers(self):
        # En orden inverso: las salidas digitales se cierran las ultimas y
        # quedan todas apagadas.
        # Se captura Exception, no solo OSError: un driver que falla al cerrar
        # no debe dejar sin cerrar (y con salidas activas) a los siguientes.
        for driver in reversed(self.drivers):
            try:
                driver.close()
            except Exception as e:
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
        """Estado actual de las salidas con hardware: DigitalOut1..8, TransistorOut1..8,
        PWMOut1/2 (bombas) y AnalogOut1 (potencia de la resistencia)."""
        with self.lock:
            return {k: v for k, v in self.outputs.items()
                    if k.startswith(("DigitalOut", "TransistorOut"))
                    or k in ("PWMOut1_value", "PWMOut2_value", "AnalogOut1_value")}

    def diagnostico(self):
        # Un hilo muerto por un error inesperado no debe seguir publicandose como en marcha.
        en_marcha = self.running and all(hilo.is_alive() for hilo in self.threads)
        with self.lock:
            motivos = self._motivos_bloqueo()
            return {"running": en_marcha, "io_ok": self.io_ok,
                    "io_errors": self.io_errors, "scan_overruns": self.scan_overruns,
                    "pwm_bombas_hz": self.pwm_bombas_hz, "retraso_potencia_ms": round(self.retraso_potencia_ms, 3),
                    "retraso_potencia_max_ms": round(self.retraso_potencia_max_ms, 3),
                    "escrituras_potencia_s": round(self.escrituras_potencia_s, 1),
                    "calefactor_bloqueado": bool(motivos), "motivos_bloqueo": motivos,
                    "paro_emergencia": self._paro_emergencia}

    def _motivos_bloqueo(self):
        """Por que no puede conducir la resistencia ahora (lista vacia = puede). Llamar con el lock cogido."""
        motivos = [MOTIVO_PARO] if self._paro_emergencia else []
        if not self._entradas_leidas or not self.io_ok:
            motivos.append(MOTIVO_TERMOSTATO_SIN_LECTURA)    # no se sabe si el termostato esta cerrado: por seguridad, apagada
            return motivos
        if self.inputs.get(ENTRADA_TERMOSTATO) is not True:
            motivos.append(MOTIVO_TERMOSTATO_ABIERTO)
        tension = self.inputs.get(ENTRADA_SONDA_T2)
        if not isinstance(tension, (int, float)) or not SONDA_T2_MIN_V <= tension <= SONDA_T2_MAX_V:
            motivos.append(MOTIVO_SONDA_T2)
        return motivos

    @staticmethod
    def _hay_fallo(motivos):
        return any(m in MOTIVOS_DE_FALLO for m in motivos)

    def paro_emergencia(self, activo):
        """Activa o rearma el paro de emergencia. Activo: todas las salidas digitales y de transistor se apagan y no se
        aceptan ordenes de encendido hasta rearmar. Rearmar no enciende nada: hay que volver a ordenar lo que se quiera."""
        with self.lock:
            self._paro_emergencia = bool(activo)
            if activo:
                for nombre in self.outputs:
                    if nombre.startswith(("DigitalOut", "TransistorOut")):
                        self.outputs[nombre] = False
                ahora = time.monotonic()
                for salida_bomba in BOMBAS:
                    self._bomba_inicio.pop(salida_bomba, None)
                    self._bomba_frenando.pop(salida_bomba, None)    # el paro corta en seco
                    self._bomba_parada[salida_bomba] = ahora
        print("PARO DE EMERGENCIA ACTIVADO: todas las salidas apagadas" if activo else "Paro de emergencia rearmado (todo sigue apagado)")

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
            elif nombre.startswith(("DigitalOut", "TransistorOut")):
                nuevos[nombre] = _a_bool(valor)
            elif nombre.startswith("PWMOut"):
                nuevos[nombre] = min(max(float(valor), 0.0), 100.0)
                if nombre in PWM_DE_BOMBA.values() and 0.0 < nuevos[nombre] < PWM_MINIMO_BOMBA:
                    print(f"{nombre} = {nuevos[nombre]:g} % subido a {PWM_MINIMO_BOMBA:g} %: por debajo la bomba puede no girar")
                    nuevos[nombre] = PWM_MINIMO_BOMBA
            else:
                nuevos[nombre] = float(valor)

        with self.lock:
            motivos = self._motivos_bloqueo()
            if self._paro_emergencia:                      # en paro no se acepta ningun encendido
                for nombre in nuevos:
                    if nombre.startswith(("DigitalOut", "TransistorOut")) and nuevos[nombre]:
                        nuevos[nombre] = False
                        print(f"Orden de encender {nombre} rechazada: paro de emergencia")
            elif nuevos.get(SALIDA_RESISTENCIA) and self._hay_fallo(motivos):
                nuevos[SALIDA_RESISTENCIA] = False       # con un fallo (termostato abierto, sonda T2) no se acepta calentar
                print(f"Orden de calentar rechazada: {', '.join(motivos)}")
            self._proteger_bombas(nuevos)
            if nuevos.get(SALIDA_RESISTENCIA) and self.caducidad_calefactor_s is not None:
                self._calefactor_hasta = time.monotonic() + self.caducidad_calefactor_s   # cada orden de calentar renueva el plazo
            self.outputs.update(nuevos)
        return ignoradas

    def _proteger_bombas(self, nuevos):
        """Filtra `nuevos` (se modifica) segun la proteccion del driver de las bombas y anota cuando se encienden y apagan.
        Un cambio de sentido se rechaza si la bomba esta girando o se paro hace menos de ESPERA_CAMBIO_SENTIDO_S. Llamar con el lock cogido."""
        ahora = time.monotonic()
        for salida_bomba, salida_sentido in BOMBAS.items():
            enc, sen = f"TransistorOut{salida_bomba}_value", f"TransistorOut{salida_sentido}_value"
            if not SENTIDO_INVERSO_PERMITIDO and nuevos.get(sen):
                del nuevos[sen]
                print(f"Orden de sentido inverso de OUT{salida_bomba:02d} rechazada: las bombas solo giran hacia delante")
            estaba_on = self.outputs[enc]
            parada = self._bomba_parada.get(salida_bomba)
            if sen in nuevos and nuevos[sen] != self.outputs[sen]:
                if estaba_on or (parada is not None and ahora - parada < ESPERA_CAMBIO_SENTIDO_S):
                    del nuevos[sen]
                    print(f"Cambio de sentido de OUT{salida_bomba:02d} rechazado: la bomba esta girando o acaba de parar")
            if enc in nuevos and nuevos[enc] != estaba_on:
                if nuevos[enc]:
                    self._bomba_inicio[salida_bomba] = ahora
                    self._bomba_frenando.pop(salida_bomba, None)
                else:
                    llevaba = self._pwm_en_marcha(salida_bomba, self.outputs[PWM_DE_BOMBA[salida_bomba]], ahora)
                    if RAMPA_PARADA_S > 0 and llevaba > PWM_MINIMO_BOMBA:
                        self._bomba_frenando[salida_bomba] = (ahora, llevaba)
                    self._bomba_inicio.pop(salida_bomba, None)
                    self._bomba_parada[salida_bomba] = ahora

    def _pwm_en_marcha(self, salida_bomba, consigna, ahora):
        """PWM real de una bomba encendida: 100 % los primeros ARRANQUE_A_TOPE_S tras encenderla y luego su consigna,
        nunca por debajo de PWM_MINIMO_BOMBA. Una consigna de 0 deja el motor sin tension (no hay corriente)."""
        if consigna <= 0:
            return 0.0
        inicio = self._bomba_inicio.get(salida_bomba)
        if inicio is not None and ahora - inicio < ARRANQUE_A_TOPE_S:
            return 100.0
        return max(consigna, PWM_MINIMO_BOMBA)

    def _pwm_frenando(self, llevaba, transcurrido):
        """Rampa de parada: de `llevaba` hasta PWM_MINIMO_BOMBA en RAMPA_PARADA_S (luego se corta)."""
        return llevaba - (llevaba - PWM_MINIMO_BOMBA) * transcurrido / RAMPA_PARADA_S

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
                with self.lock:
                    self.scan_overruns += 1
                siguiente = ahora
            self.stop_event.wait(siguiente - ahora if siguiente > ahora else 0)

    def _scan_lento(self):
        with self.lock:
            salidas = [self.outputs[f"DigitalOut{i}_value"] and not self._paro_emergencia for i in range(1, NUM_CHANNELS + 1)]

        try:
            self.digital_output_driver.write_outputs(*salidas)
            digitales = self.digital_input_driver.read_inputs()
            analogicas = self.analog_input_driver.read_inputs()
        except OSError as e:
            # Un fallo del bus no para el runtime: se reintenta en el siguiente
            # scan y la imagen conserva los ultimos valores buenos.
            self._error_io("scan lento", e)
            return

        with self.lock:
            if not self.io_ok:
                print("E/S recuperada")
            self.io_ok = True
            self.inputs.update(digitales)
            self.inputs.update(analogicas)
            self._entradas_leidas = True
            self._enclavar_resistencia()

    def _enclavar_resistencia(self):
        """Termostato abierto: se borra la orden de calentar. Aunque el termostato se cierre solo al enfriarse,
        la resistencia NO vuelve a encenderse hasta que alguien la ordene de nuevo. Llamar con el lock cogido."""
        if not self.outputs[SALIDA_RESISTENCIA]:
            return
        motivos = self._motivos_bloqueo()
        if self._hay_fallo(motivos):
            self.outputs[SALIDA_RESISTENCIA] = False
            print(f"FALLO ({', '.join(motivos)}): resistencia apagada (no se rearma sola)")
        elif self.caducidad_calefactor_s is not None and time.monotonic() > self._calefactor_hasta:
            self.outputs[SALIDA_RESISTENCIA] = False
            print("Orden de calentar caducada (nadie la ha renovado): resistencia apagada")

    def _error_io(self, donde, e):
        with self.lock:
            self.io_errors += 1
            if self.io_ok:
                print(f"Error de E/S en el {donde}: {e}")
            self.io_ok = False

    # ============================================================
    # Scan de potencia: transistores (J7), con rafagas en OUT03 y PWM en OUT07/OUT08
    # ============================================================

    def niveles_potencia(self, t, ahora=None):
        """Nivel fisico de OUT01..OUT08 en el instante `t` (segundos del reloj del hilo de potencia), a partir de la imagen.
        `ahora` (monotonic) solo se pasa en pruebas."""
        return self._plan_potencia(t, ahora)[0]

    def _plan_potencia(self, t, ahora=None):
        """(niveles de OUT01..OUT08 en `t`, instante en que hay que volver a mirar): el proximo flanco de una bomba o el
        proximo ciclo de red, y como mucho ESPERA_MAXIMA_S despues para atender pronto un paro o un apagado."""
        ahora = time.monotonic() if ahora is None else ahora
        with self.lock:
            cmd = [self.outputs[f"TransistorOut{i}_value"] for i in range(1, NUM_CHANNELS + 1)]
            potencia = self.outputs["AnalogOut1_value"]
            heat = self.outputs["PWMOut2_value"]
            feed = self.outputs["PWMOut1_value"]
            bloqueada = bool(self._motivos_bloqueo())
            paro = self._paro_emergencia
            heat = self._pwm_en_marcha(OUT_BOMBA_HEAT, heat, ahora)
            feed = self._pwm_en_marcha(OUT_BOMBA_FEED, feed, ahora)
            # Rampa de parada: la bomba ya apagada en la imagen sigue empujando con un PWM que baja hasta el minimo y se corta
            # (el relé de sentido no se toca).
            for salida_bomba in BOMBAS:
                frenando = self._bomba_frenando.get(salida_bomba)
                if frenando is None:
                    continue
                transcurrido = ahora - frenando[0]
                if cmd[salida_bomba - 1] or paro or transcurrido >= RAMPA_PARADA_S:
                    self._bomba_frenando.pop(salida_bomba, None)
                    continue
                cmd[salida_bomba - 1] = True
                if salida_bomba == OUT_BOMBA_HEAT:
                    heat = self._pwm_frenando(frenando[1], transcurrido)
                else:
                    feed = self._pwm_frenando(frenando[1], transcurrido)
        siguiente = t + ESPERA_MAXIMA_S
        if paro:
            return [False] * NUM_CHANNELS, siguiente
        if not SENTIDO_INVERSO_PERMITIDO:
            for salida_sentido in BOMBAS.values():
                cmd[salida_sentido - 1] = False
        ciclo = math.floor((t + _EPS) / CICLO_RED_S)
        if cmd[OUT_RESISTENCIA - 1]:
            cmd[OUT_RESISTENCIA - 1] = not bloqueada and burst_activo(ciclo, potencia)
            siguiente = min(siguiente, (ciclo + 1) * CICLO_RED_S)
        periodo = 1.0 / self.pwm_bombas_hz
        for salida_bomba, porcentaje in ((OUT_BOMBA_HEAT, heat), (OUT_BOMBA_FEED, feed)):
            if cmd[salida_bomba - 1]:
                cmd[salida_bomba - 1], cambio = pwm_por_flancos(t, porcentaje, periodo)
                siguiente = min(siguiente, cambio)
        return cmd, max(siguiente, t + _EPS)

    def _bucle_potencia(self):
        reloj = self._reloj
        esperar = self._esperar or self.stop_event.wait
        refresco = SLOW_SCAN_MS / 1000
        t0 = reloj()
        ultimo, escrito = None, -refresco
        objetivo = None                  # instante en que se queria despertar
        ventana, escrituras = 0.0, 0

        while not self.stop_event.is_set():
            ahora = reloj()
            t = ahora - t0
            if objetivo is not None:
                retraso = max(0.0, t - objetivo)
                with self.lock:
                    self.retraso_potencia_ms += (retraso * 1000 - self.retraso_potencia_ms) * 0.01
                    self.retraso_potencia_max_ms = max(self.retraso_potencia_max_ms, retraso * 1000)
                    if retraso > RETRASO_GRAVE_S:
                        self.scan_overruns += 1
            niveles, siguiente = self._plan_potencia(t, ahora)
            # Se escribe al cambiar y, aunque no cambie, cada 100 ms (recupera un fallo del bus).
            if niveles != ultimo or t - escrito >= refresco:
                try:
                    self.transistor_output_driver.write_outputs(*niveles)
                    ultimo, escrito = niveles, t
                    escrituras += 1
                except OSError as e:
                    self._error_io("scan de potencia", e)
                    ultimo, escrito = None, t
            if t - ventana >= 1.0:
                with self.lock:
                    self.escrituras_potencia_s = escrituras / (t - ventana)
                ventana, escrituras = t, 0

            objetivo = siguiente
            falta = siguiente - (reloj() - t0)
            if falta > 0:
                esperar(falta)

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
