# Aula PCT23: simulador con registro de alumnos y aula del profesor

Servidor web que publica el simulador de `../simulador_pct23` detrás de un acceso con cuenta:

- **Alumnos:** se registran con nombre, apellidos, módulo, correo y contraseña, y entran con correo y contraseña.
- **Cuenta nueva = pendiente.** Hasta que el profesor la autoriza, el alumno solo ve el estado de su cuenta.
- **Aula del profesor** (`/aula`): se abre con un **PIN**. Desde ahí autoriza o rechaza alumnos, filtra por módulo o nombre, autoriza a todos los pendientes de un módulo, quita accesos, da una **clave nueva** a quien la olvide y elimina cuentas.
- El simulador solo se sirve a alumnos autorizados (o al profesor con el PIN puesto). Si el profesor quita el acceso, surte efecto en la siguiente petición.

## Puesta en marcha con Docker

Hace falta Docker con el plugin Compose. Desde esta carpeta (`aula_pct23`):

```bash
cp .env.example .env          # en Windows: copy .env.example .env
# edita .env y cambia AULA_PIN por un PIN tuyo (mínimo 6 caracteres). Si no lo cambias, el PIN es 12345678
docker compose up -d --build
```

Abre `http://localhost:8000` (o el puerto de `AULA_PUERTO`). Para comprobar el estado: `docker compose ps` (el contenedor tiene comprobación de salud) y `docker compose logs -f`.

- **Alumnos:** `http://<servidor>:8000/` → Registrarme → esperar la autorización.
- **Profesor:** `http://<servidor>:8000/aula` → PIN.
- **Parar / actualizar:** `docker compose down` / `docker compose up -d --build`. Los datos se conservan en el volumen `aula_datos`.
- **Cambiar el PIN:** edita `.env` y ejecuta `docker compose up -d`.

El contexto de construcción es la carpeta `gateway_industrial_excelencia` (la imagen incluye una copia de `simulador_pct23`), así que si cambias el simulador hay que volver a construir con `--build`.

## Configuración (`.env`)

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `AULA_PIN` | `12345678` | PIN del aula del profesor (mínimo 6 caracteres). **El valor por defecto es público:** mientras se use, el aula muestra una nota. Sirve para pruebas; cámbialo antes de dar acceso a una clase real, porque cualquiera que lo conozca puede autorizar alumnos. |
| `AULA_PUERTO` | `8000` | Puerto publicado en el equipo. |
| `AULA_MODULOS` | vacío | Módulos sugeridos al registrarse, separados por comas. El alumno puede escribir otro. |
| `AULA_COOKIE_SEGURA` | `0` | Pon `1` si la publicas detrás de HTTPS: la cookie de sesión solo viajará por HTTPS. |
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

- **No cifra el tráfico.** Por una red de clase sirve con HTTP; si lo expones a Internet, ponlo detrás de un proxy inverso con HTTPS y activa `AULA_COOKIE_SEGURA=1`.
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
