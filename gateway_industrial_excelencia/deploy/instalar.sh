#!/bin/bash
# Instala y arranca broker + gateway + interfaz web en la Raspberry Pi.
# Ejecutar desde la carpeta del gateway, tras git pull:   sudo bash deploy/instalar.sh
# Es idempotente: se puede repetir tras cada actualizacion.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Ejecutalo con sudo."; exit 1; }
USUARIO="${SUDO_USER:-admin}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BROKER="${BROKER:-127.0.0.1:1883}"
# Usuarios MQTT de los servicios (los permisos de cada uno estan en deploy/mosquitto_acl.conf)
MQTT_USUARIO_GATEWAY="${MQTT_USUARIO_GATEWAY:-gateway-real-01}"
MQTT_USUARIO_SCADA="${MQTT_USUARIO_SCADA:-scada}"

echo "== Paquetes (apt)"
apt-get update -qq
apt-get install -y -qq mosquitto mosquitto-clients python3-venv python3-dev i2c-tools \
    python3-lgpio python3-smbus2 python3-spidev python3-gpiozero python3-flask python3-paho-mqtt

echo "== I2C y SPI"
if [ ! -e /dev/i2c-1 ] || [ ! -e /dev/spidev0.0 ]; then
    raspi-config nonint do_i2c 0
    raspi-config nonint do_spi 0
    REINICIAR=1
fi
usermod -aG i2c,spi,gpio "$USUARIO"

echo "== Broker Mosquitto (sin acceso anonimo: usuarios y permisos por cliente)"
install -m 644 "$DIR/deploy/mosquitto-gateway.conf" /etc/mosquitto/conf.d/gateway.conf
# Permisos por topic (el broker los lee como usuario mosquitto)
install -m 600 -o mosquitto -g mosquitto "$DIR/deploy/mosquitto_acl.conf" /etc/mosquitto/pct23_acl
# Contraseñas: solo la primera vez (repetir la instalacion NO las cambia). Se generan aleatorias y se muestran UNA vez:
# guardalas. Los servicios leen la suya de /etc/pct23/mqtt-*.env (0600, solo root). Para cambiarlas: deploy/crear_usuarios_mqtt.sh
if [ ! -f /etc/mosquitto/pct23_passwd ]; then
    bash "$DIR/deploy/crear_usuarios_mqtt.sh" --aleatorias --entornos /etc/pct23
else
    echo "Ya existe /etc/mosquitto/pct23_passwd: no se tocan las contraseñas."
fi
systemctl enable --now mosquitto
systemctl restart mosquitto
# TLS opcional (puerto 8883): sudo bash deploy/generar_certificado_mqtt.sh y descomentar el listener en gateway.conf (ver MQTT_SEGURIDAD.md)

echo "== Entorno Python"
sudo -u "$USUARIO" python3 -m venv --system-site-packages "$DIR/venv"
sudo -u "$USUARIO" "$DIR/venv/bin/pip" install -q -r "$DIR/requirements.txt"

echo "== Servicios systemd"
cat > /etc/systemd/system/pct23-tiempo.service <<UNIT
[Unit]
Description=Servidor de tiempo de la maqueta PCT23 (SNTP propio: la hora que usan el gateway y el SCADA)
After=network.target

[Service]
User=$USUARIO
WorkingDirectory=$DIR
# El puerto 123 es privilegiado: se concede solo esa capacidad al servicio. Con --hora-inicial se fija una hora de partida; sin ella parte de la del equipo.
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=$DIR/venv/bin/python modulo_tiempo.py servidor --puerto 123 --reloj autonomo
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/gateway-io.service <<UNIT
[Unit]
Description=Gateway industrial de E/S (MQTT)
After=mosquitto.service pct23-tiempo.service
Wants=mosquitto.service pct23-tiempo.service

[Service]
User=$USUARIO
WorkingDirectory=$DIR
EnvironmentFile=/etc/pct23/mqtt-gateway.env
ExecStart=$DIR/venv/bin/python gateway_pct23.py $BROKER $MQTT_USUARIO_GATEWAY --instancia real-01
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/gateway-web.service <<UNIT
[Unit]
Description=Interfaz web del gateway
After=mosquitto.service pct23-tiempo.service

[Service]
User=$USUARIO
WorkingDirectory=$DIR
EnvironmentFile=/etc/pct23/mqtt-scada.env
ExecStart=$DIR/venv/bin/python servidor_web.py $BROKER $MQTT_USUARIO_SCADA
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pct23-tiempo gateway-io gateway-web
systemctl restart pct23-tiempo gateway-io gateway-web

echo "== Estado"
sleep 3
systemctl is-active mosquitto pct23-tiempo gateway-io gateway-web || true
echo "Interfaz web: http://$(hostname -I | awk '{print $1}'):8080/"
[ "${REINICIAR:-0}" = 1 ] && echo "I2C/SPI recien activados: reinicia la Pi (sudo reboot) para que el gateway lea el hardware."
