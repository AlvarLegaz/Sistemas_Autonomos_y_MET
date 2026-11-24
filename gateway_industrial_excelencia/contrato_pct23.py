"""Núcleo del contrato MQTT PCT23 v2.4 preliminar (+ enmiendas de CONTRATO_MQTT_ENMIENDAS.md).

Es lógica pura: no importa paho ni toca hardware. Habla con el exterior por tres piezas que se le inyectan:
  - un RELOJ (`Reloj`): hoy un `RelojAutonomo` o `RelojSimulado` que creamos nosotros; después `RelojSistema` (hora real, con NTP en la Pi);
  - una PLANTA (cualquier objeto con la interfaz de `Planta`): la maqueta real a través del runtime (`planta_runtime.py`) o el mockup (`mockup_pct23.py`);
  - una función `publicar(topic, payload_dict, qos, retain)`: el cliente MQTT real (`gateway_pct23.py`) o el bus en memoria del mockup.

El `Controlador` hace lo que dice el contrato de la tarjeta: publica sensors/actuators/status/alarms, valida las órdenes de cmd/{tag} y responde en
cmd/{tag}/ack, vigila el latido del SCADA y entra en estado seguro.

Lo que el contrato no fija y hemos tenido que suponer va marcado «SUPUESTO». Lo que añadimos por seguridad y el contrato no dice, «DESVÍO».
"""
import json
import math
import sys
import time
import traceback
from collections import deque
from datetime import datetime, timezone

INTERFACE_VERSION = "2.4.0-preliminary"
SW_VERSION = "0.2.0"

CADUCIDAD_ORDEN_S = 5.0          # una orden con más retraso se rechaza (expired)
LATIDO_TIMEOUT_S = 10.0          # sin latido durante este tiempo -> estado seguro
PERIODO_SENSORS_S = 1.0
PERIODO_ACTUATORS_S = 30.0       # republica aunque no haya cambios
PERIODO_STATUS_S = 30.0
IDS_VISTOS_MAX = 500
POTENCIA_RESISTENCIA_KW = 1.76   # al 100 % (heater_kw = heater_pct x 0,0176). SUPUESTO: por comprobar con la resistencia real
L1_BAJO_MM_DEFECTO = 10.0        # SUPUESTO: umbral de «tanque A vacío» si config.l1_low_mm es null
N1_VELOCIDAD_BAJA_PCT = 50       # n1_speed_low: N1 en marcha por debajo del 50 %


# ------------------------------------------------------------------------------------------------------------------ reloj ----
class Reloj:
    """Fuente de hora. `ahora()` devuelve segundos desde 1970 (UTC), como time.time()."""
    def ahora(self):
        raise NotImplementedError


class RelojSistema(Reloj):
    """Hora real del equipo. En la Raspberry Pi hace falta NTP (no tiene RTC): sin hora correcta las órdenes caducarían."""
    def ahora(self):
        return time.time()


class RelojAutonomo(Reloj):
    """Hora PROPIA, creada por nosotros: parte de una fecha dada y avanza sola con el reloj monotónico (no depende de NTP ni de la hora del equipo).
    `factor` acelera el tiempo (1 = real). Se puede reajustar con `poner()`."""
    def __init__(self, inicio="2026-11-24T10:00:00.000Z", factor=1.0):
        t = parse_iso(inicio)
        if t is None:
            raise ValueError(f"hora inicial no válida: {inicio!r}")
        self._base, self._mono0, self.factor = t, time.monotonic(), float(factor)

    def ahora(self):
        return self._base + (time.monotonic() - self._mono0) * self.factor

    def poner(self, iso):
        t = parse_iso(iso)
        if t is None:
            raise ValueError(f"hora no válida: {iso!r}")
        self._base, self._mono0 = t, time.monotonic()


class RelojSimulado(Reloj):
    """Hora manual para pruebas: solo avanza cuando se le dice, así todo es determinista."""
    def __init__(self, inicio="2026-11-24T10:00:00.000Z"):
        self._t = parse_iso(inicio)
        if self._t is None:
            raise ValueError(f"hora inicial no válida: {inicio!r}")

    def ahora(self):
        return self._t

    def avanzar(self, segundos):
        self._t += float(segundos)
        return self._t

    def poner(self, iso):
        t = parse_iso(iso)
        if t is None:
            raise ValueError(f"hora no válida: {iso!r}")
        self._t = t


def iso_utc(epoch):
    """Segundos -> '2026-11-18T10:15:00.000Z' (ISO 8601 UTC con milisegundos, como pide el contrato)."""
    ms = int(round(epoch * 1000))
    dt = datetime.fromtimestamp(ms // 1000, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def parse_iso(texto):
    """'2026-11-18T10:15:00.120Z' -> segundos; None si no es una fecha ISO válida."""
    if not isinstance(texto, str):
        return None
    try:
        t = texto.strip()
        if t.endswith("Z"):
            t = t[:-1] + "+00:00"
        dt = datetime.fromisoformat(t)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


# ------------------------------------------------------------------------------------------------------------ tablas (§5, §6) ----
CLAVES_SENSORS = ("t1_c", "t2_c", "t3_c", "t4_c", "t5_c", "l1_level_mm", "f1_flow_ml_min",
                  "ll_tank_b", "hl_tank_b", "lvl_heat_unit", "hl_heat_unit", "stat_overtemp")

# tag -> (tipo, estado seguro). Estado seguro None = sin cambio. Tipos: 'bool', 'tanque' ("A"/"B"), 'pct' (0-100 entero)
ACTUADORES = {
    "sol1_divert":    ("bool", True),
    "sol2_feed_tank": ("tanque", None),
    "sol3_cooling":   ("bool", None),
    "sol4_fill_a":    ("bool", False),
    "sol5_fill_b":    ("bool", False),
    "n1_on":          ("bool", False),
    "n1_speed_pct":   ("pct", 0),
    "n2_on":          ("bool", False),
    "n2_speed_pct":   ("pct", None),
    "heater_pct":     ("pct", 0),
}
SERVICIO = ("reset_safe_state", "reset_model", "emergency_stop")
ESTADO_SEGURO = {tag: sv for tag, (_, sv) in ACTUADORES.items() if sv is not None}

MENSAJES_ALARMA = {
    "overtemp": "Sobretemperatura (corte del termostato)",
    "feed_tank_empty": "Tanque de alimentación vacío: se para N1",
    "watchdog_timeout": "Estado seguro por falta de latido o de broker",
    "emergency_stop": "Paro de emergencia ordenado por el SCADA",
    "feed_tank_low": "Nivel bajo en el tanque de alimentación",
    "stream_stopped": "Hay una corriente parada con la planta en marcha",
    "n1_speed_low": "N1 por debajo del 50 %: puede aspirar burbujas",
    "product_below_setpoint": "Sale producto por debajo de la consigna de pasteurización",
}
SEVERIDAD = {"overtemp": "critical", "feed_tank_empty": "critical", "watchdog_timeout": "critical", "emergency_stop": "critical"}  # el resto: warning


PARAMS_NUMERICOS = ("t6_c", "ambient_c", "cooling_water_temp_c", "cooling_water_flow_ml_min", "pasteurization_setpoint_c", "hot_water_flow_ml_min",
                    "product_flow_ml_min", "speed_factor")
PARAMS_OPCIONES = {"control_mode": ("remote", "local"), "product_flow_source": ("manual", "f1"), "t5_location": ("cooling_in", "tank_b", "other")}
CONFIG_NUMERICA = ("t_scale_c_per_v", "t1_offset_c", "t2_offset_c", "t3_offset_c", "t4_offset_c", "t5_offset_c", "l1_mm_per_v", "l1_low_mm", "l1_high_mm",
                   "l1_warn_mm", "f1_ml_min_per_v", "heartbeat_timeout_s", "command_max_age_s")


def _numero(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def limpiar_params(datos):
    """Se queda solo con los params del contrato con tipo y valor válidos (None = «sin dato»). Lo demás se ignora: nunca tumba la tarjeta."""
    ok = {}
    for k, v in datos.items():
        if k in PARAMS_NUMERICOS and (v is None or _numero(v)):
            ok[k] = v
        elif k in PARAMS_OPCIONES and v in PARAMS_OPCIONES[k]:
            ok[k] = v
    return ok


def limpiar_config(datos):
    """Igual para la config: números finitos (o null) en las claves conocidas; las escalas tienen que ser positivas."""
    ok = {}
    for k, v in datos.items():
        if k in CONFIG_NUMERICA and (v is None or _numero(v)) and not (k.endswith(("_per_v", "_mm_per_v")) and v is not None and v <= 0):
            ok[k] = v
    return ok


class Planta:
    """Interfaz que debe cumplir la planta (maqueta real o mockup). Todo en unidades de ingeniería."""
    def leer_sensores(self):
        """-> dict con (algunas de) CLAVES_SENSORS; lo que no se pueda leer, ausente o None."""
        raise NotImplementedError

    def aplicar(self, pedido):
        """Aplica un dict parcial de ACTUADORES y devuelve el dict COMPLETO de lo realmente aplicado (puede diferir: PWM mínimo, termostato…)."""
        raise NotImplementedError

    def estado_actuadores(self):
        """-> dict completo de ACTUADORES (más heater_inhibited) tal como están ahora, sea cual sea el motivo."""
        raise NotImplementedError

    def viva(self):
        """¿Siguen vivos los hilos de E/S? Si no, lo que se lee es viejo y lo que se ordena puede no aplicarse: el Controlador pasa a estado seguro."""
        return True


class Controlador:
    """La «tarjeta» del contrato. `tick()` hay que llamarlo a menudo (p. ej. cada 100 ms); usa el reloj inyectado, no el del sistema."""

    def __init__(self, instance_id, planta, reloj, publicar, kind="real", habilitar_latido=True, soporta_n2_speed=False,
                 proteccion_nivel_calefactor=True, al_cambiar_config=None, estado_hora=None):
        self.id = instance_id
        self.planta, self.reloj, self._publicar = planta, reloj, publicar
        self.kind = kind
        self.habilitar_latido = habilitar_latido           # DESVÍO: el contrato lo da por opcional; en la maqueta real conviene que sea obligatorio
        self.soporta_n2_speed = soporta_n2_speed           # SUPUESTO: n2_speed_pct está «pendiente de confirmación» en el contrato: por defecto not_supported
        self.proteccion_nivel_calefactor = proteccion_nivel_calefactor   # DESVÍO: sin nivel en el calefactor se apagan resistencia y N2 (el contrato solo rechaza órdenes nuevas)
        self.al_cambiar_config = al_cambiar_config
        self.estado_hora = estado_hora                   # callable opcional -> {"synced": bool, "server": str}: el status dice si la hora viene del servidor de tiempo
        self.params = {"control_mode": "remote"}
        self.config = {}
        self.safe_state = False
        self.safe_reason = None                            # 'watchdog' | 'emergency_stop' (campo nuevo, enmienda E2)
        self._seq = {"sensors": 0, "actuators": 0}         # SUPUESTO: un contador por topic
        self._ids_vistos, self._ids_orden = set(), deque()
        self._arranque = reloj.ahora()                     # el latido se cuenta desde el arranque, aunque aún no haya llegado ninguno
        self._ultimo_latido = None
        self._t_sensors = self._t_actuators = self._t_status = None
        self._ultimo_actuators = None
        self._ultimo_status = None
        self._alarmas = {}                                 # alarma -> reason mientras está activa
        self._sensores = {}                                # última lectura (para interlocks y alarmas)
        self._n1_parado_por_vacio = False
        self.conectado = False

    # ------------------------------------------------------------------------------------------------ utilidades ----
    def topic(self, sufijo):
        return f"pct23/{self.id}/{sufijo}"

    def _pub(self, sufijo, payload, qos, retain=False):
        self._publicar(self.topic(sufijo), payload, qos, retain)      # sin conexión el publicador descarta (no se encola nada viejo)

    def _ts(self):
        return iso_utc(self.reloj.ahora())

    def lwt(self):
        """(topic, payload, qos, retain) que hay que registrar como last will al conectar (§2)."""
        return self.topic("status"), {"state": "offline", "kind": self.kind, "instance_id": self.id}, 1, True

    # ------------------------------------------------------------------------------------------------ conexión ----
    def conectar(self):
        """Tras conectar con el broker: status online y actuators. clean session -> el cliente tiene que volver a suscribirse."""
        self.conectado = True
        if self._ultimo_latido is None:                    # DESVÍO: si el broker tarda en estar, la cuenta de los 10 s empieza al conectar, no al arrancar
            self._arranque = self.reloj.ahora()
        self._publicar_status()
        self._publicar_actuators()
        self._sensores_completos()
        self._evaluar_alarmas()                            # el SCADA se pierde las alarmas ocurridas sin conexión: se levantan o se apagan ahora

    def desconexion_broker(self):
        """Se perdió el broker: con latido habilitado la tarjeta pasa a estado seguro (§7)."""
        self.conectado = False
        if self.habilitar_latido and not self.safe_state:
            self._entrar_estado_seguro("watchdog")

    def detener(self):
        """Parada ordenada: el LWT no salta en una desconexión limpia, así que se publica «offline» a mano."""
        if self.conectado:
            topic, payload, qos, retain = self.lwt()
            self._publicar(topic, payload, qos, retain)
        self.conectado = False

    # --------------------------------------------------------------------------------------------- publicaciones ----
    def _sensores_completos(self):
        lectura = dict(self.planta.leer_sensores())
        self._sensores = {k: lectura.get(k) for k in CLAVES_SENSORS}
        return self._sensores

    def _publicar_sensors(self):
        self._seq["sensors"] += 1
        self._pub("sensors", {"ts": self._ts(), "seq": self._seq["sensors"], **self._sensores_completos()}, 0)

    def _payload_actuators(self):
        est = dict(self.planta.estado_actuadores())
        inhibida = bool(est.pop("heater_inhibited", False))
        pct = est.get("heater_pct") or 0
        est["heater_kw"] = 0.0 if inhibida else round(pct * POTENCIA_RESISTENCIA_KW / 100.0, 3)
        est["heater_inhibited"] = inhibida
        if not self.soporta_n2_speed:
            est.pop("n2_speed_pct", None)
        return est

    def _publicar_actuators(self):
        self._seq["actuators"] += 1
        est = self._payload_actuators()
        self._ultimo_actuators = est
        self._t_actuators = self.reloj.ahora()
        self._pub("actuators", {"ts": self._ts(), "seq": self._seq["actuators"], **est}, 1, True)

    def _payload_status(self):
        return {"ts": self._ts(), "state": "online", "kind": self.kind, "instance_id": self.id, "control_mode": self.params.get("control_mode", "remote"),
                "safe_state": self.safe_state, "safe_reason": self.safe_reason, "interface_version": INTERFACE_VERSION, "sw_version": SW_VERSION,
                "params": {k: v for k, v in self.params.items() if k != "control_mode"}, **self._campo_hora()}

    def _campo_hora(self):
        """Campo `time_sync` del status (ampliación nuestra, enmienda E4): solo valores estables (si no, el status se republicaría en cada ciclo)."""
        if self.estado_hora is None:
            return {}
        try:
            e = self.estado_hora()
            return {"time_sync": {"synced": bool(e.get("synced")), "server": e.get("server")}}
        except Exception:                                   # noqa: BLE001
            return {}

    def _publicar_status(self):
        self._t_status = self.reloj.ahora()
        payload = self._payload_status()
        self._ultimo_status = {k: v for k, v in payload.items() if k != "ts"}
        self._pub("status", payload, 1, True)

    def _ack(self, tag, orden_id, resultado, **extra):
        self._pub(f"cmd/{tag}/ack", {"id": orden_id, "ts": self._ts(), "result": resultado, **extra}, 1)

    # ------------------------------------------------------------------------------------------- mensajes entrantes ----
    def on_message(self, topic, payload):
        """Entrada de todo lo que llega suscrito (topic completo y payload en bytes, texto o dict). Un mensaje que no se pueda procesar se ignora y se
        anota: una excepción aquí mataría el hilo de red de paho y dejaría al gateway sordo."""
        try:
            self._on_message(topic, payload)
        except Exception:                                   # noqa: BLE001 - la tarjeta no puede caerse por un mensaje malformado
            print(f"Mensaje descartado en {topic}:", file=sys.stderr)
            traceback.print_exc()

    def _on_message(self, topic, payload):
        prefijo = f"pct23/{self.id}/"
        if not topic.startswith(prefijo):
            return
        resto = topic[len(prefijo):]
        datos = self._json(payload)
        if resto.startswith("cmd/") and not resto.endswith("/ack"):
            self._procesar_orden(resto[4:], datos)
        elif resto == "scada/heartbeat":
            if isinstance(datos, dict):
                self._ultimo_latido = self.reloj.ahora()
        elif resto == "params":
            if isinstance(datos, dict):
                self.params.update(limpiar_params(datos))
                self._publicar_status()
        elif resto == "config":
            if isinstance(datos, dict):
                self.config.update(limpiar_config(datos))
                if self.al_cambiar_config:
                    self.al_cambiar_config(dict(self.config))

    @staticmethod
    def _json(payload):
        if isinstance(payload, dict):
            return payload
        try:
            if isinstance(payload, (bytes, bytearray)):
                payload = payload.decode("utf-8")
            return json.loads(payload)
        except (ValueError, UnicodeDecodeError, TypeError):
            return None

    # --------------------------------------------------------------------------------------------------- órdenes ----
    @staticmethod
    def _validar_valor(tag, valor):
        """-> (ok, valor_normalizado)."""
        tipo = ACTUADORES[tag][0]
        if tipo == "bool":
            return (isinstance(valor, bool), valor)
        if tipo == "tanque":
            return (valor in ("A", "B"), valor)
        if isinstance(valor, bool) or not _numero(valor):
            return False, None
        if not 0 <= valor <= 100 or valor != int(valor):
            return False, None
        return True, int(valor)

    def _alimenta(self):
        a = self._ultimo_actuators or self.planta.estado_actuadores()
        return a.get("sol2_feed_tank") or "A"

    def _umbral_l1(self):
        return self.config.get("l1_low_mm") or L1_BAJO_MM_DEFECTO

    def _alimentacion_vacia(self, s=None):
        """¿Tanque de alimentación vacío? A: nivel L1 <= umbral bajo; B: flotador LL. Si el nivel no se puede leer (L1 null) no se puede afirmar:
        SUPUESTO: se da por no vacío. SUPUESTO también: el «nivel bajo» de B se toma como vacío (el contrato no distingue vacío de bajo)."""
        s = s if s is not None else self._sensores
        if self._alimenta() == "B":
            return bool(s.get("ll_tank_b"))
        nivel = s.get("l1_level_mm")
        return nivel is not None and nivel <= self._umbral_l1()

    def _alimentacion_baja(self, s=None):
        s = s if s is not None else self._sensores
        if self._alimenta() == "B":
            return bool(s.get("ll_tank_b"))
        nivel = s.get("l1_level_mm")
        return nivel is not None and nivel <= (self.config.get("l1_warn_mm") or 2 * self._umbral_l1())

    def _interlock(self, tag, valor):
        s = self._sensores_completos()
        if tag == "heater_pct" and valor > 0:
            if s.get("stat_overtemp"):
                return "interlock_overtemp"
            if s.get("lvl_heat_unit") is False:
                return "interlock_low_level_heat"
        if tag == "n2_on" and valor is True and s.get("lvl_heat_unit") is False:
            return "interlock_low_level_heat"
        if tag == "n1_on" and valor is True and self._alimentacion_vacia(s):
            return "interlock_low_level_feed"
        if tag == "sol5_fill_b" and valor is True and s.get("hl_tank_b"):
            return "interlock_high_level_b"
        return None

    def _procesar_orden(self, tag, datos):
        """Comprueba, en este orden: tag, id repetido, caducidad, valor, modo e interlocks (§6.2); aplica, responde ack y publica actuators."""
        if tag not in ACTUADORES and tag not in SERVICIO:
            if isinstance(datos, dict) and isinstance(datos.get("id"), str) and datos["id"]:
                self._ack(tag, datos["id"], "rejected", reason="unknown_tag")
            return
        if not isinstance(datos, dict) or not isinstance(datos.get("id"), str) or not datos["id"]:
            return                                          # sin id no hay a quién responder
        oid = datos["id"]
        parada = tag == "emergency_stop"

        def rechazar(motivo):
            self._ack(tag, oid, "rejected", reason=motivo)

        if tag == "n2_speed_pct" and not self.soporta_n2_speed:
            return rechazar("not_supported")
        if oid in self._ids_vistos:
            return rechazar("duplicate")
        self._ids_vistos.add(oid)
        self._ids_orden.append(oid)
        if len(self._ids_orden) > IDS_VISTOS_MAX:
            self._ids_vistos.discard(self._ids_orden.popleft())
        if not parada:                                     # enmienda E2: una parada se acepta con cualquier ts (o sin él): nunca debe fallar por el reloj
            enviada = parse_iso(datos.get("ts"))
            if enviada is None:
                return rechazar("invalid_value")           # SUPUESTO: una orden sin ts válido no se puede comprobar: se rechaza
            retraso = self.reloj.ahora() - enviada
            if retraso > CADUCIDAD_ORDEN_S:
                return rechazar("expired")
            if retraso < -CADUCIDAD_ORDEN_S:
                return rechazar("invalid_value")           # SUPUESTO: una hora del futuro (reloj desajustado) tampoco es fiable
        valor = datos.get("value")

        if tag in SERVICIO:
            return self._orden_servicio(tag, oid, valor)

        ok, valor = self._validar_valor(tag, valor)
        if not ok:
            return rechazar("invalid_value")
        if self.params.get("control_mode") == "local":
            return rechazar("local_mode")
        if self.safe_state:
            return rechazar("safe_state")
        motivo = self._interlock(tag, valor)
        if motivo:
            return rechazar(motivo)
        aplicado = self.planta.aplicar({tag: valor})
        self._ack(tag, oid, "accepted", applied=aplicado.get(tag))
        self._publicar_actuators()                          # tras cada orden aceptada, aunque no cambie nada

    def _orden_servicio(self, tag, oid, valor):
        if tag == "reset_model":
            return self._ack(tag, oid, "rejected", reason="not_supported")      # solo gemelo
        if valor is not True:
            return self._ack(tag, oid, "rejected", reason="invalid_value")
        if tag == "emergency_stop":                          # enmienda E2: se acepta aunque esté en local o ya en estado seguro
            if not self.safe_state:
                self._entrar_estado_seguro("emergency_stop")
            elif self.safe_reason != "emergency_stop":      # ya en estado seguro por otra causa: queda registrada la orden del operador
                self.safe_reason = "emergency_stop"
                self._publicar_status()
                self._evaluar_alarmas()
            return self._ack(tag, oid, "accepted", applied=True)
        # reset_safe_state: con latido habilitado hace falta que haya vuelto el latido (§7)
        if self.safe_state and ((self.habilitar_latido and not self._latido_vivo()) or not self.planta.viva()):
            return self._ack(tag, oid, "rejected", reason="safe_state")         # SUPUESTO: el contrato no da motivo para este caso
        if self.safe_state:
            self.safe_state, self.safe_reason = False, None
            self._arranque = self.reloj.ahora()
            self._publicar_status()
            self._evaluar_alarmas()
        self._ack(tag, oid, "accepted", applied=True)

    # -------------------------------------------------------------------------------------------------- estado seguro ----
    def _entrar_estado_seguro(self, motivo):
        self.planta.aplicar(dict(ESTADO_SEGURO))
        self.safe_state, self.safe_reason = True, motivo
        self._publicar_actuators()
        self._publicar_status()
        self._evaluar_alarmas()

    def _latido_vivo(self):
        return self._ultimo_latido is not None and self.reloj.ahora() - self._ultimo_latido <= LATIDO_TIMEOUT_S

    # ---------------------------------------------------------------------------------------------------- alarmas ----
    def _alarmas_activas(self):
        s, a = self._sensores, self._ultimo_actuators or self._payload_actuators()
        activas = {}
        if s.get("stat_overtemp"):
            activas["overtemp"] = "stat_overtemp"
        if self._alimentacion_vacia(s) and (a.get("n1_on") or self._n1_parado_por_vacio):
            activas["feed_tank_empty"] = "feed_tank_empty"
        if self._alimentacion_baja(s):
            activas["feed_tank_low"] = "feed_tank_low"
        if self.safe_state and self.safe_reason == "watchdog":
            activas["watchdog_timeout"] = "heartbeat_lost"       # SUPUESTO: el contrato deja el reason de esta alarma en «—»
        if self.safe_state and self.safe_reason == "emergency_stop":
            activas["emergency_stop"] = "operator_command"
        en_marcha = bool(a.get("heater_pct")) or bool(a.get("n1_on")) or bool(a.get("n2_on"))
        paradas = [r for r, p in (("n1_off", not a.get("n1_on")), ("n2_off", not a.get("n2_on")), ("cooling_closed", not a.get("sol3_cooling"))) if p]
        if en_marcha and paradas and not self.safe_state:
            activas["stream_stopped"] = ",".join(paradas)
        if a.get("n1_on") and (a.get("n1_speed_pct") or 0) < N1_VELOCIDAD_BAJA_PCT:
            activas["n1_speed_low"] = "n1_speed_low"
        consigna, t1 = self.params.get("pasteurization_setpoint_c"), s.get("t1_c")
        if consigna is not None and t1 is not None and a.get("n1_on") and a.get("sol1_divert") is False and t1 < consigna:
            activas["product_below_setpoint"] = "t1_below_setpoint"
        return activas

    def _evaluar_alarmas(self):
        """Publica solo los CAMBIOS: raised al saltar, cleared al apagarse (si cambia el motivo, se apaga y se vuelve a levantar).
        Sin conexión no se toca la memoria: lo que se publicó estando desconectado no llegó, y al reconectar se reconcilia con lo que el SCADA sí vio."""
        if not self.conectado:
            return
        nuevas = self._alarmas_activas()
        for alarma in list(self._alarmas):
            if alarma not in nuevas or nuevas[alarma] != self._alarmas[alarma]:
                self._emitir_alarma(alarma, "cleared", self._alarmas.pop(alarma))
        for alarma, motivo in nuevas.items():
            if alarma not in self._alarmas:
                self._alarmas[alarma] = motivo
                self._emitir_alarma(alarma, "raised", motivo)

    def _emitir_alarma(self, alarma, evento, motivo):
        self._pub("alarms", {"ts": self._ts(), "alarm": alarma, "event": evento, "severity": SEVERIDAD.get(alarma, "warning"), "reason": motivo,
                             "message": MENSAJES_ALARMA[alarma]}, 1)

    # ------------------------------------------------------------------------------------------------------- tick ----
    def _protecciones_propias(self, s, a):
        """Lo único que la tarjeta cambia por su cuenta. El contrato solo cita uno (tanque de alimentación vacío con N1 en marcha); las otras
        son DESVÍOS por seguridad: el runtime ya apaga la resistencia con el termostato abierto, y aquí se apaga también al faltar el nivel del calefactor."""
        if a.get("n1_on") and self._alimentacion_vacia(s):
            self.planta.aplicar({"n1_on": False, "n1_speed_pct": 0})
            self._n1_parado_por_vacio = True
        elif not self._alimentacion_vacia(s):
            self._n1_parado_por_vacio = False
        if s.get("stat_overtemp") and a.get("heater_pct"):
            self.planta.aplicar({"heater_pct": 0})
        if self.proteccion_nivel_calefactor and s.get("lvl_heat_unit") is False and (a.get("heater_pct") or a.get("n2_on")):
            self.planta.aplicar({"heater_pct": 0, "n2_on": False})

    def tick(self):
        """Un paso del ciclo. Publica lo que toque según el reloj inyectado. Una excepción interna no tumba el proceso: se anota y se pasa a estado seguro."""
        try:
            self._tick()
        except Exception:                                   # noqa: BLE001
            print("Fallo interno en el ciclo de la tarjeta:", file=sys.stderr)
            traceback.print_exc()
            try:
                if not self.safe_state:
                    self._entrar_estado_seguro("internal_error")
            except Exception:                               # noqa: BLE001
                traceback.print_exc()

    def _tick(self):
        if not self.conectado:
            return
        if not self.safe_state and not self.planta.viva():  # los hilos de E/S han muerto: lo que se lee es viejo y lo que se ordena puede no aplicarse
            self._entrar_estado_seguro("io_fault")
            return
        ahora = self.reloj.ahora()
        if self.habilitar_latido and not self.safe_state:   # sin latido durante 10 s (contados desde el arranque) -> estado seguro
            ref = self._ultimo_latido if self._ultimo_latido is not None else self._arranque
            if ahora - ref > LATIDO_TIMEOUT_S:
                self._entrar_estado_seguro("watchdog")
        if self._t_sensors is None or ahora - self._t_sensors >= PERIODO_SENSORS_S - 1e-9:
            self._t_sensors = ahora
            self._publicar_sensors()
        else:
            self._sensores_completos()
        self._protecciones_propias(self._sensores, self.planta.estado_actuadores())
        actual = self._payload_actuators()                  # la planta cambió algo por su cuenta (termostato, protecciones) o toca el refresco de 30 s
        cambio = self._ultimo_actuators is None or any(actual.get(k) != self._ultimo_actuators.get(k) for k in actual)
        if cambio or ahora - (self._t_actuators or 0) >= PERIODO_ACTUATORS_S:
            self._publicar_actuators()
        self._evaluar_alarmas()
        nuevo = {k: v for k, v in self._payload_status().items() if k != "ts"}
        if nuevo != self._ultimo_status or ahora - (self._t_status or 0) >= PERIODO_STATUS_S:
            self._publicar_status()
