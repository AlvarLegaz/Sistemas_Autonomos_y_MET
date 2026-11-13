"""Aula PCT23: registro, acceso y autorización de alumnos delante del simulador.

    - Los alumnos se registran (nombre, apellidos, módulo, correo y contraseña) y entran con correo y contraseña.
    - Una cuenta nueva queda *pendiente*: solo puede ver su estado hasta que el profesor la autorice.
    - El profesor entra al aula con un PIN (variable AULA_PIN), autoriza o rechaza alumnos y puede darles una clave nueva.
    - El simulador (carpeta simulador_pct23) solo se sirve a alumnos autorizados o al profesor con el PIN puesto.

Arranque local:   AULA_PIN=482913 python app.py        (http://localhost:8000)
Con Docker:       ver README.md
"""
import base64
import contextlib
import hmac
import csv
import html
import io
import json
import math
import os
import random
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote as url_quote

from flask import (Flask, Response, abort, flash, g, redirect, render_template, request,
                   send_from_directory, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import safe_join

ESTADOS = ("pendiente", "autorizado", "rechazado")
ACCIONES = ("autorizar", "rechazar", "pendiente", "eliminar", "clave", "autorizar_todos", "simuladores", "simuladores_lista")
PIN_POR_DEFECTO = "12345678"       # el aula arranca con este PIN si no se define AULA_PIN (la pantalla del aula avisa)
PIN_PROHIBIDOS = {"", "cambia-este-pin"}
PIN_MINIMO = 6
EXTENSIONES_SIMULADOR = {".html", ".css", ".js", ".png", ".svg", ".ico", ".json"}
CORREO = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
LARGO_MAX = {"nombre": 80, "apellidos": 120, "modulo": 80, "correo": 254}
CLAVE_MINIMA = 8
PAGINAS_SIMULADOR = ("index", "manual", "automatico", "demostracion", "planta_real", "fotovoltaica")
# Los simuladores del aula. `cfg` = clave de la configuración con su carpeta; `ruta` = dónde se sirve; el profesor decide cuáles ve cada alumno
# (columna usuarios.simuladores: NULL = todos, texto vacío = ninguno, o los ids separados por comas). La carpeta de la maqueta (/simulador/) además
# sirve el código compartido (js, css, img) que usan los otros dos: esos archivos no se restringen, solo las PÁGINAS (.html) de cada simulador.
SIMULADORES = (
    {"id": "maqueta", "cfg": "simulador", "ruta": "/simulador/", "etiqueta": "Maqueta", "titulo": "Planta de pasteurización PCT23",
     "descripcion": "La maqueta del aula con sus sensores, bombas y el control del PLC: modo manual, automático y demostración.", "pagina": "index"},
    {"id": "planta_real", "cfg": "planta_real", "ruta": "/planta-real/", "etiqueta": "Planta real", "titulo": "Pasteurizadora HTST · Lácteos Politécnico",
     "descripcion": "La estación EP-01 de tamaño industrial: sinóptico, modelo 3D de cada equipo, esquemas de fuerza y mando y modo Revisión con averías.", "pagina": "planta_real"},
    {"id": "fotovoltaica", "cfg": "fotovoltaica", "ruta": "/fotovoltaica/", "etiqueta": "Fotovoltaica", "titulo": "Instalación fotovoltaica de la cubierta",
     "descripcion": "Dos campos de paneles, inversores híbridos EASun y ZCS, batería y cuadro de alterna: sol, sombras, averías, unifilar, cableado y 3D.", "pagina": "fotovoltaica"},
)
IDS_SIMULADORES = tuple(s["id"] for s in SIMULADORES)
ETIQUETAS_PAGINA = {"index": "Inicio de la maqueta", "manual": "Modo manual", "automatico": "Modo automático", "demostracion": "Demostración",
                    "planta_real": "Planta real HTST", "fotovoltaica": "Instalación fotovoltaica"}
# Páginas que no llevan la barra del aula (son ventanas auxiliares) y archivos que nunca se sirven (bancos de pruebas de desarrollo).
SIN_BARRA = {"visor3d", "unifilar", "cableado"}
NUNCA_SERVIR = {"banco_pruebas.html"}
# Núcleo común de los simuladores (css, js, tipos.js): público y de solo lectura (la hoja de identidad la necesitan también las pantallas de entrada)
CARPETA_COMUN = Path(os.environ.get("AULA_COMUN", Path(__file__).resolve().parent.parent / "comun"))
EXTENSIONES_COMUN = {".js", ".css", ".woff2"}
SEGUNDOS_MAX_POR_ENVIO = 120
EVENTOS_MAX_POR_ENVIO = 30
EVENTOS_MAX_POR_ALUMNO = 3000
HASH_FALSO = generate_password_hash("clave-inexistente-para-igualar-tiempos")
# Retos de diagnóstico (averías ocultas): hoy solo los tiene el simulador fotovoltaico; el catálogo de averías se lee de su js/layout.js.
RETO_SIM = "fotovoltaica"
RETO_TITULO_POR_DEFECTO = "Práctica de diagnóstico"
RETO_AZAR = "azar"
ACCIONES_RETO = ("asignar", "asignar_lista", "anular")
ID_AVERIA = re.compile(r"^[A-Za-z0-9_]{1,60}$")
TAG_EQUIPO = re.compile(r"^[A-Za-z0-9_-]{1,30}$")
DETALLE_MAX = 4000
DIAGNOSTICOS_MAX_POR_ALUMNO = 1000
ETIQUETAS_DETALLE = {"sintoma": "Síntoma", "medidas": "Medidas marcadas", "reparacion": "Reparación propuesta", "observaciones": "Observaciones",
                     "pistas": "Pistas usadas", "causa": "Causa", "intento": "Intento (según el simulador)", "peligros": "Maniobras peligrosas",
                     "titulo": "Título del reto"}
# Eventos de aprendizaje (comun/CONTRATO.md §8). Las listas cerradas son copia de comun/tipos.js (Python no lee el JS): si cambian allí, cambian aquí.
SIMULADORES_CONTRATO = ("planta_real", "fotovoltaica", "maqueta", "uxs")
VERBOS = ("inicio", "acciono", "midio", "pidio_pista", "entrego", "completo", "abandono")
VERBOS_SOLO_SERVIDOR = ("entrego",)
VERBOS_XAPI = {
    "inicio": "http://adlnet.gov/expapi/verbs/initialized",
    "acciono": "http://adlnet.gov/expapi/verbs/interacted",
    "midio": "http://adlnet.gov/expapi/verbs/interacted",
    "pidio_pista": "http://adlnet.gov/expapi/verbs/asked",
    "entrego": "http://adlnet.gov/expapi/verbs/answered",
    "completo": "http://adlnet.gov/expapi/verbs/completed",
    "abandono": "https://w3id.org/xapi/adl/verbs/abandoned",
}
EVENTOS_MAX_POR_LOTE = 50
EVENTO_MAX_CARACTERES = 1000
LOTE_MAX_CARACTERES = 24000
EVENTOS_MAX_GUARDADOS_POR_ALUMNO = 20000
EVENTOS_DIAS_RETENCION = 365            # decisión abierta 2 del contrato: se borran los recibidos hace más de un año
TEXTO_MAX_CARACTERES = 120
ID_EVENTO = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
ID_SESION = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MARCA_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2}))?$")
SESION_DESCONOCIDA = "sin_sesion"
# Registro de la sesión (las órdenes de la simulación, para repetirla): va en su propia petición, con su propio límite, no en el lote de eventos.
REGISTRO_SESION_MAX_CARACTERES = 1024 * 1024
REGISTROS_SESION_MAX_POR_ALUMNO = 50


# ---------------------------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------------------------
def config_desde_entorno():
    env = os.environ
    return {
        "pin": env.get("AULA_PIN") or PIN_POR_DEFECTO,
        "secret_key": env.get("AULA_SECRET_KEY") or None,
        "datos": Path(env.get("AULA_DATOS", "./datos")),
        "simulador": Path(env.get("AULA_SIMULADOR", Path(__file__).resolve().parent.parent / "simulador_pct23")),
        "planta_real": Path(env.get("AULA_PLANTA_REAL", Path(__file__).resolve().parent.parent / "simulador_planta_real")),
        "fotovoltaica": Path(env.get("AULA_FOTOVOLTAICA", Path(__file__).resolve().parent.parent / "simulador_fotovoltaica")),
        "modulos": [m.strip() for m in env.get("AULA_MODULOS", "").split(",") if m.strip()],
        "cookie_segura": env.get("AULA_COOKIE_SEGURA", "0") == "1",
        # 1 = al arrancar se borra el PIN cambiado desde el aula y vuelve a valer AULA_PIN (por si se olvida)
        "pin_restablecer": env.get("AULA_PIN_RESTABLECER", "0") == "1",
        # 1 solo si hay un proxy inverso (nginx) delante y es lo único que alcanza a la app: se fía de X-Forwarded-*
        "proxy": env.get("AULA_PROXY", "0") == "1",
        "sesion_profesor_min": int(env.get("AULA_SESION_PROFESOR_MIN", "120")),
        "max_intentos": int(env.get("AULA_MAX_INTENTOS", "5")),
        "bloqueo_s": int(env.get("AULA_BLOQUEO_S", "300")),
    }


def validar_pin(pin):
    if pin.strip().lower() in PIN_PROHIBIDOS or len(pin) < PIN_MINIMO:
        raise RuntimeError(
            f"AULA_PIN no es válido: define un PIN de al menos {PIN_MINIMO} caracteres (y que no sea el texto de ejemplo). "
            "Está en el archivo .env.")


class Limitador:
    """Bloquea una clave (IP o correo) tras varios fallos seguidos. Estado en memoria: usar un solo proceso."""

    def __init__(self, maximo=5, bloqueo_s=300, reloj=time.monotonic):
        self.maximo, self.bloqueo_s, self.reloj = maximo, bloqueo_s, reloj
        self.fallos, self.hasta = {}, {}
        self.lock = threading.Lock()

    def restante(self, clave):
        """Segundos que faltan para poder reintentar (0 si no está bloqueada)."""
        with self.lock:
            hasta = self.hasta.get(clave)
            if hasta is None:
                return 0
            falta = hasta - self.reloj()
            if falta <= 0:
                self.hasta.pop(clave, None)
                self.fallos.pop(clave, None)
                return 0
            return int(falta) + 1

    def fallo(self, clave):
        with self.lock:
            n = self.fallos.get(clave, 0) + 1
            self.fallos[clave] = n
            if n >= self.maximo:
                self.hasta[clave] = self.reloj() + self.bloqueo_s
            if len(self.fallos) > 5000:                 # no crecer sin límite
                ahora = self.reloj()
                for k in [k for k, h in self.hasta.items() if h <= ahora]:
                    self.hasta.pop(k, None)
                    self.fallos.pop(k, None)

    def exito(self, clave):
        with self.lock:
            self.fallos.pop(clave, None)
            self.hasta.pop(clave, None)


# ---------------------------------------------------------------------------------------------
# Base de datos
# ---------------------------------------------------------------------------------------------
ESQUEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT NOT NULL,
    apellidos     TEXT NOT NULL,
    modulo        TEXT NOT NULL,
    correo        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    clave_hash    TEXT NOT NULL,
    estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','autorizado','rechazado')),
    creado        TEXT NOT NULL,
    resuelto      TEXT,
    simuladores   TEXT
);
CREATE INDEX IF NOT EXISTS usuarios_estado ON usuarios(estado);
CREATE TABLE IF NOT EXISTS actividad (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    momento     TEXT NOT NULL,
    tipo        TEXT NOT NULL,
    detalle     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS actividad_usuario ON actividad(usuario_id, id);
CREATE TABLE IF NOT EXISTS tiempo_uso (
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    dia         TEXT NOT NULL,
    pagina      TEXT NOT NULL,
    segundos    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (usuario_id, dia, pagina)
);
CREATE TABLE IF NOT EXISTS ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    sim         TEXT NOT NULL,
    averia      TEXT NOT NULL,
    titulo      TEXT NOT NULL DEFAULT '',
    pistas      INTEGER NOT NULL DEFAULT 1,
    creado      TEXT NOT NULL,
    resuelto    TEXT,
    nota        REAL,
    intentos    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS retos_usuario ON retos(usuario_id, sim, resuelto);
CREATE TABLE IF NOT EXISTS diagnosticos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    reto_id             INTEGER REFERENCES retos(id) ON DELETE SET NULL,
    sim                 TEXT NOT NULL,
    momento             TEXT NOT NULL,
    averia_real         TEXT NOT NULL,
    averia_respuesta    TEXT NOT NULL DEFAULT '',
    elemento_respuesta  TEXT NOT NULL DEFAULT '',
    acierto             REAL NOT NULL DEFAULT 0,
    nota                REAL NOT NULL DEFAULT 0,
    pistas              INTEGER NOT NULL DEFAULT 0,
    medidas             INTEGER NOT NULL DEFAULT 0,
    segundos            INTEGER NOT NULL DEFAULT 0,
    detalle             TEXT NOT NULL DEFAULT '',
    intento             INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS diagnosticos_usuario ON diagnosticos(usuario_id, id);
CREATE TABLE IF NOT EXISTS eventos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    sesion      TEXT NOT NULL,
    evento_id   TEXT NOT NULL,
    verbo       TEXT NOT NULL,
    simulador   TEXT NOT NULL,
    reto_id     INTEGER REFERENCES retos(id) ON DELETE SET NULL,
    escenario   TEXT NOT NULL DEFAULT '',
    elemento    TEXT NOT NULL DEFAULT '',
    resultado   TEXT NOT NULL DEFAULT '{}',
    intento     INTEGER NOT NULL DEFAULT 1,
    t_sim_s     REAL NOT NULL DEFAULT 0,
    marca       TEXT NOT NULL,
    recibido    TEXT NOT NULL,
    orden_lote  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (usuario_id, sesion, evento_id)
);
CREATE INDEX IF NOT EXISTS eventos_antiguedad ON eventos(usuario_id, marca, recibido, orden_lote, id);
CREATE INDEX IF NOT EXISTS eventos_marca ON eventos(marca, recibido, orden_lote, id);
CREATE TABLE IF NOT EXISTS registros_sesion (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    sesion      TEXT NOT NULL,
    simulador   TEXT NOT NULL,
    recibido    TEXT NOT NULL,
    registro    TEXT NOT NULL,
    UNIQUE (usuario_id, sesion, simulador)
);
"""


# ---------------------------------------------------------------------------------------------
# Catálogo de averías del simulador fotovoltaico (se lee de su js/layout.js: no se duplica la lista aquí)
# ---------------------------------------------------------------------------------------------
_CADENA_JS = r"""'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*\""""
_IDENT_JS = r"[A-Za-z_$][\w$]*"
_EXPR_JS = rf"(?:{_CADENA_JS}|{_IDENT_JS})(?:\s*\+\s*(?:{_CADENA_JS}|{_IDENT_JS}))*"
_CAMPO_JS = re.compile(rf"""['"]?({_IDENT_JS})['"]?\s*:\s*({_EXPR_JS})""")
_TROZO_JS = re.compile(rf"{_CADENA_JS}|{_IDENT_JS}")
_MAPA_JS = re.compile(rf"\[([\d\s,]+)\]\s*\.map\(\s*\(?\s*({_IDENT_JS})\s*\)?\s*=>\s*\(?\s*$")       # lo que precede al objeto de un `[1, 2].map(n => ({ … }))`
_ESCAPE_JS = re.compile(r"\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)", re.S)


def _bloque_js(texto, nombre):
    """Contenido del array `const NOMBRE = [ … ]` (sin los corchetes de fuera y sin comentarios), o None. Salta cadenas y corchetes anidados."""
    texto = _sin_comentarios_js(texto)
    m = (re.search(rf"\b(?:const|let|var)\s+{re.escape(nombre)}\s*=\s*\[", texto)
         or re.search(rf"(?<![\w$.]){re.escape(nombre)}\s*=\s*\[", texto))
    if not m:
        return None
    i, nivel, n = m.end(), 1, len(texto)
    while i < n:
        c = texto[i]
        if c in "'\"`":
            i = _fin_cadena_js(texto, i)
            continue
        if c == "[":
            nivel += 1
        elif c == "]":
            nivel -= 1
            if nivel == 0:
                return texto[m.end():i]
        i += 1
    return None


def _fin_cadena_js(texto, i):
    """Posición siguiente al cierre de la cadena que empieza en `i` (comilla simple, doble o invertida)."""
    c, j, n = texto[i], i + 1, len(texto)
    while j < n and texto[j] != c:
        j += 2 if texto[j] == "\\" else 1
    return min(j + 1, n)


def _sin_comentarios_js(texto):
    """El mismo JavaScript sin comentarios // ni /* */ (respetando lo que hay dentro de las cadenas)."""
    salida, i, n = [], 0, len(texto)
    while i < n:
        c = texto[i]
        if c in "'\"`":
            j = _fin_cadena_js(texto, i)
            salida.append(texto[i:j])
            i = j
        elif texto.startswith("//", i):
            j = texto.find("\n", i)
            i = n if j == -1 else j
        elif texto.startswith("/*", i):
            j = texto.find("*/", i + 2)
            salida.append(" ")
            i = n if j == -1 else j + 2
        else:
            salida.append(c)
            i += 1
    return "".join(salida)


def _cadena_js(literal):
    def cambio(m):
        e = m.group(1)
        if e[0] in "ux" and len(e) > 1:
            return chr(int(e[1:], 16))
        return {"n": "\n", "t": "\t", "r": "", "0": ""}.get(e, e)
    return _ESCAPE_JS.sub(cambio, literal[1:-1])


def _valor_js(expresion, variables):
    """Valor de una expresión de cadenas sumadas ('PV-10' + n). None si usa algo que no se conoce."""
    partes = []
    for trozo in _TROZO_JS.findall(expresion):
        if trozo[0] in "'\"":
            partes.append(_cadena_js(trozo))
        elif trozo in variables:
            partes.append(variables[trozo])
        else:
            return None
    return "".join(partes)


def _objetos_js(bloque):
    """Objetos literales de un array de JavaScript como diccionarios de texto. Entiende también `...[1, 2].map(n => ({ tag: 'PV-10' + n }))`."""
    def campos(cuerpo, variables):
        obj = {}
        for clave, expresion in _CAMPO_JS.findall(cuerpo):
            valor = _valor_js(expresion, variables)
            if valor is not None and clave not in obj:
                obj[clave] = valor
        return obj

    objetos, i, n, nivel, inicio, cuerpo = [], 0, len(bloque), 0, 0, []
    while i < n:
        c = bloque[i]
        if c in "'\"`":
            j = _fin_cadena_js(bloque, i)
            if nivel == 1:
                cuerpo.append(bloque[i:j])
            i = j
            continue
        if c == "{":
            nivel += 1
            if nivel == 1:
                inicio, cuerpo = i, []
        elif c == "}" and nivel:
            nivel -= 1
            if nivel == 0:
                mapa = _MAPA_JS.search(bloque[:inicio])
                if mapa:                        # un objeto por cada número de la lista que recorre el .map()
                    objetos.extend(campos("".join(cuerpo), {mapa.group(2): num}) for num in re.findall(r"\d+", mapa.group(1)))
                else:
                    objetos.append(campos("".join(cuerpo), {}))
        elif nivel == 1:                        # lo que hay en objetos anidados no son campos de este
            cuerpo.append(c)
        i += 1
    return objetos


def leer_catalogo_averias(carpeta):
    """Catálogo de averías del simulador fotovoltaico leído de `carpeta/js/layout.js` (arrays AVERIAS y EQUIPOS).
    Devuelve {"averias": [{"id", "titulo", "tag"}…], "equipos": {tag: nombre}} o None si no se puede leer (el aula sigue, sin retos)."""
    try:
        texto = (Path(carpeta) / "js" / "layout.js").read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    bloque = _bloque_js(texto, "AVERIAS")
    if bloque is None:
        return None
    averias, vistos = [], set()
    for o in _objetos_js(bloque):
        aid, titulo = o.get("id", ""), limpiar(o.get("titulo", ""), 200)
        if ID_AVERIA.match(aid) and titulo and aid not in vistos and aid != RETO_AZAR:
            vistos.add(aid)
            tag = o.get("tag", "")
            averias.append({"id": aid, "titulo": titulo, "tag": tag if TAG_EQUIPO.match(tag) else ""})
    if not averias:
        return None
    equipos = {}
    for o in _objetos_js(_bloque_js(texto, "EQUIPOS") or ""):
        tag = o.get("tag", "")
        if TAG_EQUIPO.match(tag):
            equipos.setdefault(tag, limpiar(o.get("nombre", ""), 200) or tag)
    for a in averias:                               # el elemento de cada avería siempre es un elemento válido, aunque EQUIPOS no se pueda leer
        if a["tag"]:
            equipos.setdefault(a["tag"], a["tag"])
    return {"averias": averias, "equipos": equipos}


def texto_nota(valor):
    """7.5 -> '7,5' · 10.0 -> '10' · None -> '—' (coma decimal, como se escribe una nota)."""
    if valor is None:
        return "—"
    return f"{float(valor):.2f}".rstrip("0").rstrip(".").replace(".", ",")


def numero_acotado(valor, minimo, maximo):
    """Número del formulario (admite coma decimal) dentro de [minimo, maximo]; lo que no sea un número vale `minimo`."""
    try:
        x = float(str(valor or "").strip().replace(",", "."))
    except ValueError:
        return minimo
    if not math.isfinite(x):
        return minimo
    return max(minimo, min(x, maximo))


def detalle_legible(texto):
    """La hoja del alumno (JSON) como lista de (etiqueta, [líneas de texto]) para mostrarla en una plantilla con autoescape: nunca se inyecta HTML."""
    try:
        dato = json.loads(texto) if texto else None
    except ValueError:
        return []

    def corto(v, hondo=0):
        if isinstance(v, bool):
            return "sí" if v else "no"
        if v is None:
            return "—"
        if isinstance(v, (int, float)):
            return texto_nota(v) if isinstance(v, float) else str(v)
        if isinstance(v, str):
            return limpiar(v, 1500)
        if hondo >= 2:
            return "…"
        if isinstance(v, dict):
            return " · ".join(f"{limpiar(str(k), 40)}: {corto(x, hondo + 1)}" for k, x in list(v.items())[:12])
        if isinstance(v, list):
            return ", ".join(corto(x, hondo + 1) for x in v[:20])
        return ""

    if isinstance(dato, list):
        dato = {"medidas": dato}
    if not isinstance(dato, dict):
        return [("Detalle", [corto(dato)])] if dato not in (None, "") else []
    salida = []
    for clave, valor in list(dato.items())[:30]:
        clave = limpiar(str(clave), 40)
        etiqueta = ETIQUETAS_DETALLE.get(clave.lower(), clave.replace("_", " ").capitalize())
        lineas = [corto(x) for x in valor[:60]] if isinstance(valor, list) else [corto(valor)]
        lineas = [x for x in lineas if x]
        if lineas:
            salida.append((etiqueta, lineas))
    return salida


def ahora_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def conectar(ruta):
    con = sqlite3.connect(ruta, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


# ---------------------------------------------------------------------------------------------
# Validación
# ---------------------------------------------------------------------------------------------
def limpiar(texto, maximo):
    texto = re.sub(r"[\x00-\x1f\x7f]", "", texto or "")
    return " ".join(texto.split())[:maximo]


def leer_marca(texto):
    """Fecha ISO 8601 ('2026-11-13T09:30:00Z', con o sin fracción y zona; o solo '2026-11-13') como datetime en UTC, o None."""
    if not isinstance(texto, str) or len(texto) > 40 or not MARCA_ISO.match(texto):
        return None
    try:
        d = datetime.fromisoformat(texto.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def iso_ms(d):
    """datetime → '2026-11-13T09:30:00.000Z' (siempre con milisegundos: así se ordena bien como texto)."""
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def _es_numero(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validar_evento(e, asignados, ahora):
    """Un EventoAprendizaje del navegador (comun/CONTRATO.md §8.1-8.2) ya normalizado para guardarlo, o None si hay que descartarlo.
    asignados: simuladores que el alumno tiene asignados; ahora: datetime UTC del servidor. Los campos desconocidos se ignoran."""
    if not isinstance(e, dict):
        return None
    try:
        if len(json.dumps(e, ensure_ascii=False, separators=(",", ":"))) > EVENTO_MAX_CARACTERES:
            return None
    except (TypeError, ValueError):
        return None
    objeto, contexto, resultado = e.get("objeto"), e.get("contexto"), e.get("resultado", {})
    if not (isinstance(e.get("id"), str) and ID_EVENTO.match(e["id"])):
        return None
    if e.get("verbo") not in VERBOS or e.get("verbo") in VERBOS_SOLO_SERVIDOR:
        return None
    if not isinstance(objeto, dict) or objeto.get("simulador") not in SIMULADORES_CONTRATO or objeto.get("simulador") not in asignados:
        return None
    if not isinstance(contexto, dict) or not (isinstance(contexto.get("sesion"), str) and ID_SESION.match(contexto["sesion"])):
        return None
    intento, t_sim = contexto.get("intento"), contexto.get("tSimS")
    if not (isinstance(intento, int) and not isinstance(intento, bool) and 1 <= intento <= 999):
        return None
    if not (_es_numero(t_sim) and 0 <= t_sim <= 1e7):
        return None
    marca = leer_marca(e.get("marca"))
    if marca is None or marca > ahora + timedelta(hours=24):
        return None
    if resultado is None:
        resultado = {}
    if not isinstance(resultado, dict):
        return None
    limpio = {}
    if "nota" in resultado:
        if not (_es_numero(resultado["nota"]) and 0 <= resultado["nota"] <= 10):
            return None
        limpio["nota"] = resultado["nota"]
    if "acierto" in resultado:
        if not (_es_numero(resultado["acierto"]) and resultado["acierto"] in (0, 0.5, 1)):
            return None
        limpio["acierto"] = resultado["acierto"]
    if "duracionS" in resultado:
        if not (_es_numero(resultado["duracionS"]) and 0 <= resultado["duracionS"] <= 86400):
            return None
        limpio["duracionS"] = resultado["duracionS"]
    if "valor" in resultado:
        if not _es_numero(resultado["valor"]):
            return None
        limpio["valor"] = resultado["valor"]
    for clave in ("unidad", "texto"):
        if isinstance(resultado.get(clave), str):
            limpio[clave] = limpiar(resultado[clave], TEXTO_MAX_CARACTERES)
    reto = objeto.get("reto")
    texto_de = lambda v: limpiar(v, TEXTO_MAX_CARACTERES) if isinstance(v, str) else ""
    return {"evento_id": e["id"], "verbo": e["verbo"], "simulador": objeto["simulador"],
            "reto": reto if isinstance(reto, int) and not isinstance(reto, bool) else None,
            "escenario": texto_de(objeto.get("escenario")), "elemento": texto_de(objeto.get("elemento")),
            "resultado": limpio, "sesion": contexto["sesion"], "intento": intento, "t_sim_s": float(t_sim), "marca": iso_ms(marca)}


def sentencia_xapi(fila, casa):
    """Una fila de la tabla eventos como sentencia xAPI. El actor es el id interno del alumno: sin nombre ni correo."""
    resultado = json.loads(fila["resultado"] or "{}")
    ext = casa + "/xapi/extensiones/"
    objeto_id = f"{casa}/simuladores/{fila['simulador']}"
    if fila["reto_id"] is not None:
        objeto_id += f"/retos/{fila['reto_id']}"
    elif fila["escenario"]:
        objeto_id += "/escenarios/" + url_quote(fila["escenario"], safe="")
    if fila["elemento"]:
        objeto_id += "/elementos/" + url_quote(fila["elemento"], safe="")
    s = {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{casa}/eventos/{fila['id']}")),
        "actor": {"objectType": "Agent", "account": {"homePage": casa, "name": str(fila["usuario_id"])}},
        "verb": {"id": VERBOS_XAPI[fila["verbo"]], "display": {"es-ES": fila["verbo"]}},
        "object": {"objectType": "Activity", "id": objeto_id},
        "context": {"registration": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{casa}/sesiones/{fila['usuario_id']}/{fila['sesion']}")),
                    "extensions": {ext + "sesion": fila["sesion"], ext + "intento": fila["intento"], ext + "tSimS": fila["t_sim_s"]}},
        "timestamp": fila["marca"],
        "stored": fila["recibido"],
    }
    r = {}
    if "nota" in resultado:
        r["score"] = {"raw": resultado["nota"], "min": 0, "max": 10, "scaled": round(resultado["nota"] / 10, 4)}
    if "acierto" in resultado:
        r["success"] = resultado["acierto"] >= 1
    if "duracionS" in resultado:
        r["duration"] = f"PT{resultado['duracionS']:g}S"
    if "texto" in resultado:
        r["response"] = resultado["texto"]
    extras = {ext + k: resultado[k] for k in ("valor", "unidad", "acierto") if k in resultado}
    if extras:
        r["extensions"] = extras
    if r:
        s["result"] = r
    return s


def validar_registro(form):
    """Devuelve (datos, errores)."""
    datos = {
        "nombre": limpiar(form.get("nombre"), LARGO_MAX["nombre"]),
        "apellidos": limpiar(form.get("apellidos"), LARGO_MAX["apellidos"]),
        "modulo": limpiar(form.get("modulo"), LARGO_MAX["modulo"]),
        "correo": limpiar(form.get("correo"), LARGO_MAX["correo"]).lower(),
    }
    clave, repite = form.get("clave", ""), form.get("clave2", "")
    errores = []
    for campo, etiqueta in (("nombre", "el nombre"), ("apellidos", "los apellidos"), ("modulo", "el módulo")):
        if not datos[campo]:
            errores.append(f"Escribe {etiqueta}.")
    if not CORREO.match(datos["correo"]):
        errores.append("El correo no parece válido.")
    if len(clave) < CLAVE_MINIMA:
        errores.append(f"La contraseña debe tener al menos {CLAVE_MINIMA} caracteres.")
    elif len(clave) > 200:
        errores.append("La contraseña es demasiado larga.")
    elif clave.lower() == datos["correo"]:
        errores.append("La contraseña no puede ser tu correo.")
    elif clave != repite:
        errores.append("Las contraseñas no coinciden.")
    return datos, clave, errores


# ---------------------------------------------------------------------------------------------
# Aplicación
# ---------------------------------------------------------------------------------------------
def crear_app(config=None):
    cfg = {**config_desde_entorno(), **(config or {})}
    validar_pin(cfg["pin"])
    cfg["datos"] = Path(cfg["datos"])
    cfg["simulador"] = Path(cfg["simulador"])
    cfg["planta_real"] = Path(cfg["planta_real"])
    cfg["fotovoltaica"] = Path(cfg["fotovoltaica"])
    cfg["datos"].mkdir(parents=True, exist_ok=True)
    if not (cfg["simulador"] / "index.html").is_file():
        raise RuntimeError(f"No se encuentra el simulador en {cfg['simulador']}")

    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=cfg["secret_key"] or clave_secreta_persistente(cfg["datos"] / "secret_key"),
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=cfg["cookie_segura"],
        SESSION_COOKIE_NAME="aula_pct23",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        MAX_CONTENT_LENGTH=32 * 1024,
        AULA=cfg,
    )
    if cfg.get("proxy"):
        # Detrás de nginx: la IP del cliente (bloqueo por intentos), el esquema https y el host vienen de las cabeceras del proxy.
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    if cfg["pin"] == PIN_POR_DEFECTO:
        print(f"AVISO: el aula usa el PIN por defecto ({PIN_POR_DEFECTO}). Cualquiera que lo conozca puede autorizar alumnos; "
              "defina AULA_PIN en .env para cambiarlo.", flush=True)
    ruta_bd = cfg["datos"] / "aula.sqlite3"
    with contextlib.closing(conectar(ruta_bd)) as con:
        con.executescript(ESQUEMA)
        if "simuladores" not in [c["name"] for c in con.execute("PRAGMA table_info(usuarios)")]:
            con.execute("ALTER TABLE usuarios ADD COLUMN simuladores TEXT")       # instalaciones anteriores: NULL = ven todos, como hasta ahora
        if cfg.get("pin_restablecer"):
            con.execute("DELETE FROM ajustes WHERE clave='pin_hash'")
        con.commit()
    limitador = Limitador(cfg["max_intentos"], cfg["bloqueo_s"], cfg.get("reloj", time.monotonic))
    app.limitador = limitador
    # Catálogo de averías para los retos de diagnóstico: se lee una vez, al arrancar, del propio simulador. Sin él no hay retos (y el aula sigue igual).
    catalogo = leer_catalogo_averias(cfg["fotovoltaica"]) if (cfg["fotovoltaica"] / "index.html").is_file() else None
    averias_por_id = {a["id"]: a for a in catalogo["averias"]} if catalogo else {}
    app.catalogo_averias = catalogo
    azar = cfg.get("azar") or random.SystemRandom()
    # Hora de pared de los eventos de aprendizaje (marca «en el futuro», recepción, retención). Las pruebas pasan su reloj en cfg["reloj"].
    reloj_pared = cfg.get("reloj") or time.time

    # ----- utilidades por petición -----
    def bd():
        if "bd" not in g:
            g.bd = conectar(ruta_bd)
        return g.bd

    def registrar_actividad(uid, tipo, detalle=""):
        con = bd()
        con.execute("INSERT INTO actividad (usuario_id, momento, tipo, detalle) VALUES (?,?,?,?)", (uid, ahora_iso(), tipo, detalle))
        con.execute("DELETE FROM actividad WHERE usuario_id=? AND id <= "
                    "(SELECT id FROM actividad WHERE usuario_id=? ORDER BY id DESC LIMIT 1 OFFSET ?)",
                    (uid, uid, EVENTOS_MAX_POR_ALUMNO))

    @app.template_filter("duracion")
    def duracion(segundos):
        segundos = int(segundos or 0)
        horas, resto = divmod(segundos, 3600)
        minutos = resto // 60
        if horas:
            return f"{horas} h {minutos:02d} min"
        return f"{minutos} min" if minutos else (f"{segundos} s" if segundos else "—")

    def pin_guardado():
        """PIN cambiado desde el aula (hash en la base de datos). Si existe, manda sobre AULA_PIN."""
        fila = bd().execute("SELECT valor FROM ajustes WHERE clave='pin_hash'").fetchone()
        return fila["valor"] if fila else None

    def pin_correcto(pin):
        guardado = pin_guardado()
        if guardado:
            return check_password_hash(guardado, pin)
        return hmac.compare_digest(pin.encode(), cfg["pin"].encode())

    @app.teardown_appcontext
    def cerrar_bd(_):
        con = g.pop("bd", None)
        if con is not None:
            con.close()

    def ip():
        return request.remote_addr or "?"

    def alumno():
        """Alumno de la sesión, leído de la base en cada petición (si lo rechazan, pierde el acceso al momento)."""
        if "alumno" not in g:
            uid = session.get("uid")
            g.alumno = bd().execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone() if uid else None
        return g.alumno

    def profesor():
        return session.get("prof_hasta", 0) > time.time()

    def disponibles():
        """Simuladores desplegados en este servidor (su carpeta existe), en el orden de SIMULADORES."""
        return [s for s in SIMULADORES if (cfg[s["cfg"]] / "index.html").is_file()]

    def ids_asignados(fila):
        """Ids de simuladores que el profesor ha asignado a una fila de usuario (NULL = todos, vacío = ninguno)."""
        valor = fila["simuladores"] if fila is not None and "simuladores" in fila.keys() else None
        if valor is None:
            return set(IDS_SIMULADORES)
        return {i for i in valor.split(",") if i in IDS_SIMULADORES}

    def simuladores_del_usuario():
        """Simuladores que puede abrir quien tiene la sesión: el profesor (con el PIN) todos; el alumno autorizado, los que tenga asignados."""
        todos = disponibles()
        if profesor():
            return todos
        a = alumno()
        if not (a and a["estado"] == "autorizado"):
            return []
        permitidos = ids_asignados(a)
        return [s for s in todos if s["id"] in permitidos]

    @app.template_global()
    def simuladores_de(fila):
        """Para las plantillas del aula: ids asignados a un alumno."""
        return ids_asignados(fila)

    def token_csrf():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(24)
        return session["csrf"]

    app.add_template_filter(texto_nota, "nota")

    @app.template_filter("acierto")
    def texto_acierto(valor):
        return "Sí" if (valor or 0) >= 1 else ("A medias" if (valor or 0) >= 0.5 else "No")

    @app.template_global()
    def titulo_averia(aid):
        """Nombre legible de una avería (solo para páginas del profesor). Si ya no está en el catálogo, su id."""
        if not aid:
            return "—"
        return averias_por_id[aid]["titulo"] if aid in averias_por_id else aid

    @app.template_global()
    def nombre_equipo(tag):
        if not tag:
            return "—"
        nombre = catalogo["equipos"].get(tag) if catalogo else None
        return f"{tag} · {nombre}" if nombre and nombre != tag else tag

    @app.context_processor
    def contexto():
        return {"csrf": token_csrf, "modulos": cfg["modulos"], "alumno_sesion": alumno(), "profesor": profesor(), "simuladores": disponibles(),
                "averias": catalogo["averias"] if catalogo else [],
                "pin_por_defecto": cfg["pin"] == PIN_POR_DEFECTO and pin_guardado() is None, "pin_defecto_valor": PIN_POR_DEFECTO}

    @app.before_request
    def limite_por_ruta():
        """El registro de la sesión trae más datos que un formulario: su ruta tiene su propio límite (va antes de leer el formulario en comprobar_csrf)."""
        if request.method == "POST" and request.path == "/api/registro_sesion":
            request.max_content_length = REGISTRO_SESION_MAX_CARACTERES + 16 * 1024
            request.max_form_memory_size = REGISTRO_SESION_MAX_CARACTERES + 1024

    @app.before_request
    def comprobar_csrf():
        if request.method == "POST":
            enviado = request.form.get("csrf", "")
            esperado = session.get("csrf", "")
            if not esperado or not hmac.compare_digest(enviado.encode(), esperado.encode()):
                abort(400, "Formulario caducado o no válido. Vuelve atrás y recarga la página.")

    @app.after_request
    def cabeceras(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'")
        if request.path.startswith(("/simulador/", "/planta-real/", "/fotovoltaica/")):
            resp.headers["Cache-Control"] = "private, no-cache"          # solo para quien ha entrado; se revalida
        elif request.endpoint != "static":
            resp.headers["Cache-Control"] = "no-store"
        return resp

    def error_json(codigo, texto):
        """Errores de las API que lee el simulador (no una persona): JSON en lugar de la página de error (contrato R15)."""
        if request.path == "/api/eventos":
            return {"guardados": 0, "error": texto}, codigo
        if request.path.startswith(("/api/reto", "/api/registro_sesion")):
            return {"guardado": False, "error": texto}, codigo
        return None

    @app.errorhandler(400)
    def error_400(e):
        return error_json(400, getattr(e, "description", "") or "Petición no válida.") or (
            render_template("error.html", titulo="Petición no válida", texto=getattr(e, "description", "")), 400)

    @app.errorhandler(404)
    def error_404(_):
        return render_template("error.html", titulo="No encontrado", texto="Esa página no existe."), 404

    @app.errorhandler(413)
    def error_413(_):
        return error_json(413, "La petición es demasiado grande.") or (
            render_template("error.html", titulo="Demasiado grande", texto="El formulario es demasiado grande."), 413)

    # ----- páginas públicas -----
    @app.get("/salud")
    def salud():
        bd().execute("SELECT 1")
        return {"estado": "ok"}

    @app.get("/")
    def inicio():
        a = alumno()
        if a is None:
            return redirect(url_for("entrar"))
        return redirect(url_for("simuladores") if a["estado"] == "autorizado" else url_for("pendiente"))

    @app.route("/registro", methods=["GET", "POST"])
    def registro():
        valores = {}
        if request.method == "POST":
            datos, clave, errores = validar_registro(request.form)
            valores = datos
            if not errores:
                try:
                    bd().execute(
                        "INSERT INTO usuarios (nombre, apellidos, modulo, correo, clave_hash, estado, creado) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (datos["nombre"], datos["apellidos"], datos["modulo"], datos["correo"],
                         generate_password_hash(clave), "pendiente", ahora_iso()))
                    bd().commit()
                except sqlite3.IntegrityError:
                    errores.append("Ya hay una cuenta con ese correo. Si es tuya, entra con tu contraseña "
                                   "o pide al profesor una clave nueva.")
            if not errores:
                flash("Registro enviado. Cuando el profesor te autorice podrás usar el simulador. "
                      "Ya puedes entrar para ver el estado de tu cuenta.", "ok")
                return redirect(url_for("entrar"))
            for e in errores:
                flash(e, "error")
        return render_template("registro.html", v=valores)

    @app.route("/entrar", methods=["GET", "POST"])
    def entrar():
        if request.method == "POST":
            correo = limpiar(request.form.get("correo"), LARGO_MAX["correo"]).lower()
            clave = request.form.get("clave", "")[:200]
            claves = (f"login-ip:{ip()}", f"login-correo:{correo}")
            espera = max(limitador.restante(k) for k in claves)
            if espera:
                flash(f"Demasiados intentos fallidos. Espera {max(1, espera // 60)} min y vuelve a probar.", "error")
                return render_template("entrar.html", correo=correo), 429
            fila = bd().execute("SELECT * FROM usuarios WHERE correo=?", (correo,)).fetchone()
            ok = check_password_hash(fila["clave_hash"] if fila else HASH_FALSO, clave) and fila is not None
            if not ok:
                for k in claves:
                    limitador.fallo(k)
                flash("Correo o contraseña incorrectos.", "error")
                return render_template("entrar.html", correo=correo), 401
            for k in claves:
                limitador.exito(k)
            session.clear()
            session.permanent = True
            session["uid"] = fila["id"]
            token_csrf()
            registrar_actividad(fila["id"], "entrada", "Inició sesión")
            bd().commit()
            return redirect(url_for("inicio"))
        return render_template("entrar.html", correo="")

    @app.route("/cuenta", methods=["GET", "POST"])
    def cuenta():
        a = alumno()
        if a is None:
            return redirect(url_for("entrar"))
        if request.method == "POST":
            clave_limite = f"clave-uid:{a['id']}"
            espera = limitador.restante(clave_limite)
            if espera:
                flash(f"Demasiados intentos. Espera {max(1, espera // 60)} min y vuelve a probar.", "error")
                return render_template("cuenta.html", a=a), 429
            actual = request.form.get("clave_actual", "")[:200]
            nueva = request.form.get("clave_nueva", "")[:200]
            repetida = request.form.get("clave_repetida", "")[:200]
            if not check_password_hash(a["clave_hash"], actual):
                limitador.fallo(clave_limite)
                flash("La contraseña actual no es correcta.", "error")
            elif nueva != repetida:
                flash("La contraseña nueva y su repetición no coinciden.", "error")
            elif len(nueva) < CLAVE_MINIMA:
                flash(f"La contraseña nueva debe tener al menos {CLAVE_MINIMA} caracteres.", "error")
            elif nueva == actual:
                flash("La contraseña nueva tiene que ser distinta de la actual.", "error")
            else:
                limitador.exito(clave_limite)
                bd().execute("UPDATE usuarios SET clave_hash=? WHERE id=?", (generate_password_hash(nueva), a["id"]))
                registrar_actividad(a["id"], "cuenta", "Cambió su contraseña")
                bd().commit()
                flash("Contraseña cambiada.", "ok")
            return redirect(url_for("cuenta"))
        return render_template("cuenta.html", a=a)

    @app.post("/salir")
    def salir():
        prof = session.get("prof_hasta")
        session.clear()
        if prof and profesor_vigente(prof):          # salir de la cuenta no cierra el aula del profesor
            session["prof_hasta"] = prof
        flash("Has cerrado la sesión.", "ok")
        return redirect(url_for("entrar"))

    def profesor_vigente(valor):
        return valor > time.time()

    @app.get("/pendiente")
    def pendiente():
        a = alumno()
        if a is None:
            return redirect(url_for("entrar"))
        if a["estado"] == "autorizado":
            return redirect(url_for("simuladores"))
        return render_template("pendiente.html", a=a)

    # ----- elección del simulador (tras entrar) -----
    @app.get("/simuladores")
    def simuladores():
        a = alumno()
        if not profesor() and not (a and a["estado"] == "autorizado"):
            return redirect(url_for("entrar" if a is None else "pendiente"))
        lista = simuladores_del_usuario()
        if len(lista) == 1 and request.args.get("lista") != "1":
            return redirect(lista[0]["ruta"])           # con uno solo asignado no hay nada que elegir
        # Al alumno solo se le dice CUÁNTOS retos tiene pendientes: nunca qué avería es (la tiene que encontrar él).
        pendientes = 0
        if a is not None and a["estado"] == "autorizado" and catalogo and RETO_SIM in [s["id"] for s in lista]:
            pendientes = sum(1 for r in bd().execute("SELECT averia FROM retos WHERE usuario_id=? AND sim=? AND resuelto IS NULL", (a["id"], RETO_SIM))
                             if r["averia"] in averias_por_id)
        return render_template("simuladores.html", lista=lista, retos_pendientes=pendientes, reto_sim=RETO_SIM)

    # ----- simulador y planta real (protegidos: alumno autorizado o profesor con el PIN) -----
    def servir(raiz, ruta, pagina_de_inicio=None, sim=None):
        """Sirve un archivo de `raiz` (simulador_pct23 o simulador_planta_real) con el mismo control de acceso, las mismas extensiones y la misma
        exclusión de tests. pagina_de_inicio: nombre con el que se registra la actividad cuando se abre index.html (para distinguir las dos pantallas de inicio)."""
        a = alumno()
        if not profesor() and not (a and a["estado"] == "autorizado"):
            return redirect(url_for("entrar" if a is None else "pendiente"))
        partes = Path(ruta).parts
        if any(p.startswith(".") or p in ("tests", "__pycache__") for p in partes) or Path(ruta).name in NUNCA_SERVIR:
            abort(404)
        ext = Path(ruta).suffix.lower()
        if ext not in EXTENSIONES_SIMULADOR:
            abort(404)
        if ext == ".html" and sim and sim not in [s["id"] for s in simuladores_del_usuario()]:
            # Solo se restringen las páginas de cada simulador: el código compartido (js, css, imágenes) lo usan los tres y sigue abierto a quien haya entrado.
            return render_template("error.html", titulo="Simulador no asignado",
                                   texto="El profesor no te ha asignado este simulador. Si lo necesitas, pídeselo."), 403
        if ext != ".html":
            return send_from_directory(raiz, ruta, max_age=0)
        destino = safe_join(str(raiz), ruta)
        if destino is None or not Path(destino).is_file():
            abort(404)
        texto = Path(destino).read_text(encoding="utf-8")
        nombre = f"{a['nombre']} {a['apellidos']}" if a else "Profesor"
        pagina = Path(ruta).stem
        if pagina_de_inicio and pagina == "index":
            pagina = pagina_de_inicio
        if a is not None and a["estado"] == "autorizado" and pagina in PAGINAS_SIMULADOR:
            registrar_actividad(a["id"], "pagina", f"Abrió {pagina}")
            bd().commit()
        if pagina not in SIN_BARRA:
            barra = render_template("barra_simulador.html", nombre=nombre, es_profesor=profesor(), con_cuenta=a is not None,
                                    pagina=pagina if pagina in PAGINAS_SIMULADOR else "index")
            fin = texto.lower().rfind("</body>")
            texto = texto[:fin] + barra + texto[fin:] if fin != -1 else texto + barra
        if raiz == cfg["planta_real"] and profesor():
            # Solo en sesiones de profesor: la planta real muestra el panel de averías (nunca se decide por la dirección de la página).
            marca = "<script>window.PCT_ES_PROFESOR = true;</script>"
            cabeza = texto.lower().find("</head>")
            texto = texto[:cabeza] + marca + texto[cabeza:] if cabeza != -1 else marca + texto
        resp = Response(texto, mimetype="text/html")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/simulador/", defaults={"ruta": "index.html"})
    @app.get("/simulador/<path:ruta>")
    def simulador(ruta):
        return servir(cfg["simulador"], ruta, sim="maqueta")

    @app.get("/comun/<path:ruta>")
    def comun(ruta):
        """Código, estilos y la fuente común (.js, .css y .woff2), sin salir de la carpeta ni tests). Público: lo cargan también las pantallas de entrada."""
        partes = Path(ruta).parts
        if Path(ruta).suffix.lower() not in EXTENSIONES_COMUN or any(p.startswith(".") or p in ("tests", "__pycache__") for p in partes):
            abort(404)
        tipo = "font/woff2" if Path(ruta).suffix.lower() == ".woff2" else None     # el mimetypes de Windows no lo conoce
        return send_from_directory(CARPETA_COMUN, ruta, max_age=0, mimetype=tipo)

    @app.get("/planta-real/", defaults={"ruta": "index.html"})
    @app.get("/planta-real/<path:ruta>")
    def planta_real(ruta):
        if not (cfg["planta_real"] / "index.html").is_file():
            abort(404)                                  # despliegue sin la planta real
        return servir(cfg["planta_real"], ruta, "planta_real", sim="planta_real")

    @app.get("/fotovoltaica/", defaults={"ruta": "index.html"})
    @app.get("/fotovoltaica/<path:ruta>")
    def fotovoltaica(ruta):
        if not (cfg["fotovoltaica"] / "index.html").is_file():
            abort(404)                                  # despliegue sin la instalación fotovoltaica
        return servir(cfg["fotovoltaica"], ruta, "fotovoltaica", sim="fotovoltaica")

    # ----- aula del profesor -----
    @app.get("/aula")
    def aula():
        if not profesor():
            return render_template("aula_pin.html")
        estado = request.args.get("estado", "pendiente")
        if estado not in ESTADOS + ("todos",):
            estado = "pendiente"
        modulo = limpiar(request.args.get("modulo"), LARGO_MAX["modulo"])
        busca = limpiar(request.args.get("q"), 80)
        datos = datos_panel(estado, modulo, busca)
        datos["vista_pin"] = request.args.get("vista") == "pin"
        datos["vista_diag"] = request.args.get("vista") == "diagnostico" and datos["hay_diagnostico"]
        if datos["vista_diag"]:
            datos["resumen_averias"] = resumen_por_averia()
        return render_template("aula_panel.html", **datos)

    def resumen_por_averia():
        """Por avería: entregas, alumnos distintos, % de acierto pleno, nota media… Las que más cuestan (peor nota media), primero."""
        return bd().execute(
            "SELECT averia_real, COUNT(*) AS n, COUNT(DISTINCT usuario_id) AS alumnos, "
            "100.0 * AVG(CASE WHEN acierto >= 1 THEN 1.0 ELSE 0.0 END) AS pct, AVG(nota) AS nota, AVG(pistas) AS pistas, "
            "AVG(medidas) AS medidas, AVG(segundos) AS segundos "
            "FROM diagnosticos WHERE sim=? GROUP BY averia_real ORDER BY AVG(nota), COUNT(*) DESC", (RETO_SIM,)).fetchall()

    def datos_panel(estado, modulo, busca, clave_nueva=None):
        condiciones, params = [], []
        if estado != "todos":
            condiciones.append("estado=?")
            params.append(estado)
        if modulo:
            condiciones.append("modulo=? COLLATE NOCASE")
            params.append(modulo)
        if busca:
            condiciones.append("(nombre LIKE ? OR apellidos LIKE ? OR correo LIKE ?)")
            params += [f"%{busca}%"] * 3
        where = f"WHERE {' AND '.join(condiciones)}" if condiciones else ""
        filas = bd().execute(
            f"SELECT u.*, COALESCE((SELECT SUM(segundos) FROM tiempo_uso t WHERE t.usuario_id=u.id), 0) AS seg_total, "
            f"(SELECT MAX(momento) FROM actividad a WHERE a.usuario_id=u.id) AS ultimo, "
            f"(SELECT COUNT(*) FROM retos r WHERE r.usuario_id=u.id AND r.resuelto IS NULL) AS retos_pend, "
            f"(SELECT COUNT(*) FROM retos r WHERE r.usuario_id=u.id AND r.resuelto IS NOT NULL) AS retos_res, "
            f"(SELECT nota FROM retos r WHERE r.usuario_id=u.id AND r.resuelto IS NOT NULL ORDER BY r.resuelto DESC, r.id DESC LIMIT 1) AS retos_nota "
            f"FROM usuarios u {where} ORDER BY apellidos COLLATE NOCASE, nombre COLLATE NOCASE LIMIT 500",
            params).fetchall()
        # La parte de diagnóstico se enseña si hay catálogo (se pueden asignar retos) o si quedan entregas guardadas de cuando lo había.
        hay_diagnostico = bool(catalogo) or bd().execute("SELECT 1 FROM diagnosticos LIMIT 1").fetchone() is not None
        con_reto = sum(1 for f in filas if f["estado"] == "autorizado" and RETO_SIM in ids_asignados(f))
        cuentas = {e: 0 for e in ESTADOS}
        for e, n in bd().execute("SELECT estado, COUNT(*) FROM usuarios GROUP BY estado"):
            cuentas[e] = n
        modulos_bd = [r[0] for r in bd().execute("SELECT DISTINCT modulo FROM usuarios ORDER BY modulo COLLATE NOCASE")]
        return {"filas": filas, "estado": estado, "modulo": modulo, "q": busca, "cuentas": cuentas,
                "modulos_bd": modulos_bd, "clave_nueva": clave_nueva, "hasta": session.get("prof_hasta", 0),
                "hay_diagnostico": hay_diagnostico, "con_reto": con_reto}

    # ----- retos de diagnóstico: lo que usa el simulador -----
    def alumno_con_retos():
        """El alumno de la sesión si está autorizado y tiene asignado el simulador de los retos; si no, None."""
        a = alumno()
        if a is None or a["estado"] != "autorizado" or RETO_SIM not in ids_asignados(a):
            return None
        return a

    @app.get("/api/reto")
    def api_reto():
        if alumno() is None and not profesor():
            return {"reto": None}, 401
        a = alumno_con_retos()
        if a is None or not catalogo or request.args.get("sim") != RETO_SIM:
            return {"reto": None}
        for r in bd().execute("SELECT * FROM retos WHERE usuario_id=? AND sim=? AND resuelto IS NULL ORDER BY id", (a["id"], RETO_SIM)):
            if r["averia"] in averias_por_id:               # una avería que ya no existe en el simulador no se puede plantear
                # La clave va en base64 solo para que no se lea a simple vista en la consola del navegador. NO es seguridad: la simulación corre en
                # el navegador del alumno y quien sepa mirar la encuentra; lo que cuenta es la hoja de diagnóstico que entrega.
                return {"reto": {"id": r["id"], "clave": base64.b64encode(r["averia"].encode()).decode("ascii"),
                                 "titulo": r["titulo"] or RETO_TITULO_POR_DEFECTO, "pistas": bool(r["pistas"])}}
        return {"reto": None}

    @app.post("/api/reto/resultado")
    def api_reto_resultado():
        a = alumno_con_retos()
        if a is None or not catalogo:
            return "", 204
        f = request.form
        if f.get("sim") != RETO_SIM:
            abort(400, "Simulador no válido.")
        averia_real = f.get("averia_real", "")
        if averia_real not in averias_por_id:
            abort(400, "Avería no válida.")
        respuesta = f.get("averia_respuesta", "")
        respuesta = respuesta if respuesta in averias_por_id else ""
        elemento = f.get("elemento_respuesta", "")
        elemento = elemento if elemento in catalogo["equipos"] else ""
        acierto = round(numero_acotado(f.get("acierto"), 0, 1) * 2) / 2            # solo 0, 0,5 o 1
        nota = round(numero_acotado(f.get("nota"), 0, 10), 2)
        pistas = int(numero_acotado(f.get("pistas"), 0, 3))
        medidas = int(numero_acotado(f.get("medidas"), 0, 9999))
        segundos = int(numero_acotado(f.get("segundos"), 0, 86400))
        detalle = f.get("detalle", "")
        try:
            if len(detalle) > DETALLE_MAX or not isinstance(json.loads(detalle), (dict, list)):
                detalle = ""
        except ValueError:
            detalle = ""
        con = bd()
        # El reto solo cuenta si es de ESTE alumno y la avería entregada es la del reto; cualquier otra cosa se guarda como práctica libre.
        reto = None
        try:
            reto = con.execute("SELECT * FROM retos WHERE id=? AND usuario_id=? AND sim=?", (int(f.get("reto", "")), a["id"], RETO_SIM)).fetchone()
        except ValueError:
            pass
        if reto is not None and reto["averia"] != averia_real:
            reto = None
        ahora = ahora_iso()
        if reto is not None:
            intento = reto["intentos"] + 1
            # Se cierra en la primera entrega; las siguientes (el alumno puede reintentar) solo suben la mejor nota y el nº de intentos.
            con.execute("UPDATE retos SET resuelto=COALESCE(resuelto, ?), nota=?, intentos=? WHERE id=?",
                        (ahora, nota if reto["nota"] is None else max(reto["nota"], nota), intento, reto["id"]))
        else:
            intento = 1 + con.execute("SELECT COUNT(*) FROM diagnosticos WHERE usuario_id=? AND sim=? AND averia_real=? AND reto_id IS NULL",
                                      (a["id"], RETO_SIM, averia_real)).fetchone()[0]
        cursor = con.execute("INSERT INTO diagnosticos (usuario_id, reto_id, sim, momento, averia_real, averia_respuesta, elemento_respuesta, acierto, nota, "
                             "pistas, medidas, segundos, detalle, intento) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                             (a["id"], reto["id"] if reto is not None else None, RETO_SIM, ahora, averia_real, respuesta, elemento, acierto, nota,
                              pistas, medidas, segundos, detalle, intento))
        # Evento de aprendizaje `entrego` (contrato §8.2): solo lo genera el servidor. Sesión: la del formulario si llega y es válida.
        sesion = f.get("sesion", "")
        marca = iso_ms(datetime.fromtimestamp(reloj_pared(), timezone.utc))
        guardar_eventos(a["id"], [{"evento_id": f"entrego_{cursor.lastrowid}", "verbo": "entrego", "simulador": RETO_SIM,
                                   "reto": reto["id"] if reto is not None else None, "escenario": "", "elemento": "",
                                   "resultado": {"nota": nota, "acierto": acierto, "duracionS": segundos},
                                   "sesion": sesion if ID_SESION.match(sesion) else SESION_DESCONOCIDA, "intento": min(intento, 999),
                                   "t_sim_s": 0.0, "marca": marca}])
        con.execute("DELETE FROM diagnosticos WHERE usuario_id=? AND id <= "
                    "(SELECT id FROM diagnosticos WHERE usuario_id=? ORDER BY id DESC LIMIT 1 OFFSET ?)", (a["id"], a["id"], DIAGNOSTICOS_MAX_POR_ALUMNO))
        registrar_actividad(a["id"], "diagnostico", f"Entregó diagnóstico: nota {texto_nota(nota)}" + (" (reto del profesor)" if reto is not None else ""))
        con.commit()
        return {"guardado": True}

    # ----- retos de diagnóstico: lo que hace el profesor -----
    @app.post("/aula/reto")
    def aula_reto():
        if not profesor():
            return redirect(url_for("aula"))
        accion = request.form.get("accion", "")
        if accion not in ACCIONES_RETO:
            abort(400, "Acción no válida.")
        con = bd()
        estado = request.form.get("estado", "pendiente")
        if estado not in ESTADOS + ("todos",):
            estado = "pendiente"
        modulo = limpiar(request.form.get("modulo"), LARGO_MAX["modulo"])
        busca = limpiar(request.form.get("q"), 80)
        if accion == "asignar_lista":
            volver = url_for("aula", estado=estado, modulo=modulo or None, q=busca or None)
        else:
            try:
                uid = int(request.form.get("id", ""))
            except ValueError:
                abort(400, "Alumno no válido.")
            fila = con.execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone()
            if fila is None:
                flash("Ese alumno ya no existe.", "error")
                return redirect(url_for("aula"))
            volver = url_for("aula_alumno", uid=uid) + "#retos"
        if accion == "anular":
            try:
                rid = int(request.form.get("reto", ""))
            except ValueError:
                abort(400, "Reto no válido.")
            n = con.execute("DELETE FROM retos WHERE id=? AND usuario_id=? AND resuelto IS NULL", (rid, uid)).rowcount
            con.commit()
            flash("Reto anulado." if n else "Ese reto ya no está pendiente: no se puede anular.", "ok" if n else "error")
            return redirect(volver)
        if not catalogo:
            flash("Este servidor no tiene el catálogo de averías del simulador fotovoltaico: no se pueden asignar retos.", "error")
            return redirect(volver)
        averia = request.form.get("averia", "")
        if averia != RETO_AZAR and averia not in averias_por_id:
            abort(400, "Avería no válida.")
        titulo = limpiar(request.form.get("titulo"), 80)
        pistas = 1 if request.form.get("pistas") else 0
        candidatos = datos_panel(estado, modulo, busca)["filas"] if accion == "asignar_lista" else [fila]
        aptos = [c for c in candidatos if c["estado"] == "autorizado" and RETO_SIM in ids_asignados(c)]
        baraja = []

        def al_azar(evitar):
            """Reparte las averías como una baraja: no se repite ninguna hasta haberlas dado todas, y a nadie le toca una que ya tiene pendiente."""
            for _ in range(2):
                if not baraja:
                    baraja.extend(averias_por_id)
                    azar.shuffle(baraja)
                for i, candidata in enumerate(baraja):
                    if candidata not in evitar:
                        return baraja.pop(i)
                baraja.clear()
            return azar.choice(list(averias_por_id))

        asignados = repetidos = 0
        ahora = ahora_iso()
        for c in aptos:
            suyas = {r["averia"] for r in con.execute("SELECT averia FROM retos WHERE usuario_id=? AND sim=? AND resuelto IS NULL", (c["id"], RETO_SIM))}
            if averia == RETO_AZAR:
                elegida = al_azar(suyas)
            elif averia in suyas:
                repetidos += 1                      # ya tiene pendiente esa misma avería: no se le duplica
                continue
            else:
                elegida = averia
            con.execute("INSERT INTO retos (usuario_id, sim, averia, titulo, pistas, creado) VALUES (?,?,?,?,?,?)",
                        (c["id"], RETO_SIM, elegida, titulo, pistas, ahora))
            asignados += 1
        con.commit()
        fuera = len(candidatos) - len(aptos)
        partes = [f"Reto de diagnóstico asignado a {asignados} alumno(s)."]
        if fuera:
            partes.append(f"{fuera} no lo recibe(n): solo se asigna a alumnos autorizados que tengan el simulador fotovoltaico.")
        if repetidos:
            partes.append(f"{repetidos} ya tenía(n) pendiente esa misma avería.")
        flash(" ".join(partes), "ok" if asignados else "error")
        return redirect(volver)

    @app.get("/aula/diagnosticos.csv")
    def aula_diagnosticos_csv():
        if not profesor():
            return redirect(url_for("aula"))
        filas = bd().execute(
            "SELECT u.apellidos, u.nombre, u.modulo, d.* FROM diagnosticos d JOIN usuarios u ON u.id=d.usuario_id "
            "ORDER BY u.apellidos COLLATE NOCASE, u.nombre COLLATE NOCASE, d.id").fetchall()
        return descarga_csv(
            "notas_diagnostico.csv",
            ["apellidos", "nombre", "modulo", "averia", "averia_titulo", "respuesta", "elemento_respuesta", "acierto", "nota", "pistas", "medidas",
             "tiempo_s", "fecha_utc", "tipo", "intento"],
            [(d["apellidos"], d["nombre"], d["modulo"], d["averia_real"], titulo_averia(d["averia_real"]), d["averia_respuesta"], d["elemento_respuesta"],
              texto_nota(d["acierto"]), texto_nota(d["nota"]), d["pistas"], d["medidas"], d["segundos"], d["momento"],
              "reto" if d["reto_id"] is not None else "práctica libre", d["intento"]) for d in filas])

    @app.get("/aula/diagnosticos_averias.csv")
    def aula_diagnosticos_averias_csv():
        if not profesor():
            return redirect(url_for("aula"))
        return descarga_csv(
            "resumen_averias.csv", ["averia", "averia_titulo", "entregas", "alumnos", "acierto_pct", "nota_media", "pistas_media", "medidas_media", "tiempo_medio_s"],
            [(r["averia_real"], titulo_averia(r["averia_real"]), r["n"], r["alumnos"], texto_nota(round(r["pct"], 1)), texto_nota(r["nota"]),
              texto_nota(r["pistas"]), texto_nota(round(r["medidas"], 1)), int(r["segundos"])) for r in resumen_por_averia()])

    # ----- registro de actividad -----
    @app.post("/api/uso")
    def api_uso():
        a = alumno()
        if a is None or a["estado"] != "autorizado":
            return "", 204
        pagina = request.form.get("pagina", "")
        if pagina not in PAGINAS_SIMULADOR:
            abort(400, "Página no válida.")
        try:
            segundos = max(0, min(int(float(request.form.get("segundos", "0"))), SEGUNDOS_MAX_POR_ENVIO))
        except ValueError:
            segundos = 0
        try:
            lista = json.loads(request.form.get("eventos", "[]"))
        except ValueError:
            lista = []
        eventos = []
        if isinstance(lista, list):
            for e in lista[:EVENTOS_MAX_POR_ENVIO]:
                texto = limpiar(str(e.get("d", "")), 120) if isinstance(e, dict) else ""
                if texto:
                    eventos.append(texto)
        con = bd()
        if segundos:
            con.execute("INSERT INTO tiempo_uso (usuario_id, dia, pagina, segundos) VALUES (?,?,?,?) "
                        "ON CONFLICT(usuario_id, dia, pagina) DO UPDATE SET segundos = segundos + excluded.segundos",
                        (a["id"], ahora_iso()[:10], pagina, segundos))
        for texto in eventos:
            registrar_actividad(a["id"], "accion", f"{pagina}: {texto}")
        con.commit()
        return "", 204

    # ----- eventos de aprendizaje (comun/CONTRATO.md §8) -----
    def guardar_eventos(uid, eventos):
        """Guarda eventos ya validados de un alumno. Devuelve (guardados, duplicados). Aplica la retención: como mucho
        EVENTOS_MAX_GUARDADOS_POR_ALUMNO por alumno (se borran los más antiguos) y nada recibido hace más de EVENTOS_DIAS_RETENCION días."""
        con = bd()
        ahora = datetime.fromtimestamp(reloj_pared(), timezone.utc)
        recibido = iso_ms(ahora)
        guardados = duplicados = 0
        for orden, ev in enumerate(eventos):
            reto = ev["reto"]
            if reto is not None and con.execute("SELECT 1 FROM retos WHERE id=? AND usuario_id=?", (reto, uid)).fetchone() is None:
                reto = None                                     # un reto que no es suyo: se guarda sin reto
            cursor = con.execute(
                "INSERT OR IGNORE INTO eventos (usuario_id, sesion, evento_id, verbo, simulador, reto_id, escenario, elemento, resultado, intento, "
                "t_sim_s, marca, recibido, orden_lote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (uid, ev["sesion"], ev["evento_id"], ev["verbo"], ev["simulador"], reto, ev["escenario"], ev["elemento"],
                 json.dumps(ev["resultado"], ensure_ascii=False), ev["intento"], ev["t_sim_s"], ev["marca"], recibido, orden))
            if cursor.rowcount:
                guardados += 1
            else:
                duplicados += 1
        if guardados:
            con.execute("DELETE FROM eventos WHERE usuario_id=? AND recibido < ?", (uid, iso_ms(ahora - timedelta(days=EVENTOS_DIAS_RETENCION))))
            sobran = con.execute("SELECT COUNT(*) FROM eventos WHERE usuario_id=?", (uid,)).fetchone()[0] - EVENTOS_MAX_GUARDADOS_POR_ALUMNO
            if sobran > 0:
                con.execute("DELETE FROM eventos WHERE id IN (SELECT id FROM eventos WHERE usuario_id=? "
                            "ORDER BY marca, recibido, orden_lote, id LIMIT ?)", (uid, sobran))
        return guardados, duplicados

    @app.post("/api/eventos")
    def api_eventos():
        # 1 (CSRF) y 2 (más de 32 KB) ya los han resuelto comprobar_csrf y los errorhandler en JSON.
        a = alumno()
        if a is None or a["estado"] != "autorizado":
            return "", 204                                      # sin aula el simulador funciona igual: no se guarda nada
        texto = request.form.get("eventos")
        if texto is None:
            abort(400, "Falta el campo eventos.")
        if len(texto) > LOTE_MAX_CARACTERES:
            abort(400, f"El lote pasa de {LOTE_MAX_CARACTERES} caracteres.")
        try:
            lista = json.loads(texto)
        except ValueError:
            abort(400, "El campo eventos no es JSON.")
        if not isinstance(lista, list) or not 1 <= len(lista) <= EVENTOS_MAX_POR_LOTE:
            abort(400, f"El campo eventos debe ser una lista de 1 a {EVENTOS_MAX_POR_LOTE} eventos.")
        ahora = datetime.fromtimestamp(reloj_pared(), timezone.utc)
        asignados = ids_asignados(a)
        validos, vistos, repetidos = [], set(), 0
        for e in lista:
            ev = validar_evento(e, asignados, ahora)
            if ev is None:
                continue
            if (ev["sesion"], ev["evento_id"]) in vistos:          # repetido dentro del mismo lote: cuenta como duplicado
                repetidos += 1
                continue
            vistos.add((ev["sesion"], ev["evento_id"]))
            validos.append(ev)
        guardados, duplicados = guardar_eventos(a["id"], validos)
        bd().commit()
        duplicados += repetidos
        return {"guardados": guardados, "descartados": len(lista) - guardados - duplicados, "duplicados": duplicados}

    @app.post("/api/registro_sesion")
    def api_registro_sesion():
        """Registro de la simulación de una sesión (las órdenes, para repetirla paso a paso). Petición aparte de los eventos, con su propio
        límite (REGISTRO_SESION_MAX_CARACTERES). Se guarda uno por alumno, sesión y simulador (el último enviado manda)."""
        a = alumno()
        if a is None or a["estado"] != "autorizado":
            return "", 204
        f = request.form
        sesion, simulador, texto = f.get("sesion", ""), f.get("simulador", ""), f.get("registro", "")
        if not ID_SESION.match(sesion):
            abort(400, "Sesión no válida.")
        if simulador not in SIMULADORES_CONTRATO or simulador not in ids_asignados(a):
            abort(400, "Simulador no válido.")
        if not texto or len(texto) > REGISTRO_SESION_MAX_CARACTERES:
            abort(400, "Registro vacío o demasiado grande.")
        try:
            registro = json.loads(texto)
        except ValueError:
            abort(400, "El registro no es JSON.")
        if not isinstance(registro, dict) or registro.get("simulador") not in (None, simulador):
            abort(400, "El registro no es de este simulador.")
        con = bd()
        con.execute("INSERT INTO registros_sesion (usuario_id, sesion, simulador, recibido, registro) VALUES (?,?,?,?,?) "
                    "ON CONFLICT(usuario_id, sesion, simulador) DO UPDATE SET recibido=excluded.recibido, registro=excluded.registro",
                    (a["id"], sesion, simulador, iso_ms(datetime.fromtimestamp(reloj_pared(), timezone.utc)), texto))
        con.execute("DELETE FROM registros_sesion WHERE usuario_id=? AND id NOT IN "
                    "(SELECT id FROM registros_sesion WHERE usuario_id=? ORDER BY recibido DESC, id DESC LIMIT ?)",
                    (a["id"], a["id"], REGISTROS_SESION_MAX_POR_ALUMNO))
        con.commit()
        return {"guardado": True}

    @app.get("/aula/eventos.xapi.json")
    def aula_eventos_xapi():
        if not profesor():
            return redirect(url_for("aula"))
        desde = request.args.get("desde")
        params, donde = [], ""
        if desde is not None:
            d = leer_marca(desde)
            if d is None:
                return {"error": "desde debe ser una fecha ISO 8601, p. ej. 2026-11-13T09:30:00Z."}, 400
            donde, params = "WHERE marca >= ?", [iso_ms(d)]
        casa = request.host_url.rstrip("/") + "/aula"
        filas = bd().execute(f"SELECT * FROM eventos {donde} ORDER BY marca, recibido, orden_lote, id", params).fetchall()
        resp = Response(json.dumps([sentencia_xapi(fila, casa) for fila in filas], ensure_ascii=False), mimetype="application/json")
        resp.headers["Content-Disposition"] = 'inline; filename="eventos.xapi.json"'
        return resp

    @app.get("/aula/alumno/<int:uid>/sesion/<sesion>")
    def aula_alumno_sesion(uid, sesion):
        """Línea de tiempo de una sesión de un alumno (solo profesor): plantilla aula_sesion.html."""
        if not profesor():
            return redirect(url_for("aula"))
        fila = bd().execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone()
        if fila is None or not ID_SESION.match(sesion):
            abort(404)
        eventos = bd().execute("SELECT * FROM eventos WHERE usuario_id=? AND sesion=? ORDER BY marca, recibido, orden_lote, id", (uid, sesion)).fetchall()
        hay_registro = bd().execute("SELECT simulador FROM registros_sesion WHERE usuario_id=? AND sesion=?", (uid, sesion)).fetchall()
        filas = []
        for ev in eventos:
            r = json.loads(ev["resultado"] or "{}")
            partes = [r.get("texto", "")]
            if "valor" in r:
                partes.append(f"{texto_nota(r['valor'])} {r.get('unidad', '')}".strip())
            if "nota" in r:
                partes.append(f"nota {texto_nota(r['nota'])}")
            filas.append({"marca": ev["marca"], "verbo": ev["verbo"], "simulador": ev["simulador"], "elemento": ev["elemento"],
                          "resultado": " · ".join(p for p in partes if p), "t_sim": texto_nota(ev["t_sim_s"])})
        resp = Response(render_template("aula_sesion.html", f=fila, sesion=sesion, filas=filas, registros=[s["simulador"] for s in hay_registro]), mimetype="text/html")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/aula/alumno/<int:uid>/sesion/<sesion>/registro_<simulador>.json")
    def aula_alumno_registro(uid, sesion, simulador):
        if not profesor():
            return redirect(url_for("aula"))
        fila = bd().execute("SELECT registro FROM registros_sesion WHERE usuario_id=? AND sesion=? AND simulador=?", (uid, sesion, simulador)).fetchone()
        if fila is None:
            abort(404)
        return Response(fila["registro"], mimetype="application/json")

    def resumen_alumno(uid):
        con = bd()
        por_pagina = con.execute("SELECT pagina, SUM(segundos) AS s FROM tiempo_uso WHERE usuario_id=? GROUP BY pagina ORDER BY s DESC", (uid,)).fetchall()
        por_dia = con.execute("SELECT dia, SUM(segundos) AS s FROM tiempo_uso WHERE usuario_id=? GROUP BY dia ORDER BY dia DESC LIMIT 30", (uid,)).fetchall()
        total = sum(r["s"] for r in por_pagina)
        entradas = con.execute("SELECT COUNT(*) FROM actividad WHERE usuario_id=? AND tipo='entrada'", (uid,)).fetchone()[0]
        acciones = con.execute("SELECT COUNT(*) FROM actividad WHERE usuario_id=? AND tipo='accion'", (uid,)).fetchone()[0]
        extremos = con.execute("SELECT MIN(momento), MAX(momento) FROM actividad WHERE usuario_id=?", (uid,)).fetchone()
        return {"por_pagina": por_pagina, "por_dia": por_dia, "total": total, "entradas": entradas, "acciones": acciones,
                "primero": extremos[0], "ultimo": extremos[1]}

    def descarga_csv(nombre, cabecera, filas):
        salida = io.StringIO()
        escritor = csv.writer(salida, delimiter=";")
        escritor.writerow(cabecera)
        escritor.writerows(filas)
        resp = Response("\ufeff" + salida.getvalue(), mimetype="text/csv; charset=utf-8")
        resp.headers["Content-Disposition"] = f'attachment; filename="{nombre}"'
        return resp

    @app.get("/aula/alumno/<int:uid>")
    def aula_alumno(uid):
        if not profesor():
            return redirect(url_for("aula"))
        fila = bd().execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone()
        if fila is None:
            abort(404)
        eventos = bd().execute("SELECT momento, tipo, detalle FROM actividad WHERE usuario_id=? ORDER BY id DESC LIMIT 300", (uid,)).fetchall()
        retos = bd().execute("SELECT * FROM retos WHERE usuario_id=? ORDER BY id DESC", (uid,)).fetchall()
        # La sesión de cada entrega sale del evento `entrego` que se guarda con ella (evento_id = 'entrego_<id>'): sin migración y sin tocar bases antiguas.
        diagnosticos = [{**dict(d), "hoja": detalle_legible(d["detalle"]), "sesion": d["sesion"] if d["sesion"] != SESION_DESCONOCIDA else None}
                        for d in bd().execute(
                            "SELECT d.*, (SELECT e.sesion FROM eventos e WHERE e.usuario_id=d.usuario_id AND e.evento_id='entrego_' || d.id) AS sesion "
                            "FROM diagnosticos d WHERE d.usuario_id=? ORDER BY d.id DESC LIMIT 300", (uid,))]
        return render_template("aula_alumno.html", f=fila, r=resumen_alumno(uid), eventos=eventos, hasta=session.get("prof_hasta", 0),
                               retos=retos, diagnosticos=diagnosticos,
                               puede_reto=bool(catalogo) and fila["estado"] == "autorizado" and RETO_SIM in ids_asignados(fila))

    @app.get("/aula/alumno/<int:uid>.csv")
    def aula_alumno_csv(uid):
        if not profesor():
            return redirect(url_for("aula"))
        fila = bd().execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone()
        if fila is None:
            abort(404)
        eventos = bd().execute("SELECT momento, tipo, detalle FROM actividad WHERE usuario_id=? ORDER BY id", (uid,)).fetchall()
        return descarga_csv(f"actividad_{uid}.csv", ["momento_utc", "tipo", "detalle"], [(e["momento"], e["tipo"], e["detalle"]) for e in eventos])

    @app.get("/aula/resumen.csv")
    def aula_resumen_csv():
        if not profesor():
            return redirect(url_for("aula"))
        filas = bd().execute(
            "SELECT u.nombre, u.apellidos, u.modulo, u.correo, u.estado, "
            "COALESCE((SELECT SUM(segundos) FROM tiempo_uso t WHERE t.usuario_id=u.id), 0) AS seg, "
            "(SELECT COUNT(*) FROM actividad a WHERE a.usuario_id=u.id AND a.tipo='entrada') AS entradas, "
            "(SELECT COUNT(*) FROM actividad a WHERE a.usuario_id=u.id AND a.tipo='accion') AS acciones, "
            "(SELECT MAX(momento) FROM actividad a WHERE a.usuario_id=u.id) AS ultimo "
            "FROM usuarios u ORDER BY u.apellidos COLLATE NOCASE, u.nombre COLLATE NOCASE").fetchall()
        return descarga_csv("resumen_aula.csv",
                            ["apellidos", "nombre", "modulo", "correo", "estado", "minutos_de_uso", "entradas", "acciones", "ultimo_acceso_utc"],
                            [(f["apellidos"], f["nombre"], f["modulo"], f["correo"], f["estado"], round(f["seg"] / 60, 1),
                              f["entradas"], f["acciones"], f["ultimo"] or "") for f in filas])

    @app.post("/aula/entrar")
    def aula_entrar():
        clave = f"pin-ip:{ip()}"
        espera = limitador.restante(clave)
        if espera:
            flash(f"Demasiados intentos con el PIN. Espera {max(1, espera // 60)} min.", "error")
            return render_template("aula_pin.html"), 429
        pin = request.form.get("pin", "")[:100]
        if not pin_correcto(pin):
            limitador.fallo(clave)
            flash("PIN incorrecto.", "error")
            return render_template("aula_pin.html"), 401
        limitador.exito(clave)
        session["prof_hasta"] = time.time() + cfg["sesion_profesor_min"] * 60
        token_csrf()
        return redirect(url_for("aula"))

    @app.post("/aula/pin")
    def aula_cambiar_pin():
        if not profesor():
            return redirect(url_for("aula"))
        clave = f"pin-ip:{ip()}"
        espera = limitador.restante(clave)
        if espera:
            flash(f"Demasiados intentos con el PIN. Espera {max(1, espera // 60)} min.", "error")
            return redirect(url_for("aula", vista="pin"))
        actual = request.form.get("pin_actual", "")[:100]
        nuevo = request.form.get("pin_nuevo", "")[:100]
        repetido = request.form.get("pin_repetido", "")[:100]
        if not pin_correcto(actual):
            limitador.fallo(clave)
            flash("El PIN actual no es correcto.", "error")
        elif nuevo != repetido:
            flash("El PIN nuevo y su repetición no coinciden.", "error")
        elif len(nuevo) < PIN_MINIMO or nuevo.strip().lower() in PIN_PROHIBIDOS or nuevo == PIN_POR_DEFECTO:
            flash(f"El PIN nuevo debe tener al menos {PIN_MINIMO} caracteres y no puede ser el de fábrica.", "error")
        else:
            limitador.exito(clave)
            con = bd()
            con.execute("INSERT INTO ajustes (clave, valor) VALUES ('pin_hash', ?) "
                        "ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", (generate_password_hash(nuevo),))
            con.commit()
            flash("PIN del aula cambiado. Úsalo la próxima vez que entres.", "ok")
        return redirect(url_for("aula", vista="pin"))

    @app.post("/aula/salir")
    def aula_salir():
        session.pop("prof_hasta", None)
        flash("Has salido del aula.", "ok")
        return redirect(url_for("aula"))

    @app.post("/aula/accion")
    def aula_accion():
        if not profesor():
            return redirect(url_for("aula"))
        accion = request.form.get("accion", "")
        if accion not in ACCIONES:
            abort(400, "Acción no válida.")
        estado = request.form.get("estado", "pendiente")
        modulo = limpiar(request.form.get("modulo"), LARGO_MAX["modulo"])
        busca = limpiar(request.form.get("q"), 80)
        volver = url_for("aula", estado=estado, modulo=modulo or None, q=busca or None)
        con = bd()
        if accion == "simuladores_lista":
            # El mismo reparto de simuladores para todos los alumnos que muestra ahora la lista (con su filtro de estado, módulo y búsqueda)
            elegidos = ",".join(i for i in IDS_SIMULADORES if request.form.get("sim_" + i))
            ids = [f["id"] for f in datos_panel(estado if estado in ESTADOS + ("todos",) else "pendiente", modulo, busca)["filas"]]
            con.executemany("UPDATE usuarios SET simuladores=? WHERE id=?", [(elegidos, i) for i in ids])
            con.commit()
            flash(f"Simuladores asignados a {len(ids)} alumno(s): {elegidos.replace(',', ', ') or 'ninguno'}.", "ok")
            return redirect(volver)
        if accion == "autorizar_todos":
            sql, params = "UPDATE usuarios SET estado='autorizado', resuelto=? WHERE estado='pendiente'", [ahora_iso()]
            if modulo:
                sql += " AND modulo=? COLLATE NOCASE"
                params.append(modulo)
            n = con.execute(sql, params).rowcount
            con.commit()
            flash(f"{n} alumno(s) autorizados.", "ok")
            return redirect(volver)
        try:
            uid = int(request.form.get("id", ""))
        except ValueError:
            abort(400, "Alumno no válido.")
        fila = con.execute("SELECT * FROM usuarios WHERE id=?", (uid,)).fetchone()
        if fila is None:
            flash("Ese alumno ya no existe.", "error")
            return redirect(volver)
        nombre = f"{fila['nombre']} {fila['apellidos']}"
        if accion in ("autorizar", "rechazar", "pendiente"):
            nuevo = {"autorizar": "autorizado", "rechazar": "rechazado", "pendiente": "pendiente"}[accion]
            con.execute("UPDATE usuarios SET estado=?, resuelto=? WHERE id=?", (nuevo, ahora_iso(), uid))
            con.commit()
            flash(f"{nombre}: {nuevo}.", "ok")
        elif accion == "simuladores":
            elegidos = ",".join(i for i in IDS_SIMULADORES if request.form.get("sim_" + i))
            con.execute("UPDATE usuarios SET simuladores=? WHERE id=?", (elegidos, uid))
            con.commit()
            flash(f"{nombre}: simuladores asignados: {elegidos.replace(',', ', ') or 'ninguno'}.", "ok")
        elif accion == "eliminar":
            con.execute("DELETE FROM usuarios WHERE id=?", (uid,))
            con.commit()
            flash(f"{nombre}: cuenta eliminada.", "ok")
        elif accion == "clave":
            temporal = secrets.token_urlsafe(9)
            con.execute("UPDATE usuarios SET clave_hash=? WHERE id=?", (generate_password_hash(temporal), uid))
            con.commit()
            limitador.exito(f"login-correo:{fila['correo']}")
            # Se muestra en esta respuesta (no por redirección ni cookie) y no se vuelve a ver.
            return render_template("aula_panel.html",
                                   **datos_panel(estado if estado in ESTADOS + ("todos",) else "pendiente", modulo, busca,
                                                 clave_nueva={"nombre": nombre, "correo": fila["correo"], "clave": temporal}))
        else:
            abort(400, "Acción no válida.")
        return redirect(volver)

    return app


def clave_secreta_persistente(ruta):
    """Clave de firma de las sesiones: se crea una vez y se guarda en el volumen de datos."""
    ruta = Path(ruta)
    if ruta.is_file():
        return ruta.read_text().strip()
    clave = secrets.token_hex(32)
    ruta.write_text(clave)
    try:
        ruta.chmod(0o600)
    except OSError:
        pass
    return clave


if __name__ == "__main__":
    aplicacion = crear_app()
    puerto = int(os.environ.get("AULA_PUERTO_INTERNO", "8000"))
    print(f"Aula PCT23 en http://localhost:{puerto}  (profesor: /aula)")
    aplicacion.run(host="0.0.0.0", port=puerto)
