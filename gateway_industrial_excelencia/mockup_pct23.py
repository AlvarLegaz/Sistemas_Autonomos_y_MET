"""Mockup del contrato MQTT PCT23 v2.4: una planta simulada, un bus MQTT en memoria y un SCADA de pruebas, con HORA PROPIA que avanzamos nosotros.

Sirve para probar el contrato entero (órdenes, ack, interlocks, latido, estado seguro, alarmas) sin broker ni hardware, y de forma determinista:

    python mockup_pct23.py          # recorre un escenario y escribe lo que pasa por el bus

La planta (`PlantaMock`) es un modelo sencillo pero coherente con la maqueta: tanque A con nivel L1, tanque B con flotadores LL/HL, calefactor con
termostato (histéresis) y bombas con PWM mínimo del 50 %. NO es la física del gemelo digital: solo lo necesario para ejercitar el contrato.
"""
import fnmatch
import json

from contrato_pct23 import (ACTUADORES, CLAVES_SENSORS, Controlador, Planta, RelojSimulado, iso_utc)

AMBIENTE_C = 24.0
TERMOSTATO_ABRE_C = 70.0          # el termostato físico del calefactor abre hacia los 70 °C
TERMOSTATO_CIERRA_C = 62.0
ML_POR_MM = 18.9                  # sección del depósito (PCT23.md): 18,9 mL por mm de altura
CAUDAL_N1_100_ML_MIN = 520.0
CAUDAL_LLENADO_ML_MIN = 600.0
PWM_MINIMO = 50


class PlantaMock(Planta):
    """Planta simulada. `paso(dt)` avanza su física dt segundos; `forzar(clave, valor)` fija un sensor (para provocar fallos); `soltar(clave)` lo libera."""

    def __init__(self):
        self.a = {"sol1_divert": True, "sol2_feed_tank": "A", "sol3_cooling": False, "sol4_fill_a": False, "sol5_fill_b": False,
                  "n1_on": False, "n1_speed_pct": 100, "n2_on": False, "n2_speed_pct": 100, "heater_pct": 0}
        self.t = {"t1": AMBIENTE_C, "t2": AMBIENTE_C, "t3": AMBIENTE_C, "t4": AMBIENTE_C}
        self.l1_mm = 250.0
        self.vb_mm = 100.0                       # nivel del tanque B (mm equivalentes)
        self.termostato_abierto = False
        self.nivel_calefactor = True
        self.io_ok = True
        self._forzado = {}

    # --- interfaz de Planta ---
    def leer_sensores(self):
        if not self.io_ok:
            return {}
        flujo = self._caudal_n1()
        lectura = {"t1_c": round(self.t["t1"], 1), "t2_c": round(self.t["t2"], 1), "t3_c": round(self.t["t3"], 1), "t4_c": round(self.t["t4"], 1),
                   "t5_c": None, "l1_level_mm": round(self.l1_mm, 1), "f1_flow_ml_min": round(flujo, 1),
                   "ll_tank_b": self.vb_mm <= 20.0, "hl_tank_b": self.vb_mm >= 200.0,
                   "lvl_heat_unit": self.nivel_calefactor, "hl_heat_unit": False, "stat_overtemp": self.termostato_abierto}
        lectura.update(self._forzado)
        return lectura

    def _inhibida(self):
        return self.termostato_abierto or not self.nivel_calefactor

    def estado_actuadores(self):
        est = dict(self.a)
        est["heater_inhibited"] = self._inhibida()
        return est

    def aplicar(self, pedido):
        for tag, valor in pedido.items():
            if tag not in ACTUADORES:
                continue
            if tag in ("n1_speed_pct", "n2_speed_pct") and 0 < valor < PWM_MINIMO:
                valor = PWM_MINIMO                # el runtime real sube las velocidades por debajo del 50 %
            if tag == "heater_pct" and valor > 0 and self._inhibida():
                valor = 0                         # con el termostato abierto o sin nivel, la resistencia no se acepta
            self.a[tag] = valor
        return self.estado_actuadores()

    # --- para provocar situaciones en las pruebas ---
    def forzar(self, clave, valor):
        self._forzado[clave] = valor

    def soltar(self, clave):
        self._forzado.pop(clave, None)

    # --- física ---
    def _caudal_n1(self):
        return CAUDAL_N1_100_ML_MIN * self.a["n1_speed_pct"] / 100.0 if self.a["n1_on"] else 0.0

    def paso(self, dt):
        calor_w = 0.0 if self._inhibida() else self.a["heater_pct"] * 17.6
        capacidad = 8400.0                         # J/K del agua del calefactor
        perdidas = 1.2 * (self.t["t2"] - AMBIENTE_C)
        self.t["t2"] += (calor_w - perdidas) * dt / capacidad
        if self.t["t2"] >= TERMOSTATO_ABRE_C:
            self.termostato_abierto = True
            self.a["heater_pct"] = 0              # el runtime real borra la orden de calentar y no se rearma sola
        elif self.termostato_abierto and self.t["t2"] <= TERMOSTATO_CIERRA_C:
            self.termostato_abierto = False
        marcha = self.a["n1_on"] and self.a["n2_on"]
        objetivo4 = AMBIENTE_C + 0.65 * (self.t["t2"] - AMBIENTE_C) if marcha else AMBIENTE_C
        objetivo1 = objetivo4 - 8.0 if marcha else AMBIENTE_C
        for k, obj in (("t4", objetivo4), ("t1", objetivo1), ("t3", AMBIENTE_C + 0.25 * (objetivo1 - AMBIENTE_C) if self.a["sol3_cooling"] else objetivo1)):
            self.t[k] += (obj - self.t[k]) * min(dt / 20.0, 1.0)
        consumo_ml = self._caudal_n1() / 60.0 * dt
        if self.a["sol2_feed_tank"] == "A":
            self.l1_mm = max(0.0, self.l1_mm - consumo_ml / ML_POR_MM)
        else:
            self.vb_mm = max(0.0, self.vb_mm - consumo_ml / ML_POR_MM)
        if self.a["sol4_fill_a"]:
            self.l1_mm = min(250.0, self.l1_mm + CAUDAL_LLENADO_ML_MIN / 60.0 * dt / ML_POR_MM)
        if self.a["sol5_fill_b"]:
            self.vb_mm = min(250.0, self.vb_mm + CAUDAL_LLENADO_ML_MIN / 60.0 * dt / ML_POR_MM)


# ---------------------------------------------------------------------------------------------------------------------------- bus ----
def coincide(patron, topic):
    """Comodines de MQTT: '+' un nivel, '#' el resto."""
    p, t = patron.split("/"), topic.split("/")
    for i, parte in enumerate(p):
        if parte == "#":
            return True
        if i >= len(t) or (parte != "+" and parte != t[i]):
            return False
    return len(p) == len(t)


class BusMock:
    """Broker en memoria: entrega síncrona a los suscriptores, guarda los retenidos y registra todo lo publicado. Los payloads se pasan por JSON."""

    def __init__(self):
        self.registro = []                  # (topic, payload, qos, retain) en orden
        self.retenidos = {}
        self._subs = []

    def suscribir(self, patron, callback):
        self._subs.append((patron, callback))
        for topic, payload in list(self.retenidos.items()):
            if coincide(patron, topic):
                callback(topic, payload)

    def publicar(self, topic, payload, qos=0, retain=False):
        datos = json.loads(json.dumps(payload))
        self.registro.append((topic, datos, qos, retain))
        if retain:
            self.retenidos[topic] = datos
        for patron, cb in list(self._subs):
            if coincide(patron, topic):
                cb(topic, datos)

    def mensajes(self, patron):
        return [(t, p) for t, p, _, _ in self.registro if coincide(patron, t)]


class ScadaMock:
    """SCADA de pruebas: latido cada 2 s, órdenes con id y ts, y recoge acks, alarmas y el último sensors/actuators/status."""

    def __init__(self, bus, instance_id, reloj, latido=True):
        self.bus, self.id, self.reloj, self.latido = bus, instance_id, reloj, latido
        self.acks, self.alarmas = {}, []
        self.sensors = self.actuators = self.status = None
        self._n, self._t_latido = 0, None
        bus.suscribir(f"pct23/{instance_id}/#", self._on)

    def _on(self, topic, p):
        resto = topic.split("/", 2)[2]
        if resto.endswith("/ack"):
            self.acks[p["id"]] = p
        elif resto == "alarms":
            self.alarmas.append(p)
        elif resto in ("sensors", "actuators", "status"):
            setattr(self, resto, p)

    def tick(self):
        ahora = self.reloj.ahora()
        if self.latido and (self._t_latido is None or ahora - self._t_latido >= 2.0):
            self._t_latido = ahora
            self.bus.publicar(f"pct23/{self.id}/scada/heartbeat", {"ts": iso_utc(ahora), "client": "scada-mock"}, 0)

    def orden(self, tag, valor, oid=None, ts=None):
        self._n += 1
        oid = oid or f"o{self._n:04d}"
        self.bus.publicar(f"pct23/{self.id}/cmd/{tag}", {"id": oid, "ts": ts or iso_utc(self.reloj.ahora()), "value": valor, "source": "scada-mock"}, 1)
        return oid

    def ultimo_ack(self, oid):
        return self.acks.get(oid)


class Simulacion:
    """Todo junto: hora propia (RelojSimulado), planta, bus, tarjeta (Controlador) y SCADA. `avanzar(s)` hace correr el tiempo en pasos de 0,1 s."""

    def __init__(self, instance_id="real-01", inicio="2026-11-24T10:00:00.000Z", latido=True, kind="real", **opciones_controlador):
        self.reloj = RelojSimulado(inicio)
        self.bus = BusMock()
        self.planta = PlantaMock()
        self.tarjeta = Controlador(instance_id, self.planta, self.reloj, self.bus.publicar, kind=kind, **opciones_controlador)
        self.scada = ScadaMock(self.bus, instance_id, self.reloj, latido=latido)
        for sufijo in ("cmd/+", "scada/heartbeat", "params", "config"):
            self.bus.suscribir(f"pct23/{instance_id}/{sufijo}", self.tarjeta.on_message)
        self.tarjeta.conectar()

    def avanzar(self, segundos, paso=0.1):
        for _ in range(int(round(segundos / paso))):
            self.reloj.avanzar(paso)
            self.planta.paso(paso)
            self.scada.tick()
            self.tarjeta.tick()

    def ordena(self, tag, valor, **kw):
        """Manda una orden y deja correr un instante; devuelve el ack."""
        oid = self.scada.orden(tag, valor, **kw)
        self.avanzar(0.2)
        return self.scada.ultimo_ack(oid)


def demostracion():
    sim = Simulacion()
    print(f"Hora propia de partida: {iso_utc(sim.reloj.ahora())}")
    sim.avanzar(1.0)
    pasos = [("sol2_feed_tank", "A"), ("sol3_cooling", True), ("n2_on", True), ("n1_on", True), ("n1_speed_pct", 30), ("sol1_divert", False), ("heater_pct", 60)]
    for tag, valor in pasos:
        ack = sim.ordena(tag, valor)
        print(f"  cmd/{tag} = {valor!r:6} -> {ack['result']}" + (f" applied={ack['applied']!r}" if ack["result"] == "accepted" else f" ({ack['reason']})"))
    sim.avanzar(120)
    print(f"A los 2 min: T1={sim.scada.sensors['t1_c']} T2={sim.scada.sensors['t2_c']} T4={sim.scada.sensors['t4_c']}  F1={sim.scada.sensors['f1_flow_ml_min']} mL/min  L1={sim.scada.sensors['l1_level_mm']} mm")
    print("Corto el latido del SCADA 12 s ...")
    sim.scada.latido = False
    sim.avanzar(12)
    print(f"  status.safe_state={sim.scada.status['safe_state']} ({sim.scada.status['safe_reason']}), heater_pct={sim.scada.actuators['heater_pct']}, n1_on={sim.scada.actuators['n1_on']}")
    print(f"  orden con safe_state: {sim.ordena('heater_pct', 50)['reason']}")
    sim.scada.latido = True
    sim.avanzar(3)
    print(f"  reset_safe_state: {sim.ordena('reset_safe_state', True)['result']}; safe_state={sim.scada.status['safe_state']}")
    print(f"  paro de emergencia: {sim.ordena('emergency_stop', True)['result']}; safe_reason={sim.scada.status['safe_reason']}")
    print("Alarmas vistas:", ", ".join(f"{a['alarm']}:{a['event']}" for a in sim.scada.alarmas))
    print(f"Mensajes publicados: {len(sim.bus.registro)}")


if __name__ == "__main__":
    demostracion()
