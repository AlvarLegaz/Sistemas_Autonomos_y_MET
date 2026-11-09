# Aula PCT23: simulador + registro de alumnos + aula del profesor.
# Se construye desde la carpeta gateway_industrial_excelencia (el contexto debe incluir simulador_didactico):
#   docker compose -f aula_pct23/docker-compose.yml up -d --build
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY aula_pct23/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY aula_pct23/app.py /app/app.py
COPY aula_pct23/templates /app/templates
COPY aula_pct23/static /app/static
COPY simulador_didactico /app/simulador
RUN rm -rf /app/simulador/tests /app/simulador/*.md

# Usuario sin privilegios; los datos (SQLite y clave de sesiones) viven en el volumen /data
RUN useradd --system --uid 10001 --no-create-home aula \
    && mkdir /data && chown aula /data
USER aula

ENV AULA_DATOS=/data \
    AULA_SIMULADOR=/app/simulador

EXPOSE 8000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/salud', timeout=3).status == 200 else 1)"

# Un solo proceso con varios hilos: el bloqueo por intentos fallidos vive en memoria.
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "8", "--no-control-socket", "--access-logfile", "-", "app:crear_app()"]
