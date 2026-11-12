"""Servidor local de pruebas con las mismas rutas que el aula: /simulador/ (simulador_pct23) y /planta-real/ (esta carpeta).

Así las páginas de la planta real cargan el código compartido con /simulador/js/... tanto aquí como en el aula, sin cambiar rutas.
Uso:  python simulador_planta_real/servir_local.py [PUERTO] [ESCUCHAR]        y abrir  http://localhost:8091/planta-real/
Para verlo desde otro dispositivo de la misma red (p. ej. el móvil): ESCUCHAR = 0.0.0.0 y abrir http://<IP-del-PC>:PUERTO/planta-real/
(sin contraseña y solo mientras lo necesites: sirve las carpetas de los dos simuladores a cualquiera de tu red)
No guarda copias en el navegador (como deploy/servidor_sin_cache.py).
"""
import http.server
import posixpath
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PREFIJOS = {"/simulador/": RAIZ / "simulador_pct23", "/planta-real/": RAIZ / "simulador_planta_real"}


class Manejador(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        ruta = posixpath.normpath(path.split("?", 1)[0].split("#", 1)[0])
        ruta = ruta + "/" if path.split("?", 1)[0].endswith("/") and not ruta.endswith("/") else ruta
        for prefijo, carpeta in PREFIJOS.items():
            if ruta.startswith(prefijo) or ruta + "/" == prefijo:
                resto = ruta[len(prefijo):]
                destino = (carpeta / resto).resolve()
                if carpeta.resolve() in destino.parents or destino == carpeta.resolve():   # sin salir de la carpeta (../)
                    return str(destino)
        return str(RAIZ / "__no_existe__")

    def do_GET(self):
        if self.path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", "/planta-real/")
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8091
    escuchar = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"      # por defecto solo este PC
    print(f"Planta real: http://localhost:{puerto}/planta-real/   (simulador de siempre: http://localhost:{puerto}/simulador/)")
    if escuchar != "127.0.0.1":
        print(f"Abierto a la red ({escuchar}): sin contraseña. Ciérralo (Ctrl+C) cuando termines.")
    http.server.ThreadingHTTPServer((escuchar, puerto), Manejador).serve_forever()
