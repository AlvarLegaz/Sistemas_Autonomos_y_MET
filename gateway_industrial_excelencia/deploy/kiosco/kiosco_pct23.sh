#!/bin/sh
# Abre el sinoptico PCT23 a pantalla completa en la pantalla tactil de la Raspberry y lo vuelve a abrir si se cierra.
URL="http://localhost:8080/pct23"
# Entorno grafico (ya viene definido al arrancar desde labwc; estos valores solo cubren el lanzamiento a mano por SSH).
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
# Espera a que el servidor web del gateway responda (arranca en paralelo con el escritorio).
until curl -s -o /dev/null --max-time 2 "$URL"; do sleep 2; done
while true; do
  chromium --kiosk --ozone-platform=wayland --noerrdialogs --disable-infobars --no-first-run \
    --disable-session-crashed-bubble --lang=es-ES --disable-features=Translate,TranslateUI --disable-translate --password-store=basic \
    --overscroll-history-navigation=0 --disable-pinch --check-for-update-interval=31536000 \
    --user-data-dir="$HOME/.config/chromium-kiosco" "$URL"
  sleep 3
done
