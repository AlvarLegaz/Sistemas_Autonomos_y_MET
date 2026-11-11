"""Control de temperatura de T1 por cascada (modo "Automático" del sinóptico).

Corre en el servidor web (servidor_web.py), no en el navegador: sigue funcionando aunque se cierre la página.

Cómo regula:
  - Lazo externo: la diferencia entre la consigna de T1 y T1 mide cuánta agua caliente hace falta; da una
    consigna para T2 (acción directa + PI), limitada por arriba a "T2 máxima".
  - Lazo interno, todo o nada con histéresis sobre T2: la resistencia se conecta cuando T2 baja de
    consigna - histéresis y se desconecta cuando sube de consigna + histéresis. Si T2 llega a la T2 máxima
    se desconecta siempre.
  - Velocidad de N1: la fija el usuario. Con el control activo, N1 y N2 quedan encendidas.

Seguridad: si el termostato (D1) abre, o faltan las lecturas de T1 o T2, la resistencia se desconecta.
Nada de esto sustituye al termostato de la maqueta, que salta a 70 °C.
"""
import time

# Canales del gateway (los mismos que la tabla MAPA de pct23.html).
CANAL_T1, CANAL_T2 = "AnalogIn1_value", "AnalogIn2_value"
CANAL_TERMOSTATO = "DigitalIn1_value"          # D1: abre (False) si hay sobretemperatura
SALIDA_RES = "TransistorOut3_value"            # resistencia de calefacción (encendido)
SALIDA_N1, SALIDA_N2 = "TransistorOut8_value", "TransistorOut7_value"
SALIDA_VELOCIDAD_N1 = "PWMOut1_value"          # PWM lento de N1 (0-100 %)

GRADOS_POR_VOLTIO = 100.0                      # sondas de 10 mV/°C
AMBIENTE_C = 22.0                              # supuesto: no hay sonda de ambiente
EFICIENCIA_BASE, REDUCCION_POR_CAUDAL = 0.79, 0.25   # intercambiador (mismos valores que el simulador)
GANANCIA_P, GANANCIA_I = 1.0, 0.002            # lazo externo (T1 -> consigna de T2), como en el simulador
SEGUNDOS_REENVIO = 5.0                         # las órdenes se repiten para que el gateway no las pierda
PASO_MAXIMO_S = 5.0                            # un hueco largo entre lecturas no acumula integral
# Motivos por los que el gateway no deja calentar (los publica en `motivos_bloqueo`) y que desactivan el control.
FALLOS = {"termostato_abierto": "Termostato disparado", "sonda_t2_fuera_de_rango": "Sonda T2 fuera de rango",
          "paro_emergencia": "Paro de emergencia"}

LIMITES = {                                    # (mínimo, máximo) de cada ajuste
    "consigna_t1": (20.0, 80.0),
    "t2_max": (30.0, 65.0),                    # el termostato salta a 70 °C y T2 sigue subiendo unos grados al cortar
    "histeresis": (0.5, 10.0),
    "velocidad_n1": (10.0, 100.0),
}
POR_DEFECTO = {"consigna_t1": 45.0, "t2_max": 60.0, "histeresis": 2.0, "velocidad_n1": 50.0}


def _limitar(valor, minimo, maximo):
    return max(minimo, min(maximo, valor))


def _temperatura(datos, canal):
    """Temperatura en °C a partir de la tensión de la sonda, o None si no hay lectura."""
    valor = datos.get(canal)
    if not isinstance(valor, (int, float)) or isinstance(valor, bool):
        return None
    return _limitar(valor / 1.5, 0.0, 1.0) * 1.5 * GRADOS_POR_VOLTIO


def eficiencia(velocidad_n1):
    return EFICIENCIA_BASE * (1 - REDUCCION_POR_CAUDAL * velocidad_n1 / 100.0)


class ControlT1:
    def __init__(self, reloj=time.monotonic):
        self._reloj = reloj
        self.ajustes = dict(POR_DEFECTO)
        self.activo = False
        self._reiniciar()

    def _reiniciar(self):
        self._integral = 0.0
        self._res_on = False
        self._ultimo_paso = None
        self._ultimo_envio = None
        self._enviar_ya = True
        self._t2_objetivo = None
        self._aviso = ""

    # ----- ajustes -----
    def configurar(self, **cambios):
        """Cambia ajustes validando rangos; si alguno falla no se cambia ninguno."""
        nuevos = {}
        for nombre, valor in cambios.items():
            if nombre not in LIMITES:
                raise ValueError(f"ajuste desconocido: {nombre}")
            if isinstance(valor, bool) or not isinstance(valor, (int, float)):
                raise ValueError(f"{nombre} debe ser un número")
            minimo, maximo = LIMITES[nombre]
            if not minimo <= valor <= maximo:
                raise ValueError(f"{nombre} debe estar entre {minimo:g} y {maximo:g}")
            nuevos[nombre] = float(valor)
        self.ajustes.update(nuevos)
        self._enviar_ya = True                 # la velocidad de N1 nueva se manda en la siguiente lectura

    def activar(self):
        if not self.activo:
            self.activo = True
            self._reiniciar()

    def desactivar(self):
        """Devuelve las órdenes para dejar la resistencia apagada (las bombas se quedan como estén)."""
        if not self.activo:
            return {}
        self.activo = False
        self._reiniciar()
        return {SALIDA_RES: False}

    # ----- un paso de control -----
    def paso(self, datos):
        """Procesa una lectura del gateway y devuelve las órdenes a publicar ({} si no hay nada que mandar)."""
        if not self.activo:
            return {}
        ahora = self._reloj()
        dt = 0.0 if self._ultimo_paso is None else _limitar(ahora - self._ultimo_paso, 0.0, PASO_MAXIMO_S)
        self._ultimo_paso = ahora
        t1, t2 = _temperatura(datos, CANAL_T1), _temperatura(datos, CANAL_T2)
        antes = self._res_on

        fallos = [FALLOS[m] for m in (datos.get("motivos_bloqueo") or []) if m in FALLOS]
        if datos.get(CANAL_TERMOSTATO) is False and not fallos:
            fallos = [FALLOS["termostato_abierto"]]
        if fallos:
            # Un fallo (termostato, sonda T2, paro de emergencia): el control se desactiva y no vuelve solo cuando se arregle.
            self.activo, self._res_on, self._t2_objetivo = False, False, None
            self._aviso = f"{' y '.join(fallos)}: control automático desactivado"
            return {SALIDA_RES: False}
        if t1 is None or t2 is None:
            self._res_on, self._t2_objetivo, self._aviso = False, None, "Sin lectura de T1 o T2: calefactor apagado"
        else:
            self._regular(t1, t2, dt, datos)
        return self._ordenes(ahora, cambio=antes != self._res_on)

    def _regular(self, t1, t2, dt, datos):
        a = self.ajustes
        objetivo = self._consigna_t2(t1, dt)
        histeresis = a["histeresis"]
        self._aviso = ""
        if t2 >= a["t2_max"]:
            self._res_on, self._aviso = False, "T2 en su máximo: calefactor apagado"
        elif t2 <= objetivo - histeresis:
            self._res_on = True
        elif t2 >= objetivo + histeresis:
            self._res_on = False

    def _consigna_t2(self, t1, dt):
        """Lazo externo: consigna de T2 que hace falta para que T1 llegue a su consigna (acción directa + PI)."""
        a = self.ajustes
        minimo, maximo = AMBIENTE_C + 5.0, a["t2_max"]
        necesaria = AMBIENTE_C + (a["consigna_t1"] - AMBIENTE_C) / eficiencia(a["velocidad_n1"])
        error = a["consigna_t1"] - t1
        sin_limitar = necesaria + GANANCIA_P * error + GANANCIA_I * self._integral
        # Integra solo si no está saturada la consigna (o si el error la devolvería al rango).
        if abs(error) < 5.0 and (minimo < sin_limitar < maximo or (sin_limitar >= maximo and error < 0)
                                 or (sin_limitar <= minimo and error > 0)):
            self._integral = _limitar(self._integral + error * dt, -5000.0, 5000.0)
        sin_limitar = necesaria + GANANCIA_P * error + GANANCIA_I * self._integral
        self._t2_objetivo = _limitar(sin_limitar, minimo, maximo)
        return self._t2_objetivo

    def _ordenes(self, ahora, cambio):
        toca = self._enviar_ya or cambio or self._ultimo_envio is None or ahora - self._ultimo_envio >= SEGUNDOS_REENVIO
        if not toca:
            return {}
        self._enviar_ya = False
        self._ultimo_envio = ahora
        return {SALIDA_RES: self._res_on, SALIDA_N1: True, SALIDA_N2: True,
                SALIDA_VELOCIDAD_N1: self.ajustes["velocidad_n1"]}

    # ----- lo que ve la página -----
    def estado(self):
        return {"activo": self.activo, **self.ajustes,
                "t2_objetivo": None if self._t2_objetivo is None else round(self._t2_objetivo, 1),
                "calefactor": self._res_on, "aviso": self._aviso}
