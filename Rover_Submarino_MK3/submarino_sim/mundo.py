"""Mundo simulado del submarino.

Aquí vive todo lo que en el submarino real es el mundo físico: el agua, el
fondo, los objetos, la física del movimiento, la batería y lo que ven los
sensores. Las clases Hardware, IMU, Profundidad y Camara del simulador no
saben nada de física: le preguntan al mundo, igual que en el submarino real le
preguntarán a los ESC, al I2C o al sensor de presión.

El vehículo lleva cuatro propulsores: dos horizontales a popa (izquierda y
derecha, avance y giro, como el rover) y dos verticales en la línea de crujía
(proa y popa, profundidad y cabeceo). Flota un poco: sin empuje sube despacio
hasta la superficie, que es lo que se quiere si se pierde el enlace.

Convenciones:
- Posición en metros: x hacia el este, y hacia el norte, z es la PROFUNDIDAD
  (positiva hacia abajo, 0 en la superficie). Arranca en (0, 0) en la
  superficie mirando al norte.
- yaw como una brújula: 0 norte, 90 este, crece en sentido horario.
- pitch positivo = morro arriba; roll positivo = lado derecho abajo. Misma
  convención que el horizonte artificial de la interfaz.
- Ejes del cuerpo para la IMU: x adelante, y izquierda, z arriba.
- Consigna de un propulsor vertical positiva = empuja hacia ABAJO (sumerge).
"""

import math
import random
import struct
import threading
import time
import zlib

import numpy as np

# ---- vehículo (valores supuestos; medirlos en el submarino real) ----
EMPUJE_MAX = 4.0         # N por propulsor con consigna 100
TAU_MOTOR = 0.2          # s; el empuje tarda en alcanzar la consigna
MASA_AVANCE = 7.0        # kg efectivos hacia delante (masa + agua arrastrada)
MASA_VERTICAL = 10.0     # kg efectivos en vertical (más agua arrastrada)
ARRASTRE_AVANCE = 8.0    # N·s²/m²: con los dos horizontales a tope, 1 m/s
ARRASTRE_VERTICAL = 30.0 # N·s²/m²: con los dos verticales a tope, 0,5 m/s
FLOTABILIDAD = 0.3       # N hacia arriba de más: sin empuje sube a 0,1 m/s
SEPARACION = 0.30        # m entre los dos propulsores horizontales
INERCIA_GUINADA = 0.15   # kg·m²
ARRASTRE_GUINADA = 1.0   # N·m·s²: giro sobre el sitio a tope, unos 60°/s
BRAZO_VERTICAL = 0.25    # m de cada propulsor vertical al centro de gravedad
INERCIA_CABECEO = 0.20   # kg·m²
ADRIZAMIENTO = 1.8       # N·m por sin(pitch): el CB sobre el CG lo endereza
ARRASTRE_CABECEO = 0.6   # N·m·s²
# El propulsor de popa da un 15 % menos que el de proa, como pasa con dos
# hélices "iguales" de verdad. Es lo que hace necesario el PID de cabeceo.
RENDIMIENTO_POPA = 0.85
RADIO_SUB = 0.25         # m; el casco se trata como una esfera
PASO = 0.02              # s por paso de simulación (50 Hz)
LIMITE = 25.0            # m; el mundo es el cuadrado ±LIMITE, no se sale
BATERIA_DURACION = 40 * 60   # s que dura la batería con los 4 a tope
GRAVEDAD = 9.81

# ---- sensores ----
RUIDO_ANGULO = 0.3       # grados, desviación típica en la orientación
RUIDO_ACEL = 0.05        # m/s^2
RUIDO_GIRO = 0.5         # grados/s
DERIVA_GIRO = 0.3        # grados/s de sesgo fijo en el giróscopo z
RUIDO_PRESION = 0.01     # m; un sensor de presión resuelve centímetros
RUIDO_ECOSONDA = 0.05    # m
ECOSONDA_PERIODO = 0.2   # s entre pings de la ecosonda (5 Hz)
ECOSONDA_ALCANCE = 30.0  # m; más lejos no devuelve eco

# ---- el mar ----
FONDO_MEDIO = 12.0       # m de profundidad media del fondo
RELIEVE = 2.5            # m de amplitud del relieve del fondo (±)

# ---- cámara ----
ANCHO_IMG = 320
ALTO_IMG = 240
FOV = 70.0               # grados, campo de visión horizontal
FPS_CAMARA = 10
VISIBILIDAD = 9.0        # m; distancia a la que todo se funde con el agua
DIST_MIN = 0.25
DIST_MAX = 40.0
MUESTRAS = 200
LUZ = np.array([-0.3, 0.2, 0.93]) / math.sqrt(0.3 ** 2 + 0.2 ** 2 + 0.93 ** 2)
AGUA_SUPERFICIE = np.array([80, 185, 205], float)    # color del agua a 0 m: turquesa de piscina
AGUA_PROFUNDA = np.array([12, 70, 95], float)        # color del agua al fondo, ya no verdoso de mar
LUZ_SUPERFICIE = np.array([220, 245, 250], float)    # brillo al mirar arriba
# Cuanto mayor, más brusco el paso del agua al brillo de la superficie
# (1 = fundido exponencial suave; 4 = borde claro a ~VISIBILIDAD metros).
AGUDEZA_SUPERFICIE = 4.0
# Aspecto de piscina de pruebas (pedido 2026-09-27: "que parezca que está en
# una piscina de pruebas"): paredes en baldosa clara con junta oscura, como un
# tanque de ensayos. El terreno (función `fondo`) y el límite físico
# (`LIMITE`) no cambian, solo cómo se pintan. El fondo, en cambio, se pinta
# color tierra (pedido 2026-09-27: "el suelo del fondo sea color tierra
# aunque los laterales sean de piscina"), con la misma rejilla en damero que
# la baldosa para dar textura y referencia de distancia, pero con línea de
# surco en vez de junta de baldosín.
TIERRA_A = np.array([150, 108, 68], float)
TIERRA_B = np.array([120, 84, 50], float)
SURCO = np.array([70, 48, 30], float)        # línea de surco entre parches de tierra
ANCHO_JUNTA = 0.045                          # fracción de baldosa/parche (1 m) que ocupa la línea
PARED_A = np.array([233, 244, 246], float)   # baldosa de las paredes
PARED_B = np.array([206, 227, 230], float)
JUNTA = np.array([70, 92, 96], float)        # línea de junta entre baldosas de pared
ALTURA_BALDOSA_PARED = 0.5                   # tamaño de baldosa en vertical, m
FUERA = np.array([25, 35, 40], float)   # fondo más allá del límite (normalmente tapado por la pared)
TIERRA_MEDIA = (TIERRA_A + TIERRA_B) / 2.0

# El suelo se pinta lanzando un rayo por columna y muestreándolo a distancias
# crecientes (MUESTRAS, espaciadas en logaritmo hasta DIST_MAX); a partir de
# unos pocos metros la separación entre muestras es mayor que una junta, o
# incluso que una baldosa entera, y el damero deja de verse como rejilla para
# verse como ruido de estática (pedido 2026-09-27: "se ve con mucho
# aliasing"). En vez de dibujar el patrón exacto ahí donde no hay muestras de
# sobra para resolverlo, se funde hacia el color medio de la baldosa según la
# distancia, como el nivel más basto de un mipmap. Todo esto solo depende de
# MUESTRAS/DIST_MIN/DIST_MAX/ANCHO_JUNTA (constantes), así que se precalcula
# una vez en vez de en cada fotograma.
PROF = (DIST_MIN * (DIST_MAX / DIST_MIN) ** (np.arange(MUESTRAS) / (MUESTRAS - 1)))[:, None]
_RATIO_MUESTRA = (DIST_MAX / DIST_MIN) ** (1.0 / (MUESTRAS - 1))
_PASO_MUESTRA = PROF * (_RATIO_MUESTRA - 1.0)     # separación aprox. entre muestras, m
# La junta (4,5 cm) es mucho más fina que la baldosa (1 m), así que se difumina
# antes: antes de 2 juntas de separación entre muestras se ve entera, a partir
# de 8 ya no queda rastro. La baldosa entera aguanta hasta separaciones de
# fracción de metro y se pierde sobre el metro.
AA_JUNTA = np.clip(1.0 - (_PASO_MUESTRA - 2 * ANCHO_JUNTA) / (6 * ANCHO_JUNTA), 0.0, 1.0)[:, :, None]
AA_LOSETA = np.clip(1.0 - (_PASO_MUESTRA - 0.35) / 0.65, 0.0, 1.0)[:, :, None]

# Los cuatro objetos, apoyados en el fondo: tipo, posición (x, y), radio y
# color. Son más grandes que los del rover para verlos con poca visibilidad.
OBJETOS = [
    {"nombre": "cubo rojo", "tipo": "cubo", "x": 0.0, "y": 4.0, "radio": 0.6, "color": (210, 50, 45)},
    {"nombre": "pelota azul", "tipo": "pelota", "x": 5.0, "y": 6.0, "radio": 0.7, "color": (40, 90, 220)},
    {"nombre": "cubo amarillo", "tipo": "cubo", "x": -6.0, "y": 2.0, "radio": 0.6, "color": (235, 200, 40)},
    {"nombre": "pelota verde", "tipo": "pelota", "x": 3.0, "y": -5.0, "radio": 0.5, "color": (50, 180, 70)},
]

# ---- corriente ----
# Velocidad del agua por nivel (m/s). El submarino avanza a 1 m/s a tope, así
# que con "mucho" hay que corregir el rumbo unos 37° para ir recto de través.
CORRIENTES = {"ninguno": 0.0, "poco": 0.25, "mucho": 0.6}
CORRIENTE_VAIVEN = 0.2           # la velocidad oscila ±20 % ...
CORRIENTE_PERIODO_VEL = 13.0     # ... con este periodo (s)
CORRIENTE_GIRO = 25.0            # y el rumbo oscila ±25° ...
CORRIENTE_PERIODO_RUMBO = 20.0   # ... con este otro (s)

# ---- aros de entrenamiento ----
# Cinco aros verticales, de rojo a azul, cada uno más hondo y a unos 7 m del
# anterior (se ven con VISIBILIDAD = 9 m). "rumbo" es la dirección en la que
# se atraviesa el aro (perpendicular a su plano). El primero está 7 m al
# norte del arranque, a 2 m de profundidad.
RADIO_ARO = 1.0          # m, del centro al eje del tubo
GROSOR_ARO = 0.12        # m, radio del tubo
AROS = [
    {"nombre": "rojo", "x": 0.0, "y": 7.0, "z": 2.0, "rumbo": 0.0, "color": (235, 50, 45)},
    {"nombre": "naranja", "x": 5.0, "y": 12.0, "z": 4.0, "rumbo": 45.0, "color": (245, 140, 30)},
    {"nombre": "amarillo", "x": 11.0, "y": 13.0, "z": 6.0, "rumbo": 90.0, "color": (240, 210, 40)},
    {"nombre": "verde", "x": 14.0, "y": 7.0, "z": 8.0, "rumbo": 160.0, "color": (50, 205, 80)},
    {"nombre": "azul", "x": 10.0, "y": 1.0, "z": 10.0, "rumbo": 225.0, "color": (60, 120, 245)},
]

# ---- vista en tercera persona ----
CAM_TERCERA_ATRAS = 2.5      # m detrás del submarino
CAM_TERCERA_ARRIBA = 0.9     # m por encima
# Modelo del submarino para verlo desde fuera: elipsoides en ejes del cuerpo
# (x adelante, y izquierda, z arriba), con centro, semiejes y color. Forma
# supuesta de un pequeño ROV: casco amarillo tipo torpedo, morro oscuro con la
# cámara, dos propulsores horizontales a popa y dos verticales sobre el casco.
# Ajustar a las medidas del submarino real cuando exista.
MODELO_SUB = [
    ("casco", (0.0, 0.0, 0.0), (0.45, 0.16, 0.14), (235, 190, 40)),
    ("morro", (0.40, 0.0, 0.0), (0.12, 0.11, 0.10), (30, 35, 45)),
    ("soporte", (0.0, 0.0, 0.13), (0.32, 0.03, 0.02), (120, 125, 130)),
    ("propulsor izquierda", (-0.42, 0.17, 0.0), (0.06, 0.08, 0.08), (25, 25, 30)),
    ("propulsor derecha", (-0.42, -0.17, 0.0), (0.06, 0.08, 0.08), (25, 25, 30)),
    ("propulsor proa", (0.22, 0.0, 0.16), (0.08, 0.08, 0.04), (25, 25, 30)),
    ("propulsor popa", (-0.22, 0.0, 0.16), (0.08, 0.08, 0.04), (25, 25, 30)),
]


def _ondas(x, y):
    """Relieve base entre -0,85 y +0,85, suma de tres ondas suaves."""
    return (0.40 * np.sin(x / 4.0) * np.cos(y / 5.0)
            + 0.30 * np.sin((x + 0.7 * y) / 6.5 + 1.0)
            + 0.20 * np.cos((x - 1.3 * y) / 3.5))


def fondo(x, y):
    """Profundidad del fondo (m, positiva) en (x, y). Vale con arrays."""
    return FONDO_MEDIO - RELIEVE * _ondas(x, y)


def pendiente_fondo(x, y):
    """Derivadas (d fondo/dx, d fondo/dy), analíticas. Positiva = más hondo."""
    dodx = (0.10 * np.cos(x / 4.0) * np.cos(y / 5.0)
            + (0.30 / 6.5) * np.cos((x + 0.7 * y) / 6.5 + 1.0)
            - (0.20 / 3.5) * np.sin((x - 1.3 * y) / 3.5))
    dody = (-0.08 * np.sin(x / 4.0) * np.sin(y / 5.0)
            + (0.30 * 0.7 / 6.5) * np.cos((x + 0.7 * y) / 6.5 + 1.0)
            + (0.20 * 1.3 / 3.5) * np.sin((x - 1.3 * y) / 3.5))
    return -RELIEVE * dodx, -RELIEVE * dody


def _altura_objeto(o):
    """Cuánto sobresale del fondo un objeto (los cubos, dos radios de arista)."""
    return 2.0 * o["radio"]


# Ningún aro se clava en el fondo: como mínimo 0,3 m entre el tubo y la arena.
for _aro in AROS:
    _aro["z"] = min(_aro["z"], float(fondo(_aro["x"], _aro["y"])) - RADIO_ARO - GROSOR_ARO - 0.3)


class Mundo:
    def __init__(self):
        # Estado físico del submarino en el mundo.
        self.x = 0.0
        self.y = 0.0
        self.z = 0.0             # profundidad, m, positiva hacia abajo
        self.yaw = 0.0           # grados, brújula
        self.pitch = 0.0         # grados, morro arriba positivo
        self.roll = 0.0          # grados; sin propulsores laterales se queda en 0
        self.u = 0.0             # m/s hacia delante (ejes del cuerpo)
        self.w = 0.0             # m/s hacia abajo
        self.r = 0.0             # rad/s de guiñada, horario positivo
        self.q = 0.0             # rad/s de cabeceo, morro subiendo positivo
        self.acel = 0.0          # m/s² hacia delante, del último paso
        self.acel_w = 0.0        # m/s² hacia abajo, del último paso
        self.empuje = {"izquierda": 0.0, "derecha": 0.0, "proa": 0.0, "popa": 0.0}   # N reales
        self.consigna = {"izquierda": 0, "derecha": 0, "proa": 0, "popa": 0}         # -100..100
        self.bateria = 100.0
        self.colision = None     # con qué se choca, o None
        self.tiempo = 0.0        # segundos de simulación
        # Corriente: nivel y rumbo base (hacia dónde va el agua, brújula).
        self.corriente_nivel = "ninguno"
        self.corriente_rumbo = 0.0
        # Aros atravesados por el hueco, en el orden en que se pasaron.
        self.aros_pasados = []
        # "primera" = cámara de a bordo; "tercera" = desde fuera, detrás.
        self.vista = "primera"
        # Última lectura de la ecosonda (se refresca a ECOSONDA_PERIODO).
        self._ecosonda = None
        self._ecosonda_proximo = 0.0
        # Fotograma en caché para no renderizar más de FPS_CAMARA veces por segundo.
        self._fotograma = None
        self._fotograma_t = 0.0
        self._cerrojo = threading.Lock()
        self._fin = threading.Event()
        self._hilo = None

    # ---- lo que usa Hardware ----

    def arrancar(self):
        """Arranca el hilo de física. Idempotente."""
        if self._hilo is None or not self._hilo.is_alive():
            self._fin.clear()
            self._hilo = threading.Thread(target=self._bucle, daemon=True)
            self._hilo.start()

    def parar(self):
        self._fin.set()
        if self._hilo is not None:
            self._hilo.join(timeout=1.0)
            self._hilo = None

    def fijar_consigna(self, izquierda, derecha, proa, popa):
        with self._cerrojo:
            self.consigna = {"izquierda": izquierda, "derecha": derecha, "proa": proa, "popa": popa}

    def leer_bateria(self):
        with self._cerrojo:
            return self.bateria

    # ---- física ----

    def _bucle(self):
        siguiente = time.monotonic()
        while not self._fin.is_set():
            siguiente += PASO
            with self._cerrojo:
                self._paso(PASO)
            espera = siguiente - time.monotonic()
            if espera > 0:
                time.sleep(espera)
            else:
                siguiente = time.monotonic()   # el PC va lento: no acumular retraso

    def _paso(self, dt):
        """Un paso de simulación. Llamar con el cerrojo cogido."""
        self.tiempo += dt

        # Propulsores: el empuje sigue a la consigna con un retardo de primer
        # orden. Sin batería no hay empuje. El de popa rinde menos a propósito.
        factor = EMPUJE_MAX / 100.0 if self.bateria > 0 else 0.0
        for nombre in self.empuje:
            objetivo = self.consigna[nombre] * factor
            if nombre == "popa":
                objetivo *= RENDIMIENTO_POPA
            self.empuje[nombre] += (objetivo - self.empuje[nombre]) * dt / TAU_MOTOR
        t_izq, t_der = self.empuje["izquierda"], self.empuje["derecha"]
        t_proa, t_popa = self.empuje["proa"], self.empuje["popa"]

        # Avance: los dos horizontales empujan a lo largo del cuerpo; el agua
        # frena con el cuadrado de la velocidad.
        u_previa = self.u
        fuerza_u = t_izq + t_der - ARRASTRE_AVANCE * self.u * abs(self.u)
        self.u += fuerza_u / MASA_AVANCE * dt

        # Guiñada: la diferencia entre los horizontales gira el casco.
        # Izquierda más fuerte que derecha: gira a la derecha, como el rover.
        par_r = (t_izq - t_der) * SEPARACION / 2.0 - ARRASTRE_GUINADA * self.r * abs(self.r)
        self.r += par_r / INERCIA_GUINADA * dt
        self.yaw = (self.yaw + math.degrees(self.r * dt)) % 360.0

        # Vertical (positivo hacia abajo): los dos verticales contra la
        # flotabilidad sobrante y el arrastre.
        w_previa = self.w
        fuerza_w = t_proa + t_popa - FLOTABILIDAD - ARRASTRE_VERTICAL * self.w * abs(self.w)
        self.w += fuerza_w / MASA_VERTICAL * dt

        # Cabeceo: la diferencia entre proa y popa inclina el casco (más
        # empuje hacia abajo en proa = morro abajo) y el par adrizante del CB
        # sobre el CG lo devuelve a horizontal.
        p_rad = math.radians(self.pitch)
        par_q = (-(t_proa - t_popa) * BRAZO_VERTICAL
                 - ADRIZAMIENTO * math.sin(p_rad)
                 - ARRASTRE_CABECEO * self.q * abs(self.q))
        self.q += par_q / INERCIA_CABECEO * dt
        self.pitch += math.degrees(self.q * dt)

        # Posición nueva: el avance va a lo largo del cuerpo, así que con el
        # morro inclinado parte se convierte en vertical.
        rad = math.radians(self.yaw)
        p_rad = math.radians(self.pitch)
        horizontal = self.u * math.cos(p_rad)
        nx = self.x + horizontal * math.sin(rad) * dt
        ny = self.y + horizontal * math.cos(rad) * dt
        nz = self.z + (self.w - self.u * math.sin(p_rad)) * dt

        # Corriente: el agua entera se mueve. Como u y w son velocidades
        # respecto al agua (el arrastre ya es relativo a ella), la corriente
        # solo desplaza la posición.
        vel_c, rumbo_c = self._corriente_ahora()
        nx += vel_c * math.sin(rumbo_c) * dt
        ny += vel_c * math.cos(rumbo_c) * dt

        # Colisión horizontal con los objetos del fondo: solo si el casco está
        # a la altura del objeto y se está acercando. Si no, pasa por encima.
        self.colision = None
        for o in OBJETOS:
            minimo = o["radio"] + RADIO_SUB
            d_nueva = math.hypot(nx - o["x"], ny - o["y"])
            d_actual = math.hypot(self.x - o["x"], self.y - o["y"])
            techo = fondo(o["x"], o["y"]) - _altura_objeto(o)
            if d_nueva < minimo and d_nueva < d_actual and nz + RADIO_SUB > techo:
                self.colision = o["nombre"]
                break
        # Aros: al cruzar el plano de un aro, por el hueco cuenta como pasado
        # (en cualquier sentido); contra el tubo, choca. Al lado, nada.
        if self.colision is None:
            for aro in AROS:
                r_aro = math.radians(aro["rumbo"])
                ex, ey = math.sin(r_aro), math.cos(r_aro)          # eje del aro
                s_actual = (self.x - aro["x"]) * ex + (self.y - aro["y"]) * ey
                s_nueva = (nx - aro["x"]) * ex + (ny - aro["y"]) * ey
                if s_actual == s_nueva or (s_actual < 0) == (s_nueva < 0):
                    continue
                k = s_actual / (s_actual - s_nueva)                 # fracción del paso al cruzar
                cx_ = self.x + (nx - self.x) * k - aro["x"]
                cy_ = self.y + (ny - self.y) * k - aro["y"]
                lado = cx_ * ey - cy_ * ex                          # dentro del plano
                vert = self.z + (nz - self.z) * k - aro["z"]
                d = math.hypot(lado, vert)
                if d + RADIO_SUB < RADIO_ARO - GROSOR_ARO:
                    if aro["nombre"] not in self.aros_pasados:
                        self.aros_pasados.append(aro["nombre"])
                elif abs(d - RADIO_ARO) < GROSOR_ARO + RADIO_SUB:
                    self.colision = "aro " + aro["nombre"]
                    break
        if self.colision is None and (abs(nx) > LIMITE or abs(ny) > LIMITE):
            self.colision = "limite del mundo"
        if self.colision is None:
            self.x, self.y = nx, ny
        else:
            # Choca: no se desplaza y la IMU nota el frenazo.
            self.u = 0.0

        # Vertical: no sube de la superficie, no baja del fondo y se apoya
        # encima de un objeto si cae sobre él.
        tope = fondo(self.x, self.y) - RADIO_SUB
        for o in OBJETOS:
            if math.hypot(self.x - o["x"], self.y - o["y"]) < o["radio"] + RADIO_SUB:
                tope = min(tope, fondo(o["x"], o["y"]) - _altura_objeto(o) - RADIO_SUB)
        if nz >= tope:
            nz = tope
            if self.w > 0:
                self.w = 0.0
            if self.colision is None:
                self.colision = "fondo"
        if nz <= 0.0:
            nz = 0.0
            if self.w < 0:
                self.w = 0.0
        self.z = nz
        self.acel = (self.u - u_previa) / dt
        self.acel_w = (self.w - w_previa) / dt

        # Batería: proporcional a la potencia pedida a los cuatro.
        potencia = sum(abs(c) for c in self.consigna.values()) / 400.0
        self.bateria = max(0.0, self.bateria - 100.0 * potencia * dt / BATERIA_DURACION)

        # Ecosonda a 5 Hz.
        if self.tiempo >= self._ecosonda_proximo:
            self._ecosonda_proximo = self.tiempo + ECOSONDA_PERIODO
            distancia = float(fondo(self.x, self.y)) - self.z
            self._ecosonda = (distancia + random.gauss(0, RUIDO_ECOSONDA)
                              if distancia <= ECOSONDA_ALCANCE else None)

    def _corriente_ahora(self):
        """Velocidad (m/s) y rumbo (rad) de la corriente en este instante.
        Llamar con el cerrojo cogido."""
        base = CORRIENTES[self.corriente_nivel]
        if base == 0.0:
            return 0.0, 0.0
        vel = base * (1.0 + CORRIENTE_VAIVEN * math.sin(2 * math.pi * self.tiempo / CORRIENTE_PERIODO_VEL))
        rumbo = self.corriente_rumbo + CORRIENTE_GIRO * math.sin(2 * math.pi * self.tiempo / CORRIENTE_PERIODO_RUMBO)
        return vel, math.radians(rumbo)

    # ---- entrenamiento (solo simulador: corriente, aros y vista) ----

    def fijar_corriente(self, nivel):
        """Fija el nivel de corriente ("ninguno", "poco" o "mucho") con un
        rumbo nuevo al azar. Devuelve el bloque de entrenamiento."""
        if nivel not in CORRIENTES:
            raise ValueError("nivel de corriente desconocido: %r" % (nivel,))
        with self._cerrojo:
            self.corriente_nivel = nivel
            self.corriente_rumbo = random.uniform(0.0, 360.0)
        return self.entrenamiento()

    def reiniciar_aros(self):
        with self._cerrojo:
            self.aros_pasados = []
        return self.entrenamiento()

    def fijar_vista(self, vista):
        """"primera" (cámara de a bordo) o "tercera" (desde fuera)."""
        if vista not in ("primera", "tercera"):
            raise ValueError("vista desconocida: %r" % (vista,))
        with self._cerrojo:
            self.vista = vista
            self._fotograma = None
        return self.entrenamiento()

    def entrenamiento(self):
        """Corriente, aros, vista y pose real, para la interfaz. No existe en
        el submarino real. Incluye además "escena": todo lo estático (colores,
        terreno, objetos, modelo) que necesita el visor 3D del navegador para
        no tener que duplicar a mano esos números en JavaScript."""
        with self._cerrojo:
            vel, rumbo = self._corriente_ahora()
            pasados = list(self.aros_pasados)
            vista = self.vista
            x, y, z, yaw, pitch, roll = self.x, self.y, self.z, self.yaw, self.pitch, self.roll
        pendientes = [a["nombre"] for a in AROS if a["nombre"] not in pasados]
        return {
            "corriente": {
                "nivel": self.corriente_nivel,
                "velocidad": round(vel, 2),
                "rumbo": round(math.degrees(rumbo) % 360.0) if vel else None,
            },
            "aros": {
                "total": len(AROS),
                "pasados": pasados,
                "siguiente": pendientes[0] if pendientes else None,
                "lista": [{"nombre": a["nombre"], "color": list(a["color"]), "x": a["x"], "y": a["y"],
                           "rumbo": a["rumbo"], "profundidad": round(a["z"], 2),
                           "pasado": a["nombre"] in pasados}
                          for a in AROS],
            },
            "vista": vista,
            # Posición y actitud reales (sin ruido de sensor): es lo mismo que
            # ya usa internamente la cámara en tercera persona, expuesto aquí
            # para que el visor 3D del navegador pueda colocar la cámara y el
            # modelo. No existe en el submarino real (ahí no hay "posición
            # real", solo lo que miden los sensores).
            "sub": {"x": round(x, 3), "y": round(y, 3), "z": round(z, 3),
                    "yaw": round(yaw, 2), "pitch": round(pitch, 2), "roll": round(roll, 2)},
            "escena": {
                "limite": LIMITE, "fondo_medio": FONDO_MEDIO, "relieve": RELIEVE,
                "radio_aro": RADIO_ARO, "grosor_aro": GROSOR_ARO,
                "visibilidad": VISIBILIDAD, "fov": FOV, "ancho_junta": ANCHO_JUNTA,
                "altura_baldosa_pared": ALTURA_BALDOSA_PARED,
                "cam_tercera_atras": CAM_TERCERA_ATRAS, "cam_tercera_arriba": CAM_TERCERA_ARRIBA,
                "tierra_a": list(TIERRA_A), "tierra_b": list(TIERRA_B), "surco": list(SURCO),
                "pared_a": list(PARED_A), "pared_b": list(PARED_B), "junta": list(JUNTA),
                "agua_superficie": list(AGUA_SUPERFICIE), "agua_profunda": list(AGUA_PROFUNDA),
                "luz_superficie": list(LUZ_SUPERFICIE),
                "objetos": [{"nombre": o["nombre"], "tipo": o["tipo"], "x": o["x"], "y": o["y"],
                             "radio": o["radio"], "color": list(o["color"])} for o in OBJETOS],
                "modelo_sub": [{"nombre": n, "centro": list(c), "semiejes": list(s), "color": list(col)}
                               for n, c, s, col in MODELO_SUB],
            },
        }

    # ---- lo que usan los sensores ----

    def leer_imu(self):
        """Orientación, aceleración y giróscopo con ruido de sensor."""
        with self._cerrojo:
            yaw, pitch, roll = self.yaw, self.pitch, self.roll
            q, r, u = self.q, self.r, self.u
            acel, acel_w = self.acel, self.acel_w
        g = random.gauss
        p, ro = math.radians(pitch), math.radians(roll)
        return {
            "orientacion": {
                "roll": roll + g(0, RUIDO_ANGULO),
                "pitch": pitch + g(0, RUIDO_ANGULO),
                "yaw": (yaw + g(0, RUIDO_ANGULO)) % 360.0,
            },
            # Lo que mide un acelerómetro, en ejes del cuerpo: la aceleración
            # propia menos la gravedad. Con el morro arriba la gravedad se
            # cuela en x; en z queda casi 9,81, menos lo que acelere hacia abajo.
            "aceleracion": {
                "x": acel + GRAVEDAD * math.sin(p) + g(0, RUIDO_ACEL),
                "y": -u * r + GRAVEDAD * math.sin(ro) + g(0, RUIDO_ACEL),
                "z": (GRAVEDAD - acel_w) * math.cos(p) * math.cos(ro) + g(0, RUIDO_ACEL),
            },
            # Regla de la mano derecha con x adelante, y izquierda, z arriba:
            # y positivo = morro bajando; z positivo = girando a la izquierda.
            # El z lleva un sesgo fijo, como un giróscopo barato.
            "giroscopio": {
                "x": g(0, RUIDO_GIRO),
                "y": -math.degrees(q) + g(0, RUIDO_GIRO),
                "z": -math.degrees(r) + DERIVA_GIRO + g(0, RUIDO_GIRO),
            },
        }

    def leer_profundidad(self):
        """Sensor de presión (profundidad) y ecosonda (distancia al fondo)."""
        with self._cerrojo:
            z, eco = self.z, self._ecosonda
        return {
            "profundidad": max(0.0, z + random.gauss(0, RUIDO_PRESION)),
            "fondo": eco,      # None si la ecosonda no tiene eco todavía
        }

    def estado(self):
        """Estado real, sin ruido. Para pruebas y depuración, no va por HTTP."""
        with self._cerrojo:
            return {
                "x": self.x, "y": self.y, "z": self.z, "yaw": self.yaw,
                "pitch": self.pitch, "roll": self.roll,
                "u": self.u, "w": self.w, "r": self.r, "q": self.q,
                "fondo": float(fondo(self.x, self.y)),
                "empuje": dict(self.empuje),
                "colision": self.colision, "bateria": self.bateria, "tiempo": self.tiempo,
                "corriente": self.corriente_nivel, "aros_pasados": list(self.aros_pasados),
            }

    # ---- cámara ----

    def fotograma(self):
        """PNG de lo que ve la cámara, como mucho FPS_CAMARA veces por segundo."""
        ahora = time.monotonic()
        with self._cerrojo:
            if self._fotograma is not None and ahora - self._fotograma_t < 1.0 / FPS_CAMARA:
                return self._fotograma
            x, y, z, yaw, pitch, roll = self.x, self.y, self.z, self.yaw, self.pitch, self.roll
            vista = self.vista
        if vista == "tercera":
            # Cámara de seguimiento: detrás y por encima del submarino, mirando
            # a él (ni sale del agua ni se mete en la arena).
            rad = math.radians(yaw)
            cx = x - CAM_TERCERA_ATRAS * math.sin(rad)
            cy = y - CAM_TERCERA_ATRAS * math.cos(rad)
            cz = max(0.05, min(z - CAM_TERCERA_ARRIBA, float(fondo(cx, cy)) - 0.2))
            pitch_cam = -math.degrees(math.atan2(z - cz, CAM_TERCERA_ATRAS))
            img = self._renderizar(cx, cy, cz, yaw, pitch_cam, 0.0, sub=(x, y, z, yaw, pitch, roll))
        else:
            img = self._renderizar(x, y, z, yaw, pitch, roll)
        png = _png(img)
        with self._cerrojo:
            self._fotograma, self._fotograma_t = png, ahora
        return png

    def _renderizar(self, x, y, z, yaw, pitch, roll, sub=None):
        """Dibuja la vista desde la cámara: agua, brillo de la superficie,
        fondo de arena, objetos y aros, todo fundido con el agua según la
        distancia. Si `sub` es (x, y, z, yaw, pitch, roll) dibuja además el
        modelo del submarino ahí (vista en tercera persona).

        La cámara va solidaria al cuerpo: con el morro arriba el horizonte baja
        en la imagen, igual que en el horizonte artificial de la interfaz.
        """
        W, H = ANCHO_IMG, ALTO_IMG
        f = (W / 2.0) / math.tan(math.radians(FOV / 2.0))   # distancia focal en px
        rad = math.radians(yaw)
        sy, cy = math.sin(rad), math.cos(rad)
        cols_px = np.arange(W) - W / 2.0 + 0.5
        cols = cols_px / f                                   # tangente lateral
        filas = np.arange(H)[:, None]
        # Fila del horizonte en cada columna, ya inclinada por pitch y roll.
        hl = (H / 2.0 + f * math.tan(math.radians(pitch))
              - math.tan(math.radians(roll)) * cols_px)[None, :]

        # El agua es más clara cerca de la superficie y más oscura al fondo.
        agua = self._color_agua(z)

        # Por encima del horizonte, agua; al mirar hacia arriba se ve el brillo
        # de la superficie, más cuanto más cerca esté (rayo hasta el plano z=0).
        # El paso de agua a brillo es brusco: casi todo el brillo dentro de
        # VISIBILIDAD metros y casi nada más allá, en vez de un fundido largo.
        elevacion = (hl - filas) / f                         # tangente hacia arriba
        arriba = elevacion > 0.02
        dist_sup = np.where(arriba, max(z, 0.05) / np.maximum(elevacion, 0.02), DIST_MAX * 10)
        brillo = np.where(arriba, np.exp(-(dist_sup / VISIBILIDAD) ** AGUDEZA_SUPERFICIE), 0.0)[..., None]
        img = agua * (1 - brillo) + LUZ_SUPERFICIE * brillo

        # Fondo: por cada columna se lanza un rayo y se muestrea a distancias
        # crecientes; cada muestra se proyecta a una fila. Para cada píxel se
        # queda la muestra más cercana que llegue a esa fila.
        prof = PROF
        lateral = prof * cols[None, :]
        xw = x + prof * sy + lateral * cy
        yw = y + prof * cy - lateral * sy
        hondo = fondo(xw, yw)
        fila_m = hl + f * (hondo - z) / prof                 # (MUESTRAS, W)
        # Color de cada muestra: tierra en damero con surco más oscuro (el
        # fondo de la piscina de pruebas, a diferencia de las paredes va en
        # tierra), gris fuera del mundo (normalmente tapado por la pared),
        # sombreado por la pendiente y más oscuro cuanto más hondo, fundido
        # con el agua. Donde las muestras del rayo ya están más separadas que
        # el surco o el parche entero, se funde hacia el color medio
        # (AA_JUNTA/AA_LOSETA) para no dibujar un patrón que no se puede
        # resolver y que si no sale como ruido.
        par = (np.floor(xw) + np.floor(yw)) % 2
        color = np.where(par[..., None] == 0, TIERRA_A, TIERRA_B)
        color = color * AA_LOSETA + TIERRA_MEDIA * (1 - AA_LOSETA)
        fx, fy = xw - np.floor(xw), yw - np.floor(yw)
        surco = (np.minimum(fx, 1 - fx) < ANCHO_JUNTA) | (np.minimum(fy, 1 - fy) < ANCHO_JUNTA)
        color_surco = color * (1 - AA_JUNTA) + SURCO * AA_JUNTA
        color = np.where(surco[..., None], color_surco, color)
        fuera = (np.abs(xw) > LIMITE) | (np.abs(yw) > LIMITE)
        color = np.where(fuera[..., None], FUERA, color)
        gx, gy = pendiente_fondo(xw, yw)
        # La normal del fondo apunta hacia arriba: (d fondo/dx, d fondo/dy, 1).
        normal_luz = (gx * LUZ[0] + gy * LUZ[1] + LUZ[2]) / np.sqrt(gx * gx + gy * gy + 1.0)
        color = color * np.clip(0.45 + 0.65 * normal_luz, 0.3, 1.1)[..., None]
        color = color * np.clip(1.15 - 0.05 * hondo, 0.35, 1.0)[..., None]
        niebla = (1 - np.exp(-prof / VISIBILIDAD))[..., None]
        color = color * (1 - niebla) + agua * niebla
        techo = np.minimum.accumulate(fila_m, axis=0)
        indice = np.empty((H, W), np.intp)
        filas_1d = -np.arange(H, dtype=float)
        for c in range(W):
            indice[:, c] = np.searchsorted(-techo[:, c], filas_1d, side="left")
        hay = indice < MUESTRAS
        cc = np.broadcast_to(np.arange(W)[None, :], (H, W))
        img[hay] = color[indice[hay], cc[hay]]
        # Distancia (hacia delante) de lo dibujado en cada píxel, para que los
        # aros y el modelo del submarino queden tapados por lo que tengan
        # delante. Empieza con el fondo; los objetos la rellenan a grosso modo.
        prof_px = np.full((H, W), np.inf)
        prof_px[hay] = prof[indice[hay], 0]

        # Las cuatro paredes de la piscina, en el mismo LIMITE que ya paraba
        # al submarino: antes ahí no había nada que ver (el suelo seguía en
        # gris hasta donde alcanzara la vista), ahora hay un tanque cerrado.
        _pared(img, prof_px, filas, hl, cols, f, x, y, z, sy, cy, agua)

        # Objetos, de lejos a cerca. Apoyados en el fondo, fundidos con el
        # agua según la distancia (con 9 m de visibilidad se ven de cerca).
        vistos = []
        for o in OBJETOS:
            dx, dy = o["x"] - x, o["y"] - y
            adelante = dx * sy + dy * cy
            lado = dx * cy - dy * sy          # positivo a la derecha
            if adelante > 0.15:
                vistos.append((adelante, lado, o))
        for adelante, lado, o in sorted(vistos, key=lambda v: -v[0]):
            cx = W / 2.0 + f * lado / adelante
            r_px = f * o["radio"] / adelante
            if r_px < 0.5 or cx + r_px < 0 or cx - r_px > W:
                continue
            hl_c = float(hl[0, min(W - 1, max(0, int(cx)))])
            fondo_o = float(fondo(o["x"], o["y"]))
            fila_suelo = hl_c + f * (fondo_o - z) / adelante
            fog = 1 - math.exp(-adelante / VISIBILIDAD)
            oscuro = max(0.35, 1.15 - 0.05 * fondo_o)
            color_o = np.array(o["color"], float) * oscuro * (1 - fog) + agua * fog
            _sombra(img, cx, fila_suelo, r_px * 1.1, max(1.0, r_px * 0.22))
            if o["tipo"] == "cubo":
                fila_top = fila_suelo - f * 2 * o["radio"] / adelante
                _cubo(img, cx, fila_top, fila_suelo, r_px, color_o, lado / adelante)
            else:
                fila_top = fila_suelo - 2 * r_px
                _pelota(img, cx, fila_suelo - r_px, r_px, color_o)
            v = _ventana(img, cx - r_px, fila_top, cx + r_px, fila_suelo)
            if v is not None:
                x0, y0, x1, y1 = v
                prof_px[y0:y1, x0:x1] = np.minimum(prof_px[y0:y1, x0:x1], adelante)

        # Aros de entrenamiento, de lejos a cerca, con test de profundidad
        # píxel a píxel (un aro puede rodear la cámara o el submarino).
        pasados = self.aros_pasados
        cerca = []
        for aro in AROS:
            adelante = (aro["x"] - x) * sy + (aro["y"] - y) * cy
            if -RADIO_ARO - 0.5 < adelante < 3 * VISIBILIDAD:
                cerca.append((adelante, aro))
        for adelante, aro in sorted(cerca, key=lambda v: -v[0]):
            _aro(img, prof_px, filas, hl, cols, f, x, y, z, sy, cy, aro, agua,
                 aro["nombre"] in pasados)

        if sub is not None:
            _modelo_sub(img, prof_px, filas, hl, cols, f, x, y, z, sy, cy, sub, agua)

        return np.clip(img, 0, 255).astype(np.uint8)

    @staticmethod
    def _color_agua(z):
        t = min(1.0, max(0.0, z / FONDO_MEDIO))
        return AGUA_SUPERFICIE * (1 - t) + AGUA_PROFUNDA * t


# ---- primitivas de dibujo (trabajan sobre el array float, con recorte) ----

def _ventana(img, x0, y0, x1, y1):
    """Recorta un rectángulo a la imagen; devuelve índices o None si queda fuera."""
    H, W = img.shape[:2]
    x0, y0 = max(0, int(math.floor(x0))), max(0, int(math.floor(y0)))
    x1, y1 = min(W, int(math.ceil(x1)) + 1), min(H, int(math.ceil(y1)) + 1)
    if x0 >= x1 or y0 >= y1:
        return None
    return x0, y0, x1, y1


def _sombra(img, cx, cy, rx, ry):
    v = _ventana(img, cx - rx, cy - ry, cx + rx, cy + ry)
    if v is None:
        return
    x0, y0, x1, y1 = v
    yy, xx = np.mgrid[y0:y1, x0:x1]
    m = ((xx + 0.5 - cx) / rx) ** 2 + ((yy + 0.5 - cy) / ry) ** 2 <= 1
    img[y0:y1, x0:x1][m] *= 0.6


def _cubo(img, cx, fila_top, fila_suelo, r_px, color, desvio):
    """Cara frontal más una cara lateral más oscura, según a qué lado quede."""
    v = _ventana(img, cx - r_px, fila_top, cx + r_px, fila_suelo)
    if v is None:
        return
    x0, y0, x1, y1 = v
    img[y0:y1, x0:x1] = color
    ancho_lat = r_px * min(1.0, abs(desvio)) * 0.7
    if ancho_lat >= 1:
        if desvio > 0:   # el cubo está a la derecha: se ve su cara izquierda
            vl = _ventana(img, cx - r_px - ancho_lat, fila_top, cx - r_px, fila_suelo)
        else:
            vl = _ventana(img, cx + r_px, fila_top, cx + r_px + ancho_lat, fila_suelo)
        if vl is not None:
            lx0, ly0, lx1, ly1 = vl
            img[ly0:ly1, lx0:lx1] = color * 0.65
    img[y0:min(y1, y0 + 1), x0:x1] = np.minimum(255, color * 1.25)


def _pelota(img, cx, cy, r, color):
    v = _ventana(img, cx - r, cy - r, cx + r, cy + r)
    if v is None:
        return
    x0, y0, x1, y1 = v
    yy, xx = np.mgrid[y0:y1, x0:x1]
    u = (xx + 0.5 - cx) / r
    w = (yy + 0.5 - cy) / r
    m = u * u + w * w <= 1
    luz = np.clip(1.05 - 0.55 * np.sqrt((u + 0.45) ** 2 + (w + 0.45) ** 2), 0.3, 1.0)
    zona = img[y0:y1, x0:x1]
    zona[m] = (color[None, None, :] * luz[..., None])[m]


def _aro(img, prof_px, filas, hl, cols, f, x, y, z, sy, cy, aro, agua, pasado):
    """Aro vertical (toro fino) de RADIO_ARO en el plano perpendicular a su
    rumbo. Por columna se corta el rayo con el plano del aro; por píxel se
    mira si el punto de corte cae sobre el tubo. Escribe color y distancia."""
    r = math.radians(aro["rumbo"])
    nx, ny = math.sin(r), math.cos(r)                 # normal del plano (eje del aro)
    n_f = sy * nx + cy * ny                            # componente hacia delante
    n_l = cy * nx - sy * ny                            # componente lateral
    D = (aro["x"] - x) * nx + (aro["y"] - y) * ny
    with np.errstate(divide="ignore", invalid="ignore"):
        a = D / (n_f + cols * n_l)                     # distancia por columna (W,)
    valida = np.isfinite(a) & (a > DIST_MIN) & (a < DIST_MAX)
    if not valida.any():
        return
    a = np.where(valida, a, DIST_MAX)
    px = x + a * (sy + cols * cy) - aro["x"]           # punto de corte, relativo al aro
    py = y + a * (cy - cols * sy) - aro["y"]
    lado = px * ny - py * nx                           # coordenada en el plano del aro
    vert = z + a[None, :] * (filas - hl) / f - aro["z"]   # (H, W), + hacia abajo
    dist = np.sqrt(lado[None, :] ** 2 + vert ** 2)
    grosor = np.maximum(GROSOR_ARO, 1.2 * a / f)      # al menos ~1 px de ancho
    m = (np.abs(dist - RADIO_ARO) < grosor[None, :]) & valida[None, :] & (a[None, :] < prof_px)
    if not m.any():
        return
    color = np.array(aro["color"], float)
    if pasado:
        color = color * 0.4 + 90.0                     # gris apagado: ya está hecho
    oscuro = max(0.35, 1.15 - 0.05 * aro["z"])
    fog = 1 - np.exp(-a / VISIBILIDAD)                 # (W,)
    # Luz desde arriba: la parte alta del tubo más clara que la baja.
    luz = np.clip(1.0 - 0.3 * vert / RADIO_ARO, 0.6, 1.25)
    pix = (color[None, None, :] * oscuro * luz[..., None] * (1 - fog)[None, :, None]
           + agua * fog[None, :, None])
    img[m] = pix[m]
    prof_px[m] = np.broadcast_to(a[None, :], prof_px.shape)[m]


def _pared(img, prof_px, filas, hl, cols, f, x, y, z, sy, cy, agua):
    """Las cuatro paredes verticales de la piscina, en x = ±LIMITE e y = ±LIMITE
    (el mismo cuadrado que ya paraba al submarino). Por columna se calcula con
    qué pared se cruza el rayo (la primera de las dos que puede tocar según su
    dirección, como en un recorte de caja); se dibuja en baldosas desde la
    superficie hasta el suelo real de ese punto, con test de profundidad para
    no tapar nada que esté antes (suelo, objetos, aros)."""
    dirx = sy + cols * cy
    diry = cy - cols * sy
    inf = np.inf
    with np.errstate(divide="ignore", invalid="ignore"):
        a_mas_x = np.where(dirx > 1e-6, (LIMITE - x) / dirx, inf)
        a_men_x = np.where(dirx < -1e-6, (-LIMITE - x) / dirx, inf)
        a_mas_y = np.where(diry > 1e-6, (LIMITE - y) / diry, inf)
        a_men_y = np.where(diry < -1e-6, (-LIMITE - y) / diry, inf)
    a = np.minimum(np.minimum(a_mas_x, a_men_x), np.minimum(a_mas_y, a_men_y))   # (W,)
    valida = np.isfinite(a) & (a > DIST_MIN) & (a < DIST_MAX)
    if not valida.any():
        return
    a = np.where(valida, a, DIST_MAX)
    xw = x + a * dirx
    yw = y + a * diry
    # Coordenada a lo largo de la pared que se ha tocado, para las baldosas.
    en_x = np.abs(np.abs(xw) - LIMITE) < np.abs(np.abs(yw) - LIMITE)
    lo_largo = np.where(en_x, yw, xw)
    hondo = fondo(xw, yw)                                    # suelo al pie de la pared
    zp = z + a[None, :] * (filas - hl) / f                   # profundidad (m) de cada píxel
    dentro = ((zp >= 0.0) & (zp <= hondo[None, :]) & valida[None, :]
              & (a[None, :] < prof_px))
    if not dentro.any():
        return
    capa = np.floor(zp / ALTURA_BALDOSA_PARED)
    fila_larga = np.floor(lo_largo)[None, :]
    par = (capa + fila_larga) % 2
    color = np.where(par[..., None] == 0, PARED_A, PARED_B)
    fz = (zp / ALTURA_BALDOSA_PARED) % 1.0
    fl = (lo_largo[None, :] - fila_larga) % 1.0
    junta = (np.minimum(fz, 1 - fz) < ANCHO_JUNTA) | (np.minimum(fl, 1 - fl) < ANCHO_JUNTA)
    color = np.where(junta[..., None], JUNTA, color)
    oscuro = np.clip(1.15 - 0.05 * zp, 0.35, 1.0)
    fog = (1 - np.exp(-a / VISIBILIDAD))[None, :]
    pix = color * oscuro[..., None] * (1 - fog)[..., None] + agua * fog[..., None]
    img[dentro] = pix[dentro]
    prof_px[dentro] = np.broadcast_to(a[None, :], prof_px.shape)[dentro]


def _modelo_sub(img, prof_px, filas, hl, cols, f, x, y, z, sy, cy, sub, agua):
    """Modelo del submarino (MODELO_SUB) visto desde la cámara: cada pieza es un
    elipsoide en ejes del cuerpo; se cortan los rayos de los píxeles de su
    recuadro con cada elipsoide y se sombrea con la normal."""
    H, W = img.shape[:2]
    sx, sy_s, sz, yaw_s, pitch_s, roll_s = sub
    dx, dy = sx - x, sy_s - y
    adelante_c = dx * sy + dy * cy
    if adelante_c < 0.3:
        return
    lado_c = dx * cy - dy * sy
    col_c = W / 2.0 + f * lado_c / adelante_c
    hl_c = float(hl[0, min(W - 1, max(0, int(col_c)))])
    fila_c = hl_c + f * (sz - z) / adelante_c
    r_px = f * 0.6 / adelante_c * 1.15                 # el modelo cabe en 0,6 m
    v = _ventana(img, col_c - r_px, fila_c - r_px, col_c + r_px, fila_c + r_px)
    if v is None:
        return
    x0, y0, x1, y1 = v
    # Ejes del cuerpo en el mundo (z hacia abajo): adelante, izquierda, arriba.
    ys, p, ro = math.radians(yaw_s), math.radians(pitch_s), math.radians(roll_s)
    fwd = np.array([math.sin(ys) * math.cos(p), math.cos(ys) * math.cos(p), -math.sin(p)])
    izq0 = np.array([-math.cos(ys), math.sin(ys), 0.0])
    arr0 = np.array([-math.sin(ys) * math.sin(p), -math.cos(ys) * math.sin(p), -math.cos(p)])
    izq = izq0 * math.cos(ro) - arr0 * math.sin(ro)   # roll + = derecha abajo
    arr = arr0 * math.cos(ro) + izq0 * math.sin(ro)
    ejes = np.stack([fwd, izq, arr])                  # (3, 3): filas = ejes del cuerpo
    # Rayos de los píxeles del recuadro, con componente adelante = 1.
    l = cols[x0:x1][None, :]
    d = (filas[y0:y1] - hl[:, x0:x1]) / f
    dir_w = np.stack([np.broadcast_to(sy + l * cy, d.shape),
                      np.broadcast_to(cy - l * sy, d.shape), d], axis=-1)   # (h, w, 3)
    dir_b = dir_w @ ejes.T                            # en ejes del cuerpo
    cam = np.array([x, y, z])
    centro_sub = np.array([sx, sy_s, sz])
    luz_w = np.array([-0.35 * sy, -0.35 * cy, -1.0])
    luz_w /= np.linalg.norm(luz_w)
    zona = img[y0:y1, x0:x1]
    prof_zona = prof_px[y0:y1, x0:x1]
    for _, centro, semi, color in MODELO_SUB:
        c_w = centro_sub + ejes.T @ np.array(centro)
        o_b = ejes @ (cam - c_w)                      # origen del rayo en ejes del cuerpo
        semi = np.array(semi)
        o_e, d_e = o_b / semi, dir_b / semi
        A = np.sum(d_e * d_e, axis=-1)
        B = 2 * np.sum(d_e * o_e, axis=-1)
        C = float(np.sum(o_e * o_e)) - 1.0
        disc = B * B - 4 * A * C
        toca = disc >= 0
        if not toca.any():
            continue
        t = (-B - np.sqrt(np.where(toca, disc, 0.0))) / (2 * A)
        m = toca & (t > 0.05) & (t < prof_zona)
        if not m.any():
            continue
        golpe = o_b + t[..., None] * dir_b
        n_b = golpe / (semi * semi)
        n_b /= np.linalg.norm(n_b, axis=-1, keepdims=True) + 1e-9
        n_w = n_b @ ejes
        luz = 0.3 + 0.7 * np.clip(n_w @ luz_w, 0.0, 1.0)
        fog = 1 - np.exp(-t / VISIBILIDAD)
        pix = (np.array(color, float)[None, None, :] * luz[..., None] * (1 - fog)[..., None]
               + agua * fog[..., None])
        zona[m] = pix[m]
        prof_zona[m] = t[m]


def _png(img):
    """Codifica un array uint8 (alto, ancho, 3) como PNG con la librería estándar."""
    H, W = img.shape[:2]
    filas = np.concatenate([np.zeros((H, 1), np.uint8), img.reshape(H, W * 3)], axis=1).tobytes()

    def trozo(tipo, datos):
        return (struct.pack(">I", len(datos)) + tipo + datos
                + struct.pack(">I", zlib.crc32(tipo + datos) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + trozo(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
            + trozo(b"IDAT", zlib.compress(filas, 1))
            + trozo(b"IEND", b""))
