# Aula PCT23: simulador con registro de alumnos y aula del profesor

Servidor web que publica el simulador de `../simulador_didactico` detrás de un acceso con cuenta:

- **Alumnos:** se registran con nombre, apellidos, módulo, correo y contraseña, y entran con correo y contraseña.
- **Cuenta nueva = pendiente.** Hasta que el profesor la autoriza, el alumno solo ve el estado de su cuenta.
- **Aula del profesor** (`/aula`): se abre con un **PIN**. Desde ahí autoriza o rechaza alumnos, filtra por módulo o nombre, autoriza a todos los pendientes de un módulo, quita accesos, da una **clave nueva** a quien la olvide y elimina cuentas.
- El simulador solo se sirve a alumnos autorizados (o al profesor con el PIN puesto). Si el profesor quita el acceso, surte efecto en la siguiente petición.

## Puesta en marcha con Docker (nginx + HTTPS)

El aula se publica **solo por HTTPS**, con nginx delante y un certificado propio (autofirmado). Son dos contenedores: `aula` (la aplicación, sin puerto público) y `nginx` (puertos **80** y **447**, los dos con TLS). Hace falta Docker con Compose. Desde esta carpeta (`aula_pct23`):

```bash
cp .env.example .env                                   # en Windows: copy .env.example .env
# edita .env y cambia AULA_PIN por un PIN tuyo (mínimo 6 caracteres). Si no lo cambias, el PIN es 12345678
./nginx/generar_certificado.sh 192.168.99.120 mi-servidor   # IP y/o nombres con los que se entrará; crea certs/aula.crt y certs/aula.key
docker compose up -d --build
```

Abre `https://<servidor>:447` (o `https://<servidor>` en el 80). Una petición `http://` a esos puertos se redirige a `https://<servidor>:447`. Para comprobar el estado: `docker compose ps` y `docker compose logs -f`.

- **Certificado propio:** el navegador avisará de que no es de confianza la primera vez; hay que aceptarlo (o instalar `certs/aula.crt` como certificado de confianza en los equipos). Solo vale para las IP y nombres con los que se generó: si entras con otro, vuelve a generarlo (borra `certs/` y repite el script). Dura 825 días. **`certs/aula.key` es secreto y no se sube a git.**
- **Alumnos:** `https://<servidor>:447/` → Registrarme → esperar la autorización.
- **Profesor:** `https://<servidor>:447/aula` → PIN.
- **Parar / actualizar:** `docker compose down` / `docker compose up -d --build`. Los datos se conservan en el volumen `aula_datos`.
- **Cambiar el PIN:** edita `.env` y ejecuta `docker compose up -d`.
- **IP real de los alumnos:** nginx la pasa a la aplicación (`AULA_PROXY=1`), así que el bloqueo por intentos fallidos es por alumno y no por la IP del proxy.

### Desplegar en una VM por SSH

Desde la raíz de `gateway_industrial_excelencia`, con los cambios ya commiteados (se sube el último commit):

```bash
./deploy/desplegar_aula_vm.sh usuario@servidor -i ~/.ssh/mi_clave
```

La primera vez instala Docker, crea el certificado propio (para la IP y el nombre de la VM) y el `.env`; después solo actualiza el código y reconstruye, sin tocar los datos de los alumnos. Si ya había un aula sin Docker (servicio systemd `pct23-aula`), añade `--migrar-datos <carpeta datos> --env-antiguo <aula.env>` para pasar la base de alumnos al volumen y parar el servicio antiguo; si la comprobación final falla, lo vuelve a arrancar. Cambia el PIN en `~/pct23-docker/aula_pct23/.env` de la VM (y `docker compose up -d`).

El contexto de construcción es la carpeta `gateway_industrial_excelencia` (la imagen incluye una copia de `simulador_didactico`), así que si cambias el simulador hay que volver a construir con `--build`.

## Configuración (`.env`)

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `AULA_PIN` | `12345678` | PIN del aula del profesor (mínimo 6 caracteres). **El valor por defecto es público:** mientras se use, el aula muestra una nota. Sirve para pruebas; cámbialo antes de dar acceso a una clase real, porque cualquiera que lo conozca puede autorizar alumnos. |
| `AULA_PUERTO_HTTP` / `AULA_PUERTO_HTTPS` | `80` / `447` | Puertos que publica nginx; los dos van por HTTPS. |
| `AULA_MODULOS` | vacío | Módulos sugeridos al registrarse, separados por comas. El alumno puede escribir otro. |
| `AULA_COOKIE_SEGURA` | `1` | La cookie de sesión solo viaja por HTTPS (con nginx delante déjalo en 1). |
| `AULA_PROXY` | `1` en Docker | Solo con nginx delante: la app se fía de `X-Forwarded-*`. No lo actives si la app es alcanzable directamente. |
| `AULA_SESION_PROFESOR_MIN` | `120` | Minutos que dura la sesión del profesor tras el PIN. |
| `AULA_MAX_INTENTOS` / `AULA_BLOQUEO_S` | `5` / `300` | Fallos seguidos (contraseña o PIN) antes de bloquear, y segundos de bloqueo. |

## Seguridad: lo que hace y lo que no

Hace:

- Contraseñas guardadas con hash (scrypt de Werkzeug), nunca en claro. Mínimo 8 caracteres.
- Mensaje de error idéntico para correo inexistente y contraseña incorrecta, y tiempo de comprobación igualado.
- Bloqueo temporal por IP y por correo tras varios fallos, y también para el PIN.
- Token CSRF en todos los formularios; cookie de sesión `HttpOnly` y `SameSite=Lax`.
- Texto de los alumnos escapado en todas las pantallas; cabeceras `X-Frame-Options`, `nosniff` y política de contenido.
- Solo se sirven del simulador archivos `.html`, `.css`, `.js`, `.png`, `.svg`, `.ico` y `.json`, nunca `tests` ni rutas ocultas.
- Contenedor con usuario sin privilegios, sistema de archivos de solo lectura y sin capacidades extra.

No hace (conviene saberlo):

- **Cifra el tráfico con certificado propio.** nginx sirve todo por HTTPS (80 y 447) y la app no tiene puerto público. El certificado es autofirmado: protege la conexión, pero el navegador no puede verificar quién la presenta hasta que se acepte o se instale `certs/aula.crt` en los equipos. Para exponerlo a Internet conviene un certificado de una autoridad reconocida (por ejemplo Let's Encrypt) en lugar del propio.
- **No verifica el correo** ni envía correos. Que alguien se registre con cualquier dirección no importa porque el profesor autoriza a mano; para recuperar una contraseña el alumno pide al profesor una clave nueva.
- El bloqueo por intentos vive en memoria de un único proceso (por eso la imagen usa un solo proceso con varios hilos) y se reinicia al reiniciar el contenedor. Detrás de un proxy, la IP que ve la aplicación es la del proxy.
- El PIN es un secreto compartido: quien lo conozca administra el aula. **Con el PIN por defecto (`12345678`) no hay ninguna protección real de la autorización**; el bloqueo tras 5 intentos solo frena adivinar un PIN, no leerlo en este README. Cámbialo si se filtra.
- Hecho para una clase, no para miles de usuarios (SQLite en un volumen).

## Ejecutar sin Docker (pruebas en el propio equipo)

```bash
pip install -r requirements.txt
AULA_PIN=482913 AULA_DATOS=./datos python app.py       # PowerShell: $env:AULA_PIN="482913"; python app.py
```

## Pruebas

Desde `gateway_industrial_excelencia`:

```bash
python -m unittest discover -s aula_pct23/tests -v
```

Cubren el registro y sus validaciones, el acceso, los bloqueos, la autorización y revocación al instante, el CSRF, la protección del simulador y de las rutas, la caducidad de la sesión del profesor y las claves nuevas.

## Estructura

- `app.py`: aplicación Flask (rutas, base de datos SQLite, limitador de intentos).
- `templates/`, `static/aula.css`: pantallas de acceso y aula del profesor.
- `Dockerfile`, `docker-compose.yml`, `.env.example`, `../.dockerignore`: despliegue.
- `tests/test_aula.py`: pruebas.
