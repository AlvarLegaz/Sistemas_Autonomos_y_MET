"""Servidor UDP para control de baja latencia.

Todavía no está implementado: HTTP sobra para probar el esqueleto. Cuando el
submarino se mueva de verdad, el mando irá por aquí (sin handshake ni
reintentos, un datagrama por consigna).
"""

PUERTO_UDP = 5001

# Socket del servidor mientras está en marcha.
_socket = None


def iniciar_servidor_udp(submarino, puerto=PUERTO_UDP):
    """Arrancará la escucha UDP y pasará las consignas a submarino.mover()."""
    # TODO(UDP): abrir socket SOCK_DGRAM, bind a ("0.0.0.0", puerto) y leer
    # datagramas en un hilo aparte para no bloquear el servidor web.
    pass


def detener_servidor_udp():
    """Cerrará el socket y parará el hilo de escucha."""
    # TODO(UDP): cerrar _socket y esperar al hilo.
    pass
