"""Pruebas del control de T1 dentro del servidor web, con un cliente MQTT falso. Ejecutar:  python test_servidor_control.py"""
import json
import unittest

import control_t1 as c
import servidor_web as web


class MensajeFalso:
    def __init__(self, datos):
        self.payload = json.dumps(datos).encode("utf-8")


class ClienteFalso:
    def __init__(self):
        self.publicado = []

    def publish(self, topic, payload, qos=0):
        self.publicado.append(json.loads(payload))
        return type("Info", (), {"rc": 0})()


def lectura(t1, t2):
    return {c.CANAL_T1: t1 / 100.0, c.CANAL_T2: t2 / 100.0, c.CANAL_TERMOSTATO: True}


class ServidorControl(unittest.TestCase):
    def setUp(self):
        self.mqtt = ClienteFalso()
        web.client = self.mqtt
        web.control = c.ControlT1()
        web.estado.update(datos=None, recibido=0.0, broker=True, rechazo=None)
        self.http = web.app.test_client()

    def enviar_lectura(self, t1=22, t2=22):
        web.on_message(None, None, MensajeFalso(lectura(t1, t2)))

    def test_activar_publica_las_ordenes_en_la_siguiente_lectura(self):
        r = self.http.post("/api/control", json={"activo": True, "consigna_t1": 40, "velocidad_n1": 60})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["activo"])
        self.assertEqual(self.mqtt.publicado, [])          # aún no hay lectura
        self.enviar_lectura()
        orden = self.mqtt.publicado[-1]
        self.assertEqual((orden[c.SALIDA_RES], orden[c.SALIDA_N1], orden[c.SALIDA_N2], orden[c.SALIDA_VELOCIDAD_N1]), (True, True, True, 60.0))

    def test_sin_activar_no_se_manda_nada(self):
        self.enviar_lectura()
        self.assertEqual(self.mqtt.publicado, [])

    def test_desactivar_apaga_la_resistencia(self):
        self.http.post("/api/control", json={"activo": True})
        self.enviar_lectura()
        self.mqtt.publicado.clear()
        r = self.http.post("/api/control", json={"activo": False})
        self.assertFalse(r.get_json()["activo"])
        self.assertEqual(self.mqtt.publicado, [{c.SALIDA_RES: False}])

    def test_ajustes_no_validos(self):
        for cuerpo in ({"t2_max": 80}, {"consigna_t1": "caliente"}, {"activo": "si"}, {"nada": 1}, []):
            self.assertEqual(self.http.post("/api/control", json=cuerpo).status_code, 400, cuerpo)
        self.assertEqual(web.control.ajustes["t2_max"], 60.0)

    def test_no_se_activa_sin_broker(self):
        web.estado["broker"] = False
        self.assertEqual(self.http.post("/api/control", json={"activo": True}).status_code, 503)
        self.assertFalse(web.control.activo)

    def test_el_estado_del_control_va_con_los_datos_de_la_pagina(self):
        self.http.post("/api/control", json={"activo": True, "t2_max": 55})
        instantanea = web.instantanea()
        self.assertTrue(instantanea["control"]["activo"])
        self.assertEqual(instantanea["control"]["t2_max"], 55.0)

    def test_una_lectura_que_no_es_un_objeto_no_rompe_el_servidor(self):
        self.http.post("/api/control", json={"activo": True})
        web.on_message(None, None, MensajeFalso([1, 2, 3]))
        self.assertEqual(self.mqtt.publicado, [])


class CodigoDeGraficas(unittest.TestCase):
    def test_solo_se_sirven_los_archivos_de_las_graficas(self):
        http = web.app.test_client()
        for ruta in ("utilidades/modulos.js", "interfaz/dom.js", "interfaz/escala_grafica.js", "interfaz/grafica.js", "interfaz/grafica_activaciones.js"):
            r = http.get("/sim/" + ruta)
            self.assertEqual(r.status_code, 200, ruta)
            r.close()
        for ruta in ("interfaz/ayuda_textos.js", "modelo/planta.js", "../index.html", "interfaz/../../README.md"):
            self.assertEqual(http.get("/sim/" + ruta).status_code, 404, ruta)


if __name__ == "__main__":
    unittest.main(verbosity=2)
