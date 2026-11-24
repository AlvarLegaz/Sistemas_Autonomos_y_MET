"""Pruebas del módulo de tiempo (servidor SNTP, consulta y reloj sincronizado) con UDP real en 127.0.0.1.

    python -m pytest test_modulo_tiempo.py -q        (desde gateway_industrial_excelencia)
"""
import socket
import struct
import threading
import time

import pytest

import modulo_tiempo as mt
from contrato_pct23 import Reloj, RelojAutonomo, iso_utc
from modulo_tiempo import ErrorTiempo, RelojSincronizado, ServidorTiempo, a_ntp, consultar_hora, de_ntp


class RelojDesfasado(Reloj):
    """Hora del equipo más un desfase fijo (el «servidor adelantado»)."""
    def __init__(self, desfase_s):
        self.desfase_s = desfase_s

    def ahora(self):
        return time.time() + self.desfase_s


class MonoFalso:
    """Reloj monotónico controlado a mano."""
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def servidor(desfase_s=0.0, **kw):
    s = ServidorTiempo(RelojDesfasado(desfase_s), host="127.0.0.1", puerto=kw.pop("puerto", 0), **kw)
    s.iniciar()
    return s


@pytest.fixture
def srv():
    s = servidor(5.0)
    yield s
    s.detener()


def peticion(version=4, modo=3, transmit=None, tam=48):
    p = bytearray(tam)
    if tam:
        p[0] = (0 << 6) | (version << 3) | modo
    if tam >= 48:
        p[40:48] = transmit if transmit is not None else a_ntp(time.time())
    return bytes(p)


def pregunta_cruda(puerto, datos, timeout=0.4):
    """Manda un paquete tal cual y devuelve la respuesta (o None si no hay)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(timeout)
        s.sendto(datos, ("127.0.0.1", puerto))
        try:
            return s.recv(512)
        except (socket.timeout, OSError):
            return None


class ServidorFalso:
    """UDP que contesta lo que diga `fabricar(peticion) -> bytes | None`."""
    def __init__(self, fabricar):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.2)
        self.puerto = self.sock.getsockname()[1]
        self.fabricar, self.parar = fabricar, threading.Event()
        self.hilo = threading.Thread(target=self._bucle, daemon=True)
        self.hilo.start()

    def _bucle(self):
        while not self.parar.is_set():
            try:
                datos, dir_ = self.sock.recvfrom(512)
            except (socket.timeout, OSError):
                continue
            r = self.fabricar(datos)
            if r is not None:
                self.sock.sendto(r, dir_)

    def cerrar(self):
        self.parar.set()
        self.hilo.join(timeout=1)
        self.sock.close()


def respuesta(origen, estrato=2, modo=4, leap=0, ref=b"GPS\0", t1=None, t2=None):
    ahora = time.time()
    cab = struct.pack("!BBBb", (leap << 6) | (4 << 3) | modo, estrato, 6, -20)
    return cab + struct.pack("!II", 0, 0) + ref + a_ntp(ahora) + origen + a_ntp(t1 if t1 is not None else ahora) + a_ntp(t2 if t2 is not None else ahora)


# ---------------------------------------------------------------------------------------------------- época NTP ----
def test_conversion_de_epoca_ntp_ida_y_vuelta():
    for t in (0.0, 1.5, 1700000000.123456, 1795000000.999999, time.time()):
        assert abs(de_ntp(a_ntp(t)) - t) < 1e-6, t
    seg, frac = struct.unpack("!II", a_ntp(0.0)); assert (seg, frac) == (2208988800, 0)
    seg, frac = struct.unpack("!II", a_ntp(10.5)); assert (seg, frac) == (2208988810, 0x80000000)
    assert len(a_ntp(123.0)) == 8


# --------------------------------------------------------------------------------------------- servidor y cliente ----
@pytest.mark.parametrize("desfase", [5.0, 3600.0, -90.0])
def test_ida_y_vuelta_mide_el_desfase_real(desfase):
    s = servidor(desfase)
    try:
        offset, retardo = consultar_hora("127.0.0.1", s.puerto)
        assert abs(offset - desfase) < 0.05, (offset, desfase)
        assert -0.05 < retardo < 0.5
        assert s.atendidas == 1
    finally:
        s.detener()


def test_formato_de_la_respuesta(srv):
    origen = a_ntp(1234567890.25)
    r = pregunta_cruda(srv.puerto, peticion(version=4, transmit=origen))
    assert r is not None and len(r) == 48
    b0 = r[0]
    assert (b0 >> 6, (b0 >> 3) & 7, b0 & 7) == (0, 4, 4)           # leap 0, versión copiada, modo servidor
    assert r[1] == 1                                                # estrato 1
    assert r[12:16] == b"LOCL"
    assert r[24:32] == origen                                       # origin = el transmit del cliente
    assert abs(de_ntp(r[40:48]) - (time.time() + 5.0)) < 0.5       # transmit con la hora del servidor
    assert abs(de_ntp(r[32:40]) - (time.time() + 5.0)) < 0.5


def test_copia_la_version_del_cliente(srv):
    assert (pregunta_cruda(srv.puerto, peticion(version=3))[0] >> 3) & 7 == 3
    assert pregunta_cruda(srv.puerto, peticion(version=2)) is None   # SUPUESTO: v1 y v2 se ignoran


def test_basura_y_paquetes_cortos_se_ignoran_sin_caerse(srv):
    malos = [b"", b"x", b"hola" * 3, bytes(47), peticion(modo=4), peticion(modo=1), peticion(modo=5), peticion(version=7), bytes(range(48)), b"\xff" * 100, bytes(1000)]
    for datos in malos:
        assert pregunta_cruda(srv.puerto, datos, timeout=0.15) is None, datos[:8]
    # tras la basura sigue respondiendo
    offset, _ = consultar_hora("127.0.0.1", srv.puerto)
    assert abs(offset - 5.0) < 0.05
    assert srv.ignoradas >= 8


def test_timeout_sin_servidor():
    mudo = ServidorFalso(lambda p: None)
    try:
        with pytest.raises(ErrorTiempo, match="sin respuesta"):
            consultar_hora("127.0.0.1", mudo.puerto, timeout=0.2)
    finally:
        mudo.cerrar()


def test_respuesta_con_origin_falso_se_rechaza():
    f = ServidorFalso(lambda p: respuesta(a_ntp(42.0)))
    try:
        with pytest.raises(ErrorTiempo, match="origin"):
            consultar_hora("127.0.0.1", f.puerto, timeout=0.5)
    finally:
        f.cerrar()


def test_kiss_o_death_se_rechaza():
    f = ServidorFalso(lambda p: respuesta(p[40:48], estrato=0, ref=b"DENY"))
    try:
        with pytest.raises(ErrorTiempo, match="kiss-o'-death.*DENY"):
            consultar_hora("127.0.0.1", f.puerto, timeout=0.5)
    finally:
        f.cerrar()


def test_otras_respuestas_invalidas_se_rechazan():
    casos = {"modo": lambda p: respuesta(p[40:48], modo=3), "corta": lambda p: respuesta(p[40:48])[:30],
             "sin_sincronizar": lambda p: respuesta(p[40:48], leap=3), "estrato_16": lambda p: respuesta(p[40:48], estrato=16),
             "transmit_cero": lambda p: respuesta(p[40:48])[:40] + bytes(8)}
    for nombre, fab in casos.items():
        f = ServidorFalso(fab)
        try:
            with pytest.raises(ErrorTiempo):
                consultar_hora("127.0.0.1", f.puerto, timeout=0.5)
        finally:
            f.cerrar()


def test_servidor_sin_sincronizar_avisa_con_leap_3_y_el_cliente_lo_rechaza():
    s = servidor(0.0, sincronizado=False)
    try:
        r = pregunta_cruda(s.puerto, peticion())
        assert (r[0] >> 6, r[1]) == (3, 16)
        with pytest.raises(ErrorTiempo, match="no está sincronizado"):
            consultar_hora("127.0.0.1", s.puerto)
        s.sincronizado = True
        assert abs(consultar_hora("127.0.0.1", s.puerto)[0]) < 0.05
    finally:
        s.detener()


def test_limite_de_ritmo_por_direccion():
    s = servidor(0.0, limite_por_s=20)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as c:
            c.settimeout(0.5)
            for _ in range(40):
                c.sendto(peticion(), ("127.0.0.1", s.puerto))
            recibidas = 0
            try:
                while True:
                    c.recv(512)
                    recibidas += 1
            except (socket.timeout, OSError):
                pass
        assert recibidas <= 20, recibidas
        assert s.limitadas >= 15, s.limitadas
        assert s.atendidas + s.limitadas == 40
    finally:
        s.detener()


def test_limite_de_ritmo_con_reloj_inyectado_la_ventana_se_libera():
    mono = MonoFalso()
    s = ServidorTiempo(RelojDesfasado(0.0), host="127.0.0.1", puerto=0, limite_por_s=3, mono=mono)
    dir_ = ("10.0.0.9", 5555)
    assert [s._permitir(dir_) for _ in range(5)] == [True, True, True, False, False]
    mono.t += 1.01
    assert s._permitir(dir_) is True                                 # pasó más de 1 s: otra vez cabe
    assert s._permitir(("10.0.0.10", 1)) is True                    # otra dirección no se ve afectada


def test_el_servidor_se_puede_parar_y_arrancar_en_el_mismo_puerto():
    s = servidor(0.0)
    puerto = s.puerto
    s.detener()
    s2 = servidor(10.0, puerto=puerto)
    try:
        assert s2.puerto == puerto and abs(consultar_hora("127.0.0.1", puerto)[0] - 10.0) < 0.05
    finally:
        s2.detener()


def test_puerto_ocupado_lanza_oserror():
    s = servidor(0.0)
    try:
        otro = ServidorTiempo(RelojDesfasado(0.0), host="127.0.0.1", puerto=s.puerto)
        with pytest.raises(OSError):
            otro.iniciar()
    finally:
        s.detener()


# ------------------------------------------------------------------------------------------------ RelojSincronizado ----
def test_sincroniza_al_arrancar_y_estado():
    s = servidor(3600.0)
    r = RelojSincronizado("127.0.0.1", s.puerto)
    try:
        assert r.sincronizado is False and r.edad_s is None
        assert abs(r.ahora() - time.time()) < 0.5                   # antes de sincronizar usa la hora de partida (la del equipo): nada falla
        assert r.arrancar(periodo_s=60.0, bloquear_hasta=3.0) is True
        assert r.sincronizado is True
        assert abs(r.ahora() - (time.time() + 3600.0)) < 0.1
        assert abs(r.salto_inicial_s - 3600.0) < 0.1                # el primer ajuste es un «paso» grande
        assert abs(r.ultimo_salto_s) < 0.1                          # y la afinación con 3 consultas ya casi no mueve la hora
        e = r.estado()
        assert set(e) == {"synced", "offset_ms", "delay_ms", "age_s", "server"}
        assert e["synced"] is True and e["server"] == f"127.0.0.1:{s.puerto}" and abs(e["offset_ms"] - 3600000.0) < 100 and e["age_s"] < 2
        assert s.atendidas >= 4                                     # 1 + 3 consultas (la de menor retardo)
    finally:
        r.detener(); s.detener()


def test_vuelve_a_sincronizar_cada_periodo():
    s = servidor(1.0)
    r = RelojSincronizado("127.0.0.1", s.puerto)
    try:
        assert r.arrancar(periodo_s=0.2, bloquear_hasta=3.0)
        n0 = r.sincronizaciones
        time.sleep(0.9)
        assert r.sincronizaciones >= n0 + 3, (r.sincronizaciones, n0)
        assert r.edad_s < 0.6 and r.sincronizado
    finally:
        r.detener(); s.detener()


def test_sobrevive_a_que_el_servidor_caiga_y_vuelva():
    s = servidor(2.0)
    puerto = s.puerto
    r = RelojSincronizado("127.0.0.1", puerto, timeout=0.15)
    s2 = None
    try:
        assert r.arrancar(periodo_s=0.2, bloquear_hasta=3.0, reintento_s=0.2)
        s.detener()                                                 # cae el servidor
        antes = r.ahora()
        time.sleep(1.0)
        assert r.fallos > 0
        assert r.ahora() > antes + 0.8                              # el reloj sigue corriendo con el último desfase
        assert abs(r.offset_s - 2.0) < 0.1                          # y no se ha descolocado
        assert r.sincronizado is False                              # la última sincronización ya es más vieja que 3 periodos
        s2 = servidor(10.0, puerto=puerto)                          # vuelve (con otra hora)
        t0 = time.time()
        while time.time() - t0 < 4 and not (r.sincronizado and abs(r.offset_s - 10.0) < 0.2):
            time.sleep(0.05)
        assert r.sincronizado and abs(r.offset_s - 10.0) < 0.2
    finally:
        r.detener(); s.detener()
        if s2:
            s2.detener()


def test_sincronizado_pasa_a_false_cuando_la_ultima_es_demasiado_vieja():
    mono = MonoFalso()
    s = servidor(0.5)
    r = RelojSincronizado("127.0.0.1", s.puerto, periodo_s=10.0, mono=mono)
    try:
        assert r.sincronizar() is True and r.sincronizado is True and r.edad_s == 0.0
        mono.t += 29.9; assert r.sincronizado is True               # hasta 3 × periodo
        mono.t += 0.2; assert r.sincronizado is False
        assert abs(r.edad_s - 30.1) < 1e-6
        assert r.estado()["synced"] is False
        assert r.sincronizar() is True and r.sincronizado is True   # una nueva sincronización lo recupera
    finally:
        s.detener()


def test_una_consulta_fallida_no_descoloca_el_reloj():
    mono = MonoFalso()
    s = servidor(7.0)
    r = RelojSincronizado("127.0.0.1", s.puerto, timeout=0.15, mono=mono)
    try:
        assert r.sincronizar(intentos=1)
        offset = r.offset_s
        s.detener()
        assert r.sincronizar(intentos=2) is False
        assert r.offset_s == offset and r.fallos >= 2
    finally:
        s.detener()


def test_se_queda_con_la_consulta_de_menor_retardo():
    llamadas = []
    resultados = iter([(5.0, 0.300), (4.0, 0.010), (6.0, 0.200)])

    def consulta(host, puerto, timeout, reloj_local):
        llamadas.append((host, puerto))
        return next(resultados)

    r = RelojSincronizado("srv", 9999, consulta=consulta)
    assert r.sincronizar(intentos=3) is True
    assert (r.offset_s, r.retardo_s) == (4.0, 0.010) and len(llamadas) == 3 and llamadas[0] == ("srv", 9999)
    assert r.estado()["delay_ms"] == 10.0


def test_no_se_deja_llevar_por_un_salto_de_la_hora_del_equipo(monkeypatch):
    s = ServidorTiempo(RelojAutonomo(iso_utc(time.time() + 3600.0)), host="127.0.0.1", puerto=0)    # servidor monotónico: inmune al salto simulado
    s.iniciar()
    r = RelojSincronizado("127.0.0.1", s.puerto)
    try:
        assert r.arrancar(periodo_s=60.0, bloquear_hasta=3.0)
        real = time.time
        antes = r.ahora()
        monkeypatch.setattr(time, "time", lambda: real() + 7200.0)  # la hora del equipo salta 2 h hacia delante (p. ej. alguien la cambia)
        despues = r.ahora()
        assert abs(despues - antes) < 0.1                           # el reloj sincronizado ni se entera
        assert abs(r.ahora() - (real() + 3600.0)) < 0.2
    finally:
        r.detener(); s.detener()


def test_arrancar_sin_servidor_devuelve_false_y_el_hilo_lo_sigue_intentando():
    s = servidor(0.0)
    puerto = s.puerto
    s.detener()                                                      # nadie escucha
    r = RelojSincronizado("127.0.0.1", puerto, timeout=0.1)
    s2 = None
    try:
        t0 = time.time()
        assert r.arrancar(periodo_s=60.0, bloquear_hasta=0.6, reintento_s=0.2) is False
        assert time.time() - t0 < 3.0                                # no se queda bloqueado
        assert r.sincronizado is False and abs(r.ahora() - time.time()) < 0.5    # y la hora de partida sigue sirviendo
        s2 = servidor(4.0, puerto=puerto)
        t0 = time.time()
        while time.time() - t0 < 4 and not r.sincronizado:
            time.sleep(0.05)
        assert r.sincronizado and abs(r.offset_s - 4.0) < 0.2        # el hilo demonio acaba sincronizando
    finally:
        r.detener()
        if s2:
            s2.detener()


def test_hora_inicial_dada_en_iso_o_en_segundos():
    r = RelojSincronizado(hora_inicial="2030-05-05T12:00:00.000Z", consulta=lambda *a: (0.0, 0.0))
    assert 1904212800 <= r.ahora() < 1904212805
    assert abs(RelojSincronizado(hora_inicial=1000.0, consulta=lambda *a: (0.0, 0.0)).ahora() - 1000.0) < 1.0


def test_detener_es_idempotente_y_se_puede_volver_a_arrancar():
    s = servidor(0.0)
    r = RelojSincronizado("127.0.0.1", s.puerto)
    try:
        r.detener(); r.detener()
        assert r.arrancar(periodo_s=0.2, bloquear_hasta=2.0)
        r.detener()
        assert r.arrancar(periodo_s=0.2, bloquear_hasta=2.0)
    finally:
        r.detener(); s.detener()


# --------------------------------------------------------------------------------------------------------- CLI ----
def test_cli_consultar_imprime_desfase(capsys):
    s = servidor(2.0)
    try:
        assert mt.main(["consultar", "127.0.0.1", "--puerto", str(s.puerto)]) == 0
        salida = capsys.readouterr().out
        assert "desfase +2000." in salida or "desfase +1999." in salida or "desfase +2001." in salida
    finally:
        s.detener()
