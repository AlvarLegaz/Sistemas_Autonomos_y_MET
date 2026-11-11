"""Pruebas del control de T1 (control_t1.py). Ejecutar:  python test_control_t1.py"""
import unittest

import control_t1 as c


class Reloj:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def lectura(t1, t2, termostato_ok=True):
    """Lectura del gateway con las temperaturas dadas (las sondas dan 10 mV/°C)."""
    return {c.CANAL_T1: t1 / 100.0, c.CANAL_T2: t2 / 100.0, c.CANAL_TERMOSTATO: termostato_ok}


class Ajustes(unittest.TestCase):
    def test_valores_por_defecto_y_rangos(self):
        control = c.ControlT1()
        self.assertEqual(control.estado()["t2_max"], 60.0)
        for malo in ({"t2_max": 80}, {"consigna_t1": 5}, {"histeresis": 0}, {"velocidad_n1": 5}, {"t2_max": "60"}, {"nada": 1}):
            with self.assertRaises(ValueError, msg=malo):
                control.configurar(**malo)
        control.configurar(consigna_t1=50, histeresis=1.5)
        self.assertEqual((control.ajustes["consigna_t1"], control.ajustes["histeresis"]), (50.0, 1.5))

    def test_si_un_ajuste_falla_no_se_cambia_ninguno(self):
        control = c.ControlT1()
        with self.assertRaises(ValueError):
            control.configurar(consigna_t1=50, t2_max=99)
        self.assertEqual(control.ajustes["consigna_t1"], 45.0)

    def test_inactivo_no_manda_nada(self):
        self.assertEqual(c.ControlT1().paso(lectura(20, 20)), {})
        self.assertEqual(c.ControlT1().desactivar(), {})


class Histeresis(unittest.TestCase):
    def setUp(self):
        self.reloj = Reloj()
        self.control = c.ControlT1(self.reloj)
        self.control.configurar(consigna_t1=45, t2_max=60, histeresis=2, velocidad_n1=50)
        self.control.activar()

    def paso(self, t1, t2, avance=1.0, **kw):
        self.reloj.t += avance
        return self.control.paso(lectura(t1, t2, **kw))

    def test_enciende_bajo_la_banda_y_apaga_sobre_ella(self):
        ordenes = self.paso(22, 22)                       # muy frío: resistencia, bombas y velocidad de N1
        self.assertEqual(ordenes[c.SALIDA_RES], True)
        self.assertEqual((ordenes[c.SALIDA_N1], ordenes[c.SALIDA_N2], ordenes[c.SALIDA_VELOCIDAD_N1]), (True, True, 50.0))
        objetivo = self.control.estado()["t2_objetivo"]
        self.assertTrue(22 + 5 <= objetivo <= 60)
        self.assertEqual(self.paso(45, objetivo + 2.5)[c.SALIDA_RES], False)   # por encima de la banda
        self.assertTrue(self.control.estado()["calefactor"] is False)

    def test_dentro_de_la_banda_mantiene_el_estado(self):
        self.control.configurar(consigna_t1=35)           # T1 = consigna: la consigna de T2 queda estable y por debajo del máximo
        self.paso(35, 20)
        objetivo = self.control.estado()["t2_objetivo"]
        self.assertTrue(self.control.estado()["calefactor"])
        self.paso(35, objetivo)                           # dentro de la banda: sigue encendida
        self.assertTrue(self.control.estado()["calefactor"])
        self.paso(35, objetivo + 2.5)                     # sube de la banda: se apaga
        self.assertFalse(self.control.estado()["calefactor"])
        self.paso(35, objetivo)                           # vuelve a la banda: sigue apagada (histéresis)
        self.assertFalse(self.control.estado()["calefactor"])
        self.paso(35, objetivo - 2.5)                     # baja de la banda: se enciende
        self.assertTrue(self.control.estado()["calefactor"])

    def test_la_consigna_de_t2_no_supera_la_maxima(self):
        self.control.configurar(consigna_t1=70, t2_max=55)
        for _ in range(50):
            self.paso(30, 40)
        self.assertEqual(self.control.estado()["t2_objetivo"], 55.0)

    def test_en_el_maximo_de_t2_se_apaga_siempre(self):
        self.control.configurar(t2_max=50)
        self.paso(22, 22)
        self.assertEqual(self.paso(30, 50.5)[c.SALIDA_RES], False)
        self.assertIn("máximo", self.control.estado()["aviso"])

    def test_termostato_disparado_apaga_la_resistencia(self):
        self.paso(22, 22)
        ordenes = self.paso(22, 30, termostato_ok=False)
        self.assertEqual(ordenes[c.SALIDA_RES], False)
        self.assertIn("Termostato", self.control.estado()["aviso"])

    def test_sin_lectura_apaga_y_se_recupera(self):
        self.paso(22, 22)
        self.reloj.t += 1
        ordenes = self.control.paso({c.CANAL_T1: 0.3})   # falta T2
        self.assertEqual(ordenes[c.SALIDA_RES], False)
        self.assertIn("Sin lectura", self.control.estado()["aviso"])
        self.assertEqual(self.paso(22, 22)[c.SALIDA_RES], True)

    def test_las_ordenes_se_repiten_cada_pocos_segundos(self):
        self.paso(22, 22)
        self.assertEqual(self.paso(22, 25), {})           # sin cambios, aún no toca repetir
        self.assertIn(c.SALIDA_RES, self.paso(22, 26, avance=c.SEGUNDOS_REENVIO))

    def test_cambiar_la_velocidad_de_n1_se_manda_enseguida(self):
        self.paso(22, 22)
        self.control.configurar(velocidad_n1=80)
        self.assertEqual(self.paso(22, 25)[c.SALIDA_VELOCIDAD_N1], 80.0)

    def test_desactivar_apaga_la_resistencia(self):
        self.paso(22, 22)
        self.assertEqual(self.control.desactivar(), {c.SALIDA_RES: False})
        self.assertFalse(self.control.activo)
        self.assertEqual(self.paso(22, 22), {})


class LazoCerrado(unittest.TestCase):
    """Planta simple de primer orden (sin inercia del calefactor): el control debe llevar T1 a su consigna."""

    def simular(self, consigna_t1, t2_max, velocidad, horas=4):
        reloj = Reloj()
        control = c.ControlT1(reloj)
        control.configurar(consigna_t1=consigna_t1, t2_max=t2_max, histeresis=2, velocidad_n1=velocidad)
        control.activar()
        t1 = t2 = 22.0
        res = False
        k = 0.15 * velocidad / 100 * 0.85                 # calor que se lleva el producto
        eficiencia = c.eficiencia(velocidad)
        maximo_t2, serie_t1 = t2, []
        for _ in range(int(horas * 3600)):
            reloj.t += 1.0
            ordenes = control.paso(lectura(t1, t2))
            res = ordenes.get(c.SALIDA_RES, res)
            t2 += (150.0 * res - (t2 - 22.0) * (1 + k)) / 1500.0
            t1 += (22.0 + (t2 - 22.0) * eficiencia - t1) / 20.0
            maximo_t2 = max(maximo_t2, t2)
            serie_t1.append(t1)
        return t1, maximo_t2, serie_t1

    def test_t1_llega_a_la_consigna_sin_pasarse_de_t2_maxima(self):
        t1, maximo_t2, serie = self.simular(consigna_t1=45, t2_max=60, velocidad=50)
        ultima_hora = serie[-3600:]
        self.assertTrue(min(ultima_hora) > 43 and max(ultima_hora) < 47, (min(ultima_hora), max(ultima_hora)))
        self.assertLess(maximo_t2, 62)

    def test_con_t2_maxima_baja_t1_no_alcanza_pero_no_se_pasa(self):
        t1, maximo_t2, _ = self.simular(consigna_t1=60, t2_max=50, velocidad=50)
        self.assertLess(t1, 60)
        self.assertLess(maximo_t2, 52)


if __name__ == "__main__":
    unittest.main(verbosity=2)
