"""Pruebas de la API de eventos de aprendizaje del aula (comun/CONTRATO.md §8, criterios A1–A10).

Escritas a partir del contrato, sin mirar la implementación. Todo se comprueba por la API pública (respuestas de /api/eventos,
la línea de tiempo del profesor y la exportación xAPI), no por el nombre de las tablas.

    python -m pytest aula_pct23/tests/test_eventos.py -q        (desde gateway_industrial_excelencia)
"""
import json
import re
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_aula as ta  # noqa: E402
import test_retos as tr  # noqa: E402

SESION = "sesion_prueba_0001"
# comun/tipos.js · VERBOS_XAPI
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
LOTE_MAX_CARACTERES = 24000
EVENTOS_MAX_GUARDADOS_POR_ALUMNO = 20000


class Utilidades:
    """Mezcla para las dos bases (ta.Base y tr.BaseRetos)."""

    def marca(self, i=0):
        # Hora del reloj de pruebas del servidor + i segundos: nunca «más de 24 h en el futuro», sea cual sea el reloj que use el servidor.
        return datetime.fromtimestamp(self.reloj.t + i, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def evento(self, i, verbo="acciono", sim="fotovoltaica", sesion=SESION, segundo=None, **cambios):
        e = {"id": f"ev{i}", "verbo": verbo, "objeto": {"simulador": sim, "elemento": "QS-101"}, "resultado": {"texto": f"paso-{i:05d}"},
             "contexto": {"sesion": sesion, "intento": 1, "tSimS": 12.5}, "marca": self.marca(i if segundo is None else segundo)}
        for k, v in cambios.items():
            e[k] = v
        return e

    def enviar(self, cliente, eventos, csrf_url="/cuenta", texto=None, **extra):
        datos = {"eventos": texto if texto is not None else json.dumps(eventos), **extra, "csrf": self.token(cliente, csrf_url)}
        return cliente.post("/api/eventos", data=datos)

    def token(self, cliente, url):
        html = cliente.get(url, follow_redirects=True).get_data(as_text=True)
        m = re.search(r'name="csrf" value="([^"]+)"', html)
        self.assertIsNotNone(m, f"no hay csrf en {url}")
        return m.group(1)

    def exportar(self, prof, **params):
        r = prof.get("/aula/eventos.xapi.json", query_string=params)
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True)[:200])
        datos = r.get_json()
        self.assertIsInstance(datos, list, "la exportación xAPI debe ser una lista de sentencias")
        return datos

    def de_alumno(self, sentencias, uid):
        return [s for s in sentencias if str(((s.get("actor") or {}).get("account") or {}).get("name")) == str(uid)]

    def assertJsonError(self, r, codigo):
        self.assertEqual(r.status_code, codigo, r.get_data(as_text=True)[:200])
        self.assertEqual(r.mimetype, "application/json")
        datos = r.get_json()
        self.assertEqual(datos.get("guardados"), 0)
        self.assertTrue(datos.get("error"), "falta el texto de error")


class BaseEventos(Utilidades, ta.Base):
    def setUp(self):
        super().setUp()
        self.alumno, self.prof = self.autorizado()
        self.uid = self.id_de()


class Csrf(BaseEventos):
    def test_A1_sin_csrf_o_con_uno_falso_400_json(self):
        lote = json.dumps([self.evento(1)])
        for datos in ({"eventos": lote}, {"eventos": lote, "csrf": "falso-falso-falso"}):
            with self.subTest(datos=list(datos)):
                self.assertJsonError(self.alumno.post("/api/eventos", data=datos), 400)
        self.assertEqual(self.de_alumno(self.exportar(self.prof), self.uid), [])


class SinAlumno(BaseEventos):
    def test_A2_anonimo_y_profesor_204_sin_guardar(self):
        anonimo = self.app.test_client()
        r = self.enviar(anonimo, [self.evento(1)], "/entrar")
        self.assertEqual((r.status_code, r.get_data()), (204, b""))
        r = self.enviar(self.prof, [self.evento(2)], "/aula")
        self.assertEqual((r.status_code, r.get_data()), (204, b""))
        self.assertEqual(self.exportar(self.prof), [])

    def test_A2_alumno_pendiente_204(self):
        c = self.app.test_client()
        self.registrar(correo="pendiente@ejemplo.es")
        self.entrar(c, correo="pendiente@ejemplo.es")
        r = self.enviar(c, [self.evento(1)], "/pendiente")
        self.assertEqual(r.status_code, 204)
        self.assertEqual(self.exportar(self.prof), [])


class Lotes(BaseEventos):
    def lote_desordenado(self):
        # ev1 es la más tardía, ev2 la más temprana: la línea de tiempo se ordena por marca, no por el orden del lote
        return [self.evento(1, segundo=20), self.evento(2, segundo=0), self.evento(3, segundo=10)]

    def test_A3_lote_valido_200_y_linea_de_tiempo_en_orden(self):
        self.registrar(correo="otro@ejemplo.es", nombre="Otro", apellidos="Alumno")
        otro = self.id_de("otro@ejemplo.es")
        r = self.enviar(self.alumno, self.lote_desordenado(), usuario=str(otro))
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True)[:200])
        self.assertEqual(r.get_json(), {"guardados": 3, "descartados": 0, "duplicados": 0})
        html = self.prof.get(f"/aula/alumno/{self.uid}/sesion/{SESION}").get_data(as_text=True)
        posiciones = [html.find(f"paso-{i:05d}") for i in (2, 3, 1)]
        self.assertTrue(all(p >= 0 for p in posiciones), f"la línea de tiempo no muestra los tres eventos: {posiciones}")
        self.assertEqual(posiciones, sorted(posiciones), "la línea de tiempo no está en orden de marca")
        # el alumno es el de la sesión aunque el cuerpo diga otro
        self.assertNotIn("paso-0000", self.prof.get(f"/aula/alumno/{otro}/sesion/{SESION}").get_data(as_text=True))
        self.assertEqual(len(self.de_alumno(self.exportar(self.prof), self.uid)), 3)
        self.assertEqual(self.de_alumno(self.exportar(self.prof), otro), [])

    def test_A3_la_linea_de_tiempo_es_solo_del_profesor(self):
        self.enviar(self.alumno, [self.evento(1)])
        for c in (self.alumno, self.app.test_client()):
            r = c.get(f"/aula/alumno/{self.uid}/sesion/{SESION}")
            self.assertEqual(r.status_code, 302)
            self.assertTrue(r.headers["Location"].endswith("/aula"))

    def test_A4_eventos_mal_formados_400_json_sin_guardar(self):
        valido = self.evento(1)
        relleno = json.dumps([valido])
        relleno = relleno[:-1] + " " * (LOTE_MAX_CARACTERES + 1 - len(relleno)) + "]"
        self.assertEqual(len(relleno), LOTE_MAX_CARACTERES + 1)
        casos = {
            "no es JSON": "esto no es json",
            "objeto": json.dumps(valido),
            "lista vacía": "[]",
            "51 eventos": json.dumps([self.evento(i) for i in range(EVENTOS_MAX_POR_LOTE + 1)]),
            "más de 24 000 caracteres": relleno,
        }
        for nombre, texto in casos.items():
            with self.subTest(nombre):
                self.assertJsonError(self.enviar(self.alumno, None, texto=texto), 400)
        with self.subTest("sin campo eventos"):
            self.assertJsonError(self.alumno.post("/api/eventos", data={"csrf": self.token(self.alumno, "/cuenta")}), 400)
        self.assertEqual(self.de_alumno(self.exportar(self.prof), self.uid), [])

    def test_A4_cincuenta_eventos_si_caben(self):
        r = self.enviar(self.alumno, [self.evento(i) for i in range(EVENTOS_MAX_POR_LOTE)])
        self.assertEqual(r.get_json(), {"guardados": 50, "descartados": 0, "duplicados": 0})

    def test_A5_peticion_de_mas_de_32_KB_413_json(self):
        r = self.enviar(self.alumno, None, texto="x" * (40 * 1024))
        self.assertJsonError(r, 413)

    def test_A6_cada_evento_invalido_se_descarta_sin_tumbar_el_lote(self):
        self.accion(self.prof, "simuladores", id=str(self.uid), sim_fotovoltaica="1")         # solo la fotovoltaica
        lote = [
            self.evento(1),
            self.evento(2, verbo="hackeo"),
            self.evento(3, verbo="entrego"),
            self.evento(4, resultado={"nota": 11}),
            self.evento(5, sim="planta_real"),
        ]
        r = self.enviar(self.alumno, lote)
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True)[:200])
        self.assertEqual(r.get_json(), {"guardados": 1, "descartados": 4, "duplicados": 0})

    def test_A6_mas_descartes_del_contrato(self):
        lote = [
            self.evento(1, sim="simulador_inventado"),
            self.evento(2, id="id con espacios"),
            self.evento(3, contexto={"sesion": "corta", "intento": 1, "tSimS": 0}),
            self.evento(4, contexto={"sesion": SESION, "intento": 0, "tSimS": 0}),
            self.evento(5, contexto={"sesion": SESION, "intento": 1, "tSimS": -1}),
            self.evento(6, marca="ayer por la tarde"),
            self.evento(7, marca=datetime.fromtimestamp(self.reloj.t + 25 * 3600, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
            self.evento(8, resultado={"acierto": 0.7}),
            self.evento(9, resultado={"duracionS": 90000}),
            self.evento(10, resultado={"texto": "x" * 500}),                                   # se recorta, no se descarta
            self.evento(11, campo_desconocido=1),                                               # se ignora
        ]
        r = self.enviar(self.alumno, lote)
        self.assertEqual(r.get_json(), {"guardados": 2, "descartados": 9, "duplicados": 0})

    def test_A7_reenviar_el_mismo_lote_da_duplicados(self):
        lote = self.lote_desordenado()
        self.assertEqual(self.enviar(self.alumno, lote).get_json(), {"guardados": 3, "descartados": 0, "duplicados": 0})
        self.assertEqual(self.enviar(self.alumno, lote).get_json(), {"guardados": 0, "descartados": 0, "duplicados": 3})
        self.assertEqual(len(self.de_alumno(self.exportar(self.prof), self.uid)), 3)
        # mismo id en otra sesión no es duplicado
        otra = [self.evento(1, sesion="otra_sesion_0002")]
        self.assertEqual(self.enviar(self.alumno, otra).get_json(), {"guardados": 1, "descartados": 0, "duplicados": 0})


class Entrega(Utilidades, tr.BaseRetos):
    def test_A8_reto_resultado_sigue_igual_y_deja_un_evento_entrego(self):
        r = self.entregar(sesion=SESION)
        self.assertEqual((r.status_code, r.get_json()), (200, {"guardado": True}))
        sentencias = self.de_alumno(self.exportar(self.prof), self.uid)
        entregas = [s for s in sentencias if (s.get("verb") or {}).get("id") == VERBOS_XAPI["entrego"]]
        self.assertEqual(len(entregas), 1, json.dumps(sentencias)[:500])
        self.assertIn("7.5", json.dumps(entregas[0]), "la sentencia de entrega no lleva la nota")

    def test_ficha_enlace_ver_sesion_solo_si_hay_sesion(self):
        ficha = f"/aula/alumno/{self.uid}"
        enlace = f"/aula/alumno/{self.uid}/sesion/{SESION}"
        self.entregar()                                   # sin sesión
        html = self.prof.get(ficha).get_data(as_text=True)
        self.assertNotIn("Ver sesión", html)
        self.assertNotIn("/sesion/", html)
        self.entregar(sesion=SESION)
        html = self.prof.get(ficha).get_data(as_text=True)
        self.assertEqual(html.count("Ver sesión"), 1, "debe haber enlace solo en la entrega con sesión")
        self.assertIn(enlace, html)


class Xapi(BaseEventos):
    def test_A9_solo_el_profesor_y_sin_datos_personales(self):
        self.enviar(self.alumno, [self.evento(1, verbo="inicio"), self.evento(2, verbo="midio")])
        for nombre, c in (("anónimo", self.app.test_client()), ("alumno", self.alumno)):
            with self.subTest(nombre):
                r = c.get("/aula/eventos.xapi.json")
                self.assertIn(r.status_code, (302, 303, 401, 403))
                self.assertNotIn("actor", r.get_data(as_text=True))
        sentencias = self.exportar(self.prof)
        self.assertEqual(len(sentencias), 2)
        texto = json.dumps(sentencias, ensure_ascii=False)
        for dato in (ta.ALUMNO["nombre"], ta.ALUMNO["apellidos"], ta.ALUMNO["correo"].lower(), "mbox"):
            self.assertNotIn(dato, texto)
        for s in sentencias:
            self.assertIn(s["verb"]["id"], VERBOS_XAPI.values())
            cuenta = s["actor"]["account"]
            self.assertTrue(cuenta.get("homePage"))
            self.assertEqual(str(cuenta.get("name")), str(self.uid))
            self.assertFalse({"name", "mbox", "mbox_sha1sum"} & set(s["actor"]), "el actor lleva nombre o correo")
        r = self.prof.get("/aula/eventos.xapi.json?desde=xx")
        self.assertEqual(r.status_code, 400)


class Retencion(BaseEventos):
    def test_A10_con_20000_guardados_uno_nuevo_borra_el_mas_antiguo(self):
        n = 0
        while n < EVENTOS_MAX_GUARDADOS_POR_ALUMNO:
            lote = [{"id": f"r{i}", "verbo": "acciono", "objeto": {"simulador": "fotovoltaica"},
                     "contexto": {"sesion": SESION, "intento": 1, "tSimS": 0}, "marca": self.marca(i)}
                    for i in range(n, n + EVENTOS_MAX_POR_LOTE)]
            r = self.enviar(self.alumno, lote)
            self.assertEqual(r.get_json(), {"guardados": EVENTOS_MAX_POR_LOTE, "descartados": 0, "duplicados": 0}, f"lote desde {n}")
            n += EVENTOS_MAX_POR_LOTE
        nuevo = [{"id": "r_nuevo", "verbo": "acciono", "objeto": {"simulador": "fotovoltaica"},
                  "contexto": {"sesion": SESION, "intento": 1, "tSimS": 0}, "marca": self.marca(n)}]
        self.assertEqual(self.enviar(self.alumno, nuevo).get_json(), {"guardados": 1, "descartados": 0, "duplicados": 0})
        sentencias = self.de_alumno(self.exportar(self.prof), self.uid)
        self.assertEqual(len(sentencias), EVENTOS_MAX_GUARDADOS_POR_ALUMNO)
        horas = sorted(datetime.fromisoformat(s["timestamp"].replace("Z", "+00:00")) for s in sentencias)
        self.assertEqual(horas[0], datetime.fromtimestamp(self.reloj.t + 1, timezone.utc), "no se ha borrado el más antiguo")
        self.assertEqual(horas[-1], datetime.fromtimestamp(self.reloj.t + n, timezone.utc))


if __name__ == "__main__":
    unittest.main()
