"""Pruebas de los retos de diagnóstico (averías ocultas del simulador fotovoltaico): catálogo, los dos endpoints del simulador y el aula del profesor.

    python -m pytest aula_pct23/tests -q        (desde gateway_industrial_excelencia)
"""
import base64
import json
import random
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_aula as ta  # noqa: E402

aula = ta.aula
PIN, ALUMNO, SIMULADOR = ta.PIN, ta.ALUMNO, ta.SIMULADOR
FOTOVOLTAICA = ta.RAIZ.parent / "simulador_fotovoltaica"
AVERIA, TITULO_AVERIA = "FUSIBLE_F101", "Fusible F-101 fundido"
OTRA = "QB_DISPARADO"


class BaseRetos(ta.Base):
    def setUp(self):
        super().setUp()
        self.alumno, self.prof = self.autorizado()
        self.uid = self.id_de()

    # ----- utilidades -----
    def otro_alumno(self, correo="marcos@ejemplo.es", autorizar=True, **cambios):
        self.registrar(correo=correo, nombre="Marcos", apellidos="Ruiz", **cambios)
        if autorizar:
            self.accion(self.prof, "autorizar", id=str(self.id_de(correo)), estado="pendiente")
        c = self.app.test_client()
        self.entrar(c, correo=correo)
        return c

    def reto(self, accion="asignar", **datos):
        d = {"accion": accion, "averia": AVERIA, "pistas": "1", **datos}
        if accion != "asignar_lista":
            d.setdefault("id", str(self.uid))
        return self.post(self.prof, "/aula/reto", {k: v for k, v in d.items() if v is not None}, "/aula")

    def entregar(self, cliente=None, **cambios):
        d = {"reto": "", "sim": "fotovoltaica", "averia_real": AVERIA, "averia_respuesta": AVERIA, "elemento_respuesta": "F-101", "acierto": "1",
             "nota": "7.5", "pistas": "1", "medidas": "6", "segundos": "240",
             "detalle": json.dumps({"sintoma": "El campo A produce la mitad", "medidas": ["Tensión de STR-101: 0 V", "Continuidad de F-101: abierto"],
                                    "reparacion": "Cambiar el fusible F-101"})}
        d.update(cambios)
        return self.post(cliente or self.alumno, "/api/reto/resultado", d, "/cuenta")

    def retos(self):
        return self.consulta("SELECT * FROM retos ORDER BY id")

    def diagnosticos(self):
        return self.consulta("SELECT * FROM diagnosticos ORDER BY id")


class Catalogo(unittest.TestCase):
    def test_el_catalogo_real_tiene_las_18_averias_y_sus_elementos(self):
        c = aula.leer_catalogo_averias(FOTOVOLTAICA)
        self.assertEqual(len(c["averias"]), 18)
        ids = [a["id"] for a in c["averias"]]
        self.assertEqual(len(set(ids)), 18)
        self.assertEqual(ids[0], "CADENA_ABIERTA_A1")
        self.assertEqual(ids[-1], "SOMBRA_PARAPETO")
        por_id = {a["id"]: a for a in c["averias"]}
        self.assertEqual(por_id[AVERIA], {"id": AVERIA, "titulo": TITULO_AVERIA, "tag": "F-101"})
        self.assertEqual(por_id["SOBRETENSION_RED"]["titulo"], "Tensión de red alta (253 V): el ZCS reduce y desconecta")   # dos puntos y paréntesis dentro del texto
        for a in c["averias"]:
            self.assertTrue(a["titulo"])
            self.assertIn(a["tag"], c["equipos"], a["id"])
        # Los paneles se generan en layout.js con `...[1, 2].map(n => ({ tag: 'PV-10' + n … }))`: también se entienden
        self.assertEqual(c["equipos"]["PV-104"], "Panel policristalino 4 del campo A")
        self.assertEqual(c["equipos"]["PV-208"], "Panel monocristalino 8 del campo B")
        self.assertEqual(c["equipos"]["BAT-101"], "Batería LiFePO4 25,6 V 100 Ah con BMS")
        self.assertEqual(len(c["equipos"]), 44)

    def catalogo_de(self, texto):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            (Path(d) / "js").mkdir()
            (Path(d) / "js" / "layout.js").write_text(texto, encoding="utf-8")
            return aula.leer_catalogo_averias(d)

    def test_la_lectura_tolera_otros_formatos_de_escritura(self):
        c = self.catalogo_de("""
            var EQUIPOS=[{tag:"A-1",nombre:"Uno [con corchetes]"}, // comentario con ' comilla
              { "tag": 'B-2', 'nombre': 'It\\'s "dos"', otro: algo },
              ...[7,8].map(i => ({ nombre: 'Panel ' + i, tag: 'P-' + i })),
            ];
            /* AVERIAS = [ { id: 'FALSA', titulo: 'en un comentario no cuenta' } ] */
            let AVERIAS =
            [
              { id : "UNA" , titulo : "Primera: con dos puntos, coma y ] corchete" , tag : "A-1" , extra: { anidado: 1 } },
              {titulo:'Segunda',id:'DOS',tag:'P-8'},
              { id: 'sin titulo' }, { titulo: 'sin id' }, { id: 'ID NO VALIDO', titulo: 'x' }, { id: 'UNA', titulo: 'repetida' },
            ];""")
        self.assertEqual([a["id"] for a in c["averias"]], ["UNA", "DOS"])
        self.assertEqual(c["averias"][0]["titulo"], "Primera: con dos puntos, coma y ] corchete")
        self.assertEqual(c["equipos"], {"P-7": "Panel 7", "P-8": "Panel 8", "A-1": "Uno [con corchetes]", "B-2": "It's \"dos\""})

    def test_sin_archivo_o_sin_averias_no_hay_catalogo(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
            self.assertIsNone(aula.leer_catalogo_averias(d))
        self.assertIsNone(aula.leer_catalogo_averias(Path("no") / "existe"))
        for texto in ("", "const EQUIPOS = [{ tag: 'A-1', nombre: 'x' }];", "const AVERIAS = [];", "const AVERIAS = [ { id: 'UNA', titulo: 'sin cerrar' }"):
            self.assertIsNone(self.catalogo_de(texto), texto)


class ApiReto(BaseRetos):
    def test_sin_sesion_da_401_con_json(self):
        r = self.app.test_client().get("/api/reto?sim=fotovoltaica")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.get_json(), {"reto": None})

    def test_sin_reto_devuelve_null(self):
        r = self.alumno.get("/api/reto?sim=fotovoltaica")
        self.assertEqual((r.status_code, r.get_json()), (200, {"reto": None}))
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        self.assertEqual(r.mimetype, "application/json")

    def test_contrato_exacto_del_reto_pendiente(self):
        self.reto(titulo="Examen del martes")
        r = self.alumno.get("/api/reto?sim=fotovoltaica")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        rid = self.retos()[0]["id"]
        self.assertEqual(r.get_json(), {"reto": {"id": rid, "clave": base64.b64encode(AVERIA.encode()).decode(), "titulo": "Examen del martes", "pistas": True}})
        self.assertNotIn(AVERIA, r.get_data(as_text=True))                      # no se lee a simple vista
        self.assertNotIn("Fusible", r.get_data(as_text=True))

    def test_titulo_por_defecto_y_sin_pistas(self):
        self.reto(pistas=None)
        reto = self.alumno.get("/api/reto?sim=fotovoltaica").get_json()["reto"]
        self.assertEqual(reto["titulo"], "Práctica de diagnóstico")
        self.assertIs(reto["pistas"], False)

    def test_se_devuelve_el_pendiente_mas_antiguo_y_al_resolverlo_el_siguiente(self):
        self.reto()
        self.reto(averia=OTRA)
        ids = [r["id"] for r in self.retos()]
        primero = self.alumno.get("/api/reto?sim=fotovoltaica").get_json()["reto"]
        self.assertEqual((primero["id"], base64.b64decode(primero["clave"]).decode()), (ids[0], AVERIA))
        self.entregar(reto=str(ids[0]))
        segundo = self.alumno.get("/api/reto?sim=fotovoltaica").get_json()["reto"]
        self.assertEqual((segundo["id"], base64.b64decode(segundo["clave"]).decode()), (ids[1], OTRA))
        self.entregar(reto=str(ids[1]), averia_real=OTRA)
        self.assertEqual(self.alumno.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})

    def test_otro_simulador_o_sin_parametro_devuelve_null(self):
        self.reto()
        for url in ("/api/reto", "/api/reto?sim=maqueta", "/api/reto?sim=planta_real", "/api/reto?sim=../x"):
            r = self.alumno.get(url)
            self.assertEqual((r.status_code, r.get_json()), (200, {"reto": None}), url)

    def test_sin_el_simulador_asignado_o_sin_autorizar_devuelve_null(self):
        self.reto()
        self.accion(self.prof, "simuladores", id=str(self.uid), estado="autorizado", sim_maqueta="1")
        self.assertEqual(self.alumno.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})
        self.accion(self.prof, "simuladores", id=str(self.uid), estado="autorizado", sim_fotovoltaica="1")
        self.assertIsNotNone(self.alumno.get("/api/reto?sim=fotovoltaica").get_json()["reto"])
        self.accion(self.prof, "rechazar", id=str(self.uid), estado="autorizado")
        r = self.alumno.get("/api/reto?sim=fotovoltaica")
        self.assertEqual((r.status_code, r.get_json()), (200, {"reto": None}))

    def test_un_alumno_no_ve_el_reto_de_otro(self):
        self.reto()
        otro = self.otro_alumno()
        self.assertEqual(otro.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})
        self.assertEqual(self.prof.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})     # el profesor (sin cuenta de alumno) tampoco tiene retos

    def test_un_reto_con_una_averia_que_ya_no_existe_se_salta(self):
        self.reto()
        con = sqlite3.connect(Path(self.tmp.name) / "aula.sqlite3")
        con.execute("UPDATE retos SET averia='AVERIA_RETIRADA'")
        con.commit()
        con.close()
        self.assertEqual(self.alumno.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})


class ApiResultado(BaseRetos):
    def test_entrega_de_un_reto_lo_cierra_y_guarda_el_diagnostico(self):
        self.reto()
        rid = self.retos()[0]["id"]
        r = self.entregar(reto=str(rid))
        self.assertEqual((r.status_code, r.get_json()), (200, {"guardado": True}))
        self.assertEqual(r.headers["Cache-Control"], "no-store")
        d = self.diagnosticos()
        self.assertEqual(len(d), 1)
        d = dict(d[0])
        self.assertTrue(d.pop("momento").endswith("Z"))
        detalle = json.loads(d.pop("detalle"))
        self.assertEqual(detalle["reparacion"], "Cambiar el fusible F-101")
        self.assertEqual(d, {"id": 1, "usuario_id": self.uid, "reto_id": rid, "sim": "fotovoltaica", "averia_real": AVERIA, "averia_respuesta": AVERIA,
                             "elemento_respuesta": "F-101", "acierto": 1.0, "nota": 7.5, "pistas": 1, "medidas": 6, "segundos": 240, "intento": 1})
        reto = self.retos()[0]
        self.assertIsNotNone(reto["resuelto"])
        self.assertEqual((reto["nota"], reto["intentos"]), (7.5, 1))
        actividad = [(f["tipo"], f["detalle"]) for f in self.consulta("SELECT tipo, detalle FROM actividad ORDER BY id")]
        self.assertIn(("diagnostico", "Entregó diagnóstico: nota 7,5 (reto del profesor)"), actividad)

    def test_practica_libre_sin_reto(self):
        self.assertEqual(self.entregar(nota="10").get_json(), {"guardado": True})
        self.entregar(nota="4,25")                                              # coma decimal
        self.entregar(nota="6", averia_real=OTRA)
        d = self.diagnosticos()
        self.assertEqual([(x["reto_id"], x["nota"], x["intento"]) for x in d], [(None, 10.0, 1), (None, 4.25, 2), (None, 6.0, 1)])
        detalles = [f["detalle"] for f in self.consulta("SELECT detalle FROM actividad WHERE tipo='diagnostico' ORDER BY id")]
        self.assertEqual(detalles, ["Entregó diagnóstico: nota 10", "Entregó diagnóstico: nota 4,25", "Entregó diagnóstico: nota 6"])

    def test_reintentar_un_reto_resuelto_conserva_la_mejor_nota_y_cuenta_los_intentos(self):
        self.reto()
        rid = str(self.retos()[0]["id"])
        self.entregar(reto=rid, nota="5", acierto="0.5")
        cerrado = self.retos()[0]["resuelto"]
        self.entregar(reto=rid, nota="9")
        self.entregar(reto=rid, nota="3", acierto="0")
        reto = self.retos()[0]
        self.assertEqual((reto["nota"], reto["intentos"], reto["resuelto"]), (9.0, 3, cerrado))      # cerrado en la primera entrega
        self.assertEqual([(d["reto_id"], d["intento"], d["nota"]) for d in self.diagnosticos()], [(int(rid), 1, 5.0), (int(rid), 2, 9.0), (int(rid), 3, 3.0)])
        self.assertEqual(self.alumno.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})

    def test_el_reto_de_otro_alumno_no_se_cierra_se_guarda_como_practica_libre(self):
        self.reto()
        rid = self.retos()[0]["id"]
        otro = self.otro_alumno()
        self.assertEqual(self.entregar(otro, reto=str(rid)).get_json(), {"guardado": True})
        reto = self.retos()[0]
        self.assertIsNone(reto["resuelto"])
        self.assertEqual((reto["nota"], reto["intentos"]), (None, 0))
        d = self.diagnosticos()[0]
        self.assertEqual((d["usuario_id"], d["reto_id"]), (self.id_de("marcos@ejemplo.es"), None))
        self.assertIsNotNone(self.alumno.get("/api/reto?sim=fotovoltaica").get_json()["reto"])         # el dueño lo sigue teniendo pendiente

    def test_reto_inexistente_o_con_otra_averia_no_cierra_nada(self):
        self.reto()
        rid = str(self.retos()[0]["id"])
        for caso in (dict(reto="9999"), dict(reto="abc"), dict(reto="-1"), dict(reto=rid, averia_real=OTRA)):
            self.assertEqual(self.entregar(**caso).get_json(), {"guardado": True}, caso)
        self.assertIsNone(self.retos()[0]["resuelto"])
        self.assertEqual([d["reto_id"] for d in self.diagnosticos()], [None] * 4)

    def test_los_valores_se_validan_y_se_acotan(self):
        casos = (
            (dict(nota="99", acierto="7", pistas="50", medidas="123456", segundos="9999999"), dict(nota=10.0, acierto=1.0, pistas=3, medidas=9999, segundos=86400)),
            (dict(nota="-3", acierto="-1", pistas="-2", medidas="-5", segundos="-9"), dict(nota=0.0, acierto=0.0, pistas=0, medidas=0, segundos=0)),
            (dict(nota="abc", acierto="nan", pistas="", medidas="inf", segundos="x"), dict(nota=0.0, acierto=0.0, pistas=0, medidas=0, segundos=0)),
            (dict(nota="7.456", acierto="0.5", pistas="2.9", medidas="3.7", segundos="12.2"), dict(nota=7.46, acierto=0.5, pistas=2, medidas=3, segundos=12)),
            (dict(acierto="0.3"), dict(acierto=0.5)),
            (dict(averia_respuesta="INVENTADA", elemento_respuesta="<script>"), dict(averia_respuesta="", elemento_respuesta="")),
            (dict(averia_respuesta="", elemento_respuesta=""), dict(averia_respuesta="", elemento_respuesta="")),
            (dict(averia_respuesta=OTRA, elemento_respuesta="PV-203"), dict(averia_respuesta=OTRA, elemento_respuesta="PV-203")),
        )
        for enviado, esperado in casos:
            self.assertEqual(self.entregar(**enviado).status_code, 200, enviado)
            fila = self.diagnosticos()[-1]
            self.assertEqual({k: fila[k] for k in esperado}, esperado, enviado)

    def test_el_detalle_debe_ser_json_valido_y_no_pasar_de_4000_caracteres(self):
        justo = json.dumps({"sintoma": "x" * 3980})
        self.assertLessEqual(len(justo), 4000)
        for detalle, esperado in (("esto no es json", ""), ('"solo un texto"', ""), ("42", ""), (json.dumps({"sintoma": "x" * 4000}), ""), ("", ""),
                                  (justo, justo), ('[{"m": 1}]', '[{"m": 1}]')):
            self.entregar(detalle=detalle)
            self.assertEqual(self.diagnosticos()[-1]["detalle"], esperado, detalle[:40])

    def test_averia_real_o_simulador_no_validos_se_rechazan_con_json(self):
        for caso in (dict(averia_real="INVENTADA"), dict(averia_real=""), dict(sim="maqueta"), dict(sim="")):
            r = self.entregar(**caso)
            self.assertEqual(r.status_code, 400, caso)
            self.assertIs(r.get_json()["guardado"], False)
        self.assertEqual(self.diagnosticos(), [])

    def test_exige_csrf(self):
        self.alumno.get("/cuenta")
        r = self.alumno.post("/api/reto/resultado", data={"sim": "fotovoltaica", "averia_real": AVERIA, "nota": "10"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.alumno.post("/api/reto/resultado", data={"sim": "fotovoltaica", "averia_real": AVERIA, "nota": "10", "csrf": "falso"}).status_code, 400)
        self.assertEqual(self.diagnosticos(), [])

    def test_quien_no_es_alumno_autorizado_con_el_simulador_recibe_204_y_no_se_guarda(self):
        pendiente = self.otro_alumno(autorizar=False)
        self.assertEqual(self.entregar(pendiente).status_code, 204)
        r = self.post(self.prof, "/api/reto/resultado", {"sim": "fotovoltaica", "averia_real": AVERIA, "nota": "10"}, "/aula")
        self.assertEqual(r.status_code, 204)                                        # el profesor no es un alumno
        self.accion(self.prof, "simuladores", id=str(self.uid), estado="autorizado", sim_maqueta="1")
        self.assertEqual(self.entregar().status_code, 204)                          # sin el simulador fotovoltaico asignado
        self.assertEqual(self.diagnosticos(), [])

    def test_un_envio_demasiado_grande_se_rechaza(self):
        r = self.entregar(detalle="x" * 40000)
        self.assertEqual(r.status_code, 413)
        self.assertEqual(self.diagnosticos(), [])

    def test_al_eliminar_la_cuenta_se_borran_sus_retos_y_diagnosticos(self):
        self.reto()
        self.reto(averia=OTRA)
        self.entregar(reto=str(self.retos()[0]["id"]))
        self.entregar()
        self.accion(self.prof, "eliminar", id=str(self.uid), estado="autorizado")
        self.assertEqual((self.retos(), self.diagnosticos()), ([], []))


class AulaRetos(BaseRetos):
    def test_asignar_a_un_alumno_desde_su_ficha(self):
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn('name="averia"', ficha)
        self.assertEqual(ficha.count('<option value="'), 19)                    # las 18 del catálogo y «al azar»
        self.assertIn(f'<option value="{AVERIA}">{TITULO_AVERIA}</option>', ficha)
        r = self.reto(titulo="  Examen   1 ")
        self.assertEqual(r.status_code, 302)
        self.assertIn(f"/aula/alumno/{self.uid}", r.headers["Location"])
        reto = self.retos()[0]
        self.assertEqual((reto["usuario_id"], reto["sim"], reto["averia"], reto["titulo"], reto["pistas"], reto["resuelto"], reto["nota"], reto["intentos"]),
                         (self.uid, "fotovoltaica", AVERIA, "Examen 1", 1, None, None, 0))
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        self.assertIn("Reto de diagnóstico asignado a 1 alumno(s).", ficha)
        self.assertIn(f'<td data-etiqueta="Avería">{TITULO_AVERIA}</td>', ficha)   # al profesor sí se le dice cuál es
        self.assertIn("Pendiente", ficha)
        self.assertIn(">Anular<", ficha)

    def test_no_se_asigna_a_quien_no_esta_autorizado_o_no_tiene_el_simulador(self):
        self.otro_alumno(autorizar=False)
        otro = self.id_de("marcos@ejemplo.es")
        self.reto(id=str(otro))
        self.accion(self.prof, "simuladores", id=str(self.uid), estado="autorizado", sim_maqueta="1", sim_planta_real="1")
        self.reto()
        self.assertEqual(self.retos(), [])
        self.assertNotIn('name="averia"', self.prof.get(f"/aula/alumno/{otro}").get_data(as_text=True))

    def test_no_se_duplica_la_misma_averia_pendiente(self):
        self.reto()
        self.reto()
        self.assertEqual(len(self.retos()), 1)
        self.reto(averia=OTRA)
        self.assertEqual(len(self.retos()), 2)

    def test_averia_o_accion_no_validas(self):
        self.assertEqual(self.reto(averia="INVENTADA").status_code, 400)
        self.assertEqual(self.reto(averia="").status_code, 400)
        self.assertEqual(self.reto(accion="hackear").status_code, 400)
        self.assertEqual(self.reto(id="abc").status_code, 400)
        self.assertEqual(self.reto(id="9999").status_code, 302)
        self.assertEqual(self.retos(), [])

    def test_asignar_a_toda_la_lista_dice_a_cuantos_si_y_a_cuantos_no(self):
        self.otro_alumno()                                                       # autorizado, con todos los simuladores
        self.otro_alumno("sin@ejemplo.es")                                       # autorizado, sin el fotovoltaico
        self.accion(self.prof, "simuladores", id=str(self.id_de("sin@ejemplo.es")), estado="autorizado", sim_maqueta="1")
        self.otro_alumno("pend@ejemplo.es", autorizar=False)                     # pendiente
        panel = self.prof.get("/aula?estado=todos").get_data(as_text=True)
        self.assertIn("Reto de diagnóstico fotovoltaico para los 4 alumnos de esta lista", panel)
        self.assertIn("Al azar, distinta para cada alumno", panel)
        self.assertIn("Permitir pistas", panel)
        self.assertIn("Lo reciben 2 de 4", panel)
        r = self.reto("asignar_lista", estado="todos", titulo="Clase del lunes", pistas=None)
        self.assertEqual(r.status_code, 302)
        retos = self.retos()
        self.assertEqual({t["usuario_id"] for t in retos}, {self.uid, self.id_de("marcos@ejemplo.es")})
        self.assertEqual({(t["averia"], t["titulo"], t["pistas"]) for t in retos}, {(AVERIA, "Clase del lunes", 0)})
        panel = self.prof.get("/aula?estado=todos").get_data(as_text=True)
        self.assertIn("Reto de diagnóstico asignado a 2 alumno(s). 2 no lo recibe(n)", panel)
        self.assertEqual(panel.count("1 pendiente<"), 2)
        self.reto("asignar_lista", estado="todos")                               # otra vez la misma: no se duplica
        self.assertEqual(len(self.retos()), 2)
        self.assertIn("2 ya tenía(n) pendiente esa misma avería", self.prof.get("/aula?estado=todos").get_data(as_text=True))

    def test_la_lista_respeta_el_filtro_de_modulo_y_busqueda(self):
        self.otro_alumno(modulo="Control")
        self.reto("asignar_lista", estado="autorizado", modulo="Control")
        self.assertEqual([t["usuario_id"] for t in self.retos()], [self.id_de("marcos@ejemplo.es")])
        self.reto("asignar_lista", estado="autorizado", q="lucia", averia=OTRA)
        self.assertEqual([(t["usuario_id"], t["averia"]) for t in self.retos()][1:], [(self.uid, OTRA)])
        self.reto("asignar_lista", estado="pendiente", averia="RED_CAIDA")       # en «pendientes» no hay nadie autorizado
        self.assertEqual(len(self.retos()), 2)

    def test_al_azar_reparte_averias_distintas_sin_repetir_hasta_agotarlas(self):
        app = aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR, "secret_key": "clave-de-pruebas", "reloj": self.reloj,
                              "azar": random.Random(7)})
        con = sqlite3.connect(Path(self.tmp.name) / "aula.sqlite3")
        for i in range(19):
            con.execute("INSERT INTO usuarios (nombre, apellidos, modulo, correo, clave_hash, estado, creado) VALUES (?,?,?,?,?,?,?)",
                        (f"N{i}", f"A{i:02d}", "M", f"a{i}@b.es", "x", "autorizado", "2026-01-01T00:00:00Z"))
        con.commit()
        con.close()
        prof = app.test_client()
        self.post(prof, "/aula/entrar", {"pin": PIN}, "/aula")
        self.post(prof, "/aula/reto", {"accion": "asignar_lista", "estado": "autorizado", "averia": "azar", "pistas": "1"}, "/aula")
        retos = self.retos()
        self.assertEqual(len(retos), 20)
        validas = {a["id"] for a in app.catalogo_averias["averias"]}
        self.assertTrue({t["averia"] for t in retos} <= validas)
        self.assertEqual(len({t["averia"] for t in retos[:18]}), 18)             # los 18 primeros, las 18 averías: ninguna repetida
        self.assertEqual(len({t["usuario_id"] for t in retos}), 20)
        # Segunda tanda: a nadie le vuelve a tocar la que ya tiene pendiente
        self.post(prof, "/aula/reto", {"accion": "asignar_lista", "estado": "autorizado", "averia": "azar"}, "/aula")
        por_alumno = {}
        for t in self.retos():
            por_alumno.setdefault(t["usuario_id"], []).append(t["averia"])
        for uid, averias in por_alumno.items():
            self.assertEqual(len(averias), 2)
            self.assertNotEqual(averias[0], averias[1], uid)

    def test_al_azar_a_un_alumno(self):
        self.reto(averia="azar")
        self.assertIn(self.retos()[0]["averia"], {a["id"] for a in self.app.catalogo_averias["averias"]})

    def test_anular_un_reto_pendiente(self):
        self.reto()
        rid = self.retos()[0]["id"]
        r = self.post(self.prof, "/aula/reto", {"accion": "anular", "id": str(self.uid), "reto": str(rid)}, "/aula")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.retos(), [])
        self.assertEqual(self.alumno.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})

    def test_no_se_anula_un_reto_resuelto_ni_el_de_otro_alumno(self):
        self.reto()
        rid = self.retos()[0]["id"]
        self.otro_alumno()
        self.post(self.prof, "/aula/reto", {"accion": "anular", "id": str(self.id_de("marcos@ejemplo.es")), "reto": str(rid)}, "/aula")
        self.assertEqual(len(self.retos()), 1)
        self.entregar(reto=str(rid))
        self.post(self.prof, "/aula/reto", {"accion": "anular", "id": str(self.uid), "reto": str(rid)}, "/aula")
        self.assertEqual(len(self.retos()), 1)
        self.assertEqual(len(self.diagnosticos()), 1)
        self.assertNotIn(">Anular<", self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True))

    def test_solo_el_profesor_asigna_y_anula(self):
        self.reto()
        rid = self.retos()[0]["id"]
        anonimo = self.app.test_client()
        for cliente, csrf_url in ((self.alumno, "/cuenta"), (anonimo, "/entrar")):
            for datos in ({"accion": "asignar", "id": str(self.uid), "averia": OTRA}, {"accion": "asignar_lista", "estado": "todos", "averia": OTRA},
                          {"accion": "anular", "id": str(self.uid), "reto": str(rid)}):
                self.assertEqual(self.post(cliente, "/aula/reto", datos, csrf_url).status_code, 302, datos)
        self.assertEqual([(t["id"], t["averia"]) for t in self.retos()], [(rid, AVERIA)])
        self.alumno.get("/cuenta")
        self.assertEqual(self.alumno.post("/aula/reto", data={"accion": "anular", "id": str(self.uid), "reto": str(rid)}).status_code, 400)   # sin CSRF
        self.assertEqual(self.prof.post("/aula/reto", data={"accion": "anular", "id": str(self.uid), "reto": str(rid)}).status_code, 400)
        self.assertEqual(len(self.retos()), 1)

    def test_el_panel_indica_pendientes_y_resueltos_con_la_ultima_nota(self):
        self.reto()
        self.reto(averia=OTRA)
        panel = self.prof.get("/aula?estado=autorizado").get_data(as_text=True)
        self.assertIn("2 pendientes<", panel)
        self.entregar(reto=str(self.retos()[0]["id"]), nota="8.25")
        panel = self.prof.get("/aula?estado=autorizado").get_data(as_text=True)
        self.assertIn("1 pendiente<", panel)
        self.assertIn("1 resuelto · nota 8,25<", panel)

    def test_la_ficha_muestra_los_diagnosticos_y_la_hoja_sin_inyectar_html(self):
        self.reto()
        malo = {"sintoma": "<script>alert(1)</script>", "medidas": ["<img src=x onerror=alert(2)>", {"punto": "STR-101", "valor": 0}],
                "reparacion": "Cambiar \"el fusible\" & probar", "<b>clave</b>": {"a": ["<i>x</i>"]}}
        self.entregar(reto=str(self.retos()[0]["id"]), detalle=json.dumps(malo), averia_respuesta=OTRA, acierto="0.5", nota="5")
        self.entregar(detalle="")
        ficha = self.prof.get(f"/aula/alumno/{self.uid}").get_data(as_text=True)
        for crudo in ("<script>alert(1)</script>", "<img src=x", "<b>clave</b>", "<i>x</i>"):
            self.assertNotIn(crudo, ficha)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", ficha)
        self.assertIn("&lt;img src=x onerror=alert(2)&gt;", ficha)
        self.assertIn("punto: STR-101 · valor: 0", ficha)
        for texto in ("Síntoma", "Medidas marcadas", "Reparación propuesta", "Ver hoja", "A medias", "Magnetotérmico de batería QB-101 disparado",
                      "F-101 · Fusible de la cadena STR-101", "Resuelto", "Práctica libre · intento 1", "Reto · intento 1", "4 min"):
            self.assertIn(texto, ficha)
        self.assertIn("Entregó diagnóstico: nota 5 (reto del profesor)", ficha)

    def test_csv_de_notas_y_resumen_por_averia(self):
        otro = self.otro_alumno()
        self.reto()
        self.entregar(reto=str(self.retos()[0]["id"]), nota="7.5")
        self.entregar(otro, nota="2", acierto="0", averia_respuesta=OTRA, pistas="3", medidas="10", segundos="60")
        self.entregar(otro, averia_real=OTRA, averia_respuesta=OTRA, elemento_respuesta="QB-101", nota="10", pistas="0")
        r = self.prof.get("/aula/diagnosticos.csv")
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers["Content-Type"])
        self.assertIn("notas_diagnostico.csv", r.headers["Content-Disposition"])
        lineas = r.get_data(as_text=True).lstrip("﻿").strip().splitlines()
        self.assertEqual(lineas[0], "apellidos;nombre;modulo;averia;averia_titulo;respuesta;elemento_respuesta;acierto;nota;pistas;medidas;tiempo_s;fecha_utc;tipo;intento")
        self.assertEqual(len(lineas), 4)
        self.assertTrue(lineas[1].startswith(f"Pérez Gómez;Lucía;Sistemas autónomos;{AVERIA};{TITULO_AVERIA};{AVERIA};F-101;1;7,5;1;6;240;"))
        self.assertTrue(lineas[1].endswith(";reto;1"))
        self.assertTrue(lineas[2].startswith(f"Ruiz;Marcos;Sistemas autónomos;{AVERIA};{TITULO_AVERIA};{OTRA};F-101;0;2;3;10;60;"))
        self.assertTrue(lineas[2].endswith(";práctica libre;1"))
        resumen = self.prof.get("/aula?vista=diagnostico").get_data(as_text=True)
        self.assertIn("resumen por avería", resumen)
        self.assertLess(resumen.index(TITULO_AVERIA), resumen.index("Magnetotérmico de batería QB-101 disparado"))   # la que más cuesta, primero
        self.assertIn('<td data-etiqueta="Acierto">50 %</td>', resumen)
        self.assertIn('<td data-etiqueta="Nota media"><b>4,75</b></td>', resumen)
        self.assertIn('<td data-etiqueta="Acierto">100 %</td>', resumen)
        csv_resumen = self.prof.get("/aula/diagnosticos_averias.csv").get_data(as_text=True).lstrip("﻿").strip().splitlines()
        self.assertEqual(csv_resumen[0], "averia;averia_titulo;entregas;alumnos;acierto_pct;nota_media;pistas_media;medidas_media;tiempo_medio_s")
        self.assertEqual(csv_resumen[1], f"{AVERIA};{TITULO_AVERIA};2;2;50;4,75;2;8;150")
        self.assertEqual(csv_resumen[2].split(";")[:6], [OTRA, "Magnetotérmico de batería QB-101 disparado", "1", "1", "100", "10"])

    def test_los_csv_y_el_resumen_solo_los_ve_el_profesor(self):
        self.entregar()
        for cliente in (self.alumno, self.app.test_client()):
            for ruta in ("/aula/diagnosticos.csv", "/aula/diagnosticos_averias.csv"):
                self.assertEqual(cliente.get(ruta).status_code, 302, ruta)
            pagina = cliente.get("/aula?vista=diagnostico").get_data(as_text=True)
            self.assertIn("Escribe el PIN", pagina)
            self.assertNotIn(TITULO_AVERIA, pagina)

    def test_el_alumno_nunca_ve_el_nombre_de_su_averia_pendiente(self):
        self.reto(titulo="Examen")
        for ruta in ("/", "/simuladores", "/simuladores?lista=1", "/cuenta", "/pendiente", "/entrar", "/registro", "/aula", f"/aula/alumno/{self.uid}",
                     "/aula?vista=diagnostico", "/aula/diagnosticos.csv", "/api/reto?sim=fotovoltaica", "/fotovoltaica/", "/simulador/", "/planta-real/"):
            texto = self.alumno.get(ruta, follow_redirects=True).get_data(as_text=True)
            for prohibido in (AVERIA, TITULO_AVERIA, "F-101 fundido"):
                self.assertNotIn(prohibido, texto, ruta)
        elegir = self.alumno.get("/simuladores").get_data(as_text=True)
        self.assertIn("Tienes 1 reto de diagnóstico pendiente", elegir)          # sabe que tiene un reto, no cuál
        self.entregar(reto=str(self.retos()[0]["id"]))
        self.assertNotIn("reto de diagnóstico pendiente", self.alumno.get("/simuladores").get_data(as_text=True))


class SinCatalogo(ta.Base):
    """Un despliegue sin el simulador fotovoltaico (o con un layout.js ilegible): el aula funciona igual, sin retos."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.vacia = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.reloj = ta.Reloj()
        self.app = aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR, "fotovoltaica": self.vacia.name, "secret_key": "clave-de-pruebas",
                                   "reloj": self.reloj})
        self.c = self.app.test_client()

    def tearDown(self):
        self.vacia.cleanup()
        super().tearDown()

    def test_el_aula_funciona_y_la_seccion_de_retos_no_aparece(self):
        self.assertIsNone(self.app.catalogo_averias)
        alumno, prof = self.autorizado()
        uid = self.id_de()
        panel = prof.get("/aula?estado=autorizado")
        self.assertEqual(panel.status_code, 200)
        ficha = prof.get(f"/aula/alumno/{uid}")
        self.assertEqual(ficha.status_code, 200)
        for pagina in (panel.get_data(as_text=True), ficha.get_data(as_text=True)):
            for texto in ("Reto", "reto", "Diagnóstico", "diagnóstico"):
                self.assertNotIn(texto, pagina)
        self.assertEqual(alumno.get("/api/reto?sim=fotovoltaica").get_json(), {"reto": None})
        r = self.post(alumno, "/api/reto/resultado", {"sim": "fotovoltaica", "averia_real": AVERIA, "nota": "10"}, "/cuenta")
        self.assertEqual(r.status_code, 204)
        r = self.post(prof, "/aula/reto", {"accion": "asignar", "id": str(uid), "averia": AVERIA}, "/aula")
        self.assertEqual(r.status_code, 302)
        self.assertEqual(self.consulta("SELECT COUNT(*) n FROM retos")[0]["n"], 0)
        self.assertEqual(self.consulta("SELECT COUNT(*) n FROM diagnosticos")[0]["n"], 0)
        self.assertEqual(alumno.get("/simuladores").status_code, 200)

    def test_un_layout_ilegible_tampoco_rompe_el_arranque(self):
        raiz = Path(self.vacia.name)
        (raiz / "index.html").write_text("<html><body>fv</body></html>", encoding="utf-8")
        (raiz / "js").mkdir()
        (raiz / "js" / "layout.js").write_bytes(b"\xff\xfe const AVERIAS = [ { id: 'UNA', titulo: 'x' } ];")
        app = aula.crear_app({"pin": PIN, "datos": self.tmp.name, "simulador": SIMULADOR, "fotovoltaica": raiz, "secret_key": "k"})
        self.assertIsNone(app.catalogo_averias)
        self.assertEqual(app.test_client().get("/salud").status_code, 200)


class Migracion(unittest.TestCase):
    def test_una_base_antigua_sin_las_tablas_se_actualiza_sin_perder_nada(self):
        carpeta = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        try:
            ruta = Path(carpeta.name) / "aula.sqlite3"
            con = sqlite3.connect(ruta)
            con.executescript("""
                CREATE TABLE usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, apellidos TEXT NOT NULL, modulo TEXT NOT NULL,
                    correo TEXT NOT NULL UNIQUE COLLATE NOCASE, clave_hash TEXT NOT NULL,
                    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','autorizado','rechazado')), creado TEXT NOT NULL, resuelto TEXT, simuladores TEXT);
                CREATE TABLE actividad (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                    momento TEXT NOT NULL, tipo TEXT NOT NULL, detalle TEXT NOT NULL DEFAULT '');
                CREATE TABLE tiempo_uso (usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE, dia TEXT NOT NULL, pagina TEXT NOT NULL,
                    segundos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (usuario_id, dia, pagina));
                CREATE TABLE ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
                INSERT INTO usuarios (nombre, apellidos, modulo, correo, clave_hash, estado, creado, simuladores) VALUES
                    ('Ana','Real','M','ana@b.es','hash-a','autorizado','2025-01-01T00:00:00Z', NULL),
                    ('Luis','Real','M','luis@b.es','hash-l','pendiente','2025-01-02T00:00:00Z', 'maqueta');
                INSERT INTO actividad (usuario_id, momento, tipo, detalle) VALUES (1,'2025-01-03T00:00:00Z','entrada','Inició sesión');
                INSERT INTO tiempo_uso VALUES (1,'2025-01-03','manual',90);
                INSERT INTO ajustes VALUES ('pin_hash','hash-del-pin');""")
            con.commit()
            antes = {t: con.execute(f"SELECT * FROM {t} ORDER BY 1").fetchall() for t in ("usuarios", "actividad", "tiempo_uso", "ajustes")}
            con.close()
            for _ in range(2):                                                    # arrancar dos veces tampoco cambia nada
                app = aula.crear_app({"pin": PIN, "datos": carpeta.name, "simulador": SIMULADOR, "secret_key": "k"})
            con = sqlite3.connect(ruta)
            try:
                despues = {t: con.execute(f"SELECT * FROM {t} ORDER BY 1").fetchall() for t in antes}
                self.assertEqual(despues, antes)
                tablas = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertTrue({"retos", "diagnosticos"} <= tablas)
                self.assertEqual([c[1] for c in con.execute("PRAGMA table_info(retos)")],
                                 ["id", "usuario_id", "sim", "averia", "titulo", "pistas", "creado", "resuelto", "nota", "intentos"])
                self.assertEqual([c[1] for c in con.execute("PRAGMA table_info(diagnosticos)")],
                                 ["id", "usuario_id", "reto_id", "sim", "momento", "averia_real", "averia_respuesta", "elemento_respuesta", "acierto", "nota",
                                  "pistas", "medidas", "segundos", "detalle", "intento"])
                self.assertEqual(con.execute("SELECT COUNT(*) FROM retos").fetchone()[0], 0)
            finally:
                con.close()
            cliente = app.test_client()
            self.assertEqual(cliente.get("/salud").status_code, 200)
        finally:
            carpeta.cleanup()


if __name__ == "__main__":
    unittest.main(verbosity=2)
