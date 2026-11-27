"""Módulo de control del SCADA: regula la temperatura con la resistencia, en DOS modos.

Vive en el SCADA, no en la placa. La placa es una caja negra que solo habla el contrato MQTT (tags en unidades de ingeniería); este módulo tampoco sabe de
voltios, canales ni escalas: lee `t1_c`, `t2_c` y manda `heater_pct`, `n1_on`, `n1_speed_pct`, `n2_on`. No importa Flask ni paho: recibe una lectura y devuelve
la lista de órdenes (tag, valor) que hay que mandar. Quien lo use (servidor_web.py) se ocupa de enviarlas con `ClienteScada.enviar_orden`.

MODO «simple»: un solo lazo, TODO O NADA con histéresis sobre UNA variable `v` (T1 por defecto):
    conecta     la resistencia cuando  v <= consigna - histéresis
    desconecta  la resistencia cuando  v >= consigna + histéresis
    entre las dos, mantiene lo que estaba haciendo (esa es la histéresis)
  - Variable T1: regula directamente el producto (su temperatura objetivo), pero T1 está al final del intercambiador y se entera tarde: se pasará de la consigna.
  - Variable T2: T2 es el agua caliente junto a la resistencia, reacciona rápido y oscila poco; T1 solo se observa.
  - T2 hace de TOPE en los dos casos (ver abajo).

MODO «cascada» T1 → T2: dos lazos anidados.
    lazo EXTERNO (T1):  e = consigna_T1 - T1;  consigna_T2 = t2_base + kp·e + ki·∫e   (PI, limitada entre T2_MIN y el tope t2_max)
    lazo INTERNO (T2):  todo o nada con histéresis sobre T2 hacia esa consigna_T2 (conecta a consigna_T2 - h, desconecta a consigna_T2 + h)
  El externo es lento y decide «cuánta agua caliente hace falta»; el interno es rápido y la mantiene, anticipándose al retraso de T1. La integral solo acumula
  si el error es menor de 5 °C y la consigna de T2 no está saturada (anti-windup). `t2_base` es la T2 que se espera necesaria en régimen (ajustable: 55 °C).

CORTE POR T1 ALTA (cascada): si T1 llega a consigna_T1 + histéresis la resistencia se desconecta ya, sin esperar a que el lazo externo baje la consigna de T2
(el agua caliente acumulada seguiría calentando el producto), y no vuelve a conectar hasta que T1 baja de su consigna. En simple-T1 el propio lazo ya corta ahí.

SOL1 (desvío del producto, los dos modos): con el control activo, SOL1 se activa (`sol1_divert` false: salida normal) cuando T1 llega a consigna_T1 y vuelve a
reposo (`sol1_divert` true: desvío) cuando T1 baja de consigna_T1 - histéresis; entre las dos se mantiene. Sin lectura de T1, con un fallo o al desactivar el
control, SOL1 queda en desvío. En simple-T2 se usa la última consigna_T1 configurada. Sin control activo no se toca.

TOPE DE T2 (los dos modos): con `T2 >= t2_max` la resistencia se desconecta siempre, sin sumar histéresis, y no vuelve a conectar hasta que T2 baja `histéresis`
por debajo del máximo (para no conmutar sin parar en el tope).

Seguridad (nada de esto sustituye al termostato físico de la maqueta ni a las protecciones de la placa):
  - Un FALLO desactiva el control y NO vuelve solo cuando se arregle: sin conexión con la planta, estado seguro, alarma overtemp / emergency_stop /
    watchdog_timeout, termostato abierto o resistencia inhibida por la placa. Devuelve heater_pct 0.
  - Si falta la lectura que necesita (T1 en cascada o en simple-T1, T2 en simple-T2, y T2 siempre por el tope) NO se desactiva: el calefactor queda apagado y avisa
    hasta que vuelva la lectura.
  - Las órdenes se repiten cada 5 s con la resistencia encendida: la placa apaga sola la orden de calentar si pasan 15 s sin renovarla (hombre muerto).
"""
import time

REENVIO_S = 5.0                                    # las órdenes se repiten para renovar la caducidad de la placa (15 s)
PASO_MAXIMO_S = 5.0                                # un hueco largo entre lecturas no acumula integral
T2_MIN_C = 27.0                                    # consigna de T2 mínima en cascada
ALARMAS_DE_FALLO = ("overtemp", "emergency_stop", "watchdog_timeout")
TEXTO_ALARMA = {"overtemp": "Sobretemperatura", "emergency_stop": "Paro de emergencia", "watchdog_timeout": "Estado seguro por falta de latido"}

LIMITES = {                                         # (mínimo, máximo) de cada ajuste numérico
    "consigna": (20.0, 80.0),
    "t2_max": (30.0, 65.0),                         # el termostato salta a 70 °C y T2 sigue subiendo unos grados al cortar
    "histeresis": (0.5, 10.0),
    "velocidad_n1": (50.0, 100.0),                  # por debajo del 50 % la peristáltica puede no girar (la placa lo sube al 50 %)
    "potencia_pct": (10.0, 100.0),                  # potencia de la resistencia cuando está conectada (la placa la aplica en pasos del 2 %)
    "kp": (0.0, 10.0),                              # cascada: ganancia proporcional del lazo externo (°C de T2 por °C de error de T1)
    "ki": (0.0, 0.05),                              # cascada: ganancia integral (°C de T2 por °C·s de error)
    "t2_base": (30.0, 65.0),                        # cascada: T2 que se espera necesaria en régimen
}
VARIABLES = ("T2", "T1")
MODOS = ("simple", "cascada")
POR_DEFECTO = {"modo": "simple", "variable": "T1", "consigna_t2": 55.0, "consigna_t1": 45.0, "t2_max": 60.0, "histeresis": 2.0, "velocidad_n1": 50.0,
               "potencia_pct": 100.0, "kp": 1.0, "ki": 0.002, "t2_base": 55.0}


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def _limitar(v, minimo, maximo):
    return max(minimo, min(maximo, v))


class ModuloControl:
    def __init__(self, reloj=time.monotonic):
        self._reloj = reloj
        self.ajustes = dict(POR_DEFECTO)
        self.activo = False
        self._reiniciar()

    def _reiniciar(self):
        self._res_on = False
        self._tope = False                 # el tope de T2 está disparado (se rearma con histéresis)
        self._t1_alta = False              # cascada: T1 pasó de consigna + histéresis (se libera al bajar de la consigna)
        self._sol1_on = False              # SOL1 activa (producto a salida normal); False = desvío
        self._integral = 0.0
        self._ultimo_paso = None
        self._t2_objetivo = None
        self._ultimo_envio = None
        self._enviar_ya = True
        self._aviso = ""

    # ------------------------------------------------------------------------------------------------ ajustes ----
    @property
    def modo(self):
        return self.ajustes["modo"]

    @property
    def variable(self):
        """Variable sobre la que se decide: en cascada siempre T1 (el lazo externo); en simple, la elegida."""
        return "T1" if self.modo == "cascada" else self.ajustes["variable"]

    def _clave_consigna(self, variable=None):
        return "consigna_t2" if (variable or self.variable) == "T2" else "consigna_t1"

    @property
    def consigna(self):
        """Consigna de la variable activa (en simple-T2 limitada por el tope de T2)."""
        c = self.ajustes[self._clave_consigna()]
        return min(c, self.ajustes["t2_max"]) if self.variable == "T2" else c

    def configurar(self, **cambios):
        """Cambia ajustes validando tipo y rango; si alguno falla no se cambia ninguno.
        `consigna` es la de la variable que se esté usando (o la de `variable`/`modo` si se cambian en la misma llamada)."""
        nuevos = {}
        modo = cambios.get("modo", self.modo)
        variable = cambios.get("variable", self.ajustes["variable"])
        if "modo" in cambios:
            if cambios["modo"] not in MODOS:
                raise ValueError("modo debe ser simple o cascada")
            nuevos["modo"] = cambios["modo"]
        if "variable" in cambios:
            if cambios["variable"] not in VARIABLES:
                raise ValueError("variable debe ser T2 o T1")
            nuevos["variable"] = cambios["variable"]
        for nombre, valor in cambios.items():
            if nombre in ("modo", "variable"):
                continue
            destino = self._clave_consigna("T1" if modo == "cascada" else variable) if nombre == "consigna" else nombre
            limite = LIMITES.get("consigna" if destino.startswith("consigna") else nombre)
            if limite is None:
                raise ValueError(f"ajuste desconocido: {nombre}")
            if not _num(valor):
                raise ValueError(f"{nombre} debe ser un número")
            if not limite[0] <= valor <= limite[1]:
                raise ValueError(f"{nombre} debe estar entre {limite[0]:g} y {limite[1]:g}")
            nuevos[destino] = float(valor)
        cambia_modo = nuevos.get("modo", self.modo) != self.modo
        self.ajustes.update(nuevos)
        self._enviar_ya = True                 # las órdenes nuevas (velocidad de N1, potencia) salen en la siguiente lectura
        if cambia_modo:                        # cambiar de modo en marcha: el lazo externo empieza de cero
            self._integral, self._t2_objetivo, self._ultimo_paso = 0.0, None, None

    def activar(self):
        if not self.activo:
            self.activo = True
            self._reiniciar()

    def desactivar(self):
        """Devuelve las órdenes para dejar la resistencia apagada y SOL1 en desvío (las bombas se quedan como estén)."""
        if not self.activo:
            return []
        self.activo = False
        self._reiniciar()
        return [("heater_pct", 0), ("sol1_divert", True)]

    # ---------------------------------------------------------------------------------------------- un paso ----
    def paso(self, lectura):
        """Procesa una lectura y devuelve las órdenes a mandar ([] si no hay nada). `lectura`: dict con
        t1_c, t2_c (None si faltan), conectada (bool), safe_state (bool), alarmas (iterable de nombres activos), stat_overtemp (bool), heater_inhibited (bool)."""
        if not self.activo:
            return []
        ahora = self._reloj()
        dt = 0.0 if self._ultimo_paso is None else _limitar(ahora - self._ultimo_paso, 0.0, PASO_MAXIMO_S)
        self._ultimo_paso = ahora
        antes = (self._res_on, self._sol1_on)
        fallo = self._fallo(lectura)
        if fallo:                              # un fallo desactiva el control y no vuelve solo
            self.activo, self._res_on, self._sol1_on, self._t2_objetivo = False, False, False, None
            self._aviso = f"{fallo}: control automático desactivado"
            return [("heater_pct", 0), ("sol1_divert", True)]
        self._regular(lectura, dt)
        return self._ordenes(ahora, cambio=antes != (self._res_on, self._sol1_on))

    @staticmethod
    def _fallo(l):
        if not l.get("conectada", True):
            return "Sin conexión con la planta"
        if l.get("safe_state"):
            return "Estado seguro de la planta"
        for a in ALARMAS_DE_FALLO:
            if a in (l.get("alarmas") or ()):
                return TEXTO_ALARMA[a]
        if l.get("stat_overtemp"):
            return "Termostato disparado"
        if l.get("heater_inhibited"):
            return "Resistencia inhibida por la planta"
        return None

    def _regular(self, l, dt):
        a = self.ajustes
        t1, t2 = l.get("t1_c"), l.get("t2_c")
        t1 = t1 if _num(t1) else None
        t2 = t2 if _num(t2) else None
        self._aviso = ""
        if t2 is not None:                  # el tope corta en T2 máxima y solo se rearma al bajar «histéresis» por debajo: sin esto conmutaría sin parar en el tope
            if t2 >= a["t2_max"]:
                self._tope = True
            elif self._tope and t2 <= a["t2_max"] - a["histeresis"]:
                self._tope = False
        cascada = self.modo == "cascada"
        c1, h = a["consigna_t1"], a["histeresis"]
        if t1 is None:                      # sin T1 no se sabe si el producto está pasteurizado: al desvío
            self._sol1_on, self._t1_alta = False, False
        else:
            if t1 >= c1:
                self._sol1_on = True
            elif t1 < c1 - h:
                self._sol1_on = False
            if t1 >= c1 + h:
                self._t1_alta = True
            elif t1 < c1:
                self._t1_alta = False
        necesita = t1 if (cascada or self.variable == "T1") else t2
        self._t2_objetivo = None
        if self._tope:
            self._res_on, self._aviso = False, "T2 en su máximo: calefactor apagado"
            if cascada and t1 is not None:
                self._consigna_t2_cascada(t1, dt, integrar=False)           # el lazo externo sigue calculando (sin acumular) para mostrarlo
        elif necesita is None or t2 is None:
            self._res_on, self._aviso = False, f"Sin lectura de {'T2' if t2 is None else 'T1' if (cascada or self.variable == 'T1') else 'T2'}: calefactor apagado"
        elif cascada:
            objetivo = self._consigna_t2_cascada(t1, dt)
            if self._t1_alta:
                self._res_on, self._aviso = False, "T1 por encima de la consigna: calefactor apagado"
            else:
                self._interno(t2, objetivo)
        else:
            self._interno(necesita, self.consigna)

    def _interno(self, v, consigna):
        """Todo o nada con histéresis (el lazo único del modo simple y el lazo interno de la cascada)."""
        h = self.ajustes["histeresis"]
        if v <= consigna - h:
            self._res_on = True
        elif v >= consigna + h:
            self._res_on = False

    def _consigna_t2_cascada(self, t1, dt, integrar=True):
        """Lazo externo: consigna de T2 que hace falta para que T1 llegue a su consigna (PI con anti-windup)."""
        a = self.ajustes
        minimo, maximo = T2_MIN_C, a["t2_max"]
        error = a["consigna_t1"] - t1
        sin_limitar = a["t2_base"] + a["kp"] * error + a["ki"] * self._integral
        # Integra solo si el error es pequeño y la consigna no está saturada (o si el error la devolvería al rango).
        if integrar and abs(error) < 5.0 and (minimo < sin_limitar < maximo or (sin_limitar >= maximo and error < 0) or (sin_limitar <= minimo and error > 0)):
            self._integral = _limitar(self._integral + error * dt, -5000.0, 5000.0)
        sin_limitar = a["t2_base"] + a["kp"] * error + a["ki"] * self._integral
        self._t2_objetivo = _limitar(sin_limitar, minimo, maximo)
        return self._t2_objetivo

    def _ordenes(self, ahora, cambio):
        toca = self._enviar_ya or cambio or self._ultimo_envio is None or ahora - self._ultimo_envio >= REENVIO_S
        if not toca:
            return []
        self._enviar_ya = False
        self._ultimo_envio = ahora
        a = self.ajustes
        return [("n2_on", True), ("n1_on", True), ("n1_speed_pct", int(round(a["velocidad_n1"]))),
                ("heater_pct", int(round(a["potencia_pct"])) if self._res_on else 0), ("sol1_divert", not self._sol1_on)]

    # ---------------------------------------------------------------------------------- lo que ve la página ----
    def estado(self):
        a = self.ajustes
        if self.modo == "cascada":
            objetivo = self._t2_objetivo
        else:
            objetivo = self.consigna if self.variable == "T2" else None
        return {"activo": self.activo, "modo": self.modo, "variable": self.variable, "consigna": self.consigna, "consigna_t2": a["consigna_t2"],
                "consigna_t1": a["consigna_t1"], "t2_max": a["t2_max"], "histeresis": a["histeresis"], "velocidad_n1": a["velocidad_n1"],
                "potencia_pct": a["potencia_pct"], "kp": a["kp"], "ki": a["ki"], "t2_base": a["t2_base"],
                "t2_objetivo": None if objetivo is None else round(objetivo, 1), "calefactor": self._res_on, "sol1": self._sol1_on, "aviso": self._aviso}
