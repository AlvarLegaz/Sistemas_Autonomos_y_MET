"""Aula PCT23: registro, acceso y autorización de alumnos delante del simulador.

    - Los alumnos se registran (nombre, apellidos, módulo, correo y contraseña) y entran con correo y contraseña.
    - Una cuenta nueva queda *pendiente*: solo puede ver su estado hasta que el profesor la autorice.
    - El profesor entra al aula con un PIN (variable AULA_PIN), autoriza o rechaza alumnos y puede darles una clave nueva.
    - El simulador (carpeta simulador_pct23) solo se sirve a alumnos autorizados o al profesor con el PIN puesto.

Arranque local:   AULA_PIN=482913 python app.py        (http://localhost:8000)
Con Docker:       ver README.md
"""
import contextlib
import hmac
import csv
import html
import io
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import (Flask, Response, abort, flash, g, redirect, render_template, request,
                   send_from_directory, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import safe_join

ESTADOS = ("pendiente", "autorizado", "rechazado")
ACCIONES = ("autorizar", "rechazar", "pendiente", "eliminar", "clave", "autorizar_todos")
PIN_POR_DEFECTO = "12345678"       # el aula arranca con este PIN si no se define AULA_PIN (la pantalla del aula avisa)
PIN_PROHIBIDOS = {"", "cambia-este-pin"}
PIN_MINIMO = 6
EXTENSIONES_SIMULADOR = {".html", ".css", ".js", ".png", ".svg", ".ico", ".json"}
CORREO = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
LARGO_MAX = {"nombre": 80, "apellidos": 120, "modulo": 80, "correo": 254}
CLAVE_MINIMA = 8
PAGINAS_SIMULADOR = ("index", "manual", "automatico", "demostracion")
SEGUNDOS_MAX_POR_ENVIO = 120
EVENTOS_MAX_POR_ENVIO = 30
EVENTOS_MAX_POR_ALUMNO = 3000
HASH_FALSO = generate_password_hash("clave-inexistente-para-igualar-tiempos")


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
    resuelto      TEXT
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
"""


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
        if cfg.get("pin_restablecer"):
            con.execute("DELETE FROM ajustes WHERE clave='pin_hash'")
        con.commit()
    limitador = Limitador(cfg["max_intentos"], cfg["bloqueo_s"], cfg.get("reloj", time.monotonic))
    app.limitador = limitador

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

    def token_csrf():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(24)
        return session["csrf"]

    @app.context_processor
    def contexto():
        return {"csrf": token_csrf, "modulos": cfg["modulos"], "alumno_sesion": alumno(), "profesor": profesor(),
                "pin_por_defecto": cfg["pin"] == PIN_POR_DEFECTO and pin_guardado() is None, "pin_defecto_valor": PIN_POR_DEFECTO}

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
        if request.path.startswith("/simulador/"):
            resp.headers["Cache-Control"] = "private, no-cache"          # solo para quien ha entrado; se revalida
        elif request.endpoint != "static":
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.errorhandler(400)
    def error_400(e):
        return render_template("error.html", titulo="Petición no válida", texto=getattr(e, "description", "")), 400

    @app.errorhandler(404)
    def error_404(_):
        return render_template("error.html", titulo="No encontrado", texto="Esa página no existe."), 404

    @app.errorhandler(413)
    def error_413(_):
        return render_template("error.html", titulo="Demasiado grande", texto="El formulario es demasiado grande."), 413

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
        return redirect("/simulador/" if a["estado"] == "autorizado" else url_for("pendiente"))

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
            return redirect("/simulador/")
        return render_template("pendiente.html", a=a)

    # ----- simulador (protegido) -----
    @app.get("/simulador/", defaults={"ruta": "index.html"})
    @app.get("/simulador/<path:ruta>")
    def simulador(ruta):
        a = alumno()
        if not profesor() and not (a and a["estado"] == "autorizado"):
            return redirect(url_for("entrar" if a is None else "pendiente"))
        partes = Path(ruta).parts
        if any(p.startswith(".") or p in ("tests", "__pycache__") for p in partes):
            abort(404)
        ext = Path(ruta).suffix.lower()
        if ext not in EXTENSIONES_SIMULADOR:
            abort(404)
        if ext != ".html":
            return send_from_directory(cfg["simulador"], ruta, max_age=0)
        destino = safe_join(str(cfg["simulador"]), ruta)
        if destino is None or not Path(destino).is_file():
            abort(404)
        texto = Path(destino).read_text(encoding="utf-8")
        nombre = f"{a['nombre']} {a['apellidos']}" if a else "Profesor"
        pagina = Path(ruta).stem
        if a is not None and a["estado"] == "autorizado" and pagina in PAGINAS_SIMULADOR:
            registrar_actividad(a["id"], "pagina", f"Abrió {pagina}")
            bd().commit()
        if pagina != "visor3d":                       # la ventana aparte del visor 3D no lleva la barra del aula
            barra = render_template("barra_simulador.html", nombre=nombre, es_profesor=profesor(), con_cuenta=a is not None,
                                    pagina=pagina if pagina in PAGINAS_SIMULADOR else "index")
            fin = texto.lower().rfind("</body>")
            texto = texto[:fin] + barra + texto[fin:] if fin != -1 else texto + barra
        resp = Response(texto, mimetype="text/html")
        resp.headers["Cache-Control"] = "no-store"
        return resp

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
        return render_template("aula_panel.html", **datos)

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
            f"(SELECT MAX(momento) FROM actividad a WHERE a.usuario_id=u.id) AS ultimo "
            f"FROM usuarios u {where} ORDER BY apellidos COLLATE NOCASE, nombre COLLATE NOCASE LIMIT 500",
            params).fetchall()
        cuentas = {e: 0 for e in ESTADOS}
        for e, n in bd().execute("SELECT estado, COUNT(*) FROM usuarios GROUP BY estado"):
            cuentas[e] = n
        modulos_bd = [r[0] for r in bd().execute("SELECT DISTINCT modulo FROM usuarios ORDER BY modulo COLLATE NOCASE")]
        return {"filas": filas, "estado": estado, "modulo": modulo, "q": busca, "cuentas": cuentas,
                "modulos_bd": modulos_bd, "clave_nueva": clave_nueva, "hasta": session.get("prof_hasta", 0)}

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
        return render_template("aula_alumno.html", f=fila, r=resumen_alumno(uid), eventos=eventos, hasta=session.get("prof_hasta", 0))

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
