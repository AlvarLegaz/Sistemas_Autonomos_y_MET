"""Control remoto del gateway industrial por MQTT.

    python control_remoto.py [ip:puerto] [usuario@clave] [--instancia real-01] [--protocolo nuevo|antiguo]

Con solo "usuario" la contraseña se toma de MQTT_PASSWORD o se pide por teclado. Por defecto el broker es 127.0.0.1:1883 (misma Raspberry Pi);
variables de entorno equivalentes: PCT23_BROKER, PCT23_INSTANCIA y PCT23_MQTT_USUARIO.
Protocolo nuevo (por defecto): contrato MQTT PCT23 v2.4 (scada_pct23.py), con latido del SCADA cada 2 s; antiguo: pct_23/entradas y pct_23/salidas.

Muestra entradas digitales y analogicas, el diagnostico del gateway y permite
conmutar las 8 salidas digitales y fijar el PWM 1.
"""
import argparse
import getpass
import json
import os
import queue
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk

import paho.mqtt.client as mqtt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # scada_pct23.py está en la carpeta superior
from scada_pct23 import ClienteScada  # noqa: E402
from scada_pct23 import GATEWAY_TIMEOUT_S as GATEWAY_TIMEOUT_NUEVO_S  # noqa: E402


TOPIC_SALIDAS = "pct_23/salidas"
TOPIC_ENTRADAS = "pct_23/entradas"
NUM_CANALES = 8
VREF = 3.3                 # fondo de escala de las barras analogicas (V)
GATEWAY_TIMEOUT_S = 1.0    # protocolo antiguo: sin datos durante este tiempo -> gateway sin respuesta (entradas llegaba cada 0,1 s)
BROKER_POR_DEFECTO = os.environ.get("PCT23_BROKER", "127.0.0.1:1883")      # misma Raspberry Pi; para un broker remoto basta cambiar la dirección
INSTANCIA_POR_DEFECTO = os.environ.get("PCT23_INSTANCIA", "real-01")
USUARIO_POR_DEFECTO = os.environ.get("PCT23_MQTT_USUARIO")

VERDE, ROJO, GRIS, AMBAR = "#2e9e44", "#c62828", "#9e9e9e", "#f9a825"


def broker(texto):
    host, sep, puerto = texto.rpartition(":")
    if not sep:
        host, puerto = texto, "1883"
    if "@" in texto:
        raise argparse.ArgumentTypeError("el broker va primero: ip:puerto usuario@clave")
    if not host or not puerto.isdigit() or not 0 < int(puerto) < 65536:
        raise argparse.ArgumentTypeError(f"se esperaba ip:puerto, no {texto!r}")
    return host, int(puerto)


def credenciales(texto):
    """'usuario@clave' -> (usuario, clave). Se parte en la PRIMERA @: la clave puede llevar @."""
    if not texto:
        return None, None
    usuario, sep, clave = texto.partition("@")
    if not sep:
        clave = os.environ.get("MQTT_PASSWORD")
        if clave is None:
            clave = getpass.getpass(f"Contraseña MQTT de {usuario}: ")
    return usuario, clave


class ControlRemoto:
    def __init__(self, root, host, puerto, usuario=None, clave=None, protocolo="nuevo", instancia=INSTANCIA_POR_DEFECTO):
        self.root = root
        self.host, self.puerto = host, puerto
        self.protocolo = protocolo
        self.timeout_s = GATEWAY_TIMEOUT_NUEVO_S if protocolo == "nuevo" else GATEWAY_TIMEOUT_S
        self.candado = threading.Lock()   # el estado del cliente del contrato lo tocan el hilo de paho y el de Tk
        self.scada = ClienteScada(instancia, self._publicar_contrato, client_id="pct23-scada-remoto") if protocolo == "nuevo" else None
        self.mensajes = queue.Queue()     # los callbacks de paho llegan en otro hilo
        self.ultimo_dato = 0.0
        self.salidas = [False] * NUM_CANALES
        self.arrastrando_pwm = False
        self.rechazo = None

        root.title(f"Control remoto gateway - {host}:{puerto}")
        root.resizable(False, False)
        self._construir()

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if usuario:
            self.client.username_pw_set(usuario, clave)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message
        self.client.connect_async(host, puerto, keepalive=30)
        self.client.loop_start()

        root.protocol("WM_DELETE_WINDOW", self.cerrar)
        self._refrescar()

    # ------------------------------------------------------------ interfaz
    def _construir(self):
        pad = {"padx": 6, "pady": 4}

        estado = ttk.Frame(self.root)
        estado.grid(row=0, column=0, columnspan=2, sticky="we", **pad)
        self.lbl_broker = tk.Label(estado, text="Conectando...", fg="white", bg=AMBAR, width=26)
        self.lbl_broker.pack(side="left", padx=(0, 6))
        self.lbl_gateway = tk.Label(estado, text="Gateway: sin datos", fg="white", bg=GRIS, width=22)
        self.lbl_gateway.pack(side="left", padx=(0, 6))
        self.lbl_diag = ttk.Label(estado, text="")
        self.lbl_diag.pack(side="left")

        f_di = ttk.LabelFrame(self.root, text="Entradas digitales")
        f_di.grid(row=1, column=0, sticky="nwe", **pad)
        self.leds = []
        for i in range(NUM_CANALES):
            ttk.Label(f_di, text=f"DI{i + 1}").grid(row=i, column=0, sticky="w", padx=6)
            led = tk.Label(f_di, text="  ", bg=GRIS, width=3)
            led.grid(row=i, column=1, pady=2, padx=6)
            self.leds.append(led)

        f_ai = ttk.LabelFrame(self.root, text=f"Entradas analógicas (0 - {VREF} V)")
        f_ai.grid(row=1, column=1, sticky="nwe", **pad)
        self.barras, self.lbl_ai = [], []
        for i in range(NUM_CANALES):
            ttk.Label(f_ai, text=f"AI{i + 1}").grid(row=i, column=0, sticky="w", padx=6)
            barra = ttk.Progressbar(f_ai, length=180, maximum=VREF)
            barra.grid(row=i, column=1, pady=2)
            lbl = ttk.Label(f_ai, text="--.--- V", width=9, anchor="e")
            lbl.grid(row=i, column=2, padx=6)
            self.barras.append(barra)
            self.lbl_ai.append(lbl)

        f_do = ttk.LabelFrame(self.root, text="Salidas digitales (clic para conmutar)")
        f_do.grid(row=2, column=0, columnspan=2, sticky="we", **pad)
        self.botones = []
        for i in range(NUM_CANALES):
            b = tk.Button(f_do, text=f"DO{i + 1}\nOFF", width=7, bg=GRIS, fg="white",
                          command=lambda canal=i: self.conmutar(canal))
            b.grid(row=0, column=i, padx=3, pady=4)
            self.botones.append(b)
        ttk.Button(f_do, text="Apagar todas", command=self.apagar_todo).grid(
            row=0, column=NUM_CANALES, padx=(12, 6))

        f_pwm = ttk.LabelFrame(self.root, text="PWM 1 (%)")
        f_pwm.grid(row=3, column=0, columnspan=2, sticky="we", **pad)
        self.pwm = tk.Scale(f_pwm, from_=0, to=100, orient="horizontal", length=420)
        self.pwm.pack(side="left", padx=6)
        self.pwm.bind("<ButtonPress-1>", lambda e: setattr(self, "arrastrando_pwm", True))
        self.pwm.bind("<ButtonRelease-1>", self._soltar_pwm)
        ttk.Label(f_pwm, text="Se envía al soltar. El gateway lo ignora\n"
                              "físicamente hasta mapear PWM_GPIO_PIN.").pack(side="left", padx=6)

        self.lbl_aviso = ttk.Label(self.root, text="", foreground=ROJO)
        self.lbl_aviso.grid(row=4, column=0, columnspan=2, sticky="w", **pad)

    # ------------------------------------------------------------ comandos
    def _publicar_contrato(self, topic, payload, qos, retain):
        self.client.publish(topic, json.dumps(payload), qos=qos, retain=retain)

    def enviar(self, datos):
        if not self.client.is_connected():
            self.lbl_aviso.config(text="Sin conexión con el broker: orden no enviada")
            return
        if self.scada is None:
            self.client.publish(TOPIC_SALIDAS, json.dumps(datos))
            self.lbl_aviso.config(text="")
            return
        with self.candado:
            resumen = self.scada.ordenes_antiguas(datos)
        if resumen["sin_hora"]:
            self.lbl_aviso.config(text="Aún no se conoce la hora de la planta (espera al primer mensaje de sensores): orden no enviada")
        elif not resumen["enviada"]:
            self.lbl_aviso.config(text="Ninguna salida válida en la orden")
        else:
            self.lbl_aviso.config(text="")

    def conmutar(self, canal):
        self.enviar({f"DigitalOut{canal + 1}_value": not self.salidas[canal]})

    def apagar_todo(self):
        self.enviar({f"DigitalOut{i}_value": False for i in range(1, NUM_CANALES + 1)})

    def _soltar_pwm(self, _evento):
        self.arrastrando_pwm = False
        self.enviar({"PWMOut1_value": self.pwm.get()})

    # ------------------------------------------------------------ MQTT
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            self.rechazo = str(reason_code)
            self.mensajes.put(("broker", f"Rechazado: {reason_code}"))
            return
        self.rechazo = None
        if self.scada is None:
            client.subscribe(TOPIC_ENTRADAS)
        else:
            with self.candado:
                self.scada.conectar()
            client.subscribe(self.scada.suscripciones())
        self.mensajes.put(("broker", None))

    def _on_message(self, client, userdata, msg):
        if self.scada is None:
            self.mensajes.put(("datos", msg.payload))
            return
        with self.candado:
            evento = self.scada.on_message(msg.topic, msg.payload)
            datos = self.scada.estado_antiguo() if evento else None
        if datos is not None:
            self.mensajes.put(("datos", json.dumps(datos)))      # mismo formato antiguo que entiende _mostrar

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        if self.scada is not None:
            with self.candado:
                self.scada.desconectar()
        # Tras un rechazo (p. ej. clave mala) se mantiene el motivo a la vista.
        if not self.rechazo:
            self.mensajes.put(("broker", "Desconectado, reintentando..."))

    # ------------------------------------------------------------ refresco (hilo de Tk)
    def _refrescar(self):
        while True:
            try:
                tipo, dato = self.mensajes.get_nowait()
            except queue.Empty:
                break
            if tipo == "broker":
                if dato is None:
                    self.lbl_broker.config(text=f"Broker {self.host}:{self.puerto}", bg=VERDE)
                else:
                    self.lbl_broker.config(text=dato, bg=ROJO)
            else:
                self._mostrar(dato)

        if self.scada is not None:
            with self.candado:
                self.scada.tick()                      # latido del SCADA cada 2 s y gestión de los ack
        if time.monotonic() - self.ultimo_dato > self.timeout_s:
            self.lbl_gateway.config(text="Gateway: sin datos", bg=GRIS)
        self.refresco = self.root.after(100, self._refrescar)

    def _mostrar(self, payload):
        try:
            d = json.loads(payload)
        except ValueError:
            return
        self.ultimo_dato = time.monotonic()

        if d.get("running") and d.get("io_ok", True):
            self.lbl_gateway.config(text="Gateway: en marcha", bg=VERDE)
        elif d.get("running"):
            self.lbl_gateway.config(text="Gateway: error de E/S", bg=ROJO)
        else:
            self.lbl_gateway.config(text="Gateway: parado", bg=AMBAR)
        self.lbl_diag.config(text=f"errores E/S: {d.get('io_errors', '-')}   "
                                  f"scans retrasados: {d.get('scan_overruns', '-')}")

        for i in range(NUM_CANALES):
            n = i + 1
            if f"DigitalIn{n}_value" in d:
                self.leds[i].config(bg=VERDE if d[f"DigitalIn{n}_value"] else GRIS)
            if f"AnalogIn{n}_value" in d:
                v = float(d[f"AnalogIn{n}_value"])
                self.barras[i]["value"] = min(max(v, 0.0), VREF)
                self.lbl_ai[i].config(text=f"{v:.3f} V")
            if f"DigitalOut{n}_value" in d:
                on = bool(d[f"DigitalOut{n}_value"])
                self.salidas[i] = on
                self.botones[i].config(text=f"DO{n}\n{'ON' if on else 'OFF'}", bg=VERDE if on else GRIS)

        if "PWMOut1_value" in d and not self.arrastrando_pwm:
            self.pwm.set(round(float(d["PWMOut1_value"])))

    def cerrar(self):
        self.root.after_cancel(self.refresco)
        self.client.disconnect()
        self.client.loop_stop()
        self.root.destroy()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("broker", nargs="?", type=broker, default=broker(BROKER_POR_DEFECTO),
                    help=f"broker MQTT como ip:puerto (por defecto {BROKER_POR_DEFECTO}; variable PCT23_BROKER)")
    ap.add_argument("credenciales", nargs="?", default=USUARIO_POR_DEFECTO,
                    help="usuario@clave, o solo usuario (sin autenticacion si se omite; por defecto PCT23_MQTT_USUARIO)")
    ap.add_argument("--instancia", default=INSTANCIA_POR_DEFECTO, help=f"id de la planta (por defecto {INSTANCIA_POR_DEFECTO}; variable PCT23_INSTANCIA)")
    ap.add_argument("--protocolo", choices=("nuevo", "antiguo"), default="nuevo", help="nuevo = contrato v2.4 (por defecto); antiguo = pct_23/*")
    args = ap.parse_args()
    usuario, clave = credenciales(args.credenciales)

    root = tk.Tk()
    ControlRemoto(root, *args.broker, usuario=usuario, clave=clave, protocolo=args.protocolo, instancia=args.instancia)
    root.mainloop()


if __name__ == "__main__":
    sys.exit(main())
