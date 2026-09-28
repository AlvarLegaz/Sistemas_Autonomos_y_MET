# Arquitectura del rover

Rover diferencial autónomo sobre Raspberry Pi. Este documento describe la
versión esqueleto: la estructura y las clases están creadas, pero el acceso al
hardware, la navegación y el vídeo **no están implementados**. Todo el código
se ejecuta en un PC (Windows o WSL) con datos simulados.

## Hardware

```
Raspberry Pi
│
├── L298
│   ├── Motores izquierdos x2
│   └── Motores derechos x2
│
├── I2C
│   └── IMU
│
├── UART
│   └── GPS
│
└── Cámara
```

Es un rover diferencial: no tiene dirección, gira por diferencia de velocidad
entre los dos lados. Los dos motores de un lado van siempre con la misma
consigna, así que el software controla **dos lados**, no cuatro motores.

Todos los pines y buses están definidos como constantes al principio de
`hardware.py` (numeración BCM): `MOTOR_IZQ_ENB/IN3/IN4`, `MOTOR_DER_ENA/IN1/IN2`,
`MOTOR_PWM_FRECUENCIA_HZ`, `I2C_BUS`, `IMU_DIRECCION_I2C`, `GPS_PUERTO` y
`GPS_BAUDIOS`. Es el único sitio que hay que tocar si cambia el cableado.

## Arquitectura software

```
                  Rover
                    │
        ┌───────────┼───────────┐
        │           │           │
    Hardware       IMU         GPS
        │
   L298 / GPIO
              + Cámara
```

`Rover` es la única clase que el resto del programa necesita conocer. Agrupa el
hardware y los tres sensores, y ofrece los métodos de movimiento y de
telemetría. La IMU, el GPS y la cámara reciben el objeto `Hardware` porque de
él saldrán el bus I2C y el puerto serie cuando se implementen.

### Comunicaciones

```
Servidor Web ──┐
               ├── Rover
Servidor UDP ──┘
```

Los dos servidores hablan con el rover, nunca con el hardware ni con los
sensores directamente. Así el control puede llegar por HTTP o por UDP sin
duplicar lógica.

### Ficheros

| Fichero | Responsabilidad |
| --- | --- |
| `hardware.py` | Abstrae el acceso físico a la Raspberry Pi: GPIO, PWM, L298, bus I2C, puerto serie del GPS y lectura de batería. Es la única capa que tocará el hardware, y donde vive el vigilante de órdenes. |
| `imu.py` | Gestiona la IMU (orientación, aceleración, giróscopo) por I2C. |
| `gps.py` | Gestiona el GPS (posición, velocidad, rumbo) por UART. |
| `camara.py` | Gestiona la cámara de la Raspberry Pi. |
| `rover.py` | Representa el rover completo y coordina sus componentes. |
| `servidor_web.py` | Expone la API HTTP con Flask y sirve la interfaz en `/`. |
| `interfaz.html` | Interfaz de control en el navegador: teclado, botones o mando, barras de empuje, telemetría y visor. Un solo fichero sin librerías externas, porque el rover no tendrá internet en el campo. |
| `servidor_udp.py` | Se utilizará posteriormente para comunicaciones de baja latencia. |
| `main.py` | Inicializa el sistema y arranca el servidor web. |

## Consigna de velocidad

`set_motores(izquierda, derecha)` y `mover(izquierda, derecha)` trabajan con un
valor por lado:

```
-100 ... 0 ... +100
```

negativo retrocede, 0 para, positivo avanza. El recorte al rango vive en
`Hardware.set_motores()`, que devuelve el valor realmente aplicado.

El rover **no guarda copia** de la consigna: la única versión buena está en el
hardware, porque es quien la puede cambiar por su cuenta cuando salta el
vigilante. `Rover.obtener_telemetria()` la lee de allí con
`Hardware.estado_control()`.

## Vigilante de órdenes (watchdog)

Si no llega una orden nueva en **0,5 s** (`WATCHDOG_TIMEOUT`), el hardware para
los motores por su cuenta. Sin esto, un corte de WiFi o un mando colgado
dejarían el rover avanzando con la última consigna hasta que se agote la
batería o choque.

Está en `hardware.py` y no en el servidor a propósito: así protege cualquier
vía de control —HTTP hoy, UDP y navegación autónoma después— y no solo la que
existía cuando se escribió.

Cómo funciona: `configurar()` arranca un hilo *daemon* que cada 0,05 s
(`WATCHDOG_INTERVALO`) comprueba el tiempo transcurrido desde la última orden;
si se ha pasado, aplica `0, 0` y levanta la bandera `watchdog`. Cualquier
llamada a `set_motores()` rearma el vigilante y baja la bandera, incluso si la
consigna es `0`. Un cerrojo protege las variables, que las tocan a la vez el
hilo del vigilante y los hilos del servidor. `cerrar()` para el hilo antes de
liberar el hardware.

Consecuencias prácticas:

- **El mando tiene que repetir la orden al menos 2 veces por segundo.** Un
  `POST /control` suelto desde `curl` mueve el rover medio segundo y se para.
  Esa cadencia es justo la razón de ser de `servidor_udp.py`: por HTTP, abrir
  una conexión 10 veces por segundo es un desperdicio.
- Recién arrancado, y antes de recibir la primera orden, la telemetría ya
  muestra `"watchdog": true`. Es correcto: no ha llegado ninguna orden, y el
  rover está parado.
- Latencia de corte medida: **515–563 ms** en 5 repeticiones (el timeout de
  500 ms más, como mucho, un intervalo de sondeo). Nunca corta antes de 500 ms.
- El vigilante no sustituye a una parada de emergencia por hardware. Si el
  programa muere sin pasar por `cerrar()`, los pines del L298 se quedan como
  estaban: eso hay que resolverlo en la Raspberry, no aquí.

## API HTTP

Escucha en `0.0.0.0:5000`.

```
GET  /
GET  /camara
GET  /imu
GET  /gps
GET  /bateria
POST /control
GET  /telemetria
```

| Endpoint | Respuesta |
| --- | --- |
| `GET /` | La interfaz de control (`interfaz.html`). |
| `GET /imu` | Lectura de la IMU: `orientacion`, `aceleracion`, `giroscopio`. |
| `GET /gps` | `lat`, `lon`, `alt`, `fix`. |
| `GET /bateria` | `{"bateria": 100}` |
| `GET /camara` | Vídeo en directo como flujo MJPEG (`multipart/x-mixed-replace; boundary=frame`), 10 fotogramas/s, cada parte con el `Content-Type` que declare `Camara.tipo_mime`. Lo pinta cualquier navegador con `<img src="/camara">`. Si la cámara no da fotogramas responde `{"estado": "camara_no_disponible"}` con 503, y el flujo se cierra si deja de darlos. |
| `GET /telemetria` | Todo agregado: `gps`, `imu`, `bateria`, `control`. |
| `POST /control` | Recibe `{"izquierda": 50, "derecha": 50}`, llama a `rover.mover()` y devuelve el control aplicado. Valida solo que ambos valores estén entre -100 y +100; si no, responde 400. **La orden caduca en 0,5 s**, ver el vigilante. |

El bloque `control` tiene la misma forma en `POST /control` y en
`GET /telemetria`: `{"izquierda": n, "derecha": n, "watchdog": bool}`.

## Interfaz de control

`GET /` sirve `interfaz.html`, una página que se abre desde cualquier
navegador de la misma red (PC, móvil o tablet).

- **Control**: teclas W A S D o flechas, o los mismos botones pulsados con el
  ratón o el dedo. Espacio, o el botón PARAR, para en seco. Mientras hay una
  pulsación se envía `POST /control` cada 150 ms para rearmar el vigilante; al
  soltar se envía un `0, 0` una sola vez. Si la pestaña pierde el foco o se
  oculta, para. Cada dedo se apunta con la tecla que sujeta, así con dos dedos
  a la vez (▲ y ▶) soltar uno no suelta el otro.
- **Mando** (Gamepad API, igual que en el simulador del submarino; prefiere
  el de DJI si hay varios): palanca izquierda a los lados = girar, palanca
  derecha arriba/abajo = adelante y atrás, con potencia proporcional al
  recorrido (a fondo = velocidad base o giro diferencial de los
  deslizadores). Zona muerta del 12 % en el centro; los ejes clavados de
  fábrica se ignoran hasta que se mueven, y la vertical derecha (eje 3, 5 o 4
  según el mando) se detecta sola, entre los ejes que reposan en el centro.
  Mientras la palanca está fuera del centro manda sobre las teclas.
- **Gatillos** del mando: mientras se aprieta, el derecho fija el límite de
  velocidad y el izquierdo el de giro (lo apretado, 0-100 %; también con el
  teclado); al soltarlos vuelven los deslizadores. Con mapeo `standard` son
  los botones 6 y 7; en los mandos genéricos, los ejes que reposan en −1
  (las palancas reposan en 0), izquierdo el de índice más bajo. La línea
  "Mando:" muestra los límites en vigor y si vienen del gatillo o del
  deslizador.
- **Móvil** (ancho ≤ 800 px o alto ≤ 500 px): el visor pasa a ser lo primero,
  a todo el ancho, y los mandos van superpuestos dentro de la imagen como en
  un juego de vehículos: cruceta ▲◀▼▶ abajo a la izquierda, PARAR redondo
  abajo a la derecha, y en las esquinas de arriba la latencia y el estado del
  control (empuje o "parado") con la batería. Son los mismos botones que la
  tarjeta de teclado (mismo `data-tecla`), que en el móvil se oculta; el resto
  de tarjetas queda debajo. La página bloquea el zoom y el menú de pulsación
  larga para que no interfieran con el mando.
- **Mezcla diferencial**: con *velocidad base* `v` y *giro diferencial* `g`,
  avanzar es `v, v`; avanzar girando a la derecha es `v+g, v-g`; parado, la A o
  la D giran sobre el sitio (`-v, v` y `v, -v`). Todo recortado a ±100.
- **Barras de empuje**: muestran lo que devuelve `/telemetria`, no lo que la
  página ha enviado. Es decir, lo que el hardware tiene aplicado de verdad,
  incluido el corte del vigilante, que se señala con una insignia.
- **IMU**: se dibuja como horizonte artificial dentro de una rosa de los
  vientos (SVG en la propia página). La rosa gira `-yaw` y el rumbo se lee bajo
  el índice rojo fijo de arriba; el disco cielo/tierra gira `-roll` y se
  desplaza `pitch` (3,2 px/° en el lienzo de 300 px) con escalera de ±10° y
  ±20°. Convención: yaw crece hacia el este, pitch positivo es morro arriba
  (el horizonte baja), roll positivo es lado derecho abajo (el horizonte sube
  por la derecha). Cuando la IMU sea real habrá que comprobar que sus signos
  coinciden con esta convención.
- **Visor**: una `<img>` conectada a `GET /camara` (4:3). Si el flujo falla o
  se corta (sin cámara, rover apagado, red caída) la imagen se oculta, aparece
  el estado `SIN IMAGEN · sin señal de cámara` y se reintenta cada 3 s.
- **Grabación de vídeo**: se graba y se guarda **en el cliente**, en el
  navegador que accede al rover, nunca en la Raspberry. El botón *Grabar*
  copia la imagen del visor a un lienzo 10 veces por segundo, lo codifica con
  `MediaRecorder` (webm, o mp4 donde no haya webm) y al parar descarga
  `rover-<fecha>.webm`. El rover no almacena vídeo. Sin imagen el botón está
  desactivado.

## Ejecución

```
pip install -r requirements.txt
python main.py
```

Funciona igual en Windows, en WSL y en la Raspberry Pi. Cuando se implemente el
resto del hardware real (`RPi.GPIO`/`gpiozero`, `smbus2`) esa parte solo podrá
probarse en la Raspberry — WSL tampoco tiene GPIO ni bus I2C.

### Cámara en la Raspberry Pi

`camara.py` captura de verdad: busca primero una cámara CSI (Raspberry Pi
Camera Module) con Picamera2 y, si no la hay, una webcam USB con OpenCV. Los
fotogramas se codifican a JPEG (en la Pi 4 con el codificador MJPEG por
hardware) y el servidor los envía como stream MJPEG en `GET /camara`. Al
arrancar, la consola dice qué cámara ha encontrado o por qué no hay ninguna.

Picamera2 y OpenCV se instalan con apt, no con pip:

```
sudo apt install python3-picamera2 python3-opencv
rpicam-hello --list-cameras        # debe listar la cámara CSI
```

Si el rover se ejecuta en un entorno virtual, hay que crearlo con
`python3 -m venv --system-site-packages venv`; sin esa opción el entorno no ve
Picamera2 y no habrá imagen.

### Motores en la Raspberry Pi

`hardware.py` mueve los motores de verdad con `gpiozero`: PWM en ENA/ENB para
la velocidad (|consigna| / 100 como duty) e IN1-IN4 para el sentido; con
consigna 0 queda en rueda libre. Fuera de la Raspberry (sin `gpiozero` o sin
pines) no falla: los motores se simulan y la consola lo indica al arrancar.
`gpiozero` y su librería de pines se instalan con apt
(`sudo apt install python3-gpiozero python3-lgpio`).

## Qué falta

- Acceso real al resto del hardware en `hardware.py` (I2C, serie, ADC de batería).
- Lectura real de la IMU y parseo NMEA del GPS.
- Navegación: `Rover.girar_grados()` y `Rover.ir_a()` están declarados y vacíos.
- Servidor UDP.
