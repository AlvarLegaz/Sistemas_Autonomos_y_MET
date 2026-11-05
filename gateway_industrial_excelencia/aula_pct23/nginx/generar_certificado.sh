#!/usr/bin/env bash
# Genera el certificado propio (autofirmado) que usa nginx: certs/aula.crt y certs/aula.key.
#   ./nginx/generar_certificado.sh [IP-o-nombre ...]
# Sin argumentos usa la primera IP del equipo y su nombre. Cada IP o nombre queda en el certificado
# (subjectAltName); el navegador solo lo acepta si la dirección con la que entras está en esa lista.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash en Windows no debe tratar -subj "/C=ES/..." como una ruta
cd "$(dirname "$0")/.."
mkdir -p certs && chmod 700 certs
[ -f certs/aula.key ] && { echo "Ya existe certs/aula.key: bórralo si quieres generar otro certificado."; exit 1; }

nombres=("$@")
if [ ${#nombres[@]} -eq 0 ]; then
  nombres=("$(hostname)" "$(hostname -I 2>/dev/null | awk '{print $1}')")
fi
san="DNS:localhost,IP:127.0.0.1"
for n in "${nombres[@]}"; do
  [ -z "$n" ] && continue
  if [[ "$n" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then san="$san,IP:$n"; else san="$san,DNS:$n"; fi
done

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 \
  -keyout certs/aula.key -out certs/aula.crt \
  -subj "/C=ES/O=CIFP Politecnico Cartagena/CN=${nombres[0]:-aula-pct23}" \
  -addext "subjectAltName=$san" 2>/dev/null
chmod 600 certs/aula.key; chmod 644 certs/aula.crt
echo "Certificado creado (825 días) para: $san"
openssl x509 -in certs/aula.crt -noout -fingerprint -sha256
