"""Pruebas de los exámenes de práctica de la planta real HTST (y de que no se mezclan con los de la fotovoltaica).

    python -m pytest aula_pct23/tests -q        (desde gateway_industrial_excelencia)
"""
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_examenes as te  # noqa: E402

PLANTA, FV = "planta_real", "fotovoltaica"


class BasePlanta(te.BaseExamen):
    """Alumno autorizado con todos los simuladores (por defecto, NULL = ven todos)."""

    def examen_sim(self, valor, accion="asignar", **datos):
        d = {"accion": accion, "practica": valor, "intentos": "1", **datos}
        if accion != "asignar_lista":
            d.setdefault("id", str(self.uid))
        return self.post(self.prof, "/aula/examen", {k: v for k, v in d.items() if v is not None}, "/aula")

    def entregar_planta(self, cliente=None, **cambios):
        fila = [e for e in self.examenes() if e["sim"] == PLANTA][0]
        d = {"examen": str(fila["id"]), "sim": PLANTA, "nota": "7",
             "detalle": json.dumps({"practica": fila["practica"], "titulo": "Control todo o nada del calentador", "nota": 7.0, "intento": 1,
                                    "resumenMedidas": "4 de 6", "resumenRespuestas": "2 de 3", "peligros": 0,
                                    "respuestas": [{"pregunta": "¿Qué banco se desconecta primero?", "elegida": "KM-202", "correcta": "KM-202", "ok": True}],
                                    "cuaderno": [{"hora": "00:12:30", "instrumento": "multimetro", "modo": "V", "puntos": "KM-201:A1", "texto": "24,0 V", "peligro": False}],
                                    "pasos": [{"paso": 1, "titulo": "Mide la bobina de KM-201", "ok": True}]})}
        d.update(cambios)
        return self.post(cliente or self.alumno, "/api/examen/resultado", d, "/cuenta")


class AsignarPlanta(BasePlanta):
    def test_se_pueden_asignar_h1_h2_h3_con_sus_intentos(self):
        for valor, intentos in (("planta_real:H1", "1"), ("planta_real:H2", "3"), ("planta_real:H3", "5")):
            self.assertEqual(self.examen_sim(valor, intentos=intentos).status_code, 302)
        filas = self.examenes()
        self.assertEqual([(f["sim"], f["practica"], f["intentos_max"]) for f in filas], [(PLANTA, "H1", 1), (PLANTA, "H2", 3), (PLANTA, "H3", 5)])

    def test_la_practica_de_un_simulador_no_vale_para_el_otro(self):
        self.assertEqual(self.examen_sim("fotovoltaica:H1").status_code, 400)
        self.assertEqual(self.examen_sim("planta_real:P2").status_code, 400)
        self.assertEqual(self.examen_sim("H1", sim="fotovoltaica").status_code, 400)      # sim aparte
        self.assertEqual(self.examen_sim("otro:H1").status_code, 400)
        self.assertEqual(self.examenes(), [])

    def test_sin_sim_la_practica_sigue_siendo_de_la_fotovoltaica_y_con_sim_aparte_vale(self):
        self.examen_sim("P1")
        self.examen_sim("H2", sim=PLANTA)
        self.assertEqual([(f["sim"], f["practica"]) for f in self.examenes()], [(FV, "P1"), (PLANTA, "H2")])

    def test_el_mensaje_nombra_el_simulador(self):
        self.examen_sim("planta_real:H1")
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn("Control todo o nada del calentador", ficha); self.assertIn("Planta real HTST", ficha)

    def test_un_alumno_sin_la_planta_asignada_no_lo_recibe_ni_se_le_asigna(self):
        self.post(self.prof, "/aula/accion", {"accion": "simuladores", "id": str(self.uid), "sim_fotovoltaica": "1"}, "/aula")
        r = self.examen_sim("planta_real:H1")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.examenes(), [])
        self.assertEqual(self.alumno.get("/api/examen?sim=planta_real").get_json(), {"examen": None})
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertNotIn("planta_real:H1", ficha); self.assertIn("fotovoltaica:P1", ficha)

    def test_asignar_a_la_lista_solo_llega_a_quien_tiene_la_planta(self):
        sin_planta = self.otro_alumno()
        self.post(self.prof, "/aula/accion", {"accion": "simuladores", "id": str(self.id_de("marcos@ejemplo.es")), "sim_fotovoltaica": "1"}, "/aula")
        self.post(self.prof, "/aula/examen", {"accion": "asignar_lista", "estado": "autorizado", "practica": "planta_real:H3", "intentos": "2"}, "/aula")
        self.assertEqual({f["usuario_id"] for f in self.examenes()}, {self.uid})
        self.assertEqual(sin_planta.get("/api/examen?sim=planta_real").get_json(), {"examen": None})

    def test_los_selectores_agrupan_por_simulador(self):
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn('<optgroup label="Planta real HTST">', ficha); self.assertIn('<optgroup label="Instalación fotovoltaica">', ficha)
        self.assertIn('value="planta_real:H2"', ficha); self.assertIn('value="fotovoltaica:P4"', ficha)
        panel = self.prof.get("/aula?estado=autorizado").get_data(as_text=True)
        self.assertIn('value="planta_real:H1"', panel); self.assertIn('value="fotovoltaica:P3"', panel)


class ApiPlanta(BasePlanta):
    def test_cada_simulador_solo_ve_sus_examenes(self):
        self.examen_sim("fotovoltaica:P2"); self.examen_sim("planta_real:H2", intentos="2")
        e = self.alumno.get("/api/examen?sim=planta_real").get_json()["examen"]
        self.assertEqual((e["sim"], e["practica"], e["titulo"], e["intentos_max"], e["intentos"]), (PLANTA, "H2", "Bomba P-101 y variador", 2, 0))
        f = self.alumno.get("/api/examen?sim=fotovoltaica").get_json()["examen"]
        self.assertEqual((f["sim"], f["practica"]), (FV, "P2"))
        self.assertEqual(self.alumno.get("/api/examen?sim=maqueta").get_json(), {"examen": None})
        self.assertEqual(self.alumno.get("/api/examen").get_json(), {"examen": None})

    def test_sin_sesion_es_401(self):
        self.assertEqual(self.app.test_client().get("/api/examen?sim=planta_real").status_code, 401)

    def test_entrega_con_intentos_y_mejor_nota(self):
        self.examen_sim("planta_real:H1", intentos="2")
        self.assertEqual(self.entregar_planta(nota="5").get_json(), {"guardado": True, "intentos": 1, "intentos_max": 2, "quedan": 1})
        self.assertEqual(self.entregar_planta(nota="8").get_json(), {"guardado": True, "intentos": 2, "intentos_max": 2, "quedan": 0})
        self.assertEqual(self.entregar_planta(nota="10").status_code, 400)
        fila = self.examenes()[0]
        self.assertEqual((fila["nota"], fila["intentos"]), (8.0, 2))
        self.assertEqual(self.alumno.get("/api/examen?sim=planta_real").get_json(), {"examen": None})

    def test_el_sim_de_la_entrega_debe_ser_el_del_examen(self):
        self.examen_sim("planta_real:H1")
        self.assertEqual(self.entregar_planta(sim=FV).status_code, 400)      # el examen es de la planta
        self.assertEqual(self.entregar_planta(sim="maqueta").status_code, 400)
        self.assertEqual(self.examenes()[0]["intentos"], 0)

    def test_no_se_entrega_el_examen_de_otro_alumno(self):
        self.examen_sim("planta_real:H1")
        otro = self.otro_alumno()
        self.assertEqual(self.entregar_planta(otro).status_code, 400)

    def test_queda_en_la_actividad_con_el_titulo_de_la_planta(self):
        self.examen_sim("planta_real:H3")
        self.entregar_planta(nota="6.5")
        act = self.consulta("SELECT detalle FROM actividad WHERE tipo='examen'")
        self.assertIn("Lazos 4-20 mA y sensores", act[0]["detalle"]); self.assertIn("6,5", act[0]["detalle"])


class InformePlanta(BasePlanta):
    def setUp(self):
        super().setUp()
        self.examen_sim("planta_real:H1", intentos="2")
        self.entregar_planta(nota="7")
        self.examen_sim("fotovoltaica:P2")

    def test_el_informe_nombra_el_simulador_de_la_planta_y_lleva_la_hoja(self):
        eid = [e for e in self.examenes() if e["sim"] == PLANTA][0]["id"]
        r = self.prof.get(f"/aula/examen/{eid}/informe.html")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["Content-Disposition"].endswith('_H1.html"'))
        html = r.get_data(as_text=True)
        for texto in ("Simulador de la planta real HTST", "Control todo o nada del calentador", "7 / 10", "KM-201:A1", "Mide la bobina de KM-201", "4 de 6", "✓ Correcta"):
            self.assertIn(texto, html)
        self.assertNotIn("Simulador fotovoltaico", html)

    def test_el_informe_de_la_fotovoltaica_sigue_diciendo_fotovoltaico(self):
        eid = [e for e in self.examenes() if e["sim"] == FV][0]["id"]
        html = self.prof.get(f"/aula/examen/{eid}/informe.html").get_data(as_text=True)
        self.assertIn("Simulador fotovoltaico", html); self.assertIn("El campo A produce la mitad", html)

    def test_el_csv_lleva_la_columna_simulador(self):
        texto = self.prof.get("/aula/examenes.csv").get_data(as_text=True)
        self.assertIn("apellidos;nombre;modulo;simulador;practica;titulo;", texto)
        self.assertIn(";planta_real;H1;Control todo o nada del calentador;1;2;7;abierto;", texto)
        self.assertIn(";fotovoltaica;P2;El campo A produce la mitad;0;1;—;abierto;", texto)

    def test_la_ficha_muestra_la_columna_simulador_y_el_informe(self):
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn("<th>Simulador</th>", ficha); self.assertIn('data-etiqueta="Simulador">Planta real HTST', ficha)
        eid = [e for e in self.examenes() if e["sim"] == PLANTA][0]["id"]
        self.assertIn(f"/aula/examen/{eid}/informe.html", ficha)


if __name__ == "__main__":
    unittest.main()
