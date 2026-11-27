"""Lado SCADA del contrato MQTT PCT23 v2.4 preliminar (+ enmiendas de CONTRATO_MQTT_ENMIENDAS.md).

Lógica pura: no importa paho ni Flask. Quien lo use (servidor_web.py, control_remoto.py) le da una función `publicar(topic, payload_dict, qos, retain)`
y le pasa lo que llega por MQTT con `on_message(topic, payload)`. Hace tres cosas:

1. CLIENTE del contrato (`ClienteScada`): guarda lo que publica la planta (sensors, actuators, status, alarms, acks), publica el latido `scada/heartbeat`
   cada 2 s y manda órdenes `cmd/{tag}` con id único y hora de la PLANTA, siguiendo su ack.
2. HORA DE LA PLANTA: la tarjeta caduca las órdenes a los 5 s con su propio reloj (hoy autónomo, mañana NTP). El SCADA no puede fiarse de la hora del PC:
   estima el desfase con el `ts` de los `sensors` que va recibiendo y pone esa hora en `ts` de las órdenes. Hasta que llegue el primer `sensors` no
   hay desfase conocido y NO se manda ninguna orden (salvo la parada de emergencia, ver `paro_emergencia`).
3. TRADUCTOR entre el contrato y el formato ANTIGUO que entienden pct23.html y control_t1.py (`AnalogIn1_value`, `DigitalOut3_value`, `TransistorOut7_value`…),
   en los dos sentidos. Así la página y el control casi no cambian.

Lo que el contrato no fija y se ha supuesto va marcado «SUPUESTO».
"""
import json
import random
import time
from collections import deque

from contrato_pct23 import ACTUADORES, iso_utc, parse_iso

PERIODO_LATIDO_S = 2.0           # el SCADA publica un latido cada 2 s (§7); la tarjeta pasa a estado seguro a los 10 s sin él
GATEWAY_TIMEOUT_S = 3.5          # sensors llega cada 1 s: sin él durante este tiempo -> planta sin respuesta
ACK_ESPERA_S = 1.5               # sin ack tras este tiempo se reenvía UNA vez la misma orden (mismo id y ts)
ACK_MAXIMO_S = 4.0               # sin ack tras este tiempo se da por perdida (la orden caducaría a los 5 s)
MUESTRAS_DESFASE = 10            # nº de lecturas de sensors con las que se estima el desfase
REINICIO_DESFASE_S = 2.0         # si una muestra se aparta más de esto de las anteriores, la planta cambió de hora: se empieza de cero
GRADOS_POR_VOLTIO = 100.0        # sondas T1-T4: 10 mV/°C
F1_ML_MIN_POR_V_ADC = 1500.0 / 3.3   # enmienda E1: 0-5 V en el conector = 0-1500 mL/min; el ADC ve 0-3,3 V (divisor)
L1_MM_MAX, ADC_VREF = 250.0, 3.3     # PCT23.md: 0-5 V (3,3 V en el ADC) = 0-250 mm
SONDA_T2_MIN_C, SONDA_T2_MAX_C = 5.0, 145.0   # mismos límites que runtime.py (0,05 a 1,45 V a 10 mV/°C)
TS_SIN_HORA = "1970-01-01T00:00:00.000Z"      # solo para la parada de emergencia cuando aún no se conoce la hora de la planta (ver paro_emergencia)

# Claves del formato antiguo que el gateway nuevo NO publica y que aquí no existen: la página y control_remoto las tratan como «sin dato».
CLAVES_ANTIGUAS_SIN_EQUIVALENTE = ("io_errors", "scan_overruns", "pwm_bombas_hz", "retraso_potencia_ms",
                                   "retraso_potencia_max_ms", "escrituras_potencia_s", "timestamp_gateway")
# Canales del formato antiguo sin función en la maqueta (DigitalOut1, 2 y 8, TransistorOut1, 2, 4, 5 y 6): se muestran apagados y las órdenes se ignoran.
SALIDAS_ANTIGUAS_SIN_USO = tuple([f"DigitalOut{i}_value" for i in (1, 2, 8)] + [f"TransistorOut{i}_value" for i in (1, 2, 4, 5, 6)])


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def _verdadero(valor):
    """Booleano del formato antiguo (acepta 1/0, 'true', 'on'…). ValueError si no es un valor digital."""
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, (int, float)):
        return bool(valor)
    if isinstance(valor, str):
        t = valor.strip().lower()
        if t in ("1", "true", "on"):
            return True
        if t in ("0", "false", "off"):
            return False
    raise ValueError(f"valor digital no válido: {valor!r}")


def _porcentaje(valor):
    if isinstance(valor, bool) or not _num(valor):
        raise ValueError(f"porcentaje no válido: {valor!r}")
    return int(round(min(max(float(valor), 0.0), 100.0)))


# ------------------------------------------------------------------------------------------- contrato -> formato antiguo ----
def sensores_a_antiguo(s):
    """`sensors` del contrato -> claves antiguas. Lo que viene null (L1 hoy) o no viene se OMITE: la página lo muestra como 0 / sin dato.
    INVERSIONES (verificadas en pct23.html y runtime.py): DigitalIn1 = NOT stat_overtemp (cerrado = todo bien) y DigitalIn4 = NOT ll_tank_b (lógica negada)."""
    out = {}
    for i, clave in enumerate(("t1_c", "t2_c", "t3_c", "t4_c", "t5_c"), 1):     # AnalogIn5 es la sonda T5; L1 no tiene canal antiguo
        if _num(s.get(clave)):
            out[f"AnalogIn{i}_value"] = round(s[clave] / GRADOS_POR_VOLTIO, 4)
    if _num(s.get("f1_flow_ml_min")):
        out["AnalogIn7_value"] = round(s["f1_flow_ml_min"] / F1_ML_MIN_POR_V_ADC, 4)
    for clave, canal, invertida in (("stat_overtemp", "DigitalIn1_value", True), ("hl_heat_unit", "DigitalIn2_value", False),
                                    ("hl_tank_b", "DigitalIn3_value", False), ("ll_tank_b", "DigitalIn4_value", True),
                                    ("lvl_heat_unit", "DigitalIn5_value", False)):    # DigitalIn5 = nivel del calefactor: SUPUESTO (PCT23.md:29)
        v = s.get(clave)
        if isinstance(v, bool):
            out[canal] = (not v) if invertida else v
    return out


def actuadores_a_antiguo(a):
    """`actuators` del contrato -> claves antiguas. INVERSIÓN: DigitalOut3 = NOT sol1_divert (SOL1 sin activar = desvío). SOL2: «A» = DigitalOut4 apagada.
    La resistencia: TransistorOut3 = encendida si heater_pct > 0 y AnalogOut1 = el porcentaje (solo con la resistencia encendida)."""
    out = {canal: False for canal in SALIDAS_ANTIGUAS_SIN_USO}
    if isinstance(a.get("sol1_divert"), bool):
        out["DigitalOut3_value"] = not a["sol1_divert"]
    if a.get("sol2_feed_tank") in ("A", "B"):
        out["DigitalOut4_value"] = a["sol2_feed_tank"] == "B"
    for clave, canal in (("sol3_cooling", "DigitalOut5_value"), ("sol4_fill_a", "DigitalOut6_value"), ("sol5_fill_b", "DigitalOut7_value"),
                         ("n1_on", "TransistorOut8_value"), ("n2_on", "TransistorOut7_value")):
        if isinstance(a.get(clave), bool):
            out[canal] = a[clave]
    for clave, canal in (("n1_speed_pct", "PWMOut1_value"), ("n2_speed_pct", "PWMOut2_value")):
        if _num(a.get(clave)):
            out[canal] = a[clave]
    pct = a.get("heater_pct")
    if _num(pct):
        out["TransistorOut3_value"] = pct > 0
        if pct > 0:
            out["AnalogOut1_value"] = pct
    return out


def diagnostico_a_antiguo(status, sensors, alarmas, vivo):
    """Lo que antes publicaba `Runtime.diagnostico()`, deducido de status/alarms/sensors (el resto de claves antiguas ya no existe, ver
    CLAVES_ANTIGUAS_SIN_EQUIVALENTE). SUPUESTO: safe_state por emergencia = paro_emergencia; safe_state por latido = motivo «estado_seguro»."""
    motivos = []
    seguro, razon = bool(status.get("safe_state")), status.get("safe_reason")
    if seguro:
        motivos.append("paro_emergencia" if razon == "emergency_stop" else "estado_seguro")
    if sensors.get("stat_overtemp") is True or "overtemp" in alarmas:
        motivos.append("termostato_abierto")
    if sensors:                                              # sin lecturas aún no se puede juzgar la sonda
        t2 = sensors.get("t2_c")
        if not _num(t2) or not SONDA_T2_MIN_C <= t2 <= SONDA_T2_MAX_C:
            motivos.append("sonda_t2_fuera_de_rango")
    return {"running": vivo, "io_ok": vivo and any(_num(v) for v in sensors.values()),
            "calefactor_bloqueado": bool(motivos), "motivos_bloqueo": motivos,
            "paro_emergencia": seguro and razon == "emergency_stop", "safe_state": seguro, "safe_reason": razon,
            "control_mode": status.get("control_mode"), "instance_id": status.get("instance_id"),
            "interface_version": status.get("interface_version"), "alarmas": sorted(alarmas)}


# ------------------------------------------------------------------------------------------- formato antiguo -> contrato ----
class TraductorOrdenes:
    """Convierte lo que manda la página o control_t1 (dict del formato antiguo) en órdenes del contrato [(tag, valor)].
    Recuerda la potencia de la resistencia (AnalogOut1, 100 % por defecto como el gateway antiguo): en el contrato es un único tag heater_pct."""

    def __init__(self, potencia_inicial=100):
        self.potencia = int(potencia_inicial)

    def traducir(self, orden, actuadores=None):
        """-> {"ordenes": [(tag, valor)], "ignoradas": [claves sin función], "invalidas": [claves con valor no válido]}.
        `actuadores` (último `actuators`) solo sirve para saber si la resistencia está encendida cuando llega una potencia suelta."""
        ordenes, ignoradas, invalidas = [], [], []
        resistencia_encendida = bool(actuadores and _num(actuadores.get("heater_pct")) and actuadores["heater_pct"] > 0)
        potencia_suelta = None
        res = None                                         # orden de la resistencia: None, True o False
        for clave, valor in orden.items():
            try:
                if clave == "paro_emergencia":
                    ordenes.insert(0, ("emergency_stop", True) if _verdadero(valor) else ("reset_safe_state", True))
                elif clave == "DigitalOut3_value":
                    ordenes.append(("sol1_divert", not _verdadero(valor)))
                elif clave == "DigitalOut4_value":
                    ordenes.append(("sol2_feed_tank", "B" if _verdadero(valor) else "A"))
                elif clave in ("DigitalOut5_value", "DigitalOut6_value", "DigitalOut7_value"):
                    ordenes.append((("sol3_cooling", "sol4_fill_a", "sol5_fill_b")[int(clave[10]) - 5], _verdadero(valor)))
                elif clave == "TransistorOut8_value":
                    ordenes.append(("n1_on", _verdadero(valor)))
                elif clave == "TransistorOut7_value":
                    ordenes.append(("n2_on", _verdadero(valor)))
                elif clave == "PWMOut1_value":
                    ordenes.append(("n1_speed_pct", _porcentaje(valor)))
                elif clave == "PWMOut2_value":
                    ordenes.append(("n2_speed_pct", _porcentaje(valor)))
                elif clave == "TransistorOut3_value":
                    res = _verdadero(valor)
                elif clave == "AnalogOut1_value":
                    potencia_suelta = _porcentaje(valor)
                else:
                    ignoradas.append(clave)
            except ValueError:
                invalidas.append(clave)
        if potencia_suelta is not None:
            self.potencia = potencia_suelta
        if res is True:
            ordenes.append(("heater_pct", self.potencia))
        elif res is False:
            ordenes.append(("heater_pct", 0))
        elif potencia_suelta is not None and resistencia_encendida:
            ordenes.append(("heater_pct", potencia_suelta))      # cambiar la potencia con la resistencia encendida
        return {"ordenes": ordenes, "ignoradas": ignoradas, "invalidas": invalidas}


# ------------------------------------------------------------------------------------------------------ cliente del contrato ----
class ClienteScada:
    """El SCADA de una instancia (`real-01`…). Se llama a `tick()` a menudo (cada ~0,5 s) y a `on_message()` con todo lo que llega suscrito."""

    def __init__(self, instance_id, publicar, reloj_local=time.time, reloj_mono=time.monotonic, client_id="pct23-scada", reloj_hora=None):
        self.id, self._publicar = instance_id, publicar
        self.reloj_hora = reloj_hora                       # RelojSincronizado con el servidor de tiempo (la misma autoridad que la planta): si está sincronizado, manda
        self._local, self._mono, self.client_id = reloj_local, reloj_mono, client_id
        self.sensors, self.actuators, self.status = {}, {}, {}
        self.alarmas = {}                                  # alarmas activas: nombre -> último mensaje raised
        self._t_sensors = None                             # instante (monotónico) del último sensors
        self._muestras = deque(maxlen=MUESTRAS_DESFASE)    # ts_planta - reloj monotónico (al recibir) de cada sensors: inmune a los saltos de la hora del equipo
        self._seq = 0
        self._sal = random.Random().randrange(0x10000)     # sal del id: dos SCADA con el mismo client_id no repiten ids
        self.pendientes = {}                               # id -> orden esperando ack
        self.resultados = deque(maxlen=100)                # órdenes ya resueltas (más reciente al final)
        self._t_latido = None
        self.conectado = False
        self.traductor = TraductorOrdenes()

    # ------------------------------------------------------------------------------------------------------ MQTT ----
    def topic(self, sufijo):
        return f"pct23/{self.id}/{sufijo}"

    def suscripciones(self):
        """[(topic, qos)] que hay que suscribir al conectar (clean session: se repite en cada reconexión)."""
        return [(self.topic("sensors"), 0), (self.topic("actuators"), 1), (self.topic("status"), 1), (self.topic("alarms"), 1),
                (self.topic("cmd/+/ack"), 1)]

    def conectar(self):
        self.conectado = True
        self._t_latido = None                              # latido inmediato en el siguiente tick

    def desconectar(self):
        self.conectado = False

    def _pub(self, sufijo, payload, qos):
        self._publicar(self.topic(sufijo), payload, qos, False)

    # ---------------------------------------------------------------------------------------------------- entrada ----
    def on_message(self, topic, payload):
        """Procesa un mensaje de la planta. Devuelve qué era: 'sensors', 'actuators', 'status', 'alarms', 'ack' o None si se ignora."""
        prefijo = self.topic("")
        if not topic.startswith(prefijo):
            return None
        resto = topic[len(prefijo):]
        datos = self._json(payload)
        if not isinstance(datos, dict):
            return None
        if resto == "sensors":
            self.sensors = {k: v for k, v in datos.items() if k not in ("ts", "seq")}
            self._t_sensors = self._mono()
            ts = parse_iso(datos.get("ts"))
            if ts is not None:                             # solo sensors (QoS 0, sin retain): status y actuators están retenidos y su ts puede ser viejo
                muestra = ts - self._mono()
                if self._muestras and abs(muestra - max(self._muestras)) > REINICIO_DESFASE_S:
                    self._muestras.clear()                 # la planta cambió de hora (reinicio, o la sincronizó el servidor de tiempo): se descarta lo anterior
                self._muestras.append(muestra)
            return "sensors"
        if resto == "actuators":
            self.actuators = {k: v for k, v in datos.items() if k not in ("ts", "seq")}
            return "actuators"
        if resto == "status":
            self.status = {k: v for k, v in datos.items() if k != "ts"}      # el LWT («offline») también llega por aquí
            return "status"
        if resto == "alarms":
            nombre = datos.get("alarm")
            if isinstance(nombre, str):
                if datos.get("event") == "raised":
                    self.alarmas[nombre] = datos
                elif datos.get("event") == "cleared":
                    self.alarmas.pop(nombre, None)
            return "alarms"
        if resto.startswith("cmd/") and resto.endswith("/ack"):
            self._procesar_ack(datos)
            return "ack"
        return None

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

    # -------------------------------------------------------------------------------------------------- hora y salud ----
    def hora_planta(self):
        """Hora de la planta en segundos, o None si aún no se conoce el desfase (no ha llegado ningún sensors).
        Se toma el MÁXIMO de las últimas muestras: una muestra es hora_planta - hora_local_de_recepción, o sea el desfase menos el retraso de la red, así que
        la mayor es la de menos retraso. Las órdenes salen con la hora de la planta como mucho unos milisegundos atrasada, muy lejos del límite de 5 s."""
        if self.reloj_hora is not None and self.reloj_hora.sincronizado:
            return self.reloj_hora.ahora()                 # misma autoridad de hora que la planta: no hace falta estimar nada
        if not self._muestras:
            return None
        return self._mono() + max(self._muestras)

    def hora_planta_iso(self):
        t = self.hora_planta()
        return None if t is None else iso_utc(t)

    def gateway_vivo(self):
        """¿Llega sensors con regularidad y la planta no ha dicho (LWT) que está offline?"""
        if self._t_sensors is None or self._mono() - self._t_sensors >= GATEWAY_TIMEOUT_S:
            return False
        return self.status.get("state") != "offline"

    def hay_datos(self):
        return bool(self.sensors or self.actuators)

    def lectura_control(self):
        """Lo que necesita el módulo de control (`modulo_control.py`), en el idioma del contrato: temperaturas en °C y las señales de seguridad de la planta."""
        return {"t1_c": self.sensors.get("t1_c"), "t2_c": self.sensors.get("t2_c"), "conectada": bool(self.conectado and self.gateway_vivo()),
                "safe_state": bool(self.status.get("safe_state")), "alarmas": set(self.alarmas), "stat_overtemp": bool(self.sensors.get("stat_overtemp")),
                "heater_inhibited": bool(self.actuators.get("heater_inhibited"))}

    # ---------------------------------------------------------------------------------------------------- órdenes ----
    def _nuevo_id(self):
        self._seq += 1
        return f"{self.client_id}-{self._sal:04x}-{self._seq}"

    def enviar_orden(self, tag, valor):
        """Manda `cmd/{tag}` con id único y la hora de la planta. -> {"id", "enviada", "motivo"}; motivo: None | 'sin_conexion' | 'sin_hora_planta' | 'tag_desconocido'.
        Sin desfase conocido (aún no ha llegado ningún sensors) NO se manda nada: una orden con la hora del PC podría salir «del futuro» o caducada."""
        if tag not in ACTUADORES and tag not in ("reset_safe_state", "emergency_stop"):
            return {"id": None, "enviada": False, "motivo": "tag_desconocido"}
        if not self.conectado:
            return {"id": None, "enviada": False, "motivo": "sin_conexion"}
        ts = self.hora_planta_iso()
        if ts is None:
            if tag != "emergency_stop":
                return {"id": None, "enviada": False, "motivo": "sin_hora_planta"}
            ts = TS_SIN_HORA                               # SUPUESTO: la parada se acepta con cualquier edad (enmienda E2), así que sirve sin hora conocida
        oid = self._nuevo_id()
        payload = {"id": oid, "ts": ts, "value": valor, "source": "scada"}
        self.pendientes[oid] = {"id": oid, "tag": tag, "value": valor, "payload": payload, "enviada": self._mono(), "reintentos": 0}
        self._publicar(self.topic(f"cmd/{tag}"), payload, 1, False)
        return {"id": oid, "enviada": True, "motivo": None}

    def _procesar_ack(self, ack):
        orden = self.pendientes.pop(ack.get("id"), None)
        if orden is None:
            return                                         # ack de otro SCADA o de una orden ya resuelta
        aceptada = ack.get("result") == "accepted"
        resultado = {"id": orden["id"], "tag": orden["tag"], "value": orden["value"], "estado": "aceptada" if aceptada else "rechazada",
                     "reason": ack.get("reason"), "applied": ack.get("applied")}
        if not aceptada and ack.get("reason") == "duplicate" and orden["reintentos"] > 0:
            resultado["estado"] = "recibida"               # SUPUESTO: el reenvío llegó como duplicado = la original sí llegó; su efecto se ve en actuators
        self.resultados.append(resultado)

    def resultado(self, oid):
        """Estado de una orden: 'pendiente', 'aceptada', 'rechazada', 'recibida', 'sin_respuesta' o None si no se conoce."""
        if oid in self.pendientes:
            return "pendiente"
        for r in reversed(self.resultados):
            if r["id"] == oid:
                return r["estado"]
        return None

    def rechazos_recientes(self, n=5):
        """Últimas órdenes rechazadas o perdidas, para avisar al usuario. Una orden rechazada NO se reintenta (un interlock no se arregla repitiendo)."""
        return [r for r in self.resultados if r["estado"] in ("rechazada", "sin_respuesta")][-n:]

    def paro_emergencia(self, activo):
        """True -> cmd/emergency_stop; False -> cmd/reset_safe_state. Siempre value true (enmienda E2)."""
        return self.enviar_orden("emergency_stop" if activo else "reset_safe_state", True)

    def ordenes_antiguas(self, orden):
        """Traduce y envía una orden en formato antiguo. -> {"enviadas": [ids], "ignoradas", "invalidas", "sin_hora", "sin_conexion", "enviada": bool}."""
        t = self.traductor.traducir(orden, self.actuators)
        enviadas, sin_hora, sin_conexion = [], False, False
        for tag, valor in t["ordenes"]:
            r = self.enviar_orden(tag, valor)
            if r["enviada"]:
                enviadas.append(r["id"])
            sin_hora = sin_hora or r["motivo"] == "sin_hora_planta"
            sin_conexion = sin_conexion or r["motivo"] == "sin_conexion"
        return {"enviadas": enviadas, "ignoradas": t["ignoradas"], "invalidas": t["invalidas"], "sin_hora": sin_hora,
                "sin_conexion": sin_conexion, "enviada": bool(enviadas)}

    # ----------------------------------------------------------------------------------------------------- ciclo ----
    def tick(self):
        """Latido cada 2 s y gestión de los ack que no llegan. Llamar cada ~0,5 s."""
        ahora = self._mono()
        if self.conectado and (self._t_latido is None or ahora - self._t_latido >= PERIODO_LATIDO_S - 1e-9):
            self._t_latido = ahora
            self._pub("scada/heartbeat", {"ts": self.hora_planta_iso() or iso_utc(self._local()), "client": self.client_id}, 0)
        for oid, o in list(self.pendientes.items()):
            espera = ahora - o["enviada"]
            if espera >= ACK_MAXIMO_S:
                del self.pendientes[oid]
                self.resultados.append({"id": oid, "tag": o["tag"], "value": o["value"], "estado": "sin_respuesta", "reason": None, "applied": None})
            elif espera >= ACK_ESPERA_S and o["reintentos"] == 0 and self.conectado:
                o["reintentos"] = 1                        # una sola vez y con el MISMO id y ts: si la original llegó, la planta contesta «duplicate»
                self._publicar(self.topic(f"cmd/{o['tag']}"), o["payload"], 1, False)

    # --------------------------------------------------------------------------------------- vista en formato antiguo ----
    def estado_antiguo(self):
        """Todo lo que ve la página, en el formato antiguo; None mientras no haya llegado nada."""
        if not self.hay_datos():
            return None
        d = {}
        d.update(sensores_a_antiguo(self.sensors))
        d.update(actuadores_a_antiguo(self.actuators))
        d.update(diagnostico_a_antiguo(self.status, self.sensors, self.alarmas, self.gateway_vivo()))
        d["timestamp"] = self._local()
        return d
