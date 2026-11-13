"""Pruebas de POST /api/registro_sesion y del campo `sesion` de POST /api/reto/resultado (comun/CONTRATO.md §8.2 y §8.3).

Escritas a partir del contrato, solo con la API pública: las respuestas de las peticiones, la lectura del profesor
(`/aula/alumno/<id>/sesion/<sesion>/registro_<simulador>.json` y la página de la sesión) y la exportación xAPI.

    python -m pytest aula_pct23/tests/test_registro_sesion.py -q        (desde gateway_industrial_excelencia)
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_aula as ta  # noqa: E402
import test_eventos as te  # noqa: E402
import test_retos as tr  # noqa: E402

SESION = "sesion_prueba_0001"
# comun/tipos.js
REGISTRO_SESION_MAX_CARACTERES = 1024 * 1024
REGISTROS_SESION_MAX_POR_ALUMNO = 50
SESION_DESCONOCIDA = "sin_sesion"
MARGEN_PETICION = 16 * 1024           # «la petición admite ese tamaño + 16 KB»


def registro(simulador="fotovoltaica", **extra):
    """Un Registro (§2.10) mínimo y bien formado."""
    return {"simulador": simulador, "versionContrato": 1, "semilla": 7, "escenario": None, "pasoFijoS": 2 if simulador == "fotovoltaica" else 0.1,
            "pasos": 5, "ordenes": [{"paso": 2, "orden": {"tipo": "protecciones.abrir", "destino": "QS-101", "origen": "alumno"}}], **extra}


def registro_de_tamano(n, simulador="fotovoltaica"):
    """Texto JSON de un registro con EXACTAMENTE n caracteres (relleno ASCII)."""
    base = len(json.dumps({"simulador": simulador, "relleno": ""}))
    assert n > base
    texto = json.dumps({"simulador": simulador, "relleno": "x" * (n - base)})
    assert len(texto) == n
    return texto


class BaseRegistro(te.Utilidades, ta.Base):
    def setUp(self):
        super().setUp()
        self.alumno, self.prof = self.autorizado()
        self.uid = self.id_de()

    def enviar_registro(self, cliente=None, sesion=SESION, simulador="fotovoltaica", reg=None, texto=None, csrf_url="/cuenta", **extra):
        c = cliente or self.alumno
        if texto is None:
            texto = json.dumps(registro(simulador) if reg is None else reg)
        datos = {"sesion": sesion, "simulador": simulador, "registro": texto, **extra}
        datos["csrf"] = self.token(c, csrf_url)
        return c.post("/api/registro_sesion", data=datos)

    def leer(self, sesion=SESION, simulador="fotovoltaica", uid=None):
        return self.prof.get(f"/aula/alumno/{uid or self.uid}/sesion/{sesion}/registro_{simulador}.json")

    def asignar(self, **sims):
        datos = {"id": str(self.uid), "estado": "autorizado", **{"sim_" + k: "1" for k, v in sims.items() if v}}
        self.assertIn(self.accion(self.prof, "simuladores", **datos).status_code, (200, 302))

    def otro_alumno(self, correo="otro@ejemplo.es"):
        c = self.app.test_client()
        self.registrar(correo=correo, nombre="Otro", apellidos="Alumno")
        self.accion(self.prof, "autorizar", id=str(self.id_de(correo)), estado="pendiente")
        self.entrar(c, correo=correo)
        return c

    def assertError400(self, r, que=""):
        self.assertEqual(r.status_code, 400, f"{que}: {r.get_data(as_text=True)[:200]}")
        self.assertEqual(r.mimetype, "application/json", que)
        d = r.get_json()
        self.assertIs(d.get("guardado"), False, f"{que}: {d}")
        self.assertTrue(d.get("error"), f"{que}: falta el texto de error")

    def assertGuardado(self, r, que=""):
        self.assertEqual((r.status_code, r.get_json()), (200, {"guardado": True}), f"{que}: {r.get_data(as_text=True)[:200]}")


class Respuestas(BaseRegistro):
    def test_guardado_correcto_200_y_el_profesor_lo_lee_tal_cual(self):
        reg = registro()
        self.assertGuardado(self.enviar_registro(reg=reg))
        r = self.leer()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.mimetype, "application/json")
        self.assertEqual(r.get_json(), reg, "el registro guardado debe devolverse tal cual")

    def test_el_registro_sin_campo_simulador_tambien_vale(self):
        sin = registro()
        del sin["simulador"]
        self.assertGuardado(self.enviar_registro(reg=sin))
        self.assertEqual(self.leer().get_json(), sin)

    def test_csrf_ausente_o_falso_400_json_y_no_guarda(self):
        texto = json.dumps(registro())
        for datos in ({"sesion": SESION, "simulador": "fotovoltaica", "registro": texto},
                      {"sesion": SESION, "simulador": "fotovoltaica", "registro": texto, "csrf": "falso-falso-falso"}):
            with self.subTest(datos=list(datos)):
                r = self.alumno.post("/api/registro_sesion", data=datos)
                self.assertEqual(r.status_code, 400)
                self.assertEqual(r.mimetype, "application/json")
                self.assertTrue(r.get_json().get("error"))
        self.assertEqual(self.leer().status_code, 404)

    def test_sin_alumno_autorizado_204_sin_cuerpo_y_no_guarda(self):
        anonimo = self.app.test_client()
        r = self.enviar_registro(anonimo, csrf_url="/entrar")
        self.assertEqual((r.status_code, r.get_data()), (204, b""), "anónimo")
        r = self.enviar_registro(self.prof, csrf_url="/aula")
        self.assertEqual((r.status_code, r.get_data()), (204, b""), "profesor sin cuenta de alumno")
        self.registrar(correo="pendiente@ejemplo.es")
        pendiente = self.app.test_client()
        self.entrar(pendiente, correo="pendiente@ejemplo.es")
        r = self.enviar_registro(pendiente, csrf_url="/pendiente")
        self.assertEqual((r.status_code, r.get_data()), (204, b""), "alumno pendiente")
        self.assertEqual(self.leer().status_code, 404)
        self.assertEqual(self.leer(uid=self.id_de("pendiente@ejemplo.es")).status_code, 404)

    def test_peticiones_mal_formadas_400_json_y_no_guardan(self):
        grande = registro_de_tamano(REGISTRO_SESION_MAX_CARACTERES + 1)
        casos = [
            ("sesión demasiado corta", dict(sesion="corta")),
            ("sesión con caracteres no válidos", dict(sesion="sesion con espacios!!")),
            ("sesión demasiado larga", dict(sesion="s" * 65)),
            ("sesión vacía", dict(sesion="")),
            ("simulador desconocido", dict(simulador="no_existe", reg=registro())),
            ("simulador vacío", dict(simulador="", reg=registro())),
            ("registro vacío", dict(texto="")),
            ("registro mayor del límite (1 048 577 caracteres)", dict(texto=grande)),
            ("registro que no es JSON", dict(texto="{esto no es json")),
            ("registro que es una lista", dict(texto="[1, 2, 3]")),
            ("registro que es un número", dict(texto="42")),
            ("registro que es null", dict(texto="null")),
            ("registro de otro simulador", dict(simulador="fotovoltaica", reg=registro("planta_real"))),
        ]
        for que, kw in casos:
            with self.subTest(que):
                self.assertError400(self.enviar_registro(**kw), que)
        for sesion in ("corta", "s" * 65, "sesion con espacios!!"):
            self.assertEqual(self.leer(sesion=sesion).status_code, 404, sesion)
        self.assertEqual(self.leer().status_code, 404, "nada de lo rechazado debe quedar guardado")

    def test_simulador_no_asignado_al_alumno_400(self):
        self.asignar(planta_real=True)                                  # solo la planta real
        self.assertError400(self.enviar_registro(simulador="fotovoltaica"), "fotovoltaica no asignada")
        self.assertGuardado(self.enviar_registro(simulador="planta_real"), "planta_real asignada")
        self.assertEqual(self.leer(simulador="fotovoltaica").status_code, 404)
        self.assertEqual(self.leer(simulador="planta_real").status_code, 200)


class Limites(BaseRegistro):
    def test_el_limite_propio_es_un_mebibyte_de_caracteres_y_no_los_32_KB_del_resto(self):
        # mucho más de 32 KB, pero dentro del límite propio: se acepta
        medio = registro_de_tamano(200 * 1024)
        self.assertGuardado(self.enviar_registro(sesion="sesion_medio_001", texto=medio), "200 KB")
        self.assertEqual(self.leer(sesion="sesion_medio_001").get_json(), json.loads(medio))
        # exactamente el límite: se acepta; un carácter más: 400 (no 413: la petición admite el límite + 16 KB)
        justo = registro_de_tamano(REGISTRO_SESION_MAX_CARACTERES)
        self.assertGuardado(self.enviar_registro(sesion="sesion_justo_001", texto=justo), "1 048 576 caracteres")
        self.assertEqual(self.leer(sesion="sesion_justo_001").get_json(), json.loads(justo))
        self.assertError400(self.enviar_registro(sesion="sesion_pasa_0001", texto=registro_de_tamano(REGISTRO_SESION_MAX_CARACTERES + 1)),
                            "1 048 577 caracteres")

    def test_peticion_de_mas_de_limite_mas_16_KB_413_json(self):
        enorme = registro_de_tamano(REGISTRO_SESION_MAX_CARACTERES + MARGEN_PETICION + 4096)
        r = self.enviar_registro(texto=enorme)
        self.assertEqual(r.status_code, 413, r.get_data(as_text=True)[:200])
        self.assertEqual(r.mimetype, "application/json")
        self.assertTrue(r.get_json().get("error"))
        self.assertEqual(self.leer().status_code, 404)

    def test_uno_por_alumno_sesion_y_simulador_el_ultimo_sustituye(self):
        self.assertGuardado(self.enviar_registro(reg=registro(pasos=5)))
        self.assertGuardado(self.enviar_registro(reg=registro(pasos=99)))
        self.assertEqual(self.leer().get_json()["pasos"], 99, "el último enviado debe sustituir al anterior")
        # otro simulador en la misma sesión, y otra sesión con el mismo simulador, conviven
        self.assertGuardado(self.enviar_registro(simulador="planta_real", reg=registro("planta_real", pasos=7)))
        self.assertGuardado(self.enviar_registro(sesion="otra_sesion_0002", reg=registro(pasos=3)))
        self.assertEqual(self.leer(simulador="planta_real").get_json()["pasos"], 7)
        self.assertEqual(self.leer(sesion="otra_sesion_0002").get_json()["pasos"], 3)
        self.assertEqual(self.leer().get_json()["pasos"], 99)
        # otro alumno con la misma sesión y simulador no pisa el de este
        otro = self.otro_alumno()
        self.assertGuardado(self.enviar_registro(otro, reg=registro(pasos=1)))
        self.assertEqual(self.leer(uid=self.id_de("otro@ejemplo.es")).get_json()["pasos"], 1)
        self.assertEqual(self.leer().get_json()["pasos"], 99)

    def test_maximo_50_por_alumno_se_borra_el_de_recepcion_mas_antigua(self):
        def sesion(i):
            return f"sesion_{i:06d}"
        for i in range(REGISTROS_SESION_MAX_POR_ALUMNO):
            self.reloj.t += 1
            self.assertGuardado(self.enviar_registro(sesion=sesion(i), reg=registro(pasos=i)), f"registro {i}")
        for i in range(REGISTROS_SESION_MAX_POR_ALUMNO):
            self.assertEqual(self.leer(sesion=sesion(i)).status_code, 200, f"con 50 guardados falta el {i}")
        # sustituir uno existente no cuenta como uno más
        self.reloj.t += 1
        self.assertGuardado(self.enviar_registro(sesion=sesion(10), reg=registro(pasos=1010)))
        for i in range(REGISTROS_SESION_MAX_POR_ALUMNO):
            self.assertEqual(self.leer(sesion=sesion(i)).status_code, 200, f"sustituir no debe borrar nada (falta el {i})")
        # el 51.º borra el más antiguo (el primero), y solo ese
        self.reloj.t += 1
        self.assertGuardado(self.enviar_registro(sesion=sesion(50), reg=registro(pasos=50)))
        self.assertEqual(self.leer(sesion=sesion(0)).status_code, 404, "no se ha borrado el de recepción más antigua")
        self.assertEqual(self.leer(sesion=sesion(50)).get_json()["pasos"], 50)
        for i in range(1, REGISTROS_SESION_MAX_POR_ALUMNO):
            self.assertEqual(self.leer(sesion=sesion(i)).status_code, 200, f"se ha borrado de más: {i}")

    def test_el_tope_es_por_alumno(self):
        otro = self.otro_alumno()
        self.assertGuardado(self.enviar_registro(otro, sesion="sesion_del_otro_1"))
        for i in range(REGISTROS_SESION_MAX_POR_ALUMNO + 1):
            self.reloj.t += 1
            self.enviar_registro(sesion=f"sesion_{i:06d}")
        self.assertEqual(self.leer(sesion="sesion_del_otro_1", uid=self.id_de("otro@ejemplo.es")).status_code, 200,
                         "los registros de un alumno no cuentan para el tope de otro")


class Lectura(BaseRegistro):
    def test_solo_el_profesor_lee_el_registro_y_404_si_no_hay(self):
        self.assertGuardado(self.enviar_registro())
        ruta = f"/aula/alumno/{self.uid}/sesion/{SESION}/registro_fotovoltaica.json"
        for nombre, c in (("alumno", self.alumno), ("anónimo", self.app.test_client())):
            r = c.get(ruta)
            self.assertIn(r.status_code, (302, 303, 401, 403), nombre)
            self.assertNotIn("pasoFijoS", r.get_data(as_text=True), nombre)
        self.assertEqual(self.prof.get(ruta).status_code, 200)
        self.assertEqual(self.leer(simulador="planta_real").status_code, 404)
        self.assertEqual(self.leer(sesion="sesion_inexistente_9").status_code, 404)
        self.assertEqual(self.leer(uid=987654).status_code, 404)

    def test_la_pagina_de_la_sesion_enlaza_cada_registro_guardado(self):
        self.assertGuardado(self.enviar_registro())
        self.assertGuardado(self.enviar_registro(simulador="planta_real", reg=registro("planta_real")))
        r = self.prof.get(f"/aula/alumno/{self.uid}/sesion/{SESION}")
        self.assertEqual(r.status_code, 200, "la sesión con registro pero sin eventos debe verse")
        html = r.get_data(as_text=True)
        for s in ("fotovoltaica", "planta_real"):
            self.assertIn(f"registro_{s}.json", html, f"falta el enlace al registro de {s}")


class SesionEnLaEntrega(te.Utilidades, tr.BaseRetos):
    """`sesion` (opcional) de POST /api/reto/resultado: es el contexto.sesion del evento `entrego` (§8.2)."""

    def contextos_de_entrega(self):
        sentencias = self.de_alumno(self.exportar(self.prof), self.uid)
        entregas = [s for s in sentencias if (s.get("verb") or {}).get("id") == te.VERBOS_XAPI["entrego"]]
        return [json.dumps(s.get("context", {}), ensure_ascii=False) for s in entregas]

    def test_con_sesion_valida_es_la_del_evento(self):
        r = self.entregar(sesion=SESION)
        self.assertEqual((r.status_code, r.get_json()), (200, {"guardado": True}))
        contextos = self.contextos_de_entrega()
        self.assertEqual(len(contextos), 1)
        self.assertIn(SESION, contextos[0])
        self.assertNotIn(SESION_DESCONOCIDA, contextos[0])
        html = self.prof.get(f"/aula/alumno/{self.uid}/sesion/{SESION}").get_data(as_text=True)
        self.assertIn("entrego", html, "la línea de tiempo de esa sesión debe mostrar la entrega")

    def test_sin_sesion_es_sin_sesion(self):
        r = self.entregar()
        self.assertEqual((r.status_code, r.get_json()), (200, {"guardado": True}))
        contextos = self.contextos_de_entrega()
        self.assertEqual(len(contextos), 1)
        self.assertIn(SESION_DESCONOCIDA, contextos[0])
        html = self.prof.get(f"/aula/alumno/{self.uid}/sesion/{SESION_DESCONOCIDA}").get_data(as_text=True)
        self.assertIn("entrego", html)

    def test_sesion_invalida_no_da_error_y_cae_en_sin_sesion(self):
        invalidas = ["corta", "con espacios y !!", "s" * 65, "ñandú_acentuado", "a/b/c/d/e/f/g/h", ""]
        for i, mala in enumerate(invalidas):
            with self.subTest(mala):
                r = self.entregar(sesion=mala, medidas=str(i + 1))
                self.assertEqual((r.status_code, r.get_json()), (200, {"guardado": True}), f"sesion={mala!r} no debe dar error")
        contextos = self.contextos_de_entrega()
        self.assertEqual(len(contextos), len(invalidas))
        for c in contextos:
            self.assertIn(SESION_DESCONOCIDA, c)


if __name__ == "__main__":
    unittest.main()
