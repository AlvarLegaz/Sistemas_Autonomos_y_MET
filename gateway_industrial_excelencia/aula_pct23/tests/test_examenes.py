"""Pruebas de los exámenes de práctica (fotovoltaica): el profesor desbloquea una práctica y elige los intentos; el alumno la entrega desde el simulador.

    python -m pytest aula_pct23/tests -q        (desde gateway_industrial_excelencia)
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_retos as tr  # noqa: E402

aula = tr.aula


class BaseExamen(tr.BaseRetos):
    def examen(self, accion="asignar", **datos):
        d = {"accion": accion, "practica": "P2", "intentos": "1", **datos}
        if accion != "asignar_lista":
            d.setdefault("id", str(self.uid))
        return self.post(self.prof, "/aula/examen", {k: v for k, v in d.items() if v is not None}, "/aula")

    def examenes(self):
        return self.consulta("SELECT * FROM examenes ORDER BY id")

    def entregar_examen(self, cliente=None, **cambios):
        d = {"examen": str(self.examenes()[0]["id"]), "sim": "fotovoltaica", "nota": "8",
             "detalle": json.dumps({"practica": "P2", "pasos": 7, "fallos": 1})}
        d.update(cambios)
        return self.post(cliente or self.alumno, "/api/examen/resultado", d, "/cuenta")


class ApiExamen(BaseExamen):
    def test_sin_examen_no_hay_nada_y_sin_sesion_es_401(self):
        self.assertEqual(self.alumno.get("/api/examen?sim=fotovoltaica").get_json(), {"examen": None})
        self.assertEqual(self.app.test_client().get("/api/examen?sim=fotovoltaica").status_code, 401)

    def test_el_profesor_desbloquea_y_el_alumno_lo_recibe_con_sus_intentos(self):
        r = self.examen(intentos="3")
        self.assertEqual(r.status_code, 302)
        self.assertIn(f"/aula/alumno/{self.uid}", r.headers["Location"])
        fila = self.examenes()[0]
        self.assertEqual((fila["usuario_id"], fila["sim"], fila["practica"], fila["intentos_max"], fila["intentos"], fila["entregado"], fila["nota"]),
                         (self.uid, "fotovoltaica", "P2", 3, 0, None, None))
        e = self.alumno.get("/api/examen?sim=fotovoltaica").get_json()["examen"]
        self.assertEqual((e["practica"], e["intentos_max"], e["intentos"], e["titulo"]), ("P2", 3, 0, "El campo A produce la mitad"))
        self.assertEqual(self.alumno.get("/api/examen?sim=otro").get_json(), {"examen": None})

    def test_los_intentos_se_acotan_de_1_a_5(self):
        for pedido, esperado in (("0", 1), ("", 1), ("x", 1), ("9", 5), ("2", 2)):
            with self.subTest(pedido=pedido):
                self.examen(practica="P1", intentos=pedido)
                self.assertEqual(self.examenes()[-1]["intentos_max"], esperado)
                self.examen("anular", examen=str(self.examenes()[-1]["id"]))

    def test_practica_invalida_es_400(self):
        self.assertEqual(self.examen(practica="P9").status_code, 400)
        self.assertEqual(self.examen(practica=None).status_code, 400)
        self.assertEqual(self.examenes(), [])

    def test_no_se_duplica_el_mismo_examen_abierto_pero_si_otra_practica(self):
        self.examen(); self.examen()
        self.assertEqual(len(self.examenes()), 1)
        self.examen(practica="P3")
        self.assertEqual(len(self.examenes()), 2)

    def test_solo_a_alumnos_autorizados_con_el_simulador(self):
        pendiente = self.otro_alumno(correo="pepe@ejemplo.es", autorizar=False)
        uid = self.id_de("pepe@ejemplo.es")
        r = self.post(self.prof, "/aula/examen", {"accion": "asignar", "id": str(uid), "practica": "P1", "intentos": "1"}, "/aula")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.examenes(), [])
        self.assertEqual(pendiente.get("/api/examen?sim=fotovoltaica").get_json(), {"examen": None})

    def test_asignar_a_la_lista(self):
        otro = self.otro_alumno()
        r = self.post(self.prof, "/aula/examen", {"accion": "asignar_lista", "estado": "autorizado", "practica": "P4", "intentos": "2"}, "/aula")
        self.assertEqual(r.status_code, 302)
        self.assertEqual({f["usuario_id"] for f in self.examenes()}, {self.uid, self.id_de("marcos@ejemplo.es")})
        self.assertEqual(otro.get("/api/examen?sim=fotovoltaica").get_json()["examen"]["practica"], "P4")

    def test_solo_el_profesor_puede_desbloquear(self):
        r = self.post(self.alumno, "/aula/examen", {"accion": "asignar", "id": str(self.uid), "practica": "P1", "intentos": "1"}, "/cuenta")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.examenes(), [])


class ResultadoExamen(BaseExamen):
    def setUp(self):
        super().setUp()
        self.examen(intentos="2")

    def test_el_intento_cuenta_y_se_guarda_la_mejor_nota_con_su_hoja(self):
        r = self.entregar_examen(nota="6")
        self.assertEqual(r.get_json(), {"guardado": True, "intentos": 1, "intentos_max": 2, "quedan": 1})
        self.assertEqual(self.alumno.get("/api/examen?sim=fotovoltaica").get_json()["examen"]["intentos"], 1)
        r = self.entregar_examen(nota="4", detalle=json.dumps({"peor": True}))
        self.assertEqual(r.get_json(), {"guardado": True, "intentos": 2, "intentos_max": 2, "quedan": 0})
        fila = self.examenes()[0]
        self.assertEqual((fila["nota"], fila["intentos"]), (6.0, 2))
        self.assertIn("pasos", fila["detalle"]); self.assertNotIn("peor", fila["detalle"])

    def test_sin_intentos_ya_no_se_puede_entregar_ni_se_ofrece(self):
        self.entregar_examen(nota="5"); self.entregar_examen(nota="9")
        r = self.entregar_examen(nota="10")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.examenes()[0]["nota"], 9.0)
        self.assertEqual(self.alumno.get("/api/examen?sim=fotovoltaica").get_json(), {"examen": None})

    def test_la_nota_se_acota_y_un_detalle_roto_se_descarta(self):
        self.entregar_examen(nota="99", detalle="no es json")
        fila = self.examenes()[0]
        self.assertEqual((fila["nota"], fila["detalle"]), (10.0, ""))

    def test_no_se_puede_entregar_el_examen_de_otro_alumno(self):
        otro = self.otro_alumno()
        r = self.entregar_examen(otro)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.examenes()[0]["intentos"], 0)

    def test_examen_inexistente_o_simulador_erroneo_es_400(self):
        self.assertEqual(self.entregar_examen(examen="999").status_code, 400)
        self.assertEqual(self.entregar_examen(examen="x").status_code, 400)
        self.assertEqual(self.entregar_examen(sim="maqueta").status_code, 400)

    def test_queda_en_la_actividad_del_alumno(self):
        self.entregar_examen(nota="7.5")
        act = self.consulta("SELECT tipo, detalle FROM actividad WHERE tipo='examen'")
        self.assertEqual(len(act), 1)
        self.assertIn("intento 1 de 2", act[0]["detalle"]); self.assertIn("7,5", act[0]["detalle"])


class FichaExamen(BaseExamen):
    def test_la_ficha_muestra_el_formulario_el_estado_y_permite_retirar(self):
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn('id="examen"', ficha); self.assertIn('name="practica"', ficha); self.assertIn('name="intentos"', ficha)
        self.examen(intentos="2")
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn("0 de 2", ficha); self.assertIn("Sin empezar", ficha); self.assertIn("Retirar", ficha)
        self.entregar_examen(nota="8")
        self.assertIn("En curso", self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True))
        self.entregar_examen(nota="9")
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn("Cerrado", ficha); self.assertIn("<b>9</b>", ficha); self.assertNotIn("Retirar", ficha)

    def test_retirar_solo_un_examen_abierto(self):
        self.examen()
        eid = str(self.examenes()[0]["id"])
        self.entregar_examen(nota="5")           # intentos_max = 1: queda cerrado
        self.examen("anular", examen=eid)
        self.assertEqual(len(self.examenes()), 1)
        self.examen(practica="P1")
        abierto = str(self.examenes()[-1]["id"])
        self.examen("anular", examen=abierto)
        self.assertEqual(len(self.examenes()), 1)

    def test_el_panel_tiene_el_formulario_de_la_lista(self):
        panel = self.prof.get("/aula?estado=autorizado").get_data(as_text=True)
        self.assertIn('id="examen-lista"', panel); self.assertIn("Desbloquear examen", panel)


class InformeExamen(BaseExamen):
    HOJA = {"practica": "P2", "titulo": "El campo A produce la mitad", "nota": 8.5, "intento": 1, "resumenMedidas": "5 de 7", "resumenRespuestas": "1 de 1", "peligros": 0,
            "respuestas": [{"pregunta": "¿Qué elemento interrumpe la cadena?", "elegida": "El fusible F-101 (fundido)", "correcta": "El fusible F-101 (fundido)", "ok": True}],
            "cuaderno": [{"hora": "21 jun · 12:03", "instrumento": "pinza", "modo": "DC", "puntos": "STR-101.+", "texto": "0,00 A", "peligro": False}],
            "pasos": [{"paso": 1, "titulo": "Mide STR-102 con la pinza", "ok": True}]}

    def setUp(self):
        super().setUp()
        self.examen(intentos="2")
        self.entregar_examen(nota="8.5", detalle=json.dumps(self.HOJA))

    def test_el_profesor_descarga_el_informe_con_nota_respuestas_y_medidas(self):
        eid = self.examenes()[0]["id"]
        r = self.prof.get(f"/aula/examen/{eid}/informe.html")
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r.headers["Content-Disposition"])
        self.assertIn("informe_examen_", r.headers["Content-Disposition"]); self.assertTrue(r.headers["Content-Disposition"].endswith('_P2.html"'))
        html = r.get_data(as_text=True)
        for texto in ("Pérez Gómez, Lucía", "8,5 / 10", "Intentos 1 de 2", "El fusible F-101 (fundido)", "✓ Correcta", "STR-101.+", "Mide STR-102 con la pinza", "5 de 7"):
            self.assertIn(texto, html)

    def test_el_informe_escapa_lo_que_escribe_el_alumno(self):
        malo = dict(self.HOJA, respuestas=[{"pregunta": "<script>alert(1)</script>", "elegida": "<img src=x onerror=1>", "correcta": "x", "ok": False}])
        self.entregar_examen(nota="9", detalle=json.dumps(malo))
        html = self.prof.get(f"/aula/examen/{self.examenes()[0]['id']}/informe.html").get_data(as_text=True)
        self.assertNotIn("<script>alert", html); self.assertNotIn("<img src=x", html); self.assertIn("&lt;script&gt;", html)

    def test_sin_hoja_el_informe_lo_dice_y_solo_el_profesor_lo_ve(self):
        self.consulta("SELECT 1")
        eid = self.examenes()[0]["id"]
        self.assertEqual(self.alumno.get(f"/aula/examen/{eid}/informe.html").status_code, 302)
        self.assertEqual(self.prof.get("/aula/examen/9999/informe.html").status_code, 404)

    def test_la_hoja_admite_hasta_12000_caracteres_y_se_descarta_si_pasa(self):
        grande = json.dumps({"relleno": "x" * 11000})
        self.entregar_examen(nota="9", detalle=grande)
        self.assertEqual(len(self.examenes()[0]["detalle"]), len(grande))
        self.examen(practica="P1"); abierto = self.examenes()[-1]["id"]
        self.entregar_examen(examen=str(abierto), nota="3", detalle=json.dumps({"relleno": "x" * 12100}))
        self.assertEqual(self.examenes()[-1]["detalle"], "")

    def test_csv_de_notas_de_examenes(self):
        r = self.prof.get("/aula/examenes.csv")
        self.assertEqual(r.status_code, 200)
        texto = r.get_data(as_text=True)
        self.assertIn("apellidos;nombre;modulo;simulador;practica;titulo;intentos_usados;intentos_max;nota;estado;ultima_entrega_utc", texto)
        self.assertIn("Pérez Gómez;Lucía", texto); self.assertIn(";fotovoltaica;P2;El campo A produce la mitad;1;2;8,5;abierto;", texto)
        self.assertEqual(self.alumno.get("/aula/examenes.csv").status_code, 302)

    def test_la_ficha_enlaza_el_informe_y_el_csv(self):
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn(f"/aula/examen/{self.examenes()[0]['id']}/informe.html", ficha); self.assertIn("/aula/examenes.csv", ficha)


if __name__ == "__main__":
    unittest.main()
