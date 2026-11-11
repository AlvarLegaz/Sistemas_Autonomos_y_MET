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
        self.qos = getattr(self, "qos", []) + [qos]
        return type("Info", (), {"rc": 0})()


def lectura(t1, t2):
    return {c.CANAL_T1: t1 / 100.0, c.CANAL_T2: t2 / 100.0, c.CANAL_TERMOSTATO: True}


class ServidorControl(unittest.TestCase):
    def setUp(self):
        self.mqtt = ClienteFalso()
        web.client = self.mqtt
        web.control = c.ControlT1()
        web.res_deseado, web.ultima_orden_res, web.emergencia_pedida = False, 0.0, False
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


class SeguridadDelServidor(unittest.TestCase):
    def setUp(self):
        self.mqtt = ClienteFalso()
        web.client = self.mqtt
        web.control = c.ControlT1()
        web.res_deseado, web.ultima_orden_res, web.emergencia_pedida = False, 0.0, False
        web.estado.update(datos=None, recibido=0.0, broker=True, rechazo=None)
        self.http = web.app.test_client()

    # -- la orden de calentar se va renovando (en el gateway caduca) --
    def test_la_orden_de_calentar_se_renueva_mientras_dure(self):
        self.http.post("/api/salidas", json={c.SALIDA_RES: True})
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        web.refrescar_ordenes()
        self.assertEqual(self.mqtt.publicado, [{c.SALIDA_RES: True}] * 2)

    def test_si_se_apaga_la_resistencia_deja_de_renovarse(self):
        self.http.post("/api/salidas", json={c.SALIDA_RES: True})
        self.http.post("/api/salidas", json={c.SALIDA_RES: False})
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertEqual(self.mqtt.publicado, [])

    def test_si_el_gateway_la_apaga_el_servidor_no_insiste(self):
        self.http.post("/api/salidas", json={c.SALIDA_RES: True})
        web.ultima_orden_res -= 10                       # la orden es antigua: el gateway la ha apagado por algo
        web.on_message(None, None, MensajeFalso({**lectura(22, 22), c.SALIDA_RES: False}))
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertEqual(self.mqtt.publicado, [])

    def test_justo_despues_de_ordenar_aun_no_se_da_por_apagada(self):
        self.http.post("/api/salidas", json={c.SALIDA_RES: True})
        web.on_message(None, None, MensajeFalso({**lectura(22, 22), c.SALIDA_RES: False}))   # el gateway aun no la ha encendido
        self.assertTrue(web.res_deseado)

    def test_el_control_automatico_tambien_renueva(self):
        self.http.post("/api/control", json={"activo": True})
        web.on_message(None, None, MensajeFalso(lectura(22, 22)))
        self.assertTrue(web.res_deseado)
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertEqual(self.mqtt.publicado, [{c.SALIDA_RES: True}])

    # -- paro de emergencia --
    def test_el_paro_se_envia_con_qos_1_y_desactiva_el_control(self):
        self.http.post("/api/control", json={"activo": True})
        self.http.post("/api/salidas", json={c.SALIDA_RES: True})
        self.mqtt.publicado.clear(); self.mqtt.qos = []
        r = self.http.post("/api/emergencia", json={"activo": True})
        self.assertEqual((r.status_code, r.get_json()["enviado"]), (200, True))
        self.assertEqual(self.mqtt.publicado, [{"paro_emergencia": True}])
        self.assertEqual(self.mqtt.qos, [1])
        self.assertFalse(web.control.activo)
        self.assertFalse(web.res_deseado)
        self.assertTrue(web.instantanea()["emergencia_pedida"])

    def test_el_paro_se_repite_hasta_que_el_gateway_lo_confirma(self):
        self.http.post("/api/emergencia", json={"activo": True})
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertEqual(self.mqtt.publicado, [{"paro_emergencia": True}])
        web.on_message(None, None, MensajeFalso({**lectura(22, 22), "paro_emergencia": True}))
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertEqual(self.mqtt.publicado, [])
        self.assertFalse(web.instantanea()["emergencia_pedida"])

    def test_durante_el_paro_no_se_renueva_la_orden_de_calentar(self):
        self.http.post("/api/salidas", json={c.SALIDA_RES: True})
        self.http.post("/api/emergencia", json={"activo": True})
        self.mqtt.publicado.clear()
        web.refrescar_ordenes()
        self.assertNotIn({c.SALIDA_RES: True}, self.mqtt.publicado)

    def test_rearmar_manda_false_y_necesita_broker(self):
        self.http.post("/api/emergencia", json={"activo": True})
        self.mqtt.publicado.clear()
        self.assertEqual(self.http.post("/api/emergencia", json={"activo": False}).status_code, 200)
        self.assertEqual(self.mqtt.publicado, [{"paro_emergencia": False}])
        self.assertFalse(web.emergencia_pedida)
        web.client = None
        self.assertEqual(self.http.post("/api/emergencia", json={"activo": False}).status_code, 503)

    def test_el_paro_pedido_sin_broker_queda_pendiente_y_para_el_control(self):
        self.http.post("/api/control", json={"activo": True})
        web.client = None
        r = self.http.post("/api/emergencia", json={"activo": True})
        self.assertFalse(r.get_json()["enviado"])
        self.assertTrue(web.emergencia_pedida)
        self.assertFalse(web.control.activo)

    def test_peticiones_no_validas(self):
        for cuerpo in ({}, {"activo": "si"}, {"activo": 1}, [], None):
            self.assertEqual(self.http.post("/api/emergencia", json=cuerpo).status_code, 400, cuerpo)


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
