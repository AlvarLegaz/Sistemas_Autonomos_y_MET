# Gemelo digital del rover (simulador)

Copia del proyecto `rover/` en la que el mundo físico se sustituye por un
mundo simulado. Sirve para que los alumnos aprendan a manejar el rover desde
el navegador (misma URL, misma interfaz, misma API) antes de tocar el real.

La idea de diseño es una sola: **el simulador tiene la misma arquitectura que
el rover**, fichero a fichero y clase a clase, y lo único que cambia es qué
hay debajo de `Hardware`, `IMU`, `GPS` y `Camara`. En el rover real debajo hay
GPIO, I2C, UART y una cámara; aquí hay `mundo.py`.

## Qué es igual y qué cambia

| Fichero | Respecto a `rover/` |
| --- | --- |
| `main.py`, `rover.py`, `servidor_web.py`, `servidor_udp.py`, `interfaz.html` | **Idénticos**, copiados tal cual. Si se cambian en un sitio hay que copiarlos al otro. |
| `hardware.py` | Misma clase `Hardware`, mismos métodos y mismo vigilante de 500 ms. Crea el `Mundo`, `set_motores()` le pasa la consigna y `leer_bateria()` se la pide. |
| `imu.py`, `gps.py`, `camara.py` | Mismas clases y métodos. Leen del mundo a través de `self.hardware.mundo`, igual que en el real leerán del bus a través de `self.hardware`. |
| `mundo.py` | **Nuevo, y el único fichero nuevo.** Una sola clase `Mundo`: terreno, objetos, física, batería, sensores y cámara. |
| `requirements.txt` | `flask`, `flask-sock` (WebSocket de control) y `numpy` (numpy solo para dibujar la cámara). |

Todo lo demás (API HTTP, vigilante, forma de la telemetría, interfaz, vista
móvil, grabación en el cliente) está descrito en `rover/ARQUITECTURA.md` y se
aplica igual aquí. Se arranca igual:

```
pip install -r requirements.txt
python main.py
```

y se abre `http://<ip-del-pc>:5000/`, también desde el móvil de la misma red.
Como usa el mismo puerto 5000, no puede correr a la vez que el rover real en
la misma máquina.

## El mundo (`mundo.py`)

Primer mundo, deliberadamente simple:

- **Terreno**: baldosas de 1 m (dos tonos de tierra) sobre un **relieve
  suave**: la altura es una suma de tres ondas (`altura(x, y)` en `mundo.py`,
  entre −0,8 y +0,9 m) con pendientes de 5° de media y 11° como mucho, medidas
  sobre 20 000 puntos. Está puesto para que pitch y roll cambien al moverse y
  el horizonte artificial de la interfaz tenga algo que enseñar. Cielo
  degradado y una **silueta de montañas lejanas fija** que no se acerca nunca:
  sirve para saber hacia dónde se mira. Fuera del cuadrado de ±25 m el suelo
  se ve gris y el rover no puede salir.
- **Objetos**: cuatro, con los que el rover choca y no avanza.

  | Objeto | Posición (x este, y norte) | Radio |
  | --- | --- | --- |
  | cubo rojo | (0, 4) — justo delante al arrancar | 0,4 m |
  | pelota azul | (5, 6) | 0,5 m |
  | cubo amarillo | (−6, 2) | 0,4 m |
  | pelota verde | (3, −5) | 0,35 m |

- **Rover**: arranca en (0, 0) mirando al norte. Se trata como un círculo de
  0,20 m de radio.

### Física

Hilo propio a 50 Hz (`PASO = 0,02 s`), independiente del servidor web, igual
que el mundo real sigue aunque nadie pregunte.

- **Motores**: la consigna −100..100 de cada lado se convierte en velocidad
  objetivo (100 = 1 m/s) y la velocidad real la sigue con un retardo de primer
  orden de 0,3 s: al soltar no se para en seco, y al arrancar tarda en coger
  velocidad. Sin batería no hay empuje.
- **Cinemática diferencial**: velocidad `v = (vI + vD)/2`, giro
  `w = (vI − vD)/0,40 m`. Izquierda más rápida que derecha gira a la derecha,
  que es lo que hace la mezcla de la interfaz.
- **Actitud**: el rover se apoya en el terreno, así que su pitch es la
  pendiente del suelo hacia delante (cuesta arriba, morro arriba, positivo) y
  su roll la pendiente hacia el lado (terreno más bajo a la derecha, roll
  positivo). Es la misma convención que dibuja el horizonte artificial. La
  pendiente no frena ni acelera el rover (primera versión).
- **Colisión**: si la nueva posición se mete en un objeto (distancia entre
  centros menor que la suma de radios) y además se acerca, el rover no se
  desplaza; puede seguir girando y puede alejarse marcha atrás. Igual con el
  límite del mundo. Al chocar la velocidad real pasa a 0 y la IMU nota el
  frenazo. La colisión no sale por HTTP: el alumno la ve en la cámara y en
  que el GPS no avanza, como en el rover real. `Mundo.estado()` la expone
  sin ruido solo para pruebas.
- **Batería**: 100 % al arrancar, se gasta en proporción a la potencia
  pedida; a plena potencia dura 40 min. A 0 % los motores dejan de empujar.
  Se reinicia reiniciando el programa (no hay endpoint de reset a propósito:
  el rover real tampoco lo tiene).

### Sensores

Devuelven la misma forma que los del rover real, con ruido para que no sean
"demasiado perfectos":

- **IMU**: `orientacion` con yaw de brújula (0 norte, 90 este) y el pitch y
  roll que impone el terreno, los tres con ruido de 0,3°. `aceleracion` es lo
  que mide un acelerómetro, en ejes del cuerpo (x adelante, y izquierda, z
  arriba): x la aceleración real más la componente de la gravedad al estar
  inclinado (`g·sin(pitch)`), y la centrípeta al girar más `g·sin(roll)`, z
  `g·cos(pitch)·cos(roll)`, de modo que en reposo el módulo vale 9,81 aunque
  esté en cuesta. `giroscopio` con regla de la mano derecha: x es la velocidad
  de roll, y la de pitch cambiada de signo, z positiva girando a la
  izquierda; ruido de 0,5°/s y en z un sesgo fijo de 0,3°/s, como un
  giróscopo barato. Cuando exista la IMU real hay que comprobar que sus
  signos coinciden con estos.
- **GPS**: origen en **Cartagena** (37,600 N, −0,983 E, 10 m; la altitud suma
  la del terreno). Una lectura por
  segundo, error gaussiano de 1,5 m, sin `fix` los primeros 5 s (lat/lon a 0,
  como un receptor real arrancando). `velocidad()` es la real más ruido;
  `rumbo()` es el rumbo del movimiento y parado conserva el último.
- **Cámara**: 320×240, campo de visión 70°, a 0,25 m del suelo y solidaria
  al cuerpo: con el morro arriba el horizonte baja en la imagen y con el
  lado derecho abajo el horizonte sube por la derecha, igual que en el
  horizonte artificial. Se dibuja con numpy: cielo y montañas respecto a la
  línea de horizonte inclinada; el terreno lanzando un rayo por columna,
  muestreándolo a 220 distancias entre 0,25 y 80 m y quedándose en cada
  píxel con la muestra más cercana que lo cubre (así una loma tapa lo que hay
  detrás), con sombreado según la pendiente para que las lomas se vean;
  encima los objetos apoyados en el terreno, de lejos a cerca, con sombra
  (no se ocultan tras las lomas: son bajas). Se codifica en PNG con la
  librería estándar; medido, 13 ms por fotograma en un PC normal. Se renderiza
  como mucho 10 veces por segundo y se cachea; `Camara.tipo_mime` es
  `image/png` (la real dará `image/jpeg`, el servidor lo pone en cada parte
  del flujo y no le importa).

## Qué falta

- Que la pendiente afecte al movimiento (frenar cuesta arriba, deslizar
  cuesta abajo), y más objetos o un circuito.
- Un modo "reiniciar mundo" sin reiniciar el programa, si en clase resulta
  molesto.
- Servidor UDP, igual que en el real.
