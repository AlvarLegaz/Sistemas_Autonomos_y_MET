"""Sirve una carpeta por HTTP sin que el navegador guarde copias (evita ver versiones antiguas).

Uso: python servidor_sin_cache.py CARPETA [PUERTO]
"""
import functools
import http.server
import sys


class ManejadorSinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


def main():
    carpeta = sys.argv[1] if len(sys.argv) > 1 else "."
    puerto = int(sys.argv[2]) if len(sys.argv) > 2 else 8090
    manejador = functools.partial(ManejadorSinCache, directory=carpeta)
    http.server.ThreadingHTTPServer(("0.0.0.0", puerto), manejador).serve_forever()


if __name__ == "__main__":
    main()
