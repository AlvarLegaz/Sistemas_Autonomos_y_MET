"""Pruebas del contrato MQTT PCT23 v2.4 sobre el mockup (hora propia simulada, sin broker ni hardware).

    python -m pytest test_contrato_pct23.py -q        (desde gateway_industrial_excelencia)
"""
import unittest

from contrato_pct23 import (CLAVES_SENSORS, INTERFACE_VERSION, RelojAutonomo, RelojSimulado, iso_utc, parse_iso)
from mockup_pct23 import BusMock, Simulacion, coincide


def sim(**kw):
    s = Simulacion(**kw)
    s.avanzar(1.0)
    return s


def arrancar(s):
    """Planta en marcha: N2, N1 a 100 %, SOL1 a producto, calefactor al 50 %."""
    for tag, valor in (("sol3_cooling", True), ("n2_on", True), ("n1_on", True), ("n1_speed_pct", 100), ("sol1_divert", False), ("heater_pct", 50)):
        assert s.ordena(tag, valor)["result"] == "accepted", tag


def alarmas(s, nombre=None):
    return [(a["alarm"], a["event"]) for a in s.scada.alarmas if nombre in (None, a["alarm"])]


class Reloj(unittest.TestCase):
    def test_iso_ida_y_vuelta_con_milisegundos(self):
        t = parse_iso("2026-11-18T10:15:00.120Z")
        self.assertEqual(iso_utc(t), "2026-11-18T10:15:00.120Z")
        self.assertIsNone(parse_iso("ayer")); self.assertIsNone(parse_iso(None)); self.assertIsNone(parse_iso(12))

    def test_reloj_simulado_solo_avanza_cuando_se_le_dice(self):
        r = RelojSimulado("2026-01-01T00:00:00.000Z")
        a = r.ahora(); self.assertEqual(r.ahora(), a)
        r.avanzar(1.5); self.assertEqual(iso_utc(r.ahora()), "2026-01-01T00:00:01.500Z")
        r.poner("2027-02-03T04:05:06.007Z"); self.assertEqual(iso_utc(r.ahora()), "2027-02-03T04:05:06.007Z")

    def test_reloj_autonomo_parte_de_nuestra_hora_y_avanza_solo(self):
        r = RelojAutonomo("2030-05-05T12:00:00.000Z", factor=1000.0)       # ×1000 para que se note en una prueba
        t0 = r.ahora(); self.assertGreaterEqual(t0, parse_iso("2030-05-05T12:00:00.000Z"))
        import time; time.sleep(0.02)
        self.assertGreater(r.ahora(), t0 + 5)
        with self.assertRaises(ValueError): RelojAutonomo("no es una fecha")


class Publicaciones(unittest.TestCase):
    def test_al_conectar_publica_status_y_actuators_retenidos(self):
        s = Simulacion()
        t = {top: (p, retain) for top, p, _, retain in s.bus.registro}
        st, ret = t["pct23/real-01/status"]
        self.assertTrue(ret); self.assertEqual((st["state"], st["kind"], st["instance_id"], st["interface_version"]), ("online", "real", "real-01", INTERFACE_VERSION))
        self.assertIn("safe_state", st); self.assertFalse(st["safe_state"])
        ac, ret = t["pct23/real-01/actuators"]
        self.assertTrue(ret)
        for k in ("sol1_divert", "sol2_feed_tank", "sol3_cooling", "sol4_fill_a", "sol5_fill_b", "n1_on", "n1_speed_pct", "n2_on", "heater_pct", "heater_kw", "heater_inhibited"):
            self.assertIn(k, ac)
        self.assertNotIn("n2_speed_pct", ac)                          # opcional y pendiente de confirmar: no se publica

    def test_lwt_del_contrato(self):
        top, payload, qos, retain = Simulacion().tarjeta.lwt()
        self.assertEqual((top, payload, qos, retain), ("pct23/real-01/status", {"state": "offline", "kind": "real", "instance_id": "real-01"}, 1, True))

    def test_sensors_cada_segundo_con_todas_las_claves_seq_y_qos0(self):
        s = Simulacion(); s.avanzar(5.0)
        ms = [(p, q, r) for t, p, q, r in s.bus.registro if t.endswith("/sensors")]
        self.assertGreaterEqual(len(ms), 5); self.assertLessEqual(len(ms), 7)
        self.assertEqual([m[0]["seq"] for m in ms], list(range(1, len(ms) + 1)))
        for p, q, r in ms:
            self.assertEqual((q, r), (0, False)); self.assertTrue(set(CLAVES_SENSORS) <= set(p)); self.assertIn("ts", p)
        self.assertIsNone(ms[0][0]["t5_c"])                            # va null, nunca se omite

    def test_actuators_se_republica_cada_30_s_aunque_no_pase_nada(self):
        s = Simulacion(); n0 = len(s.bus.mensajes("pct23/real-01/actuators")); s.avanzar(61.0)
        self.assertGreaterEqual(len(s.bus.mensajes("pct23/real-01/actuators")) - n0, 2)

    def test_status_cambia_con_params_y_se_republica(self):
        s = sim(); s.bus.publicar("pct23/real-01/params", {"ts": iso_utc(s.reloj.ahora()), "pasteurization_setpoint_c": 60.0, "t6_c": 26.0}, 1, True); s.avanzar(0.2)
        self.assertEqual(s.scada.status["params"], {"pasteurization_setpoint_c": 60.0, "t6_c": 26.0})

    def test_parada_ordenada_publica_offline(self):
        s = sim(); s.tarjeta.detener()
        self.assertEqual(s.bus.retenidos["pct23/real-01/status"]["state"], "offline")

    def test_heater_kw_se_calcula_del_pct(self):
        s = sim(); s.ordena("heater_pct", 50); self.assertAlmostEqual(s.scada.actuators["heater_kw"], 0.88, places=3)


class Ordenes(unittest.TestCase):
    def test_aceptada_responde_ack_con_applied_y_publica_actuators_aunque_no_cambie(self):
        s = sim(); n0 = len(s.bus.mensajes("pct23/real-01/actuators"))
        ack = s.ordena("sol3_cooling", True); self.assertEqual((ack["result"], ack["applied"]), ("accepted", True))
        s.ordena("sol3_cooling", True)                                  # misma orden, nada cambia: se publica igual
        self.assertEqual(len(s.bus.mensajes("pct23/real-01/actuators")) - n0, 2)
        self.assertTrue(s.scada.actuators["sol3_cooling"])

    def test_n1_30_pct_se_aplica_al_50_y_el_ack_dice_lo_aplicado(self):
        s = sim(); ack = s.ordena("n1_speed_pct", 30)
        self.assertEqual((ack["result"], ack["applied"]), ("accepted", 50)); self.assertEqual(s.scada.actuators["n1_speed_pct"], 50)

    def test_tag_desconocido(self):
        s = sim(); self.assertEqual(s.ordena("sol9", True)["reason"], "unknown_tag")

    def test_id_repetido_es_duplicate(self):
        s = sim(); s.ordena("sol3_cooling", True, oid="x1")
        self.assertEqual(s.ordena("sol3_cooling", False, oid="x1")["reason"], "duplicate"); self.assertTrue(s.scada.actuators["sol3_cooling"])

    def test_orden_vieja_caduca_a_los_5_s_pero_una_de_4_vale(self):
        s = sim(); vieja = iso_utc(s.reloj.ahora() - 6.0); reciente = iso_utc(s.reloj.ahora() - 4.0)
        self.assertEqual(s.ordena("sol3_cooling", True, ts=vieja)["reason"], "expired")
        self.assertEqual(s.ordena("sol3_cooling", True, ts=reciente)["result"], "accepted")

    def test_hora_del_futuro_o_sin_ts_valido_se_rechaza(self):
        s = sim()
        self.assertEqual(s.ordena("sol3_cooling", True, ts=iso_utc(s.reloj.ahora() + 30))["reason"], "invalid_value")
        self.assertEqual(s.ordena("sol3_cooling", True, ts="mañana")["reason"], "invalid_value")

    def test_valores_no_validos(self):
        s = sim()
        for tag, valor in (("sol3_cooling", 1), ("sol3_cooling", "true"), ("sol2_feed_tank", "C"), ("n1_speed_pct", 101), ("n1_speed_pct", -1), ("n1_speed_pct", 50.5),
                           ("n1_speed_pct", True), ("heater_pct", "50"), ("n1_on", None), ("heater_pct", float("nan"))):
            with self.subTest(tag=tag, valor=valor):
                self.assertEqual(s.ordena(tag, valor)["reason"], "invalid_value")

    def test_n2_speed_pct_not_supported_mientras_este_pendiente(self):
        self.assertEqual(sim().ordena("n2_speed_pct", 60)["reason"], "not_supported")

    def test_orden_sin_id_no_tiene_ack(self):
        s = sim(); n0 = len(s.bus.mensajes("pct23/real-01/cmd/+/ack"))
        s.bus.publicar("pct23/real-01/cmd/sol3_cooling", {"ts": iso_utc(s.reloj.ahora()), "value": True}, 1); s.avanzar(0.2)
        self.assertEqual(len(s.bus.mensajes("pct23/real-01/cmd/+/ack")), n0); self.assertFalse(s.scada.actuators["sol3_cooling"])

    def test_modo_local_rechaza_ordenes(self):
        s = sim(); s.bus.publicar("pct23/real-01/params", {"control_mode": "local"}, 1, True); s.avanzar(0.2)
        self.assertEqual(s.scada.status["control_mode"], "local"); self.assertEqual(s.ordena("sol3_cooling", True)["reason"], "local_mode")

    def test_reset_model_solo_gemelo(self):
        self.assertEqual(sim().ordena("reset_model", "cold")["reason"], "not_supported")

    def test_orden_de_servicio_con_valor_falso_es_invalid(self):
        self.assertEqual(sim().ordena("reset_safe_state", False)["reason"], "invalid_value")


class Interlocks(unittest.TestCase):
    def test_calefactor_con_termostato_abierto(self):
        s = sim(); s.planta.forzar("stat_overtemp", True); s.avanzar(0.2)
        self.assertEqual(s.ordena("heater_pct", 20)["reason"], "interlock_overtemp"); self.assertEqual(s.ordena("heater_pct", 0)["result"], "accepted")

    def test_calefactor_y_n2_sin_nivel_en_el_calefactor(self):
        s = sim(); s.planta.forzar("lvl_heat_unit", False); s.avanzar(0.2)
        self.assertEqual(s.ordena("heater_pct", 20)["reason"], "interlock_low_level_heat")
        self.assertEqual(s.ordena("n2_on", True)["reason"], "interlock_low_level_heat")
        self.assertEqual(s.ordena("n2_on", False)["result"], "accepted")

    def test_n1_con_tanque_a_vacio_y_con_b_vacio(self):
        s = sim(); s.planta.l1_mm = 5.0; s.avanzar(0.2)
        self.assertEqual(s.ordena("n1_on", True)["reason"], "interlock_low_level_feed")
        s.ordena("sol2_feed_tank", "B"); s.planta.vb_mm = 10.0; s.avanzar(0.2)
        self.assertEqual(s.ordena("n1_on", True)["reason"], "interlock_low_level_feed")
        s.planta.vb_mm = 100.0; s.avanzar(0.2); self.assertEqual(s.ordena("n1_on", True)["result"], "accepted")

    def test_l1_no_legible_no_se_inventa_un_interlock(self):
        s = sim(); s.planta.forzar("l1_level_mm", None); s.avanzar(0.2); self.assertEqual(s.ordena("n1_on", True)["result"], "accepted")

    def test_sol5_con_b_en_nivel_alto(self):
        s = sim(); s.planta.vb_mm = 210.0; s.avanzar(0.2)
        self.assertEqual(s.ordena("sol5_fill_b", True)["reason"], "interlock_high_level_b"); self.assertEqual(s.ordena("sol5_fill_b", False)["result"], "accepted")

    def test_el_orden_de_comprobacion_tag_duplicado_caducidad_valor_modo_interlock(self):
        s = sim(); s.planta.forzar("stat_overtemp", True); s.avanzar(0.2)
        # con termostato abierto y una orden además caducada: gana expired (va antes que el interlock)
        self.assertEqual(s.ordena("heater_pct", 20, ts=iso_utc(s.reloj.ahora() - 9))["reason"], "expired")
        # valor inválido gana al interlock
        self.assertEqual(s.ordena("heater_pct", 200)["reason"], "invalid_value")


class AutoParada(unittest.TestCase):
    def test_tanque_a_se_vacia_con_n1_en_marcha_la_planta_para_n1_y_publica(self):
        s = sim(); s.ordena("n1_on", True); s.planta.l1_mm = 12.0
        s.avanzar(20.0)
        self.assertFalse(s.scada.actuators["n1_on"])
        self.assertIn(("feed_tank_empty", "raised"), alarmas(s))
        s.ordena("sol4_fill_a", True); s.avanzar(30.0); s.ordena("sol4_fill_a", False); s.avanzar(1.0)
        self.assertIn(("feed_tank_empty", "cleared"), alarmas(s))

    def test_termostato_abierto_apaga_la_resistencia_y_levanta_overtemp(self):
        s = sim(); s.ordena("heater_pct", 100); s.planta.forzar("stat_overtemp", True); s.avanzar(1.5)
        self.assertEqual(s.scada.actuators["heater_pct"], 0)
        self.assertIn(("overtemp", "raised"), alarmas(s))
        s.planta.soltar("stat_overtemp"); s.avanzar(1.5); self.assertIn(("overtemp", "cleared"), alarmas(s))
        self.assertEqual(s.scada.actuators["heater_pct"], 0)           # no se rearma sola

    def test_sin_nivel_en_el_calefactor_se_apagan_resistencia_y_n2_desvio_de_seguridad(self):
        s = sim(); s.ordena("n2_on", True); s.ordena("heater_pct", 40); s.planta.forzar("lvl_heat_unit", False); s.avanzar(1.5)
        self.assertEqual((s.scada.actuators["heater_pct"], s.scada.actuators["n2_on"]), (0, False))

    def test_sin_la_proteccion_activada_no_se_apaga(self):
        s = sim(proteccion_nivel_calefactor=False); s.ordena("heater_pct", 40); s.planta.nivel_calefactor = True; s.planta.forzar("lvl_heat_unit", False); s.avanzar(1.5)
        self.assertEqual(s.scada.actuators["heater_pct"], 40)


class LatidoYEstadoSeguro(unittest.TestCase):
    def test_sin_latido_10_s_desde_el_arranque_entra_en_estado_seguro(self):
        s = Simulacion(latido=False); s.avanzar(9.0)
        self.assertFalse(s.scada.status["safe_state"]); s.avanzar(2.5)
        st = s.scada.status; self.assertTrue(st["safe_state"]); self.assertEqual(st["safe_reason"], "watchdog")
        self.assertIn(("watchdog_timeout", "raised"), alarmas(s))

    def test_con_latido_no_entra(self):
        s = Simulacion(); s.avanzar(60.0); self.assertFalse(s.scada.status["safe_state"])

    def test_estado_seguro_pone_los_actuadores_como_dice_la_tabla(self):
        s = sim(); arrancar(s); s.ordena("sol2_feed_tank", "B"); s.scada.latido = False; s.avanzar(12.0)
        a = s.scada.actuators
        self.assertEqual((a["heater_pct"], a["n1_on"], a["n2_on"], a["n1_speed_pct"], a["sol1_divert"], a["sol4_fill_a"], a["sol5_fill_b"]), (0, False, False, 0, True, False, False))
        self.assertEqual((a["sol2_feed_tank"], a["sol3_cooling"]), ("B", True))      # SOL2 y SOL3: sin cambio

    def test_en_estado_seguro_se_rechazan_las_ordenes_y_sensors_sigue(self):
        s = sim(); s.scada.latido = False; s.avanzar(12.0)
        n0 = len(s.bus.mensajes("pct23/real-01/sensors")); s.avanzar(3.0)
        self.assertGreater(len(s.bus.mensajes("pct23/real-01/sensors")), n0)
        self.assertEqual(s.ordena("sol3_cooling", True)["reason"], "safe_state")

    def test_no_sale_solo_hace_falta_latido_y_reset(self):
        s = sim(); s.scada.latido = False; s.avanzar(12.0)
        self.assertEqual(s.ordena("reset_safe_state", True)["reason"], "safe_state")      # sin latido no sale
        s.scada.latido = True; s.avanzar(3.0)
        self.assertEqual(s.ordena("reset_safe_state", True)["result"], "accepted")
        self.assertFalse(s.scada.status["safe_state"]); self.assertIn(("watchdog_timeout", "cleared"), alarmas(s))
        self.assertEqual(s.ordena("sol3_cooling", True)["result"], "accepted")
        s.avanzar(5.0); self.assertFalse(s.scada.status["safe_state"])                   # y no vuelve a saltar con latido

    def test_se_pierde_el_broker_estado_seguro(self):
        s = sim(); arrancar(s); s.tarjeta.desconexion_broker()
        self.assertTrue(s.tarjeta.safe_state); self.assertEqual(s.planta.a["heater_pct"], 0)


class ParadaDeEmergencia(unittest.TestCase):
    def test_se_acepta_pone_estado_seguro_levanta_alarma_y_publica_status(self):
        s = sim(); arrancar(s); ack = s.ordena("emergency_stop", True)
        self.assertEqual((ack["result"], ack["applied"]), ("accepted", True))
        self.assertTrue(s.scada.status["safe_state"]); self.assertEqual(s.scada.status["safe_reason"], "emergency_stop")
        self.assertEqual((s.scada.actuators["heater_pct"], s.scada.actuators["n1_on"]), (0, False))
        a = [x for x in s.scada.alarmas if x["alarm"] == "emergency_stop"][0]
        self.assertEqual((a["event"], a["severity"], a["reason"]), ("raised", "critical", "operator_command"))

    def test_se_acepta_en_modo_local_con_orden_vieja_y_en_estado_seguro(self):
        s = sim(); s.bus.publicar("pct23/real-01/params", {"control_mode": "local"}, 1, True); s.avanzar(0.2)
        self.assertEqual(s.ordena("emergency_stop", True, ts=iso_utc(s.reloj.ahora() - 60))["result"], "accepted")
        self.assertEqual(s.ordena("emergency_stop", True)["result"], "accepted")          # ya en estado seguro

    def test_se_rechaza_false_el_duplicado_y_los_actuadores_despues(self):
        s = sim()
        self.assertEqual(s.ordena("emergency_stop", False)["reason"], "invalid_value")
        s.ordena("emergency_stop", True, oid="par1")
        self.assertEqual(s.ordena("emergency_stop", True, oid="par1")["reason"], "duplicate")
        self.assertEqual(s.ordena("heater_pct", 10)["reason"], "safe_state")

    def test_reset_safe_state_la_vuelve_a_dejar_operativa_y_apaga_la_alarma(self):
        s = sim(); s.ordena("emergency_stop", True)
        self.assertEqual(s.ordena("reset_safe_state", True)["result"], "accepted")
        self.assertFalse(s.scada.status["safe_state"]); self.assertIn(("emergency_stop", "cleared"), alarmas(s))
        self.assertEqual(s.ordena("sol3_cooling", True)["result"], "accepted")


class Alarmas(unittest.TestCase):
    def test_solo_cambios_nunca_repetidas(self):
        s = sim(); s.planta.forzar("stat_overtemp", True); s.avanzar(10.0)
        self.assertEqual(alarmas(s, "overtemp"), [("overtemp", "raised")])

    def test_stream_stopped_lista_lo_parado(self):
        s = sim(); s.ordena("heater_pct", 30)
        a = [x for x in s.scada.alarmas if x["alarm"] == "stream_stopped"][-1]
        self.assertEqual(a["event"], "raised"); self.assertEqual(a["reason"], "n1_off,n2_off,cooling_closed"); self.assertEqual(a["severity"], "warning")

    def test_product_below_setpoint(self):
        s = sim(); s.bus.publicar("pct23/real-01/params", {"pasteurization_setpoint_c": 60.0}, 1, True); s.avanzar(0.2)
        arrancar(s); s.avanzar(2.0)
        self.assertIn(("product_below_setpoint", "raised"), alarmas(s))

    def test_el_mensaje_y_la_severidad_van_en_cada_alarma(self):
        s = sim(); s.planta.forzar("stat_overtemp", True); s.avanzar(1.5)
        a = s.scada.alarmas[0]; self.assertEqual((a["alarm"], a["severity"], a["reason"]), ("overtemp", "critical", "stat_overtemp")); self.assertTrue(a["message"])


class RevisionDeSeguridad(unittest.TestCase):
    """Hallazgos de la revisión independiente: cada uno con su prueba."""

    def test_emergency_stop_se_acepta_con_ts_futuro_o_sin_ts(self):
        s = sim()
        self.assertEqual(s.ordena("emergency_stop", True, ts=iso_utc(s.reloj.ahora() + 3600))["result"], "accepted")
        s2 = sim(); s2.bus.publicar("pct23/real-01/cmd/emergency_stop", {"id": "sin-ts", "value": True}, 1); s2.avanzar(0.2)
        self.assertEqual(s2.scada.acks["sin-ts"]["result"], "accepted"); self.assertTrue(s2.scada.status["safe_state"])

    def test_las_demas_ordenes_siguen_exigiendo_hora(self):
        s = sim(); self.assertEqual(s.ordena("sol3_cooling", True, ts=iso_utc(s.reloj.ahora() + 3600))["reason"], "invalid_value")

    def test_valores_gigantes_o_infinitos_no_tumban_la_tarjeta(self):
        s = sim()
        for valor in (1e999, -1e999, 10 ** 400, float("inf")):
            with self.subTest(valor=repr(valor)[:12]):
                s.bus.publicar("pct23/real-01/cmd/n1_speed_pct", {"id": f"g{abs(hash(repr(valor)))}", "ts": iso_utc(s.reloj.ahora()), "value": valor}, 1)
        s.avanzar(0.5)
        self.assertEqual(s.ordena("sol3_cooling", True)["result"], "accepted")          # sigue viva y operativa

    def test_params_y_config_malformados_se_ignoran(self):
        s = sim()
        s.bus.publicar("pct23/real-01/params", {"pasteurization_setpoint_c": "sesenta", "control_mode": "raro", "t6_c": float("nan"), "ambient_c": 21.5}, 1, True)
        s.bus.publicar("pct23/real-01/config", {"f1_ml_min_per_v": "x", "l1_low_mm": True, "t_scale_c_per_v": -5, "l1_warn_mm": 30}, 1, True); s.avanzar(2.0)
        self.assertEqual(s.scada.status["params"], {"ambient_c": 21.5}); self.assertEqual(s.tarjeta.config, {"l1_warn_mm": 30})
        self.assertEqual(s.scada.status["control_mode"], "remote"); self.assertFalse(s.scada.status["safe_state"])

    def test_una_excepcion_en_el_ciclo_lleva_a_estado_seguro_y_no_tumba_el_proceso(self):
        s = sim(); arrancar(s)
        s.planta.leer_sensores = lambda: (_ for _ in ()).throw(RuntimeError("driver roto"))
        s.avanzar(1.5)
        self.assertTrue(s.tarjeta.safe_state); self.assertEqual(s.tarjeta.safe_reason, "internal_error"); self.assertEqual(s.planta.a["heater_pct"], 0)

    def test_si_los_hilos_de_es_mueren_estado_seguro_y_no_se_puede_rearmar(self):
        s = sim(); arrancar(s); s.planta.viva = lambda: False; s.avanzar(1.5)
        self.assertEqual((s.scada.status["safe_state"], s.scada.status["safe_reason"]), (True, "io_fault")); self.assertEqual(s.scada.actuators["heater_pct"], 0)
        self.assertEqual(s.ordena("reset_safe_state", True)["reason"], "safe_state")
        s.planta.viva = lambda: True; s.avanzar(3.0)
        self.assertEqual(s.ordena("reset_safe_state", True)["result"], "accepted")

    def test_emergency_stop_en_estado_seguro_por_latido_cambia_el_motivo_y_la_alarma(self):
        s = sim(); s.scada.latido = False; s.avanzar(12.0)
        self.assertEqual(s.scada.status["safe_reason"], "watchdog")
        self.assertEqual(s.ordena("emergency_stop", True)["result"], "accepted")
        self.assertEqual(s.scada.status["safe_reason"], "emergency_stop")
        self.assertIn(("watchdog_timeout", "cleared"), alarmas(s)); self.assertIn(("emergency_stop", "raised"), alarmas(s))

    def test_alarmas_ocurridas_sin_conexion_se_reconcilian_al_reconectar(self):
        s = sim(); s.tarjeta.conectado = False                                  # se cae el broker: el publicador real descarta
        s.planta.forzar("stat_overtemp", True)
        s.bus.registro.clear(); s.scada.alarmas.clear()
        s.tarjeta.tick(); self.assertEqual(alarmas(s), [])                      # sin conexión no se publica ni se da por enviada
        s.tarjeta.conectar()
        self.assertIn(("overtemp", "raised"), alarmas(s))                      # al reconectar llega lo que se perdió
        s.tarjeta.conectado = False; s.planta.soltar("stat_overtemp"); s.tarjeta._sensores_completos()
        s.tarjeta.conectar()
        self.assertIn(("overtemp", "cleared"), alarmas(s))                     # y también el «cleared» perdido


class BusComodines(unittest.TestCase):
    def test_comodines_de_mqtt(self):
        self.assertTrue(coincide("pct23/+/status", "pct23/real-01/status")); self.assertTrue(coincide("pct23/#", "pct23/real-01/cmd/n1_on/ack"))
        self.assertFalse(coincide("pct23/+/status", "pct23/real-01/cmd/status")); self.assertFalse(coincide("pct23/real-01/cmd/+", "pct23/real-01/cmd/n1_on/ack"))

    def test_el_bus_entrega_los_retenidos_al_suscribirse_tarde(self):
        b = BusMock(); b.publicar("a/b", {"x": 1}, 1, True); visto = []
        b.suscribir("a/#", lambda t, p: visto.append((t, p))); self.assertEqual(visto, [("a/b", {"x": 1})])


if __name__ == "__main__":
    unittest.main()
