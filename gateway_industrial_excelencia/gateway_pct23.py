"""Gateway de la maqueta PCT23 con el contrato MQTT v2.4: runtime de la placa + cliente MQTT (paho) + núcleo del contrato.

    python3 gateway_pct23.py [ip:puerto] [usuario@clave] [--instancia real-01] [--simular] [--reloj autonomo|sistema] [--hora-inicial ISO]
                             [--sin-latido] [--caducidad-calefactor 15] [--config config_pct23.json]

- Se conecta con MQTT 3.1.1, usuario y contraseña, clean session y keepalive 30 s, y deja registrado el last will (`status` offline).
- HORA: la da el SERVIDOR DE TIEMPO propio (`modulo_tiempo.py`, `--reloj servidor`, por defecto): se le pide al arrancar y cada `--periodo-hora` s. Si no hay
  servidor, `--reloj autonomo` (hora propia que parte de `--hora-inicial`) o `--reloj sistema` (hora del equipo, con NTP).
- Seguridad: con latido habilitado (por defecto), 10 s sin latido del SCADA o la pérdida del broker dejan la maqueta en estado seguro. La orden de calentar
  caduca a los 15 s si nadie la renueva (`--caducidad-calefactor`, 0 = sin caducidad): el SCADA la repite. El gateway antiguo (`gateway_main_app.py`) no debe
  ejecutarse a la vez: solo debe haber una autoridad de órdenes sobre la maqueta.
"""
import argparse
import getpass
import json
import os
import re
import signal
import threading
import time

import paho.mqtt.client as mqtt

from contrato_pct23 import Controlador, RelojAutonomo, RelojSistema, iso_utc
from modulo_tiempo import RelojSincronizado
from planta_runtime import PlantaRuntime
from runtime import Runtime

BROKER_POR_DEFECTO = "127.0.0.1:1883"      # hoy el broker está en la propia Raspberry; más adelante será otra máquina (basta cambiar la dirección)
KEEPALIVE_S = 30
PERIODO_TICK_S = 0.1
CADUCIDAD_CALEFACTOR_S = 15.0
ARCHIVO_CONFIG = "config_pct23.json"
SERVIDOR_HORA_POR_DEFECTO = os.environ.get("PCT23_SERVIDOR_HORA", "127.0.0.1:123")   # servidor de tiempo (modulo_tiempo.py); hoy en la misma Raspberry
PERIODO_HORA_S = 60.0
SUSCRIPCIONES = (("cmd/+", 1), ("scada/heartbeat", 0), ("params", 1), ("config", 1))


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
    """'usuario@clave' -> (usuario, clave). Se parte en la PRIMERA @: la clave puede llevar @. Con solo usuario, la clave sale de MQTT_PASSWORD o se pide."""
    if not texto:
        return None, None
    usuario, sep, clave = texto.partition("@")
    if not sep:
        clave = os.environ.get("MQTT_PASSWORD")
        if clave is None:
            clave = getpass.getpass(f"Contraseña MQTT de {usuario}: ")
    return usuario, clave


def cargar_config(ruta):
    """config del contrato guardada en disco (se aplica al arrancar sin depender del broker). Un archivo roto se ignora."""
    try:
        with open(ruta, encoding="utf-8") as f:
            datos = json.load(f)
        return datos if isinstance(datos, dict) else {}
    except (OSError, ValueError):
        return {}


def guardar_config(ruta, config):
    tmp = f"{ruta}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    os.replace(tmp, ruta)                       # escritura atómica: un corte no deja el archivo a medias


class GatewayPCT23:
    def __init__(self, host, puerto, instancia="real-01", usuario=None, clave=None, simular=False, reloj=None, habilitar_latido=True,
                 caducidad_calefactor_s=CADUCIDAD_CALEFACTOR_S, archivo_config=ARCHIVO_CONFIG, cliente=None, runtime=None, periodo_hora_s=PERIODO_HORA_S):
        self.host, self.puerto, self.instancia = host, puerto, instancia
        self.periodo_hora_s = periodo_hora_s
        self.stop_event = threading.Event()
        self.lock = threading.RLock()            # paho llama a on_message desde su hilo: el controlador no es reentrante entre hilos
        self.archivo_config = archivo_config
        self.runtime = runtime or Runtime(simular=simular, caducidad_calefactor_s=caducidad_calefactor_s or None)
        config = cargar_config(archivo_config) if archivo_config else {}
        self.planta = PlantaRuntime(self.runtime, config)
        self.reloj = reloj or RelojAutonomo(iso_utc(time.time()))
        self.controlador = Controlador(instancia, self.planta, self.reloj, self._publicar, kind="real", habilitar_latido=habilitar_latido,
                                       al_cambiar_config=self._config_cambiada,
                                       estado_hora=getattr(self.reloj, "estado", None) if isinstance(self.reloj, RelojSincronizado) else None)
        self.controlador.config.update(config)
        self.planta.config = self.controlador.config
        self.cliente = cliente or mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"pct23-{instancia}", protocol=mqtt.MQTTv311, clean_session=True)
        if usuario:
            self.cliente.username_pw_set(usuario, clave)
        topic, payload, qos, retain = self.controlador.lwt()
        self.cliente.will_set(topic, json.dumps(payload), qos=qos, retain=retain)
        self.cliente.on_connect, self.cliente.on_disconnect, self.cliente.on_message = self.on_connect, self.on_disconnect, self.on_message

    # --------------------------------------------------------------------------------------------------- MQTT ----
    def _publicar(self, topic, payload, qos, retain):
        """Si no hay conexión NO se encola: paho guardaría mensajes de estado viejos y los soltaría al reconectar, por detrás de los nuevos."""
        if not self.cliente.is_connected():
            return
        self.cliente.publish(topic, json.dumps(payload), qos=qos, retain=retain)

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if getattr(reason_code, "is_failure", False):
            print(f"Error conectando a MQTT: {reason_code}")
            return
        print("MQTT conectado")
        for sufijo, qos in SUSCRIPCIONES:             # clean session: hay que volver a suscribirse en cada conexión
            client.subscribe(f"pct23/{self.instancia}/{sufijo}", qos=qos)
        with self.lock:
            self.controlador.conectar()

    def on_disconnect(self, client, userdata, flags=None, reason_code=None, properties=None):
        if self.stop_event.is_set():
            return
        print(f"MQTT desconectado ({reason_code}); reintentando...")
        with self.lock:
            self.controlador.desconexion_broker()

    def on_message(self, client, userdata, msg):
        with self.lock:
            self.controlador.on_message(msg.topic, msg.payload)

    def _config_cambiada(self, config):
        if self.archivo_config:
            try:
                guardar_config(self.archivo_config, config)
            except OSError as e:
                print(f"No se pudo guardar la config: {e}")

    # --------------------------------------------------------------------------------------------------- ciclo ----
    def run(self):
        self.runtime.start()
        try:
            if isinstance(self.reloj, RelojSincronizado):
                # SIEMPRE al arrancar: se pide la hora al servidor de tiempo antes de conectar; después, cada PERIODO_HORA_S
                ok = self.reloj.arrancar(periodo_s=self.periodo_hora_s, bloquear_hasta=10.0)
                print(f"Hora del servidor de tiempo {self.reloj.estado()['server']}: " + ("sincronizada" if ok else "SIN SINCRONIZAR (se sigue intentando; la hora puede no coincidir con la del SCADA)"))
            print(f"Gateway {self.instancia}: hora de la planta {iso_utc(self.reloj.ahora())} ({type(self.reloj).__name__})")
            print(f"Conectando MQTT a {self.host}:{self.puerto}...")
            self.cliente.connect_async(self.host, self.puerto, keepalive=KEEPALIVE_S)
            self.cliente.loop_start()
            while not self.stop_event.wait(PERIODO_TICK_S):
                with self.lock:
                    self.controlador.tick()
        finally:
            print("Parando gateway...")
            with self.lock:
                self.controlador.detener()          # publica «offline» a mano: el LWT no salta en una parada limpia
            self.cliente.disconnect()
            self.cliente.loop_stop()
            if isinstance(self.reloj, RelojSincronizado):
                self.reloj.detener()
            self.runtime.stop()                      # las salidas quedan apagadas
            print("Gateway parado")

    def stop(self):
        self.stop_event.set()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("broker", nargs="?", type=broker, default=broker(BROKER_POR_DEFECTO), help=f"broker MQTT como ip:puerto (por defecto {BROKER_POR_DEFECTO})")
    ap.add_argument("credenciales", nargs="?", help="usuario@clave, o solo usuario")
    ap.add_argument("--instancia", default="real-01", help="id de la planta en el broker ([a-z0-9-])")
    ap.add_argument("--simular", action="store_true", help="E/S simulada, sin I2C ni SPI (para probar en un PC)")
    ap.add_argument("--reloj", choices=("servidor", "autonomo", "sistema"), default="servidor",
                    help="hora de la planta: del servidor de tiempo (por defecto, pedida al arrancar y cada --periodo-hora), propia sin servidor, o la del equipo con NTP")
    ap.add_argument("--servidor-hora", default=SERVIDOR_HORA_POR_DEFECTO, help=f"servidor de tiempo ip:puerto (por defecto {SERVIDOR_HORA_POR_DEFECTO}; variable PCT23_SERVIDOR_HORA)")
    ap.add_argument("--periodo-hora", type=float, default=PERIODO_HORA_S, help=f"cada cuántos segundos se pide la hora al servidor de tiempo (por defecto {PERIODO_HORA_S:g})")
    ap.add_argument("--hora-inicial", help="hora de partida del reloj autónomo en ISO UTC (por defecto, la del equipo al arrancar)")
    ap.add_argument("--sin-latido", action="store_true", help="NO usar el latido del SCADA ni el estado seguro (solo para pruebas)")
    ap.add_argument("--caducidad-calefactor", type=float, default=CADUCIDAD_CALEFACTOR_S, help="segundos que dura la orden de calentar sin renovarse (0 = sin caducidad)")
    ap.add_argument("--config", default=ARCHIVO_CONFIG, help="archivo donde se guarda la config del contrato")
    args = ap.parse_args()
    if not re.fullmatch(r"[a-z0-9-]+", args.instancia):
        ap.error("--instancia solo admite minúsculas ASCII, números y guiones")

    usuario, clave = credenciales(args.credenciales)
    if args.reloj == "sistema":
        reloj = RelojSistema()
    elif args.reloj == "servidor":
        host_hora, puerto_hora = broker(args.servidor_hora if ":" in args.servidor_hora else f"{args.servidor_hora}:123")
        reloj = RelojSincronizado(host_hora, puerto_hora, hora_inicial=args.hora_inicial, periodo_s=args.periodo_hora)
    else:
        reloj = RelojAutonomo(args.hora_inicial or iso_utc(time.time()))
    app = GatewayPCT23(*args.broker, instancia=args.instancia, usuario=usuario, clave=clave, simular=args.simular, reloj=reloj, habilitar_latido=not args.sin_latido,
                       caducidad_calefactor_s=args.caducidad_calefactor, archivo_config=args.config, periodo_hora_s=args.periodo_hora)
    signal.signal(signal.SIGINT, lambda sig, frame: app.stop())
    signal.signal(signal.SIGTERM, lambda sig, frame: app.stop())
    app.run()


if __name__ == "__main__":
    main()
