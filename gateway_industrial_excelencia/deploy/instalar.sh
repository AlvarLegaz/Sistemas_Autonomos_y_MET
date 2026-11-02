#!/bin/bash
# Instala y arranca broker + gateway + interfaz web en la Raspberry Pi.
# Ejecutar desde la carpeta del gateway, tras git pull:   sudo bash deploy/instalar.sh
# Es idempotente: se puede repetir tras cada actualizacion.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Ejecutalo con sudo."; exit 1; }
USUARIO="${SUDO_USER:-admin}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BROKER="${BROKER:-127.0.0.1:1883}"

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

echo "== Broker Mosquitto"
install -m 644 "$DIR/deploy/mosquitto-gateway.conf" /etc/mosquitto/conf.d/gateway.conf
systemctl enable --now mosquitto
systemctl restart mosquitto

echo "== Entorno Python"
sudo -u "$USUARIO" python3 -m venv --system-site-packages "$DIR/venv"
sudo -u "$USUARIO" "$DIR/venv/bin/pip" install -q -r "$DIR/requirements.txt"

echo "== Servicios systemd"
cat > /etc/systemd/system/gateway-io.service <<UNIT
[Unit]
Description=Gateway industrial de E/S (MQTT)
After=mosquitto.service
Wants=mosquitto.service

[Service]
User=$USUARIO
WorkingDirectory=$DIR
ExecStart=$DIR/venv/bin/python gateway_main_app.py $BROKER
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/gateway-web.service <<UNIT
[Unit]
Description=Interfaz web del gateway
After=mosquitto.service

[Service]
User=$USUARIO
WorkingDirectory=$DIR
ExecStart=$DIR/venv/bin/python servidor_web.py $BROKER
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable gateway-io gateway-web
systemctl restart gateway-io gateway-web

echo "== Estado"
sleep 3
systemctl is-active mosquitto gateway-io gateway-web || true
echo "Interfaz web: http://$(hostname -I | awk '{print $1}'):8080/"
[ "${REINICIAR:-0}" = 1 ] && echo "I2C/SPI recien activados: reinicia la Pi (sudo reboot) para que el gateway lea el hardware."
