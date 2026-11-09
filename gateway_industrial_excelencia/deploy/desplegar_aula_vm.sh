#!/usr/bin/env bash
# Despliega el aula PCT23 (aula + nginx con HTTPS, en Docker) en una VM Linux por SSH.
# Se ejecuta desde este repositorio, con los cambios ya commiteados (usa el último commit, no el árbol de trabajo):
#
#   ./deploy/desplegar_aula_vm.sh usuario@servidor [opciones]
#
#   -i CLAVE              clave privada SSH a usar
#   --migrar-datos RUTA   datos de una instalación anterior sin Docker (carpeta con aula.sqlite3 y secret_key, en la VM):
#                         se copian al volumen de Docker y se para el servicio systemd antiguo "pct23-aula"
#   --env-antiguo FICHERO aula.env de esa instalación (en la VM): se usa como .env si todavía no existe
#
# La primera vez instala Docker (paquetes de Debian/Ubuntu), crea el certificado propio (para la IP y el nombre de la VM)
# y el .env. Después solo actualiza el código y reconstruye. Los datos de los alumnos (volumen) nunca se tocan al actualizar.
# Si la comprobación final falla y se había parado el servicio antiguo, lo vuelve a arrancar.
set -euo pipefail

DESTINO=""; CLAVE=""; MIGRAR=""; ENV_ANTIGUO=""
while [ $# -gt 0 ]; do
  case "$1" in
    -i) CLAVE="$2"; shift 2;;
    --migrar-datos) MIGRAR="$2"; shift 2;;
    --env-antiguo) ENV_ANTIGUO="$2"; shift 2;;
    -h|--help) sed -n '2,15p' "$0"; exit 0;;
    *) DESTINO="$1"; shift;;
  esac
done
[ -n "$DESTINO" ] || { echo "Uso: $0 usuario@servidor [-i clave] [--migrar-datos RUTA] [--env-antiguo FICHERO]"; exit 2; }

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"            # gateway_industrial_excelencia
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15); [ -n "$CLAVE" ] && SSH+=(-i "$CLAVE" -o IdentitiesOnly=yes)

if [ -n "$(git -C "$RAIZ" status --porcelain -- aula_pct23 simulador_pct23)" ]; then
  echo "Hay cambios sin commitear en aula_pct23 o simulador_pct23: se despliega el último commit, sin ellos."
fi
echo "== Subiendo el código del commit $(git -C "$RAIZ" rev-parse --short HEAD) a $DESTINO =="
git -C "$RAIZ" archive --format=tar HEAD -- aula_pct23 simulador_pct23 .dockerignore \
    ':(exclude)aula_pct23/tests' ':(exclude)simulador_pct23/tests' \
  | "${SSH[@]}" "$DESTINO" 'mkdir -p ~/pct23-docker && rm -rf ~/pct23-docker/simulador_pct23 ~/pct23-docker/simulador_didactico && tar -C ~/pct23-docker -xf - 2>&1 | grep -v "in the future" || true'

echo "== Desplegando en la VM =="
"${SSH[@]}" "$DESTINO" "MIGRAR='$MIGRAR' ENV_ANTIGUO='$ENV_ANTIGUO' bash -s" <<'REMOTO'
set -uo pipefail
cd ~/pct23-docker/aula_pct23

# 1. Docker
if ! command -v docker >/dev/null; then
  echo "Instalando Docker..."; sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose >/dev/null
fi
if sudo docker compose version >/dev/null 2>&1; then DC="sudo docker compose"; else DC="sudo docker-compose"; fi

# 2. Certificado propio (solo si no existe): IP y nombre de esta VM
if [ ! -f certs/aula.key ]; then ./nginx/generar_certificado.sh "$(hostname)" $(hostname -I) | tail -2; fi

# 3. .env (solo si no existe)
if [ ! -f .env ]; then
  if [ -n "$ENV_ANTIGUO" ] && [ -f "$ENV_ANTIGUO" ]; then cp "$ENV_ANTIGUO" .env; else cp .env.example .env; fi
  chmod 600 .env; echo ".env creado"
fi
grep -q '^AULA_PIN=12345678' .env && echo "AVISO: el PIN del aula es el de fábrica (12345678). Cámbialo en ~/pct23-docker/aula_pct23/.env y ejecuta 'up -d'."

# 4. Construir la imagen (el servicio actual sigue funcionando mientras tanto)
$DC build aula 2>&1 | tail -2
$DC up --no-start 2>&1 | tail -1
VOL="$(sudo docker volume ls -q | grep -E 'aula_datos$' | head -1)"

# 5. Datos de la instalación anterior (opcional): se para el servicio antiguo y se copian al volumen
PARADO=0
if [ -n "$MIGRAR" ]; then
  [ -f "$MIGRAR/aula.sqlite3" ] || { echo "No hay $MIGRAR/aula.sqlite3"; exit 1; }
  cp -a "$MIGRAR" "$MIGRAR.copia-$(date +%F_%H%M)" && echo "Copia de seguridad: $MIGRAR.copia-*"
  if systemctl is-active --quiet pct23-aula; then sudo systemctl stop pct23-aula; PARADO=1; fi
  sudo docker run --rm --user 0 -v "$VOL":/data -v "$(readlink -f "$MIGRAR")":/src:ro --entrypoint sh pct23-aula:latest \
    -c 'cp -a /src/. /data/ && chown -R 10001 /data'
fi

# 6. Arrancar y comprobar
$DC up -d 2>&1 | tail -2
for i in $(seq 1 20); do s=$(sudo docker inspect -f '{{.State.Health.Status}}' pct23-aula 2>/dev/null); [ "$s" = healthy ] && break; sleep 2; done
ok=1; [ "$s" = healthy ] || ok=0
for p in 80 447; do c=$(curl -sk -o /dev/null -m 8 -w '%{http_code}' https://127.0.0.1:$p/); echo "  https :$p -> $c"; [ "$c" = 302 ] || ok=0; done
if [ $ok = 1 ]; then
  [ $PARADO = 1 ] && sudo systemctl disable pct23-aula >/dev/null 2>&1
  echo "== OK: aula + nginx en Docker (80 y 447, HTTPS) =="; sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
else
  echo "!! La comprobación falló"; $DC logs --tail 15 2>&1 | cut -c1-170; $DC down
  [ $PARADO = 1 ] && { sudo systemctl start pct23-aula; echo "Servicio anterior restaurado"; }
  exit 1
fi
REMOTO
