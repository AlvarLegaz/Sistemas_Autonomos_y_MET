"""Módulo de tiempo: la AUTORIDAD de hora del sistema (servidor SNTP, RFC 4330) y el cliente que se sincroniza con ella.

Hoy no hay NTP ni RTC en la Raspberry. Este módulo genera la hora (parte de la que fijemos nosotros, con `RelojAutonomo`, o de la del equipo) y la sirve por UDP.
El gateway de la maqueta y el SCADA piden la hora a este servidor SIEMPRE al arrancar y después cada cierto tiempo (`RelojSincronizado`). Hoy el servidor
corre en la misma Raspberry (127.0.0.1); en el futuro estará en otra máquina: basta cambiar la dirección del servidor de tiempo.

Servidor (el puerto 123 es el de NTP y en la Raspberry pide privilegios: con `sudo`, o con otro puerto):
    python modulo_tiempo.py servidor [--puerto 123] [--hora-inicial 2026-11-24T10:00:00Z] [--factor 1] [--reloj autonomo|sistema]
Consulta de prueba:
    python modulo_tiempo.py consultar 127.0.0.1 [--puerto 123]

Uso desde otro módulo:
    reloj = RelojSincronizado("127.0.0.1", 123)
    reloj.arrancar(periodo_s=60.0)       # sincroniza SIEMPRE al arrancar y luego cada 60 s
    reloj.ahora()                         # hora (segundos desde 1970 UTC) corregida; sigue funcionando aunque el servidor caiga
    reloj.sincronizado, reloj.estado()    # ¿la última sincronización es reciente?

Es un `Reloj` de `contrato_pct23.py`: se puede pasar tal cual como reloj del Controlador y del cliente SCADA.

Lo que no fija la especificación y hemos tenido que suponer va marcado «SUPUESTO».
"""
import argparse
import math
import signal
import socket
import struct
import sys
import threading
import time
from collections import deque

from contrato_pct23 import Reloj, RelojAutonomo, RelojSistema, iso_utc, parse_iso

EPOCA_NTP = 2208988800                 # segundos entre 1900-01-01 (época NTP) y 1970-01-01 (época Unix)
TAM_PAQUETE = 48
PUERTO_NTP = 123
LIMITE_PETICIONES_POR_S = 20           # SUPUESTO: más de 20 peticiones por segundo desde una misma dirección se ignoran
MAX_DIRECCIONES_RECORDADAS = 1024
UMBRAL_PASO_S = 0.5                    # salto de hora a partir del cual se anota como «paso»
PRECISION_LOG2 = -20                   # ≈ 1 µs
VERSIONES_ACEPTADAS = (3, 4)           # SUPUESTO: las versiones 1 y 2 de NTP son antiguas y se ignoran


class ErrorTiempo(Exception):
    """La consulta de hora no se pudo hacer o la respuesta no es válida."""


# -------------------------------------------------------------------------------------------------- época NTP ----
def a_ntp(epoch_s):
    """Segundos Unix (float) -> 8 bytes de marca NTP (32 bits de segundos desde 1900 + 32 de fracción). SUPUESTO: no se trata el cambio de era de 2036."""
    x = epoch_s + EPOCA_NTP
    segundos = math.floor(x)
    fraccion = min(int((x - segundos) * 4294967296.0), 0xFFFFFFFF)
    return struct.pack("!II", segundos & 0xFFFFFFFF, fraccion)


def de_ntp(marca):
    """8 bytes de marca NTP -> segundos Unix (float)."""
    segundos, fraccion = struct.unpack("!II", bytes(marca))
    return segundos - EPOCA_NTP + fraccion / 4294967296.0


# ---------------------------------------------------------------------------------------------------- servidor ----
class ServidorTiempo:
    """Servidor SNTP por UDP. La hora sale de `reloj.ahora()`. Nunca lanza excepción por un paquete malo: lo ignora y sigue."""

    def __init__(self, reloj, host="0.0.0.0", puerto=PUERTO_NTP, sincronizado=True, limite_por_s=LIMITE_PETICIONES_POR_S, mono=time.monotonic):
        self.reloj, self.host = reloj, host
        self.puerto = puerto                       # tras iniciar() es el puerto real (útil con puerto 0 en pruebas)
        self.sincronizado = sincronizado           # False -> avisa a los clientes (leap 3, estrato 16)
        self.limite_por_s = limite_por_s
        self._mono = mono
        self.atendidas = self.ignoradas = self.limitadas = 0
        self._recientes = {}                       # dirección -> instantes de sus últimas peticiones
        self._sock = None
        self._hilo = None
        self._parar = threading.Event()

    # --- ciclo de vida ---
    def iniciar(self):
        if self._hilo is not None:
            return
        self._parar.clear()
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.bind((self.host, self.puerto))
        except OSError:
            sock.close()
            raise
        sock.settimeout(0.2)
        self.puerto = sock.getsockname()[1]
        self._sock = sock
        self._hilo = threading.Thread(target=self._bucle, name="servidor_tiempo", daemon=True)
        self._hilo.start()

    def detener(self):
        self._parar.set()
        if self._hilo is not None:
            self._hilo.join(timeout=2.0)
            self._hilo = None
        if self._sock is not None:
            self._sock.close()
            self._sock = None

    # --- atención ---
    def _bucle(self):
        sock = self._sock
        while not self._parar.is_set():
            try:
                datos, direccion = sock.recvfrom(512)
            except socket.timeout:
                continue
            except OSError:                        # p. ej. WSAECONNRESET en Windows tras un ICMP de puerto cerrado, o socket cerrado al parar
                if self._parar.is_set():
                    return
                continue
            recibido = self.reloj.ahora()          # la marca de recepción se toma nada más recibir
            try:
                respuesta = self._atender(datos, direccion, recibido)
                if respuesta is not None:
                    sock.sendto(respuesta, direccion)
            except Exception:                      # noqa: BLE001 - el servidor de hora no puede caerse por un paquete malo
                self.ignoradas += 1

    def _permitir(self, direccion):
        """Límite simple de ritmo por dirección (ventana deslizante de 1 s)."""
        ahora = self._mono()
        ip = direccion[0]
        cola = self._recientes.get(ip)
        if cola is None:
            if len(self._recientes) >= MAX_DIRECCIONES_RECORDADAS:       # no crece sin límite ante muchas direcciones
                self._recientes = {k: v for k, v in self._recientes.items() if v and ahora - v[-1] < 1.0}
            cola = self._recientes[ip] = deque()
        while cola and ahora - cola[0] >= 1.0:
            cola.popleft()
        if len(cola) >= self.limite_por_s:
            return False
        cola.append(ahora)
        return True

    def _atender(self, datos, direccion, recibido):
        """-> bytes de la respuesta, o None si se ignora el paquete."""
        if len(datos) < TAM_PAQUETE:
            self.ignoradas += 1
            return None
        b0 = datos[0]
        version, modo = (b0 >> 3) & 7, b0 & 7
        if modo != 3 or version not in VERSIONES_ACEPTADAS:
            self.ignoradas += 1
            return None
        if not self._permitir(direccion):
            self.limitadas += 1
            return None
        self.atendidas += 1
        return self._respuesta(version, datos[2], datos[40:48], recibido)

    def _respuesta(self, version, poll, origen, recibido):
        sincronizado = self.sincronizado
        leap, estrato = (0, 1) if sincronizado else (3, 16)
        cabecera = struct.pack("!BBBb", (leap << 6) | (version << 3) | 4, estrato, poll, PRECISION_LOG2)
        return (cabecera + struct.pack("!II", 0, 0) + b"LOCL" + a_ntp(recibido) + origen + a_ntp(recibido) + a_ntp(self.reloj.ahora()))


# ----------------------------------------------------------------------------------------------------- cliente ----
def consultar_hora(host, puerto=PUERTO_NTP, timeout=1.0, reloj_local=time.time):
    """Una consulta SNTP. -> (offset_s, retardo_s) con las cuatro marcas t0 (envío local), t1 (recibido en el servidor), t2 (enviado por el servidor)
    y t3 (recibido local): offset = ((t1-t0)+(t2-t3))/2, retardo = (t3-t0)-(t2-t1). El offset es lo que hay que SUMAR a la hora local para tener la del servidor.
    `reloj_local` es un callable que da segundos (inyectable para pruebas). Lanza ErrorTiempo si hay timeout o la respuesta no es válida."""
    try:
        familia, tipo, proto, _, destino = socket.getaddrinfo(host, puerto, type=socket.SOCK_DGRAM)[0]
    except (OSError, IndexError) as e:
        raise ErrorTiempo(f"no se pudo resolver {host}:{puerto}: {e}") from e
    t0 = reloj_local()
    envio = a_ntp(t0)
    paquete = bytearray(TAM_PAQUETE)
    paquete[0] = (0 << 6) | (4 << 3) | 3                  # leap 0, versión 4, modo cliente
    paquete[40:48] = envio
    try:
        with socket.socket(familia, tipo, proto) as s:
            s.settimeout(timeout)
            s.connect(destino)                            # solo se aceptan respuestas de esa dirección
            s.send(bytes(paquete))
            datos = s.recv(512)
            t3 = reloj_local()
    except socket.timeout as e:
        raise ErrorTiempo(f"sin respuesta de {host}:{puerto} en {timeout:g} s") from e
    except OSError as e:
        raise ErrorTiempo(f"error de red con {host}:{puerto}: {e}") from e
    return _validar_respuesta(datos, envio, t0, t3)


def _validar_respuesta(datos, envio, t0, t3):
    if len(datos) < TAM_PAQUETE:
        raise ErrorTiempo("respuesta demasiado corta")
    b0, estrato = datos[0], datos[1]
    leap, modo = b0 >> 6, b0 & 7
    if modo != 4:
        raise ErrorTiempo(f"la respuesta no es de modo servidor (modo {modo})")
    if estrato == 0:
        raise ErrorTiempo(f"kiss-o'-death: {datos[12:16].decode('ascii', 'replace')!r}")
    if leap == 3 or estrato > 15:
        raise ErrorTiempo("el servidor de tiempo no está sincronizado")     # SUPUESTO: una hora que el propio servidor da por no fiable no se usa
    if bytes(datos[24:32]) != bytes(envio):
        raise ErrorTiempo("la respuesta no corresponde a la petición (origin distinto)")
    if bytes(datos[32:40]) == bytes(8) or bytes(datos[40:48]) == bytes(8):
        raise ErrorTiempo("la respuesta no trae marcas de tiempo")
    t1, t2 = de_ntp(datos[32:40]), de_ntp(datos[40:48])
    return ((t1 - t0) + (t2 - t3)) / 2.0, (t3 - t0) - (t2 - t1)


class RelojSincronizado(Reloj):
    """Reloj local MONOTÓNICO (no le afectan los saltos de la hora del equipo) con un desfase corregido por el servidor de tiempo."""

    def __init__(self, host="127.0.0.1", puerto=PUERTO_NTP, hora_inicial=None, timeout=1.0, periodo_s=60.0, mono=time.monotonic, consulta=None):
        self.host, self.puerto, self.timeout, self.periodo_s = host, puerto, timeout, float(periodo_s)
        self._mono = mono
        self._consulta = consulta or consultar_hora
        if isinstance(hora_inicial, str):
            hora_inicial = parse_iso(hora_inicial)
        self._base = time.time() if hora_inicial is None else float(hora_inicial)     # hora de partida: la del equipo o la dada
        self._mono0 = mono()
        self._offset = 0.0
        self._retardo = 0.0
        self._t_sync = None                        # instante monotónico de la última sincronización válida
        self.ultimo_salto_s = 0.0
        self.salto_inicial_s = 0.0
        self.sincronizaciones = 0
        self.fallos = 0
        self._lock = threading.Lock()
        self._hilo = None
        self._parar = threading.Event()

    def _local(self):
        """Reloj local sin corregir: parte de la hora de partida y avanza con el reloj monotónico."""
        return self._base + (self._mono() - self._mono0)

    def ahora(self):
        with self._lock:
            return self._local() + self._offset

    # --- sincronización ---
    def sincronizar(self, intentos=3):
        """Hace `intentos` consultas y se queda con la de MENOR retardo (la menos afectada por la red). -> True si alguna valió.
        Una consulta fallida no descoloca el reloj: conserva el último desfase. SUPUESTO: el desfase se aplica de golpe aunque el salto sea pequeño o grande;
        `ultimo_salto_s` guarda cuánto cambió la hora (si pasa de 0,5 s es un «paso»)."""
        medidas = []
        for _ in range(max(1, int(intentos))):
            try:
                medidas.append(self._consulta(self.host, self.puerto, self.timeout, self._local))
            except Exception:                      # noqa: BLE001 - ErrorTiempo, red, o cualquier fallo: no se descoloca el reloj
                self.fallos += 1
        if not medidas:
            return False
        offset, retardo = min(medidas, key=lambda m: m[1])
        with self._lock:
            self.ultimo_salto_s = offset - self._offset
            if self.sincronizaciones == 0:
                self.salto_inicial_s = self.ultimo_salto_s     # cuánto se movió la hora en la primera sincronización (el «paso» inicial)
            self._offset, self._retardo = offset, retardo
            self._t_sync = self._mono()
            self.sincronizaciones += 1
        return True

    @property
    def offset_s(self):
        return self._offset

    @property
    def retardo_s(self):
        return self._retardo

    @property
    def edad_s(self):
        """Segundos desde la última sincronización válida, o None si todavía no ha habido ninguna."""
        t = self._t_sync
        return None if t is None else self._mono() - t

    @property
    def sincronizado(self):
        """Ha habido una sincronización válida y la última no es más vieja que 3 periodos."""
        edad = self.edad_s
        return edad is not None and edad <= 3.0 * self.periodo_s

    def estado(self):
        edad = self.edad_s
        return {"synced": self.sincronizado, "offset_ms": round(self._offset * 1000.0, 3), "delay_ms": round(self._retardo * 1000.0, 3),
                "age_s": None if edad is None else round(edad, 3), "server": f"{self.host}:{self.puerto}"}

    # --- arranque y refresco periódico ---
    def arrancar(self, periodo_s=60.0, bloquear_hasta=10.0, reintento_s=5.0):
        """Sincroniza SIEMPRE al arrancar (reintenta cada 0,5 s hasta `bloquear_hasta` segundos) y después cada `periodo_s` en un hilo demonio. Si al arrancar no
        lo consigue, sigue y devuelve False: el hilo lo seguirá intentando cada `reintento_s` (5 s) hasta lograrlo. -> True si quedó sincronizado al arrancar."""
        self.detener()
        self.periodo_s = float(periodo_s)
        limite = time.monotonic() + max(0.0, float(bloquear_hasta))
        logrado = False
        while True:
            if self.sincronizar(intentos=1):
                logrado = self.sincronizar(intentos=3) or True       # afina con la mejor de 3 consultas
                break
            if time.monotonic() >= limite:
                break
            time.sleep(0.5)
        self._parar.clear()
        self._hilo = threading.Thread(target=self._bucle, args=(self.periodo_s, float(reintento_s), logrado), name="reloj_sincronizado", daemon=True)
        self._hilo.start()
        return logrado

    def _bucle(self, periodo, reintento, logrado):
        espera = periodo if logrado else reintento
        while not self._parar.wait(espera):
            try:
                espera = periodo if self.sincronizar() else reintento
            except Exception:                      # noqa: BLE001 - el hilo no debe morir nunca
                espera = reintento

    def detener(self):
        self._parar.set()
        if self._hilo is not None:
            self._hilo.join(timeout=3.0)
            self._hilo = None


# ----------------------------------------------------------------------------------------------------------- CLI ----
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="orden", required=True)
    s = sub.add_parser("servidor", help="arranca el servidor de tiempo")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--puerto", type=int, default=PUERTO_NTP, help="por defecto 123 (en la Raspberry pide sudo); puede ser otro")
    s.add_argument("--reloj", choices=("autonomo", "sistema"), default="autonomo", help="hora propia (por defecto) o la del equipo")
    s.add_argument("--hora-inicial", help="hora de partida del reloj autónomo en ISO UTC (por defecto, la del equipo al arrancar)")
    s.add_argument("--factor", type=float, default=1.0, help="aceleración del reloj autónomo (1 = tiempo real)")
    c = sub.add_parser("consultar", help="pide la hora a un servidor y muestra desfase y retardo")
    c.add_argument("host")
    c.add_argument("--puerto", type=int, default=PUERTO_NTP)
    args = ap.parse_args(argv)

    if args.orden == "consultar":
        offset, retardo = consultar_hora(args.host, args.puerto)
        print(f"desfase {offset * 1000:+.3f} ms · retardo {retardo * 1000:.3f} ms")
        return 0
    if args.reloj == "sistema":
        reloj = RelojSistema()
    else:
        inicio = args.hora_inicial or iso_utc(time.time())
        if parse_iso(inicio) is None:
            ap.error(f"--hora-inicial no es una fecha ISO válida: {inicio!r}")
        reloj = RelojAutonomo(inicio, factor=args.factor)
    servidor = ServidorTiempo(reloj, host=args.host, puerto=args.puerto)
    try:
        servidor.iniciar()
    except PermissionError:
        print(f"Sin permiso para usar el puerto {args.puerto}: el 123 pide privilegios (usa sudo) o elige otro con --puerto.", file=sys.stderr)
        return 2
    except OSError as e:
        print(f"No se pudo abrir {args.host}:{args.puerto}: {e}", file=sys.stderr)
        return 2
    print(f"Servidor de tiempo en {args.host}:{servidor.puerto} · hora {iso_utc(reloj.ahora())} ({type(reloj).__name__})")
    parar = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: parar.set())
    signal.signal(signal.SIGTERM, lambda *_: parar.set())
    parar.wait()
    servidor.detener()
    print(f"Servidor de tiempo parado ({servidor.atendidas} peticiones atendidas)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
