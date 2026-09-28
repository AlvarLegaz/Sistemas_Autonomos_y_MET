"""El submarino completo: coordina hardware, IMU, profundidad y cámara, y
lleva el control de profundidad y cabeceo.

Es la única clase que los demás módulos necesitan conocer. El servidor web y,
más adelante, el servidor UDP hablan con el submarino, nunca con el hardware
ni con los sensores directamente.

A diferencia del rover, el mando no fija los motores directamente: fija los
dos horizontales (avance y giro, como en el rover) y una velocidad vertical
deseada. Con ella el submarino mueve su profundidad objetivo, y un PID sobre
el sensor de presión manda a los dos propulsores verticales lo necesario para
alcanzarla y mantenerla. Un segundo PID sobre la IMU reparte ese empuje entre
proa y popa para que el casco se mantenga horizontal. Los dos corren en un
hilo propio a 20 Hz, que es lo que correrá en la Raspberry.
"""

import threading
import time

from hardware import Hardware, WATCHDOG_TIMEOUT
from imu import IMU
from profundidad import Profundidad
from camara import Camara

# Periodo del bucle de control (20 Hz).
PERIODO_CONTROL = 0.05
# Velocidad a la que se mueve la profundidad objetivo con vertical = ±100.
VELOCIDAD_VERTICAL = 0.3     # m/s
# La profundidad objetivo no puede pedirse más cerca del fondo que esto.
MARGEN_FONDO = 0.5           # m

# Ganancias del PID de profundidad: entrada en metros, salida en consigna
# (-100..100) común a los dos verticales. La derivada se toma de la propia
# medida, filtrada, porque no hay sensor de velocidad vertical. Ajustadas en
# el simulador (escalón de 5 m: sobreimpulso 0,20 m, ±0,1 m a los 15 s);
# con el hardware real habrá que reajustarlas.
KP_PROFUNDIDAD = 150.0
KI_PROFUNDIDAD = 30.0
KD_PROFUNDIDAD = 100.0
TAU_DERIVADA = 0.4           # s del filtro de la derivada de profundidad

# Ganancias del PID de cabeceo: entrada en grados, salida en consigna que se
# resta a proa y se suma a popa. La derivada la da el giróscopo, no se deriva.
# Poca P a propósito: con el retardo de los motores (0,2 s) una P alta hace
# oscilar el casco; lo que lo sujeta es la D (amortiguación) y la I compensa
# que un propulsor rinda distinto del otro.
KP_CABECEO = 2.0
KI_CABECEO = 1.0
KD_CABECEO = 1.5


class PID:
    """Regulador PID mínimo.

    La derivada se calcula sobre la medida (no sobre el error) para que un
    salto de la consigna no dé un pico, o se recibe de fuera si hay un sensor
    que la mida mejor (el giróscopo). La integral está acotada para que no se
    dispare mientras los motores están saturados.
    """

    def __init__(self, kp, ki, kd, limite, tau_derivada=0.0):
        self.kp, self.ki, self.kd = kp, ki, kd
        self.limite = limite
        self.tau_derivada = tau_derivada
        self.integral = 0.0
        self.derivada = 0.0
        self.medida_previa = None

    def reiniciar(self, medida):
        self.integral = 0.0
        self.derivada = 0.0
        self.medida_previa = medida

    def calcular(self, objetivo, medida, dt, derivada=None):
        error = objetivo - medida
        if derivada is None:
            bruta = 0.0 if self.medida_previa is None else (medida - self.medida_previa) / dt
            self.derivada += (bruta - self.derivada) * dt / (self.tau_derivada + dt)
        else:
            self.derivada = derivada
        self.medida_previa = medida
        # Integración condicional: si la salida ya está saturada y el error
        # empuja en el mismo sentido, la integral no crece (no se "carga"
        # durante un descenso largo a tope para descargarse luego pasándose).
        integral = self.integral + error * dt
        salida = self.kp * error + self.ki * integral - self.kd * self.derivada
        if abs(salida) > self.limite and salida * error > 0:
            salida = self.kp * error + self.ki * self.integral - self.kd * self.derivada
        else:
            self.integral = integral
        return max(-self.limite, min(self.limite, salida))


class Submarino:
    def __init__(self, hardware=None, imu=None, profundidad=None, camara=None):
        # Se puede inyectar cada componente (útil para probar) o dejar que el
        # submarino los cree. Los sensores reciben el hardware porque de él
        # saldrán el bus I2C y el puerto serie cuando se implementen.
        self.hardware = hardware or Hardware()
        self.imu = imu or IMU(self.hardware)
        self.profundidad = profundidad or Profundidad(self.hardware)
        self.camara = camara or Camara(self.hardware)
        # Profundidad objetivo (m) que mantiene el PID.
        self.objetivo = 0.0
        # Última orden del mando: horizontales tal cual y velocidad vertical
        # (-100..100, positiva = subir).
        self._izquierda = 0
        self._derecha = 0
        self._vertical = 0
        self._ultima_orden = 0.0
        # True mientras el mando esté enviando; al perderlo se deja de escribir
        # en los motores y el vigilante del hardware los para.
        self._activo = False
        # Con los PID desactivados la orden vertical va directa a los dos
        # propulsores verticales (modo manual).
        self._pid = True
        self._t_control = 0.0
        self._pid_profundidad = PID(KP_PROFUNDIDAD, KI_PROFUNDIDAD, KD_PROFUNDIDAD, 100, TAU_DERIVADA)
        self._pid_cabeceo = PID(KP_CABECEO, KI_CABECEO, KD_CABECEO, 60)
        self._cerrojo = threading.Lock()
        self._fin = threading.Event()
        self._hilo = None

    # ---- bucle de control ----

    def iniciar(self):
        """Arranca el hilo de control. Idempotente."""
        if self._hilo is None or not self._hilo.is_alive():
            self._fin.clear()
            self._hilo = threading.Thread(target=self._bucle, daemon=True)
            self._hilo.start()

    def detener(self):
        self._fin.set()
        if self._hilo is not None:
            self._hilo.join(timeout=1.0)
            self._hilo = None

    def _bucle(self):
        while not self._fin.wait(PERIODO_CONTROL):
            self._controlar()

    def _controlar(self):
        """Un ciclo de control: lee sensores, calcula los PID y escribe motores."""
        ahora = time.monotonic()
        with self._cerrojo:
            if ahora - self._ultima_orden > WATCHDOG_TIMEOUT:
                # Sin mando se paran los motores una vez y no se escribe más:
                # el vigilante del hardware lo confirma y el submarino sube solo.
                if self._activo:
                    self._activo = False
                    self.hardware.set_motores(0, 0, 0, 0)
                return
            lectura = self.profundidad.leer()
            imu = self.imu.leer()
            z = lectura["profundidad"]
            pitch = imu["orientacion"]["pitch"]
            vel_pitch = -imu["giroscopio"]["y"]     # y positivo = morro bajando
            if not self._activo:
                # Se retoma el control donde esté el submarino, sin saltos.
                self._activo = True
                self._t_control = ahora
                self.objetivo = z
                self._pid_profundidad.reiniciar(z)
                self._pid_cabeceo.reiniciar(pitch)
            dt = min(0.2, max(0.005, ahora - self._t_control))
            self._t_control = ahora
            if not self._pid:
                # Modo manual: la orden vertical (positiva = subir) va tal cual
                # a los dos verticales, que empujan hacia abajo con consigna
                # positiva. Sin orden el submarino sube solo por su
                # flotabilidad, y nada le impide llegar al fondo. El objetivo
                # sigue a la profundidad real y los PID se mantienen a cero
                # para que, al reactivarlos, sujeten la que tenga sin salto.
                self.objetivo = z
                self._pid_profundidad.reiniciar(z)
                self._pid_cabeceo.reiniciar(pitch)
                self.hardware.set_motores(self._izquierda, self._derecha,
                                          -self._vertical, -self._vertical)
                return
            # La orden vertical mueve el objetivo; no puede ir por encima de la
            # superficie ni más cerca del fondo que MARGEN_FONDO.
            objetivo = self.objetivo - self._vertical / 100.0 * VELOCIDAD_VERTICAL * dt
            if lectura["fondo"] is not None:
                objetivo = min(objetivo, z + lectura["fondo"] - MARGEN_FONDO)
            self.objetivo = max(0.0, objetivo)
            comun = self._pid_profundidad.calcular(self.objetivo, z, dt)
            cabeceo = self._pid_cabeceo.calcular(0.0, pitch, dt, derivada=vel_pitch)
            # Morro arriba (pitch > 0) da cabeceo negativo: más empuje hacia
            # abajo en proa y menos en popa, y el morro baja.
            self.hardware.set_motores(self._izquierda, self._derecha,
                                      comun - cabeceo, comun + cabeceo)

    # ---- movimiento ----

    def mover(self, izquierda, derecha, vertical):
        """Aplica una orden del mando y devuelve el estado de control.

        izquierda y derecha son las consignas de los horizontales, -100..100,
        como en el rover. vertical es la velocidad vertical deseada, -100..100,
        positiva hacia arriba; mueve la profundidad objetivo y el PID hace el
        resto. Cada llamada rearma el vigilante: si no llega otra en
        WATCHDOG_TIMEOUT los motores se paran y el submarino sube solo.
        """
        with self._cerrojo:
            self._izquierda = izquierda
            self._derecha = derecha
            self._vertical = max(-100, min(100, vertical))
            self._ultima_orden = time.monotonic()
        # Con el hilo en marcha la orden se aplica en el siguiente ciclo (50 ms
        # como mucho); sin hilo (pruebas) se aplica aquí mismo.
        if self._hilo is None or not self._hilo.is_alive():
            self._controlar()
        return self.estado_control()

    def avanzar(self, velocidad):
        return self.mover(velocidad, velocidad, 0)

    def retroceder(self, velocidad):
        return self.mover(-velocidad, -velocidad, 0)

    def girar_izquierda(self, velocidad):
        """Giro sobre el sitio: un lado avanza y el otro retrocede."""
        return self.mover(-velocidad, velocidad, 0)

    def girar_derecha(self, velocidad):
        return self.mover(velocidad, -velocidad, 0)

    def subir(self, velocidad):
        return self.mover(0, 0, velocidad)

    def bajar(self, velocidad):
        return self.mover(0, 0, -velocidad)

    def parar(self):
        """Para los horizontales y deja de mover el objetivo: mantiene la profundidad."""
        return self.mover(0, 0, 0)

    def fijar_pid(self, activo):
        """Activa o desactiva los PID de profundidad y cabeceo.

        Desactivados, la orden vertical del mando va directa a los dos
        propulsores verticales y el submarino ya no mantiene profundidad ni
        se endereza: con vertical = 0 sube solo. Al reactivarlos sujeta la
        profundidad que tenga en ese momento.
        """
        with self._cerrojo:
            self._pid = bool(activo)
        return self.estado_control()

    # ---- navegación: pendiente ----

    def girar_grados(self, grados):
        """Gira los grados indicados usando el yaw de la IMU."""
        # TODO(navegación): control en lazo cerrado sobre imu.orientacion().
        pass

    def ir_a_profundidad(self, metros):
        """Fija directamente la profundidad objetivo."""
        with self._cerrojo:
            self.objetivo = max(0.0, float(metros))

    # ---- estado ----

    def estado_control(self):
        """Consignas de los cuatro motores, vigilante, profundidad objetivo y
        si los PID están activos."""
        estado = self.hardware.estado_control()
        with self._cerrojo:
            estado["objetivo"] = round(self.objetivo, 2)
            estado["pid"] = self._pid
        return estado

    def obtener_telemetria(self):
        """Todo el estado disponible del submarino en un solo diccionario."""
        return {
            "profundidad": self.profundidad.leer(),
            "imu": self.imu.leer(),
            "bateria": self.hardware.leer_bateria(),
            "control": self.estado_control(),
        }
