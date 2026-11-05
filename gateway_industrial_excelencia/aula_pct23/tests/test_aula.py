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
    def autorizado(self):
        self.registrar()
        prof = self.profesor()
        self.accion(prof, "autorizar", id=str(self.id_de()), estado="pendiente")
        alumno = self.app.test_client()
        self.entrar(alumno)
        return alumno, prof

    def test_alumno_autorizado_ve_el_simulador_con_la_barra_de_sesion(self):
        alumno, _ = self.autorizado()
        self.assertEqual(alumno.get("/").headers["Location"], "/simulador/")
        r = alumno.get("/simulador/")
        html = r.get_data(as_text=True)
        self.assertEqual(r.status_code, 200)
        self.assertIn("Planta de proceso de pasteurización", html)
        self.assertIn('id="aula-barra"', html)
        self.assertIn("Lucía Pérez Gómez", html)
        for pagina in ("manual.html", "automatico.html", "demostracion.html"):
            self.assertEqual(alumno.get("/simulador/" + pagina).status_code, 200, pagina)
        for recurso in ("interfaz.css", "modelo.js", "secuencia.js", "ayuda.js"):
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
        for ruta in ("/simulador/../app.py", "/simulador/%2e%2e/app.py", "/simulador/README.md", "/simulador/tests/modelo.test.js",
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
