"""Mundo simulado del gemelo digital.

Aquí vive todo lo que en el rover real es el mundo físico: el terreno, los
objetos, la física del movimiento, la batería y lo que ven los sensores. Las
clases Hardware, IMU, GPS y Camara del simulador no saben nada de física: le
preguntan al mundo, igual que en el rover real le preguntarán al L298, al I2C
o a la UART.

Primer mundo: terreno de baldosas con ondulaciones suaves (para que el
horizonte artificial tenga algo que enseñar), cielo, unas montañas lejanas
fijas que sirven de referencia de rumbo, y cuatro objetos (dos cubos y dos
pelotas) con los que el rover choca y no puede avanzar.

Convenciones:
- Posición en metros: x hacia el este, y hacia el norte, z hacia arriba. El
  rover arranca en (0, 0) mirando al norte.
- yaw como una brújula: 0 norte, 90 este, crece en sentido horario.
- pitch positivo = morro arriba (subiendo una cuesta); roll positivo = lado
  derecho abajo. Misma convención que el horizonte artificial de la interfaz.
- Ejes del cuerpo para la IMU: x adelante, y izquierda, z arriba.
"""

import math
import random
import struct
import threading
import time
import zlib

import numpy as np

# ---- física ----
VELOCIDAD_MAX = 1.0      # m/s con consigna 100
ANCHO_VIA = 0.40         # m entre los dos lados del rover
TAU_MOTOR = 0.3          # s; los motores tardan en alcanzar la consigna
RADIO_ROVER = 0.20       # m; el rover se trata como un círculo
PASO = 0.02              # s por paso de simulación (50 Hz)
LIMITE = 25.0            # m; el mundo es el cuadrado ±LIMITE, no se sale
BATERIA_DURACION = 40 * 60   # s que dura la batería a plena potencia
GRAVEDAD = 9.81

# ---- sensores ----
RUIDO_ANGULO = 0.3       # grados, desviación típica en la orientación
RUIDO_ACEL = 0.05        # m/s^2
RUIDO_GIRO = 0.5         # grados/s
DERIVA_GIRO = 0.3        # grados/s de sesgo fijo en el giróscopo z
GPS_PERIODO = 1.0        # s entre lecturas de GPS
GPS_ERROR = 1.5          # m, desviación típica de la posición
GPS_TIEMPO_FIX = 5.0     # s hasta que el GPS consigue fix
# Origen del mundo: Cartagena (37°36'N 0°59'W). Altitud aproximada.
ORIGEN_LAT = 37.6000
ORIGEN_LON = -0.9833
ORIGEN_ALT = 10.0
METROS_POR_GRADO = 111320.0

# ---- cámara ----
ANCHO_IMG = 320
ALTO_IMG = 240
FOV = 70.0               # grados, campo de visión horizontal
ALTURA_CAMARA = 0.25     # m sobre el suelo
FPS_CAMARA = 10
NIEBLA = 45.0            # m; distancia a la que el suelo se funde con el cielo
# El suelo se dibuja lanzando un rayo por columna y muestreándolo a estas
# distancias (espaciado geométrico: denso cerca, ralo lejos).
DIST_MIN = 0.25
DIST_MAX = 80.0
MUESTRAS = 220
LUZ = np.array([-0.4, 0.3, 0.85]) / math.sqrt(0.4 ** 2 + 0.3 ** 2 + 0.85 ** 2)   # sol alto, al oeste
CIELO_ALTO = np.array([52, 110, 200], float)
CIELO_HORIZONTE = np.array([190, 215, 235], float)
MONTANA = np.array([120, 135, 160], float)
SUELO_A = np.array([168, 138, 96], float)
SUELO_B = np.array([154, 126, 86], float)
FUERA = np.array([110, 120, 110], float)   # suelo más allá del límite

# Los cuatro objetos: tipo, posición (x, y), radio de colisión y color.
# El cubo rojo está 4 m al norte, justo delante del rover al arrancar.
OBJETOS = [
    {"nombre": "cubo rojo", "tipo": "cubo", "x": 0.0, "y": 4.0, "radio": 0.4, "color": (210, 50, 45)},
    {"nombre": "pelota azul", "tipo": "pelota", "x": 5.0, "y": 6.0, "radio": 0.5, "color": (40, 90, 220)},
    {"nombre": "cubo amarillo", "tipo": "cubo", "x": -6.0, "y": 2.0, "radio": 0.4, "color": (235, 200, 40)},
    {"nombre": "pelota verde", "tipo": "pelota", "x": 3.0, "y": -5.0, "radio": 0.35, "color": (50, 180, 70)},
]


def altura(x, y):
    """Altura del terreno (m) en (x, y). Suma de ondas suaves: pendientes de
    unos 5° típicas y 11° como mucho. Vale con escalares y con arrays."""
    return (0.40 * np.sin(x / 4.0) * np.cos(y / 5.0)
            + 0.30 * np.sin((x + 0.7 * y) / 6.5 + 1.0)
            + 0.20 * np.cos((x - 1.3 * y) / 3.5))


def pendiente(x, y):
    """Derivadas parciales (dz/dx, dz/dy) de altura(), analíticas."""
    dzdx = (0.10 * np.cos(x / 4.0) * np.cos(y / 5.0)
            + (0.30 / 6.5) * np.cos((x + 0.7 * y) / 6.5 + 1.0)
            - (0.20 / 3.5) * np.sin((x - 1.3 * y) / 3.5))
    dzdy = (-0.08 * np.sin(x / 4.0) * np.sin(y / 5.0)
            + (0.30 * 0.7 / 6.5) * np.cos((x + 0.7 * y) / 6.5 + 1.0)
            + (0.20 * 1.3 / 3.5) * np.sin((x - 1.3 * y) / 3.5))
    return dzdx, dzdy


class Mundo:
    def __init__(self):
        # Estado físico del rover en el mundo.
        self.x = 0.0
        self.y = 0.0
        self.yaw = 0.0           # grados, brújula
        self.z = float(altura(0.0, 0.0))
        self.pitch = 0.0         # grados, morro arriba positivo; lo impone el terreno
        self.roll = 0.0          # grados, lado derecho abajo positivo
        self.vel_pitch = 0.0     # grados/s, para el giróscopo
        self.vel_roll = 0.0
        self.v_izq = 0.0         # m/s reales de cada lado
        self.v_der = 0.0
        self.acel = 0.0          # m/s^2 hacia delante, del último paso
        self._v_previa = 0.0     # velocidad del paso anterior, para la aceleración
        self.w = 0.0             # rad/s de giro, horario positivo
        self.consigna_izq = 0    # -100..100, lo que pide el hardware
        self.consigna_der = 0
        self.bateria = 100.0
        self.colision = None     # nombre del objeto con el que se choca, o None
        self.tiempo = 0.0        # segundos de simulación
        # Última lectura del GPS (se refresca a GPS_PERIODO).
        self._gps = {"lat": 0.0, "lon": 0.0, "alt": 0.0, "fix": False, "velocidad": 0.0, "rumbo": 0.0}
        self._gps_proximo = 0.0
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

    def fijar_consigna(self, izquierda, derecha):
        with self._cerrojo:
            self.consigna_izq = izquierda
            self.consigna_der = derecha

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

        # Motores: retardo de primer orden hacia la consigna. Sin batería no
        # hay empuje.
        factor = VELOCIDAD_MAX / 100.0 if self.bateria > 0 else 0.0
        obj_izq = self.consigna_izq * factor
        obj_der = self.consigna_der * factor
        self.v_izq += (obj_izq - self.v_izq) * dt / TAU_MOTOR
        self.v_der += (obj_der - self.v_der) * dt / TAU_MOTOR

        # Cinemática diferencial.
        v = (self.v_izq + self.v_der) / 2.0
        self.w = (self.v_izq - self.v_der) / ANCHO_VIA   # izquierda más rápida: gira a la derecha
        self.yaw = (self.yaw + math.degrees(self.w * dt)) % 360.0
        rad = math.radians(self.yaw)
        nx = self.x + v * math.sin(rad) * dt
        ny = self.y + v * math.cos(rad) * dt

        # Colisión: si la nueva posición se mete en un objeto (y no está
        # saliendo de él), el rover se queda donde está.
        self.colision = None
        for o in OBJETOS:
            minimo = o["radio"] + RADIO_ROVER
            d_nueva = math.hypot(nx - o["x"], ny - o["y"])
            d_actual = math.hypot(self.x - o["x"], self.y - o["y"])
            if d_nueva < minimo and d_nueva < d_actual:
                self.colision = o["nombre"]
                break
        if self.colision is None and (abs(nx) > LIMITE or abs(ny) > LIMITE):
            self.colision = "limite del mundo"
        if self.colision is None:
            self.x, self.y = nx, ny
        else:
            # Choca: las ruedas patinan y el rover no se desplaza. Para la IMU
            # su velocidad real es 0 y el frenazo se nota como aceleración.
            v = 0.0
        self.acel = (v - self._v_previa) / dt
        self._v_previa = v

        # Actitud: el rover se apoya en el terreno, así que pitch y roll son
        # la pendiente hacia delante y hacia el lado. Cuesta arriba, morro
        # arriba; terreno más bajo a la derecha, lado derecho abajo.
        self.z = float(altura(self.x, self.y))
        gx, gy = pendiente(self.x, self.y)
        adelante = gx * math.sin(rad) + gy * math.cos(rad)
        derecha = gx * math.cos(rad) - gy * math.sin(rad)
        pitch = math.degrees(math.atan(adelante))
        roll = math.degrees(math.atan(-derecha))
        self.vel_pitch = (pitch - self.pitch) / dt
        self.vel_roll = (roll - self.roll) / dt
        self.pitch, self.roll = pitch, roll

        # Batería: proporcional a la potencia pedida.
        potencia = (abs(self.consigna_izq) + abs(self.consigna_der)) / 200.0
        self.bateria = max(0.0, self.bateria - 100.0 * potencia * dt / BATERIA_DURACION)

        # GPS a 1 Hz, con fix a partir de GPS_TIEMPO_FIX.
        if self.tiempo >= self._gps_proximo:
            self._gps_proximo = self.tiempo + GPS_PERIODO
            self._actualizar_gps(v)

    def _actualizar_gps(self, v):
        if self.tiempo < GPS_TIEMPO_FIX:
            self._gps = {"lat": 0.0, "lon": 0.0, "alt": 0.0, "fix": False, "velocidad": 0.0, "rumbo": 0.0}
            return
        ex = random.gauss(0, GPS_ERROR)
        ey = random.gauss(0, GPS_ERROR)
        lat = ORIGEN_LAT + (self.y + ey) / METROS_POR_GRADO
        lon = ORIGEN_LON + (self.x + ex) / (METROS_POR_GRADO * math.cos(math.radians(ORIGEN_LAT)))
        # El rumbo GPS es el del movimiento: parado no tiene sentido y se
        # conserva el último, como hace un receptor real.
        rumbo = self.yaw if abs(v) > 0.05 else self._gps["rumbo"]
        self._gps = {
            "lat": lat, "lon": lon,
            "alt": ORIGEN_ALT + self.z + random.gauss(0, GPS_ERROR * 2),
            "fix": True,
            "velocidad": abs(v) + abs(random.gauss(0, 0.05)),
            "rumbo": rumbo,
        }

    # ---- lo que usan los sensores ----

    def leer_imu(self):
        """Orientación, aceleración y giróscopo con ruido de sensor."""
        with self._cerrojo:
            yaw, pitch, roll = self.yaw, self.pitch, self.roll
            vel_pitch, vel_roll = self.vel_pitch, self.vel_roll
            acel, w, v = self.acel, self.w, (self.v_izq + self.v_der) / 2.0
        g = random.gauss
        p, r = math.radians(pitch), math.radians(roll)
        return {
            "orientacion": {
                "roll": roll + g(0, RUIDO_ANGULO),
                "pitch": pitch + g(0, RUIDO_ANGULO),
                "yaw": (yaw + g(0, RUIDO_ANGULO)) % 360.0,
            },
            # Lo que mide un acelerómetro: la aceleración propia menos la
            # gravedad, en ejes del cuerpo. x adelante: aceleración lineal más
            # la componente de la gravedad al estar inclinado (morro arriba,
            # positiva). y izquierda: centrípeta al girar (a la derecha, es
            # negativa) más la de la gravedad con el roll. z arriba: casi 9,81
            # en reposo, algo menos cuanto más inclinado.
            "aceleracion": {
                "x": acel + GRAVEDAD * math.sin(p) + g(0, RUIDO_ACEL),
                "y": -v * w + GRAVEDAD * math.sin(r) + g(0, RUIDO_ACEL),
                "z": GRAVEDAD * math.cos(p) * math.cos(r) + g(0, RUIDO_ACEL),
            },
            # Regla de la mano derecha con x adelante, y izquierda, z arriba:
            # x positivo = lado derecho bajando (roll creciendo); y positivo =
            # morro bajando (pitch decreciendo); z positivo = girando a la
            # izquierda (yaw de brújula decreciendo). El z lleva un sesgo
            # fijo, como un giróscopo barato.
            "giroscopio": {
                "x": vel_roll + g(0, RUIDO_GIRO),
                "y": -vel_pitch + g(0, RUIDO_GIRO),
                "z": -math.degrees(w) + DERIVA_GIRO + g(0, RUIDO_GIRO),
            },
        }

    def leer_gps(self):
        with self._cerrojo:
            return dict(self._gps)

    def estado(self):
        """Estado real, sin ruido. Para pruebas y depuración, no va por HTTP."""
        with self._cerrojo:
            return {
                "x": self.x, "y": self.y, "z": self.z, "yaw": self.yaw,
                "pitch": self.pitch, "roll": self.roll,
                "v": (self.v_izq + self.v_der) / 2.0, "w": self.w,
                "colision": self.colision, "bateria": self.bateria, "tiempo": self.tiempo,
            }

    # ---- cámara ----

    def fotograma(self):
        """PNG de lo que ve la cámara, como mucho FPS_CAMARA veces por segundo."""
        ahora = time.monotonic()
        with self._cerrojo:
            if self._fotograma is not None and ahora - self._fotograma_t < 1.0 / FPS_CAMARA:
                return self._fotograma
            x, y, yaw, pitch, roll = self.x, self.y, self.yaw, self.pitch, self.roll
        img = self._renderizar(x, y, yaw, pitch, roll)
        png = _png(img)
        with self._cerrojo:
            self._fotograma, self._fotograma_t = png, ahora
        return png

    def _renderizar(self, x, y, yaw, pitch, roll):
        """Dibuja la vista desde la cámara: cielo, montañas, terreno y objetos.

        La cámara va solidaria al cuerpo: con el morro arriba el horizonte baja
        en la imagen, y con el lado derecho abajo el horizonte sube por la
        derecha, igual que en el horizonte artificial de la interfaz.
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

        # Cielo: degradado de azul arriba a casi blanco en el horizonte.
        t = np.clip((hl - filas) / (H / 2.0), 0.0, 1.0)[..., None]
        img = CIELO_HORIZONTE * (1 - t) + CIELO_ALTO * t

        # Montañas lejanas: una silueta fija en función del rumbo de cada
        # columna. No se acercan nunca; sirven para saber hacia dónde se mira.
        angulo = np.radians(yaw) + np.arctan(cols)
        cresta = 10 + 7 * np.sin(3 * angulo) + 5 * np.sin(7 * angulo + 1.0) + 3 * np.sin(13 * angulo + 2.0)
        img[(filas >= hl - cresta[None, :]) & (filas < hl + 2)] = MONTANA

        # Terreno: por cada columna se lanza un rayo y se muestrea a distancias
        # crecientes; cada muestra se proyecta a una fila. Para cada píxel se
        # queda la muestra más cercana que llegue a esa fila (así las lomas de
        # delante tapan lo de detrás).
        z_cam = float(altura(x, y)) + ALTURA_CAMARA
        prof = (DIST_MIN * (DIST_MAX / DIST_MIN) ** (np.arange(MUESTRAS) / (MUESTRAS - 1)))[:, None]
        lateral = prof * cols[None, :]
        xw = x + prof * sy + lateral * cy
        yw = y + prof * cy - lateral * sy
        z = altura(xw, yw)
        fila_m = hl + f * (z_cam - z) / prof                 # (MUESTRAS, W)
        # Color de cada muestra: baldosas, gris fuera del mundo, sombreado por
        # la pendiente (es lo que hace visibles las lomas) y niebla.
        par = (np.floor(xw) + np.floor(yw)) % 2
        color = np.where(par[..., None] == 0, SUELO_A, SUELO_B)
        fuera = (np.abs(xw) > LIMITE) | (np.abs(yw) > LIMITE)
        color = np.where(fuera[..., None], FUERA, color)
        gx, gy = pendiente(xw, yw)
        normal_luz = (-gx * LUZ[0] - gy * LUZ[1] + LUZ[2]) / np.sqrt(gx * gx + gy * gy + 1.0)
        color = color * np.clip(0.45 + 0.65 * normal_luz, 0.3, 1.1)[..., None]
        niebla = (1 - np.exp(-prof / NIEBLA))[..., None]
        color = color * (1 - niebla) + CIELO_HORIZONTE * niebla
        # La muestra visible en la fila r es la primera cuyo mínimo acumulado
        # de fila ha llegado a r (las filas van subiendo con la distancia).
        techo = np.minimum.accumulate(fila_m, axis=0)
        indice = np.empty((H, W), np.intp)
        filas_1d = -np.arange(H, dtype=float)
        for c in range(W):
            indice[:, c] = np.searchsorted(-techo[:, c], filas_1d, side="left")
        hay = indice < MUESTRAS
        cc = np.broadcast_to(np.arange(W)[None, :], (H, W))
        img[hay] = color[indice[hay], cc[hay]]

        # Objetos, de lejos a cerca para que los cercanos tapen a los lejanos.
        # Se apoyan en el terreno; no se ocultan tras las lomas (son bajas).
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
            z_obj = float(altura(o["x"], o["y"]))
            fila_suelo = hl_c + f * (z_cam - z_obj) / adelante
            fog = 1 - math.exp(-adelante / NIEBLA)
            color_o = np.array(o["color"], float) * (1 - fog) + CIELO_HORIZONTE * fog
            _sombra(img, cx, fila_suelo, r_px * 1.1, max(1.0, r_px * 0.22))
            if o["tipo"] == "cubo":
                fila_top = fila_suelo - f * 2 * o["radio"] / adelante
                _cubo(img, cx, fila_top, fila_suelo, r_px, color_o, lado / adelante)
            else:
                _pelota(img, cx, fila_suelo - r_px, r_px, color_o)

        return np.clip(img, 0, 255).astype(np.uint8)


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
    # Cara lateral visible: en el lado que mira al centro de la imagen.
    ancho_lat = r_px * min(1.0, abs(desvio)) * 0.7
    if ancho_lat >= 1:
        if desvio > 0:   # el cubo está a la derecha: se ve su cara izquierda
            vl = _ventana(img, cx - r_px - ancho_lat, fila_top, cx - r_px, fila_suelo)
        else:
            vl = _ventana(img, cx + r_px, fila_top, cx + r_px + ancho_lat, fila_suelo)
        if vl is not None:
            lx0, ly0, lx1, ly1 = vl
            img[ly0:ly1, lx0:lx1] = color * 0.65
    # Arista superior un poco más clara.
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
    # Sombreado: más claro arriba a la izquierda, como con una luz alta.
    luz = np.clip(1.05 - 0.55 * np.sqrt((u + 0.45) ** 2 + (w + 0.45) ** 2), 0.3, 1.0)
    zona = img[y0:y1, x0:x1]
    zona[m] = (color[None, None, :] * luz[..., None])[m]


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
