#!/usr/bin/env bash
# Crea el fichero de contraseñas del broker MQTT (Mosquitto) y, opcionalmente, los ficheros de entorno de los servicios.
#
#   sudo bash deploy/crear_usuarios_mqtt.sh [opciones] [usuario ...]
#
#   --aleatorias       genera una contraseña aleatoria por usuario y la MUESTRA UNA SOLA VEZ en pantalla (guárdala en un gestor de contraseñas)
#   --fichero RUTA     fichero de contraseñas (por defecto /etc/mosquitto/pct23_passwd)
#   --entornos DIR     escribe DIR/mqtt-gateway.env y DIR/mqtt-scada.env (MQTT_PASSWORD=...) con permisos 0600, para los servicios
#                      systemd (EnvironmentFile). Por defecto /etc/pct23; usa --sin-entornos para no escribirlos
#   --sin-entornos
#   --anadir           no borra el fichero: añade o cambia solo los usuarios indicados
#   -h, --help
#
# Usuarios por defecto: gateway-real-01 scada twin-001 lector   (los permisos de cada uno están en deploy/mosquitto_acl.conf)
#
# Sin --aleatorias pide cada contraseña por teclado (sin eco, dos veces). Las contraseñas NUNCA se pasan como argumento
# (se verían en el historial y en la lista de procesos) ni se guardan en el repositorio.
set -euo pipefail

FICHERO="/etc/mosquitto/pct23_passwd"
ENTORNOS="/etc/pct23"
ALEATORIAS=0
ANADIR=0
USUARIOS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --aleatorias) ALEATORIAS=1; shift;;
    --fichero) FICHERO="$2"; shift 2;;
    --entornos) ENTORNOS="$2"; shift 2;;
    --sin-entornos) ENTORNOS=""; shift;;
    --anadir) ANADIR=1; shift;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    -*) echo "Opción desconocida: $1"; exit 2;;
    *) USUARIOS+=("$1"); shift;;
  esac
done
[ ${#USUARIOS[@]} -gt 0 ] || USUARIOS=(gateway-real-01 scada twin-001 lector)

command -v mosquitto_passwd >/dev/null || { echo "Falta mosquitto_passwd (paquete mosquitto): sudo apt install mosquitto"; exit 1; }
for u in "${USUARIOS[@]}"; do
  [[ "$u" =~ ^[A-Za-z0-9._-]{1,40}$ ]] || { echo "Nombre de usuario no válido: $u (solo letras, números, punto, guion y guion bajo)"; exit 2; }
done

# SUPUESTO: las versiones recientes de mosquitto_passwd leen la contraseña de la entrada estándar con -i (no verificado en este equipo: no hay Mosquitto instalado).
# ¿Lo admite este mosquitto_passwd? Si no, se usa -b (la contraseña se ve un instante en la lista de procesos).
if mosquitto_passwd --help 2>&1 | grep -qE '(^|[[:space:]])-i([[:space:],]|$)'; then LEER_STDIN=1; else LEER_STDIN=0; echo "AVISO: este mosquitto_passwd no admite -i; se usará -b (la contraseña queda visible un instante en 'ps')."; fi

generar() { openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24; }

fijar_clave() {   # fijar_clave USUARIO CLAVE  -> escribe en $FICHERO (ya creado)
  if [ "$LEER_STDIN" = 1 ]; then printf '%s\n' "$2" | mosquitto_passwd -i "$FICHERO" "$1"
  else mosquitto_passwd -b "$FICHERO" "$1" "$2"; fi
}

mkdir -p "$(dirname "$FICHERO")"
if [ "$ANADIR" = 0 ] || [ ! -f "$FICHERO" ]; then
  [ -f "$FICHERO" ] && cp -p "$FICHERO" "$FICHERO.bak"
  : > "$FICHERO"
fi
chmod 600 "$FICHERO"

declare -A CLAVES
for u in "${USUARIOS[@]}"; do
  if [ "$ALEATORIAS" = 1 ]; then
    c="$(generar)"
  else
    read -r -s -p "Contraseña de $u: " c; echo
    read -r -s -p "Repítela: " c2; echo
    [ "$c" = "$c2" ] || { echo "No coinciden."; exit 1; }
    [ ${#c} -ge 12 ] || { echo "Usa al menos 12 caracteres."; exit 1; }
  fi
  fijar_clave "$u" "$c"
  CLAVES[$u]="$c"
done

# El broker lee el fichero como usuario «mosquitto»: propietario suyo y 0600.
if id mosquitto >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then chown mosquitto:mosquitto "$FICHERO"; fi
chmod 600 "$FICHERO"
echo "Fichero de contraseñas: $FICHERO ($(wc -l < "$FICHERO") usuario(s))"

# Ficheros de entorno de los servicios (solo la contraseña; el usuario va en la línea de arranque del servicio)
if [ -n "$ENTORNOS" ]; then
  mkdir -p "$ENTORNOS"; chmod 755 "$ENTORNOS"
  escribir_entorno() {   # escribir_entorno FICHERO USUARIO
    local f="$1" u="$2"
    [ -n "${CLAVES[$u]:-}" ] || return 0
    ( umask 077; printf 'MQTT_PASSWORD=%s\n' "${CLAVES[$u]}" > "$f" )
    chmod 600 "$f"; echo "Entorno del servicio: $f"
  }
  escribir_entorno "$ENTORNOS/mqtt-gateway.env" gateway-real-01
  escribir_entorno "$ENTORNOS/mqtt-scada.env" scada
fi

if [ "$ALEATORIAS" = 1 ]; then
  echo
  echo "=== CONTRASEÑAS GENERADAS (se muestran UNA sola vez; guárdalas ahora) ==="
  for u in "${USUARIOS[@]}"; do printf '  %-18s %s\n' "$u" "${CLAVES[$u]}"; done
  echo "==========================================================================="
fi
echo "Reinicia el broker para que lo lea:  sudo systemctl restart mosquitto   (o sudo systemctl reload mosquitto)"
