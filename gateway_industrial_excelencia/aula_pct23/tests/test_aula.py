"""Pruebas del aula: registro, acceso, autorización por el profesor y protección del simulador.

    python -m unittest discover -s aula_pct23/tests -v        (desde gateway_industrial_excelencia)
"""
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
import app as aula  # noqa: E402

SIMULADOR = RAIZ.parent / "simulador_pct23"
PIN = "482913"
ALUMNO = {"nombre": "Lucía", "apellidos": "Pérez Gómez", "modulo": "Sistemas autónomos", "correo": "Lucia@Ejemplo.es",
          "clave": "contraseña-larga-1", "clave2": "contraseña-larga-1"}


class Reloj:
    def __init__(self): self.t = 1000.0
    def __call__(self): return self.t


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.reloj = Reloj()
        self.app = aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR, "secret_key": "clave-de-pruebas",
                                   "reloj": self.reloj, "modulos": ["Sistemas autónomos"]})
        self.c = self.app.test_client()

    def tearDown(self):
        self.tmp.cleanup()

    # ----- utilidades -----
    def csrf(self, cliente, url="/entrar"):
        html = cliente.get(url).get_data(as_text=True)
        return re.search(r'name="csrf" value="([^"]+)"', html).group(1)

    def post(self, cliente, url, datos, csrf_url="/entrar", **kw):
        d = dict(datos)
        d["csrf"] = self.csrf(cliente, csrf_url)
        return cliente.post(url, data=d, **kw)

    def registrar(self, **cambios):
        d = {**ALUMNO, **cambios}
        return self.post(self.c, "/registro", d, "/registro")

    def entrar(self, cliente, correo=ALUMNO["correo"], clave=ALUMNO["clave"]):
        return self.post(cliente, "/entrar", {"correo": correo, "clave": clave})

    def profesor(self):
        p = self.app.test_client()
        r = self.post(p, "/aula/entrar", {"pin": PIN}, "/aula")
        self.assertEqual(r.status_code, 302)
        return p

    def accion(self, prof, accion, **datos):
        return self.post(prof, "/aula/accion", {"accion": accion, **datos}, "/aula")

    def autorizado(self):
        self.registrar()
        prof = self.profesor()
        self.accion(prof, "autorizar", id=str(self.id_de()), estado="pendiente")
        alumno = self.app.test_client()
        self.entrar(alumno)
        return alumno, prof

    def consulta(self, sql, params=()):
        """Lee la base de datos y cierra la conexión (en Windows un archivo abierto no se puede borrar)."""
        con = sqlite3.connect(Path(self.tmp.name) / "aula.sqlite3")
        con.row_factory = sqlite3.Row
        try:
            return con.execute(sql, params).fetchall()
        finally:
            con.close()

    def id_de(self, correo=ALUMNO["correo"]):
        return self.consulta("SELECT id FROM usuarios WHERE correo=?", (correo.lower(),))[0]["id"]


class Registro(Base):
    def test_registro_correcto_queda_pendiente_y_la_clave_no_se_guarda_en_claro(self):
        r = self.registrar()
        self.assertEqual(r.status_code, 302)
        fila = self.consulta("SELECT * FROM usuarios")[0]
        self.assertEqual((fila["nombre"], fila["apellidos"], fila["modulo"]), ("Lucía", "Pérez Gómez", "Sistemas autónomos"))
        self.assertEqual(fila["correo"], "lucia@ejemplo.es")
        self.assertEqual(fila["estado"], "pendiente")
        self.assertNotIn(ALUMNO["clave"], fila["clave_hash"])
        self.assertTrue(fila["clave_hash"].startswith(("scrypt:", "pbkdf2:")))

    def test_campos_obligatorios_y_formato(self):
        for cambio, texto in (({"nombre": ""}, "nombre"), ({"apellidos": " "}, "apellidos"), ({"modulo": ""}, "módulo"),
                              ({"correo": "no-es-un-correo"}, "correo"), ({"clave": "corta", "clave2": "corta"}, "8 caracteres"),
                              ({"clave2": "otra-distinta-1"}, "no coinciden"), ({"clave": "lucia@ejemplo.es", "clave2": "lucia@ejemplo.es"}, "tu correo")):
            r = self.registrar(**cambio)
            self.assertEqual(r.status_code, 200, cambio)
            self.assertIn(texto, r.get_data(as_text=True), cambio)
        self.assertEqual(self.consulta("SELECT COUNT(*) AS n FROM usuarios")[0]["n"], 0)

    def test_correo_repetido_aunque_cambien_las_mayusculas(self):
        self.registrar()
        r = self.registrar(correo="LUCIA@ejemplo.ES")
        self.assertIn("Ya hay una cuenta", r.get_data(as_text=True))
        self.assertEqual(self.consulta("SELECT COUNT(*) AS n FROM usuarios")[0]["n"], 1)

    def test_el_texto_del_alumno_se_escapa_en_el_aula(self):
        self.registrar(nombre="<script>alert(1)</script>")
        prof = self.profesor()
        html = prof.get("/aula").get_data(as_text=True)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)

    def test_sugiere_los_modulos_configurados(self):
        self.assertIn('<option value="Sistemas autónomos">', self.c.get("/registro").get_data(as_text=True))


class Acceso(Base):
    def test_sin_sesion_se_redirige_a_entrar(self):
        self.assertEqual(self.c.get("/").headers["Location"], "/entrar")
        self.assertEqual(self.c.get("/simulador/").headers["Location"], "/entrar")
        self.assertEqual(self.c.get("/simulador/automatico.html").headers["Location"], "/entrar")

    def test_error_generico_y_mismo_codigo_con_correo_inexistente_o_clave_mala(self):
        self.registrar()
        a = self.entrar(self.app.test_client(), clave="mala-clave-1")
        b = self.entrar(self.app.test_client(), correo="nadie@ejemplo.es", clave="mala-clave-1")
        self.assertEqual((a.status_code, b.status_code), (401, 401))
        self.assertIn("Correo o contraseña incorrectos", a.get_data(as_text=True))
        self.assertIn("Correo o contraseña incorrectos", b.get_data(as_text=True))

    def test_cuenta_pendiente_entra_pero_no_ve_el_simulador(self):
        self.registrar()
        r = self.entrar(self.c)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.c.get("/").headers["Location"], "/pendiente")
        self.assertIn("Esperando autorización", self.c.get("/pendiente").get_data(as_text=True))
        self.assertEqual(self.c.get("/simulador/").headers["Location"], "/pendiente")
        self.assertEqual(self.c.get("/simulador/modelo.js").status_code, 302)

    def test_bloqueo_tras_intentos_fallidos_y_desbloqueo_con_el_tiempo(self):
        self.registrar()
        for _ in range(5):
            self.entrar(self.c, clave="mala-clave-1")
        r = self.entrar(self.c)                       # incluso la clave buena queda bloqueada
        self.assertEqual(r.status_code, 429)
        self.reloj.t += 301
        self.assertEqual(self.entrar(self.c).status_code, 302)

    def test_cerrar_sesion_retira_el_acceso(self):
        self.registrar()
        prof = self.profesor()
        self.accion(prof, "autorizar", id=str(self.id_de()), estado="pendiente")
        self.entrar(self.c)
        self.assertEqual(self.c.get("/simulador/").status_code, 200)
        self.post(self.c, "/salir", {}, "/entrar")
        self.assertEqual(self.c.get("/simulador/").status_code, 302)


class Simulador(Base):
    def test_alumno_autorizado_ve_el_simulador_con_la_barra_de_sesion(self):
        alumno, _ = self.autorizado()
        self.assertEqual(alumno.get("/").headers["Location"], "/simuladores")
        r = alumno.get("/simulador/")
        html = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        self.assertIn("Planta de proceso de pasteurización", html)
        self.assertIn('id="aula-barra"', html)
        self.assertIn("Lucía Pérez Gómez", html)
        for pagina in ("manual.html", "automatico.html", "demostracion.html"):
            self.assertEqual(alumno.get("/simulador/" + pagina).status_code, 200, pagina)
        for recurso in ("css/interfaz.css", "js/modelo/planta.js", "js/control/secuencia.js", "js/interfaz/ayuda.js"):
            with alumno.get("/simulador/" + recurso) as resp:
                self.assertEqual(resp.status_code, 200, recurso)

    def test_quitar_el_acceso_surte_efecto_al_instante(self):
        alumno, prof = self.autorizado()
        self.assertEqual(alumno.get("/simulador/").status_code, 200)
        self.accion(prof, "rechazar", id=str(self.id_de()), estado="autorizado")
        self.assertEqual(alumno.get("/simulador/").status_code, 302)
        self.assertIn("Acceso no concedido", alumno.get("/pendiente").get_data(as_text=True))

    def test_no_se_sirve_nada_fuera_del_simulador(self):
        alumno, _ = self.autorizado()
        for ruta in ("/simulador/../app.py", "/simulador/%2e%2e/app.py", "/simulador/README.md", "/simulador/tests/modelo.test.js", "/simulador/DISENO.md",
                     "/simulador/.git/config", "/simulador/inexistente.html"):
            self.assertEqual(alumno.get(ruta).status_code, 404, ruta)

    def test_el_profesor_con_pin_tambien_puede_abrir_el_simulador(self):
        self.assertEqual(self.profesor().get("/simulador/").status_code, 200)

    def test_cabeceras_de_seguridad(self):
        r = self.c.get("/entrar")
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(r.headers["X-Frame-Options"], "DENY")
        self.assertIn("frame-ancestors 'none'", r.headers["Content-Security-Policy"])
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        self.assertIn("HttpOnly", r.headers["Set-Cookie"])
        self.assertIn("SameSite=Lax", r.headers["Set-Cookie"])


class PlantaReal(Base):
    """El segundo simulador (planta real HTST) se sirve en /planta-real/ con el mismo control de acceso que el simulador de la maqueta."""

    def test_sin_sesion_se_redirige_a_entrar(self):
        for ruta in ("/planta-real/", "/planta-real/css/planta_real.css", "/planta-real/js/layout.js"):
            self.assertEqual(self.c.get(ruta).headers["Location"], "/entrar", ruta)

    def test_un_alumno_pendiente_no_la_ve(self):
        self.registrar()
        self.entrar(self.c)
        self.assertEqual(self.c.get("/planta-real/").headers["Location"], "/pendiente")

    def test_el_alumno_autorizado_ve_la_planta_con_la_barra_del_aula(self):
        alumno, _ = self.autorizado()
        r = alumno.get("/planta-real/")
        html = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        self.assertIn("Planta real HTST", html)
        self.assertIn('id="aula-barra"', html)
        self.assertNotIn("PCT_ES_PROFESOR", html)                       # el panel de averías no es para el alumno
        for recurso in ("css/planta_real.css", "js/layout.js", "js/interfaz/cargador.js", "js/interfaz/pagina.js", "js/modelo/simulacion.js"):
            with alumno.get("/planta-real/" + recurso) as resp:
                self.assertEqual(resp.status_code, 200, recurso)

    def test_la_ventana_del_3d_no_lleva_la_barra(self):
        alumno, _ = self.autorizado()
        r = alumno.get("/planta-real/visor3d.html")
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('id="aula-barra"', r.get_data(as_text=True))

    def test_solo_la_sesion_de_profesor_marca_el_panel_de_averias(self):
        html = self.profesor().get("/planta-real/").get_data(as_text=True)
        self.assertIn("window.PCT_ES_PROFESOR = true", html)
        self.assertLess(html.index("window.PCT_ES_PROFESOR"), html.lower().index("</head>"))
        alumno, _ = self.autorizado()
        self.assertNotIn("PCT_ES_PROFESOR", alumno.get("/planta-real/?profesor=1").get_data(as_text=True))   # el parámetro de la dirección no vale

    def test_no_se_sirve_nada_que_no_sea_de_la_planta(self):
        alumno, _ = self.autorizado()
        for ruta in ("/planta-real/../app.py", "/planta-real/%2e%2e/app.py", "/planta-real/ARQUITECTURA.md", "/planta-real/servir_local.py", "/planta-real/tests/x.js",
                     "/planta-real/js/visor3d_htst/banco_pruebas.html", "/planta-real/.git/config", "/planta-real/inexistente.html"):
            self.assertEqual(alumno.get(ruta).status_code, 404, ruta)

    def test_se_registra_la_pantalla_de_inicio_como_planta_real(self):
        alumno, _ = self.autorizado()
        alumno.get("/planta-real/")
        tipos = [(f["tipo"], f["detalle"]) for f in self.consulta("SELECT tipo, detalle FROM actividad ORDER BY id")]
        self.assertIn(("pagina", "Abrió planta_real"), tipos)

    def test_sin_la_carpeta_de_la_planta_real_da_404(self):
        import tempfile as _tf
        with _tf.TemporaryDirectory(ignore_cleanup_errors=True) as vacia:
            app = aula.crear_app({"pin": PIN, "datos": self.tmp.name + "/otro", "simulador": SIMULADOR, "planta_real": vacia, "secret_key": "x", "reloj": self.reloj})
            cliente = app.test_client()
            self.assertEqual(self.profesor_de(app).get("/planta-real/").status_code, 404)
            self.assertEqual(cliente.get("/planta-real/").status_code, 404)       # sin la carpeta no hay nada que proteger: 404 también sin sesión

    def profesor_de(self, app):
        p = app.test_client()
        self.assertEqual(self.post(p, "/aula/entrar", {"pin": PIN}, "/aula").status_code, 302)
        return p


class AulaDelProfesor(Base):
    def test_sin_pin_no_hay_acceso_ni_acciones(self):
        self.registrar()
        self.assertIn("Escribe el PIN", self.c.get("/aula").get_data(as_text=True))
        r = self.post(self.c, "/aula/accion", {"accion": "autorizar", "id": str(self.id_de())}, "/aula")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.consulta("SELECT estado FROM usuarios")[0]["estado"], "pendiente")

    def test_pin_incorrecto_y_bloqueo(self):
        for _ in range(5):
            r = self.post(self.c, "/aula/entrar", {"pin": "000001"}, "/aula")
            self.assertEqual(r.status_code, 401)
        r = self.post(self.c, "/aula/entrar", {"pin": PIN}, "/aula")
        self.assertEqual(r.status_code, 429)
        self.reloj.t += 301
        self.assertEqual(self.post(self.c, "/aula/entrar", {"pin": PIN}, "/aula").status_code, 302)

    def test_pin_no_valido_impide_arrancar(self):
        for pin in ("", "12345", "cambia-este-pin"):
            with self.assertRaises(RuntimeError, msg=pin):
                aula.crear_app({"pin": pin, "datos": self.tmp.name, "simulador": SIMULADOR, "secret_key": "x"})

    def test_sin_configurar_el_pin_es_12345678_y_el_aula_avisa(self):
        import os
        previo = os.environ.pop("AULA_PIN", None)
        try:
            app = aula.crear_app({"datos": self.tmp.name, "simulador": SIMULADOR, "secret_key": "x"})
        finally:
            if previo is not None:
                os.environ["AULA_PIN"] = previo
        self.assertEqual(app.config["AULA"]["pin"], "12345678")
        p = app.test_client()
        tok = lambda u: re.search(r'name="csrf" value="([^"]+)"', p.get(u).get_data(as_text=True)).group(1)
        self.assertEqual(p.post("/aula/entrar", data={"pin": "12345678", "csrf": tok("/aula")}).status_code, 302)
        html = p.get("/aula").get_data(as_text=True)
        self.assertIn("PIN por defecto en uso (12345678)", html)

    def test_con_un_pin_propio_no_sale_el_aviso(self):
        prof = self.profesor()
        self.assertNotIn("PIN por defecto", prof.get("/aula").get_data(as_text=True))

    # ----- registro de actividad para el profesor -----
    def enviar_uso(self, cliente, pagina="manual", segundos=30, eventos=()):
        import json
        return self.post(cliente, "/api/uso", {"pagina": pagina, "segundos": str(segundos), "eventos": json.dumps(list(eventos))}, "/cuenta")

    def test_se_registran_el_inicio_de_sesion_y_las_pantallas_abiertas(self):
        alumno, _ = self.autorizado()
        alumno.get("/simulador/manual.html")
        alumno.get("/simulador/automatico.html")
        tipos = [(f["tipo"], f["detalle"]) for f in self.consulta("SELECT tipo, detalle FROM actividad ORDER BY id")]
        self.assertIn(("entrada", "Inició sesión"), tipos)
        self.assertIn(("pagina", "Abrió manual"), tipos)
        self.assertIn(("pagina", "Abrió automatico"), tipos)

    def test_el_simulador_manda_tiempo_y_acciones(self):
        alumno, _ = self.autorizado()
        self.assertEqual(self.enviar_uso(alumno, segundos=45, eventos=[{"d": "Iniciar la simulación"}, {"d": "Pulsó g-SOL1"}]).status_code, 204)
        self.enviar_uso(alumno, segundos=30)
        self.assertEqual(self.consulta("SELECT SUM(segundos) s FROM tiempo_uso")[0]["s"], 75)
        acciones = [f["detalle"] for f in self.consulta("SELECT detalle FROM actividad WHERE tipo='accion' ORDER BY id")]
        self.assertEqual(acciones, ["manual: Iniciar la simulación", "manual: Pulsó g-SOL1"])

    def test_el_tiempo_enviado_tiene_tope_y_la_pagina_debe_ser_valida(self):
        alumno, _ = self.autorizado()
        self.enviar_uso(alumno, segundos=99999)
        self.assertEqual(self.consulta("SELECT SUM(segundos) s FROM tiempo_uso")[0]["s"], 120)
        self.assertEqual(self.enviar_uso(alumno, pagina="../../etc").status_code, 400)

    def test_un_alumno_pendiente_no_registra_actividad_de_uso(self):
        self.registrar()
        self.entrar(self.c)
        self.assertEqual(self.enviar_uso(self.c, segundos=30).status_code, 204)
        self.assertEqual(self.consulta("SELECT COUNT(*) n FROM tiempo_uso")[0]["n"], 0)

    def test_el_profesor_ve_la_actividad_del_alumno(self):
        alumno, prof = self.autorizado()
        alumno.get("/simulador/manual.html")
        for _ in range(31):
            self.enviar_uso(alumno, segundos=120, eventos=[{"d": "Parar todo"}] if _ == 0 else [])
        uid = self.id_de()
        html = prof.get(f"/aula/alumno/{uid}").get_data(as_text=True)
        self.assertIn("1 h 02 min", html)
        self.assertIn("manual: Parar todo", html)
        self.assertIn("Abrió manual", html)
        panel = prof.get("/aula?estado=todos").get_data(as_text=True)
        self.assertIn("1 h 02 min", panel)
        csv_alumno = prof.get(f"/aula/alumno/{uid}.csv")
        self.assertEqual(csv_alumno.status_code, 200)
        self.assertIn("manual: Parar todo", csv_alumno.get_data(as_text=True))
        resumen = prof.get("/aula/resumen.csv").get_data(as_text=True)
        self.assertIn("62.0", resumen)

    def test_la_actividad_solo_la_ve_el_profesor(self):
        alumno, _ = self.autorizado()
        uid = self.id_de()
        for ruta in (f"/aula/alumno/{uid}", f"/aula/alumno/{uid}.csv", "/aula/resumen.csv"):
            self.assertEqual(alumno.get(ruta).status_code, 302, ruta)
            self.assertEqual(self.app.test_client().get(ruta).status_code, 302, ruta)

    def test_al_eliminar_la_cuenta_se_borra_su_actividad(self):
        alumno, prof = self.autorizado()
        self.enviar_uso(alumno, segundos=30, eventos=[{"d": "Reiniciar la planta"}])
        self.accion(prof, "eliminar", id=str(self.id_de()), estado="autorizado")
        self.assertEqual(self.consulta("SELECT COUNT(*) n FROM actividad")[0]["n"], 0)
        self.assertEqual(self.consulta("SELECT COUNT(*) n FROM tiempo_uso")[0]["n"], 0)

    def test_el_cambio_de_pin_esta_en_su_propia_pestana(self):
        prof = self.profesor()
        normal = prof.get("/aula").get_data(as_text=True)
        pestana = prof.get("/aula?vista=pin").get_data(as_text=True)
        self.assertIn("Cambiar PIN", normal)
        self.assertNotIn('name="pin_actual"', normal)
        self.assertIn('name="pin_actual"', pestana)
        self.assertNotIn('class="filtros"', pestana)

    # ----- el alumno cambia su contraseña -----
    def cambiar_clave(self, cliente, actual=ALUMNO["clave"], nueva="Nueva-clave-9", repetida=None):
        return self.post(cliente, "/cuenta", {"clave_actual": actual, "clave_nueva": nueva,
                                              "clave_repetida": nueva if repetida is None else repetida}, "/cuenta")

    def test_el_alumno_cambia_su_contrasena(self):
        alumno, _ = self.autorizado()
        self.assertEqual(self.cambiar_clave(alumno).status_code, 302)
        self.assertEqual(self.entrar(self.app.test_client(), clave=ALUMNO["clave"]).status_code, 401)
        self.assertEqual(self.entrar(self.app.test_client(), clave="Nueva-clave-9").status_code, 302)

    def test_cambiar_la_contrasena_exige_la_actual_y_una_valida(self):
        alumno, _ = self.autorizado()
        antes = self.consulta("SELECT clave_hash FROM usuarios")[0]["clave_hash"]
        for caso in (dict(actual="incorrecta1"), dict(nueva="corta"), dict(nueva="Nueva-clave-9", repetida="otra-distinta"),
                     dict(nueva=ALUMNO["clave"])):
            self.cambiar_clave(alumno, **caso)
            self.assertEqual(self.consulta("SELECT clave_hash FROM usuarios")[0]["clave_hash"], antes, caso)

    def test_la_cuenta_requiere_sesion_y_tambien_la_ve_un_alumno_pendiente(self):
        self.assertEqual(self.c.get("/cuenta").headers["Location"], "/entrar")
        self.registrar()
        self.entrar(self.c)
        self.assertEqual(self.c.get("/cuenta").status_code, 200)

    def test_el_profesor_resetea_y_el_alumno_pone_la_suya(self):
        alumno, prof = self.autorizado()
        r = self.accion(prof, "clave", id=str(self.id_de()), estado="autorizado")
        temporal = re.search(r'class="clave">([^<]+)<', r.get_data(as_text=True)).group(1)
        otro = self.app.test_client()
        self.assertEqual(self.entrar(otro, clave=temporal).status_code, 302)
        self.assertEqual(self.cambiar_clave(otro, actual=temporal, nueva="Mi-clave-propia").status_code, 302)
        self.assertEqual(self.entrar(self.app.test_client(), clave="Mi-clave-propia").status_code, 302)

    # ----- cambiar el PIN desde el aula -----
    def cambiar_pin(self, prof, actual=PIN, nuevo="Clase-2026", repetido=None):
        return self.post(prof, "/aula/pin", {"pin_actual": actual, "pin_nuevo": nuevo,
                                             "pin_repetido": nuevo if repetido is None else repetido}, "/aula")

    def test_cambiar_el_pin_desde_el_aula(self):
        prof = self.profesor()
        self.assertEqual(self.cambiar_pin(prof).status_code, 302)
        otro = self.app.test_client()                     # el PIN viejo ya no vale; el nuevo sí
        self.assertEqual(self.post(otro, "/aula/entrar", {"pin": PIN}, "/aula").status_code, 401)
        self.assertEqual(self.post(otro, "/aula/entrar", {"pin": "Clase-2026"}, "/aula").status_code, 302)
        guardado = self.consulta("SELECT valor FROM ajustes WHERE clave='pin_hash'")[0]["valor"]
        self.assertNotIn("Clase-2026", guardado)          # solo se guarda el hash

    def test_cambiar_el_pin_exige_el_actual_y_un_pin_valido(self):
        prof = self.profesor()
        casos = [dict(actual="000000"), dict(nuevo="corto"), dict(nuevo="12345678"), dict(nuevo="Clase-2026", repetido="otra-cosa")]
        for caso in casos:
            self.cambiar_pin(prof, **caso)
            self.assertEqual(self.consulta("SELECT COUNT(*) n FROM ajustes")[0]["n"], 0, caso)
        self.assertEqual(self.post(self.app.test_client(), "/aula/entrar", {"pin": PIN}, "/aula").status_code, 302)

    def test_cambiar_el_pin_requiere_ser_profesor(self):
        r = self.post(self.c, "/aula/pin", {"pin_actual": PIN, "pin_nuevo": "Clase-2026", "pin_repetido": "Clase-2026"}, "/entrar")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.consulta("SELECT COUNT(*) n FROM ajustes")[0]["n"], 0)

    def test_el_pin_cambiado_sobrevive_al_reinicio_y_se_puede_restablecer(self):
        self.cambiar_pin(self.profesor())
        for restablecer, pin_valido in ((False, "Clase-2026"), (True, PIN)):
            app = aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR, "secret_key": "clave-de-pruebas",
                                  "pin_restablecer": restablecer})
            c = app.test_client()
            tok = re.search(r'name="csrf" value="([^"]+)"', c.get("/aula").get_data(as_text=True)).group(1)
            self.assertEqual(c.post("/aula/entrar", data={"pin": pin_valido, "csrf": tok}).status_code, 302, restablecer)

    def test_con_el_pin_de_fabrica_cambiado_ya_no_sale_el_aviso(self):
        app = aula.crear_app({"datos": self.tmp.name, "simulador": SIMULADOR, "secret_key": "x", "pin": "12345678"})
        p = app.test_client()
        tok = lambda u: re.search(r'name="csrf" value="([^"]+)"', p.get(u).get_data(as_text=True)).group(1)
        p.post("/aula/entrar", data={"pin": "12345678", "csrf": tok("/aula")})
        self.assertIn("PIN por defecto en uso", p.get("/aula").get_data(as_text=True))
        p.post("/aula/pin", data={"pin_actual": "12345678", "pin_nuevo": "Clase-2026", "pin_repetido": "Clase-2026", "csrf": tok("/aula")})
        self.assertNotIn("PIN por defecto en uso", p.get("/aula").get_data(as_text=True))

    def test_autorizar_rechazar_y_listados(self):
        self.registrar()
        self.registrar(correo="otro@ejemplo.es", nombre="Marcos", modulo="Control")
        prof = self.profesor()
        html = prof.get("/aula").get_data(as_text=True)
        self.assertIn("Pendientes <span class=\"n\">2</span>", html)
        self.accion(prof, "autorizar", id=str(self.id_de()), estado="pendiente")
        self.accion(prof, "rechazar", id=str(self.id_de("otro@ejemplo.es")), estado="pendiente")
        self.assertIn("Lucía", prof.get("/aula?estado=autorizado").get_data(as_text=True))
        self.assertIn("Marcos", prof.get("/aula?estado=rechazado").get_data(as_text=True))
        self.assertIn("No hay alumnos pendientes", prof.get("/aula").get_data(as_text=True))

    def test_autorizar_a_todos_respeta_el_modulo(self):
        self.registrar()
        self.registrar(correo="otro@ejemplo.es", modulo="Control")
        prof = self.profesor()
        self.post(prof, "/aula/accion", {"accion": "autorizar_todos", "estado": "pendiente", "modulo": "control"}, "/aula")
        estados = {r["correo"]: r["estado"] for r in self.consulta("SELECT correo, estado FROM usuarios")}
        self.assertEqual(estados, {"lucia@ejemplo.es": "pendiente", "otro@ejemplo.es": "autorizado"})

    def test_filtros_por_modulo_y_busqueda(self):
        self.registrar()
        self.registrar(correo="otro@ejemplo.es", nombre="Marcos", modulo="Control")
        prof = self.profesor()
        html = prof.get("/aula?estado=todos&modulo=Control").get_data(as_text=True)
        self.assertIn("Marcos", html)
        self.assertNotIn("Lucía", html)
        html = prof.get("/aula?estado=todos&q=lucia").get_data(as_text=True)
        self.assertIn("Lucía", html)
        self.assertNotIn("Marcos", html)

    def test_clave_nueva_se_muestra_una_vez_y_sustituye_a_la_anterior(self):
        self.registrar()
        prof = self.profesor()
        r = self.accion(prof, "clave", id=str(self.id_de()), estado="pendiente")
        self.assertEqual(r.status_code, 200)
        nueva = re.search(r'<p class="clave">([^<]+)</p>', r.get_data(as_text=True)).group(1)
        self.assertGreaterEqual(len(nueva), 10)
        self.assertNotIn(nueva, prof.get("/aula").get_data(as_text=True))          # no se vuelve a ver
        self.assertEqual(self.entrar(self.app.test_client()).status_code, 401)       # la anterior ya no vale
        self.assertEqual(self.entrar(self.app.test_client(), clave=nueva).status_code, 302)

    def test_eliminar_cuenta(self):
        self.registrar()
        prof = self.profesor()
        self.accion(prof, "eliminar", id=str(self.id_de()), estado="pendiente")
        self.assertEqual(self.consulta("SELECT COUNT(*) AS n FROM usuarios")[0]["n"], 0)
        self.assertEqual(self.entrar(self.app.test_client()).status_code, 401)

    def test_accion_no_valida_o_alumno_inexistente(self):
        prof = self.profesor()
        self.assertEqual(self.accion(prof, "hackear", id="1", estado="pendiente").status_code, 400)
        self.registrar()
        self.assertEqual(self.accion(prof, "autorizar", id="abc", estado="pendiente").status_code, 400)
        self.assertEqual(self.accion(prof, "autorizar", id="9999", estado="pendiente").status_code, 302)

    def test_la_sesion_del_profesor_caduca(self):
        prof = self.profesor()
        self.assertEqual(prof.get("/aula").status_code, 200)
        with prof.session_transaction() as s:
            s["prof_hasta"] = 1.0                                  # ya pasó
        self.assertIn("Escribe el PIN", prof.get("/aula").get_data(as_text=True))

    def test_salir_del_aula(self):
        prof = self.profesor()
        self.post(prof, "/aula/salir", {}, "/aula")
        self.assertIn("Escribe el PIN", prof.get("/aula").get_data(as_text=True))


class Seguridad(Base):
    def test_los_formularios_exigen_token_csrf(self):
        self.registrar()
        for url, datos in (("/registro", ALUMNO), ("/entrar", {"correo": ALUMNO["correo"], "clave": ALUMNO["clave"]}),
                           ("/aula/entrar", {"pin": PIN}), ("/salir", {}), ("/aula/accion", {"accion": "autorizar", "id": "1"})):
            self.c.get("/entrar")                                   # crea la sesión con su token
            self.assertEqual(self.c.post(url, data=datos).status_code, 400, url)
            self.assertEqual(self.c.post(url, data={**datos, "csrf": "falso"}).status_code, 400, url)

    def test_salud(self):
        self.assertEqual(self.c.get("/salud").get_json(), {"estado": "ok"})

    def test_la_clave_de_sesion_se_crea_una_vez_y_se_conserva(self):
        app1 = aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR})
        app2 = aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR})
        self.assertEqual(app1.config["SECRET_KEY"], app2.config["SECRET_KEY"])
        self.assertGreaterEqual(len(app1.config["SECRET_KEY"]), 32)


class DetrasDeProxy(Base):
    """Con nginx delante, el bloqueo por intentos debe ser por cliente real y no por la IP del proxy."""

    def app_con(self, proxy):
        return aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR, "secret_key": "clave-de-pruebas",
                               "reloj": self.reloj, "proxy": proxy}).test_client()

    def fallar(self, cliente, ip, veces=5):
        for _ in range(veces):
            self.post(cliente, "/entrar", {"correo": ALUMNO["correo"], "clave": "mala-clave-1"},
                      headers={"X-Forwarded-For": ip})

    def test_con_proxy_cada_cliente_tiene_su_propio_bloqueo(self):
        c = self.app_con(True)
        self.fallar(c, "10.0.0.1")
        malo = self.post(c, "/entrar", {"correo": ALUMNO["correo"], "clave": "otra"}, headers={"X-Forwarded-For": "10.0.0.1"})
        # otro alumno, desde otra IP y con otro correo (el bloqueo por correo protege la cuenta atacada aparte)
        otro = self.post(c, "/entrar", {"correo": "otro@ejemplo.es", "clave": "otra"}, headers={"X-Forwarded-For": "10.0.0.2"})
        self.assertEqual(malo.status_code, 429)
        self.assertNotEqual(otro.status_code, 429)

    def test_sin_proxy_la_cabecera_no_sirve_para_esquivar_el_bloqueo(self):
        c = self.app_con(False)
        self.fallar(c, "10.0.0.1")
        r = self.post(c, "/entrar", {"correo": "otro@ejemplo.es", "clave": "otra"}, headers={"X-Forwarded-For": "10.0.0.99"})
        self.assertEqual(r.status_code, 429)         # sigue siendo la misma IP (la del proxy): la cabecera se ignora


class ElegirSimulador(Base):
    def test_sin_sesion_o_pendiente_no_se_ve_la_eleccion(self):
        self.assertEqual(self.c.get("/simuladores").headers["Location"], "/entrar")

    def test_el_alumno_autorizado_ve_las_tres_tarjetas_con_su_imagen_3d(self):
        alumno, _ = self.autorizado()
        self.assertEqual(alumno.get("/").headers["Location"], "/simuladores")
        r = alumno.get("/simuladores")
        html = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        for ruta, imagen in (("/simulador/", "maqueta.jpg"), ("/planta-real/", "planta_real.jpg"), ("/fotovoltaica/", "fotovoltaica.jpg")):
            self.assertIn(f'href="{ruta}"', html)
            self.assertIn("img/sim/" + imagen, html)
            self.assertEqual(alumno.get("/static/img/sim/" + imagen).status_code, 200, imagen)

    def test_la_barra_del_simulador_enlaza_con_la_eleccion(self):
        alumno, _ = self.autorizado()
        self.assertIn('href="/simuladores"', alumno.get("/simulador/").get_data(as_text=True))

    def test_el_alumno_autorizado_abre_la_instalacion_fotovoltaica_con_la_barra_del_aula(self):
        alumno, _ = self.autorizado()
        r = alumno.get("/fotovoltaica/")
        self.assertEqual(r.status_code, 200)
        html = r.get_data(as_text=True)
        self.assertIn("Instalación fotovoltaica", html)
        self.assertIn('id="aula-barra"', html)
        self.assertEqual(alumno.get("/fotovoltaica/js/layout.js").status_code, 200)
        self.assertEqual(alumno.get("/fotovoltaica/tests/modelo_sol.test.js").status_code, 404)
        self.assertEqual(self.c.get("/fotovoltaica/").headers["Location"], "/entrar")


class AsignarSimuladores(Base):
    """El profesor decide qué simuladores ve cada alumno (NULL = todos, como hasta ahora)."""

    def asignar(self, prof, **sims):
        datos = {"id": str(self.id_de()), "estado": "autorizado"}
        datos.update({"sim_" + k: "1" for k, v in sims.items() if v})
        return self.accion(prof, "simuladores", **datos)

    def test_por_defecto_ve_todos(self):
        alumno, _ = self.autorizado()
        self.assertIsNone(self.consulta("SELECT simuladores FROM usuarios")[0]["simuladores"])
        for ruta in ("/simulador/", "/planta-real/", "/fotovoltaica/"):
            self.assertEqual(alumno.get(ruta).status_code, 200, ruta)

    def test_con_dos_asignados_ve_solo_esas_dos_tarjetas_y_el_tercero_da_403(self):
        alumno, prof = self.autorizado()
        self.asignar(prof, maqueta=True, fotovoltaica=True)
        html = alumno.get("/simuladores").get_data(as_text=True)
        self.assertIn('href="/simulador/"', html)
        self.assertIn('href="/fotovoltaica/"', html)
        self.assertNotIn('href="/planta-real/"', html)
        r = alumno.get("/planta-real/")
        self.assertEqual(r.status_code, 403)
        self.assertIn("no te ha asignado", r.get_data(as_text=True))
        self.assertEqual(alumno.get("/fotovoltaica/").status_code, 200)

    def test_el_codigo_compartido_de_la_maqueta_sigue_abierto_aunque_no_la_tenga_asignada(self):
        alumno, prof = self.autorizado()
        self.asignar(prof, fotovoltaica=True)
        self.assertEqual(alumno.get("/simulador/").status_code, 403)                      # la página de la maqueta, no
        for recurso in ("js/interfaz/scada/canvas.js", "css/interfaz.css", "img/logo-politecnico.png"):
            self.assertEqual(alumno.get("/simulador/" + recurso).status_code, 200, recurso)  # el código que usan los otros simuladores, sí

    def test_con_uno_solo_asignado_entra_directo(self):
        alumno, prof = self.autorizado()
        self.asignar(prof, planta_real=True)
        r = alumno.get("/simuladores")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(r.headers["Location"], "/planta-real/")
        self.assertEqual(alumno.get("/").headers["Location"], "/simuladores")

    def test_sin_ninguno_asignado_se_le_explica(self):
        alumno, prof = self.autorizado()
        self.asignar(prof)
        self.assertEqual(self.consulta("SELECT simuladores FROM usuarios")[0]["simuladores"], "")
        r = alumno.get("/simuladores")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Aún no tienes simuladores", r.get_data(as_text=True))
        for ruta in ("/simulador/", "/planta-real/", "/fotovoltaica/"):
            self.assertEqual(alumno.get(ruta).status_code, 403, ruta)

    def test_el_profesor_con_el_pin_ve_todos_siempre(self):
        _, prof = self.autorizado()
        self.asignar(prof)
        for ruta in ("/simulador/", "/planta-real/", "/fotovoltaica/"):
            self.assertEqual(prof.get(ruta).status_code, 200, ruta)

    def test_asignar_a_toda_la_lista(self):
        alumno, prof = self.autorizado()
        self.registrar(correo="otra@ejemplo.es", nombre="Otra", apellidos="Alumna")
        self.accion(prof, "simuladores_lista", estado="todos", sim_planta_real="1")
        for fila in self.consulta("SELECT simuladores FROM usuarios"):
            self.assertEqual(fila["simuladores"], "planta_real")
        self.assertEqual(alumno.get("/fotovoltaica/").status_code, 403)

    def test_solo_el_profesor_puede_asignar(self):
        alumno, _ = self.autorizado()
        r = self.post(alumno, "/aula/accion", {"accion": "simuladores", "id": str(self.id_de()), "sim_maqueta": "1"}, "/simuladores")
        self.assertEqual(r.status_code, 302)
        self.assertIsNone(self.consulta("SELECT simuladores FROM usuarios")[0]["simuladores"])

    def test_el_panel_del_aula_muestra_y_guarda_las_casillas(self):
        _, prof = self.autorizado()
        html = prof.get("/aula?estado=autorizado").get_data(as_text=True)
        for nombre in ("sim_maqueta", "sim_planta_real", "sim_fotovoltaica"):
            self.assertIn(f'name="{nombre}"', html)
        self.assertIn("Asignar a la lista", html)
        self.asignar(prof, maqueta=True)
        self.assertIn("1 de 3", prof.get("/aula?estado=autorizado").get_data(as_text=True))

    def test_una_base_de_datos_anterior_sin_la_columna_se_actualiza_y_todos_siguen_viendo_todo(self):
        otra = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        try:
            con = sqlite3.connect(Path(otra.name) / "aula.sqlite3")
            con.executescript("""CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, apellidos TEXT NOT NULL, modulo TEXT NOT NULL,
                correo TEXT NOT NULL UNIQUE COLLATE NOCASE, clave_hash TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'pendiente', creado TEXT NOT NULL, resuelto TEXT);
                INSERT INTO usuarios (nombre, apellidos, modulo, correo, clave_hash, estado, creado) VALUES ('A','B','M','a@b.es','x','autorizado','2025-01-01');""")
            con.commit()
            con.close()
            app = aula.crear_app({"pin": PIN, "datos": otra.name, "simulador": SIMULADOR, "secret_key": "k"})
            con = sqlite3.connect(Path(otra.name) / "aula.sqlite3")
            try:
                self.assertIn("simuladores", [c[1] for c in con.execute("PRAGMA table_info(usuarios)")])
                self.assertIsNone(con.execute("SELECT simuladores FROM usuarios").fetchone()[0])
            finally:
                con.close()
            self.assertEqual(app.test_client().get("/salud").status_code, 200)
        finally:
            otra.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
