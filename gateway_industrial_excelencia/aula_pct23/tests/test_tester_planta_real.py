"""PRUEBAS AÑADIDAS POR EL TESTER (no son del autor del aula): ataques de ruta y de acceso contra /planta-real/ y /simulador/.

Complementan `PlantaReal` de test_aula.py con más variantes de salto de directorio, mayúsculas, métodos y tipos de archivo.
Ejecutar:  python -m pytest -q aula_pct23/tests/test_tester_planta_real.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_aula import Base  # noqa: E402


class AtaquesDeRuta(Base):
    def alumno(self):
        return self.profesor()      # sesión con acceso (el control de acceso ya lo cubren las pruebas de test_aula.py)

    RUTAS_DE_SALTO = (
        "/planta-real/../app.py", "/planta-real/%2e%2e/app.py", "/planta-real/%2e%2e%2fapp.py", "/planta-real/..%2fapp.py",
        "/planta-real/..%5capp.py", "/planta-real/js/..%5c..%5capp.py", "/planta-real/%252e%252e/app.py", "/planta-real/js/../../app.py",
        "/planta-real/js/../../../etc/passwd", "/planta-real/..;/app.py", "/planta-real/js/layout.js%00.png", "/planta-real/%2e%2e/%2e%2e/etc/passwd",
        "/simulador/../app.py", "/simulador/%2e%2e%2fapp.py", "/simulador/js/..%5c..%5capp.py",
    )

    def test_ningun_salto_de_directorio_devuelve_contenido(self):
        p = self.alumno()
        for ruta in self.RUTAS_DE_SALTO:
            r = p.get(ruta)
            self.assertIn(r.status_code, (301, 302, 400, 404), f"{ruta} -> {r.status_code}")
            cuerpo = r.get_data(as_text=True)
            self.assertNotIn("def crear_app", cuerpo, ruta)
            self.assertNotIn("root:x:", cuerpo, ruta)

    def test_el_banco_de_pruebas_no_se_sirve_ni_con_otras_formas(self):
        p = self.alumno()
        for ruta in ("/planta-real/js/visor3d_htst/banco_pruebas.html", "/planta-real/js/visor3d_htst/banco_pruebas.html/",
                     "/planta-real/js/visor3d_htst//banco_pruebas.html", "/planta-real/js/visor3d_htst/./banco_pruebas.html",
                     "/planta-real/js/visor3d_htst/%62anco_pruebas.html", "/planta-real/js/visor3d_htst/banco_pruebas.html?x=1"):
            self.assertEqual(p.get(ruta).status_code, 404, ruta)

    def test_solo_se_sirven_las_extensiones_permitidas(self):
        p = self.alumno()
        for ruta in ("/planta-real/ARQUITECTURA.md", "/planta-real/servir_local.py", "/planta-real/modelos/LEEME.md", "/planta-real/modelos/x.glb",
                     "/planta-real/js/layout.js.bak", "/planta-real/js/layout.JS.map", "/planta-real/index.html.old", "/planta-real/tests/modelo_ayuda.js",
                     "/planta-real/tests/", "/planta-real/js/__pycache__/x.js", "/planta-real/.env", "/planta-real/js/.hidden.js"):
            self.assertEqual(p.get(ruta).status_code, 404, ruta)

    def test_los_metodos_que_escriben_no_estan_permitidos(self):
        p = self.alumno()
        for metodo in ("post", "put", "delete", "patch"):
            r = getattr(p, metodo)("/planta-real/js/layout.js")
            self.assertIn(r.status_code, (302, 400, 405), f"{metodo} -> {r.status_code}")

    def test_sin_sesion_nada_de_la_planta_ni_del_visor_aparte(self):
        for ruta in ("/planta-real/visor3d.html", "/planta-real/js/averias/catalogo.js", "/planta-real/js/visor3d_htst/escena_planta.js",
                     "/planta-real/css/planta_real.css", "/planta-real/?averia=HTST-00"):
            r = self.c.get(ruta)
            self.assertEqual(r.status_code, 302, ruta)
            self.assertEqual(r.headers["Location"], "/entrar", ruta)

    def test_el_flag_de_profesor_no_se_cuela_por_la_direccion_ni_en_el_visor_del_alumno(self):
        # el alumno (sin sesión de profesor) nunca recibe window.PCT_ES_PROFESOR; el profesor sí, solo en la planta
        self.assertNotIn("PCT_ES_PROFESOR", self.c.get("/planta-real/?profesor=1").get_data(as_text=True))
        html = self.profesor().get("/planta-real/").get_data(as_text=True)
        self.assertIn("PCT_ES_PROFESOR", html)

    def test_la_planta_no_lleva_cache_y_las_cabeceras_de_seguridad_se_mantienen(self):
        r = self.profesor().get("/planta-real/js/layout.js")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(r.headers.get("X-Frame-Options"), "DENY")
        self.assertIn("default-src 'self'", r.headers.get("Content-Security-Policy", ""))
        self.assertIn("no-cache", r.headers.get("Cache-Control", ""))


if __name__ == "__main__":
    unittest.main()
