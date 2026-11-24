#!/usr/bin/env bash
# Genera el certificado propio (autofirmado) del broker MQTT para el listener TLS (puerto 8883): mqtt.crt y mqtt.key.
#   sudo bash deploy/generar_certificado_mqtt.sh [--dir DIRECTORIO] [IP-o-nombre ...]
# Sin argumentos: guarda en /etc/mosquitto/certs (o en ./certs_mqtt si no hay /etc/mosquitto) y usa el nombre y las IP del equipo.
# Cada IP o nombre queda en el certificado (subjectAltName): un cliente solo lo acepta si la dirección con la que conecta está en esa lista.
# Es el mismo enfoque que aula_pct23/nginx/generar_certificado.sh. Al ser autofirmado, cada cliente usa mqtt.crt como CA (cafile).
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash en Windows no debe tratar -subj "/C=ES/..." como una ruta

DIR=""
nombres=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2;;
    -h|--help) sed -n '2,7p' "$0"; exit 0;;
    *) nombres+=("$1"); shift;;
  esac
done
if [ -z "$DIR" ]; then
  if [ -d /etc/mosquitto ] && [ "$(id -u)" -eq 0 ]; then DIR=/etc/mosquitto/certs; else DIR="$(cd "$(dirname "$0")/.." && pwd)/certs_mqtt"; fi
fi
mkdir -p "$DIR" && chmod 755 "$DIR"
[ -f "$DIR/mqtt.key" ] && { echo "Ya existe $DIR/mqtt.key: bórralo si quieres generar otro certificado."; exit 1; }

if [ ${#nombres[@]} -eq 0 ]; then
  nombres=("$(hostname)")
  for ip in $(hostname -I 2>/dev/null); do nombres+=("$ip"); done
fi
san="DNS:localhost,IP:127.0.0.1"
for n in "${nombres[@]}"; do
  [ -z "$n" ] && continue
  if [[ "$n" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then san="$san,IP:$n"; else san="$san,DNS:$n"; fi
done

cd "$DIR"   # rutas relativas: el openssl de Windows (Git Bash) no entiende rutas absolutas tipo /tmp/...
registro="$(mktemp)"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 \
  -keyout mqtt.key -out mqtt.crt \
  -subj "/C=ES/O=CIFP Politecnico Cartagena/CN=${nombres[0]:-broker-pct23}" \
  -addext "subjectAltName=$san" >"$registro" 2>&1 || { cat "$registro"; rm -f "$registro" mqtt.key mqtt.crt; echo "openssl ha fallado."; exit 1; }
rm -f "$registro"
chmod 600 mqtt.key; chmod 644 mqtt.crt
# El broker lee la clave como usuario «mosquitto».
if id mosquitto >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then chown mosquitto:mosquitto mqtt.key; fi

echo "Certificado creado (825 días) en $DIR para: $san"
openssl x509 -in mqtt.crt -noout -fingerprint -sha256
echo "Copia mqtt.crt (solo el .crt, NUNCA la .key) a cada cliente y úsalo como CA:  mosquitto_pub --cafile mqtt.crt -p 8883 ..."
echo "Para activarlo, descomenta el listener 8883 de deploy/mosquitto-gateway.conf y reinicia mosquitto."
