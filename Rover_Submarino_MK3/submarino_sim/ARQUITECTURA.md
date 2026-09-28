# Simulador del submarino

Hermano de `rover_sim/`: misma arquitectura, misma forma de trabajar, mismo
puerto. Cambia el vehículo. En vez de un rover con dos ruedas motrices sobre
un terreno hay un submarino con cuatro propulsores dentro del agua, y en vez
de GPS hay un sensor de presión (profundidad) y una ecosonda (distancia al
fondo). Todo lo que dice `rover_sim/ARQUITECTURA.md` sobre vigilante,
interfaz, vista móvil, flujo MJPEG y grabación en el cliente vale aquí igual.

```
pip install -r requirements.txt
python main.py
```

y se abre `http://<ip-del-pc>:5000/`, también desde el móvil. Comparte el
puerto 5000 con el rover y con su simulador: no pueden correr a la vez.

## Qué es igual y qué cambia

| Fichero | Respecto a `rover_sim/` |
| --- | --- |
| `main.py`, `servidor_udp.py` | Iguales salvo el nombre (`Submarino` en vez de `Rover`). El UDP sigue siendo un stub. |
| `hardware.py` | Misma clase `Hardware` y mismo vigilante de 500 ms, pero `set_motores()` recibe **cuatro** consignas: `izquierda, derecha, proa, popa`. |
| `imu.py`, `camara.py` | Mismas clases y métodos. Leen del mundo a través de `self.hardware.mundo`. |
| `profundidad.py` | **Sustituye a `gps.py`.** Clase `Profundidad` con `leer()` → `{"profundidad", "fondo"}`, `profundidad()` y `distancia_fondo()`. |
| `submarino.py` | **Sustituye a `rover.py`** y es donde está la diferencia de fondo: el mando ya no fija los motores directamente, hay un bucle de control a 20 Hz con dos PID (ver abajo). |
| `servidor_web.py` | Mismos endpoints, con `/profundidad` en vez de `/gps`, `vertical` en `POST /control`, un `POST /pid` nuevo y, solo cuando hay mundo simulado, el bloque `mundo` en `/telemetria` y `POST /mundo` (corriente, aros, vista). |
| `interfaz.html` | La del rover más ↑/↓ (subir/bajar), deslizador de velocidad de inmersión, botón del PID, mando por Gamepad API, barras de los cuatro propulsores, perfil de profundidad (columna de agua con superficie, objetivo, submarino y fondo), botón de vista a bordo / desde fuera y la tarjeta "Entrenamiento" (aparece sola cuando la telemetría trae `mundo`). |
| `mundo.py` | Mundo submarino: superficie, fondo con relieve, objetos apoyados en el fondo, cinco aros de entrenamiento, corriente, física de cuatro propulsores, cámara bajo el agua a bordo o de seguimiento. |

## El vehículo

Cuatro propulsores: dos **horizontales** a popa (`izquierda`, `derecha`),
que dan avance y giro exactamente como las ruedas del rover, y dos
**verticales** en la línea de crujía (`proa`, `popa`), que dan profundidad y
cabeceo. Consigna vertical positiva = empuja hacia abajo (sumerge).

Tiene **flotabilidad positiva a propósito**: sobran 0,3 N hacia arriba. Sin
empuje sube despacio (0,10 m/s medido, 32 s desde 3 m). Es la conducta segura
si se pierde el enlace: el vigilante para los cuatro motores y el submarino
vuelve solo a la superficie. Medido en el simulador con corte del mando a
5 m: motores a 0 a los 0,38 s, en superficie a los 52 s.

El propulsor de popa rinde un 15 % menos que el de proa, como pasa con dos
hélices "iguales" de verdad. Es lo que hace necesario el PID de cabeceo:
mandando lo mismo a los dos el casco se inclina (−5,2° bajando a tope).

Los parámetros físicos (`EMPUJE_MAX` 4 N, masas efectivas 7 y 10 kg,
arrastres, inercias, `ADRIZAMIENTO`, `TAU_MOTOR` 0,2 s) están al principio de
`mundo.py` y son **supuestos**: hay que medirlos en el submarino real.
Velocidades resultantes: 1,0 m/s de avance a tope, 0,49 m/s de inmersión a
tope, 63°/s girando sobre el sitio.

## Control (`submarino.py`)

El mando envía tres números por `POST /control`: `izquierda` y `derecha`
(−100..100, van tal cual a los horizontales, como en el rover) y `vertical`
(−100..100, positivo = subir). `vertical` **no** va a los motores: es la
velocidad a la que se mueve la **profundidad objetivo** (a ±100, 0,3 m/s). Un
hilo a 20 Hz (`PERIODO_CONTROL`), que es lo que correrá en la Raspberry, hace
en cada ciclo:

1. Si la última orden tiene más de `WATCHDOG_TIMEOUT`, escribe ceros una vez
   y deja de escribir (el vigilante del hardware lo confirma). Cuando el
   mando vuelve, el objetivo se pone a la profundidad actual y los PID se
   reinician: se retoma donde esté, sin salto.
2. Mueve el objetivo según `vertical`, sin pasar de la superficie ni
   acercarse al fondo más de `MARGEN_FONDO` (0,5 m) según la ecosonda.
3. **PID de profundidad** sobre el sensor de presión → empuje común a los dos
   verticales. La derivada se toma de la propia medida, filtrada
   (`TAU_DERIVADA` 0,4 s), porque no hay sensor de velocidad vertical.
4. **PID de cabeceo** sobre la IMU (objetivo 0°) → se resta a proa y se suma
   a popa. La derivada la da el giróscopo, no se deriva.
5. `set_motores(izquierda, derecha, común − cabeceo, común + cabeceo)`.

La clase `PID` es mínima: derivada sobre la medida (un salto de consigna no da
pico) o externa, integral con anti-windup condicional (no se carga con la
salida saturada) y salida acotada.

Ganancias ajustadas en el simulador con un barrido (escalón 0 → 5 m y rampa
de uso normal): profundidad Kp 150, Ki 30, Kd 100; cabeceo Kp 2, Ki 1, Kd 1,5.
Poca P en cabeceo a propósito: con el retardo de los motores (0,2 s) una P
alta hace oscilar el casco; lo que lo sujeta es la D y la I compensa la
diferencia entre hélices. Medido con ellas:

| Prueba | Resultado |
| --- | --- |
| Escalón 0 → 5 m | sobreimpulso 0,22 m, dentro de ±0,1 m a los 15 s, error final −0,002 m, cabeceo máx. 3,3° (8,0° sin PID de cabeceo) |
| BAJAR al 60 % durante 20 s | objetivo 3,59 m, real 3,60 m, error de seguimiento medio 0,06 m |
| Soltar 15 s | se queda a 3,59 m con cabeceo 0,0° |
| BAJAR a tope 120 s | se detiene a 0,45 m del fondo sin tocarlo |

Con el hardware real habrá que reajustarlas.

### Sin PID (modo manual)

`POST /pid {"activo": false}` (botón "PID activo · desactivar" de la interfaz;
en el móvil, la insignia PID/MANUAL sobre la imagen) desactiva los dos PID.
Entonces `vertical` va **directo** a los dos propulsores verticales (↑ al 60 %
= −60 en proa y popa), nada mantiene la profundidad, sin teclas sube solo por
la flotabilidad y nada le impide llegar al fondo. El vigilante sigue igual.
Mientras está desactivado el objetivo sigue a la profundidad real y los PID
se mantienen a cero, así que al reactivarlo sujeta la que tenga en ese momento
(medido: reactivado subiendo a 2,12 m, se queda en 2,13 m). `control.pid` en
`/telemetria` dice en qué modo está.

### Mando (Gamepad API)

Si el navegador ve un mando (el de DJI por USB, o cualquier otro; hay que
pulsar un botón para que aparezca en `navigator.getGamepads()`), la interfaz
lo lee cada 50 ms con disposición tipo dron (modo 2): **palanca izquierda**
arriba/abajo = subir/bajar e izquierda/derecha = girar; **palanca derecha**
arriba/abajo = adelante/atrás. Todo proporcional al recorrido (zona muerta
0,12) y multiplicado por los mismos deslizadores que las teclas; mientras una
palanca esté fuera del centro manda sobre las teclas, centrada vuelven a
mandar las teclas. Un eje no cuenta hasta que se ha movido al menos 0,3
desde el valor con el que apareció: hay mandos que presentan ejes sin usar
(o gatillos) clavados en −1 o +1 en reposo y, sin ese filtro, el submarino
salía a toda máquina nada más conectarlos y las teclas dejaban de mandar.
La palanca izquierda es los ejes 0/1 y la horizontal de la derecha el 2 en
casi todos los mandos, pero la vertical de la derecha cambia: 3 con mapeo
`standard` (Xbox, PlayStation) y 5 en los genéricos DirectInput que Chrome
en Windows presenta con 10 ejes (cruceta en el eje 9, reposo 3,29). La
interfaz parte de esa regla y, si antes se mueve otro de `EJES_AVANCE`
(3, 5, 4), el avance pasa a ese y se queda ahí. La línea "Mando:" de la
tarjeta enseña el nombre, todos los ejes en vivo, qué eje manda el avance y
qué ejes siguen ignorados por no haberse movido. Si la palanca izquierda
tampoco coincide, cambiar `EJE_GIRO` y `EJE_VERTICAL` al principio del
bloque. Origen (2026-09-27): el mando de DJI del usuario no aparece en el
navegador (no es un joystick USB); con un mando genérico de 10 ejes la
palanca izquierda funcionó y el avance no estaba en el eje 3.
Probado con un mando simulado (sin DJI real a mano): izquierda arriba a tope
+ derecha a la mitad → `{izquierda 30, derecha 30, vertical 60}`; izquierda
a la derecha → 60/−60; ejes dentro de la zona muerta → 0.

## API HTTP

| Endpoint | Qué devuelve |
| --- | --- |
| `GET /` | `interfaz.html` |
| `GET /imu` | `{orientacion, aceleracion, giroscopio}` como en el rover |
| `GET /profundidad` | `{"profundidad": m, "fondo": m o null}` |
| `GET /bateria` | `{"bateria": %}` |
| `GET /camara` | flujo MJPEG (503 si no hay fotograma) |
| `GET /three.min.js` | copia local de Three.js, para el visor 3D del simulador |
| `GET /telemetria` | `{profundidad, imu, bateria, control}`; `control` = consigna de los cuatro motores, `watchdog`, `objetivo` y `pid`. Solo en el simulador lleva además `mundo` = `{corriente: {nivel, velocidad, rumbo}, aros: {total, pasados, siguiente, lista}, vista}` |
| `POST /control` | `{"izquierda", "derecha", "vertical"}` en −100..100; 400 si falta algo o se sale. Caduca a los 0,5 s: hay que repetirla, también con todo a 0, o el submarino sube |
| `POST /pid` | `{"activo": true/false}`; 400 si no es booleano. Devuelve el bloque `control` |
| `POST /mundo` | Solo simulador (404 en el real). `{"corriente": "ninguno"/"poco"/"mucho"}`, `{"reiniciar_aros": true}` y/o `{"vista": "primera"/"tercera"}`; 400 si el valor no existe. Devuelve el bloque `mundo` |

La interfaz no sabe si habla con el simulador o con el submarino real: si la
telemetría trae `mundo`, enseña la tarjeta de entrenamiento y el botón de
vista; si no, los deja ocultos. `submarino.py` no toca el mundo; el bloque lo
añade `servidor_web.py` mirando si `hardware` tiene `.mundo`.

## El mundo (`mundo.py`)

- **Superficie** en z = 0 y **fondo** a 12 m de media con relieve suave
  (±2,5 m, las mismas tres ondas que el terreno del rover). El mundo es el
  cuadrado de ±25 m.
- **Objetos**, apoyados en el fondo, más grandes que los del rover para
  verlos con poca visibilidad:

  | Objeto | Posición (x este, y norte) | Radio |
  | --- | --- | --- |
  | cubo rojo | (0, 4) — delante al arrancar | 0,6 m |
  | pelota azul | (5, 6) | 0,7 m |
  | cubo amarillo | (−6, 2) | 0,6 m |
  | pelota verde | (3, −5) | 0,5 m |

- **Submarino**: arranca en (0, 0) en la superficie mirando al norte. El
  casco se trata como una esfera de 0,25 m.

### Entrenamiento: aros y corriente

- **Cinco aros** verticales de 1 m de radio (tubo de 0,12 m), del rojo al
  azul, cada uno 2 m más hondo que el anterior y a 6–7 m del anterior (se
  ven con los 9 m de visibilidad). `rumbo` es la dirección en la que se
  atraviesa (perpendicular al plano del aro). Ninguno queda a menos de 0,3 m
  del fondo (se recorta al cargar el módulo).

  | Aro | Posición (x, y) | Profundidad | Rumbo |
  | --- | --- | --- | --- |
  | rojo | (0, 7) — 7 m al norte del arranque | 2 m | 0° |
  | naranja | (5, 12) | 4 m | 45° |
  | amarillo | (11, 13) | 6 m | 90° |
  | verde | (14, 7) | 8 m | 160° |
  | azul | (10, 1) | 10 m | 225° |

  En cada paso de física se mira si el submarino ha cruzado el plano de un
  aro. Si el casco entero cabe por el hueco (distancia al centro + 0,25 m <
  0,88 m) el aro cuenta como pasado, en cualquier sentido y una sola vez;
  si toca el tubo es colisión (`"aro rojo"`, frena como un objeto); más
  lejos, nada. `POST /mundo {"reiniciar_aros": true}` vuelve a contar.
  Medido: cruce centrado cuenta, 0,9 m desviado choca, 1,6 m pasa de largo.
- **Corriente**: tres niveles, `ninguno` 0, `poco` 0,25 m/s y `mucho`
  0,6 m/s (el submarino avanza a 1,0 m/s a tope, así que con "mucho" hay
  que corregir unos 37° para ir recto de través). Al fijar el nivel el rumbo
  se sortea al azar; después la velocidad oscila ±20 % con periodo de 13 s
  y el rumbo ±25° con periodo de 20 s, para que no se pueda compensar con
  un ángulo fijo. Como `u` y `w` son velocidades respecto al agua, la
  corriente solo desplaza la posición; el arrastre no cambia. Medido: a la
  deriva sin empuje con "mucho", 0,59 m/s de media en 20 s.

### Visor 3D en el navegador (solo simulador)

En el simulador el visor es siempre el 3D: renderiza la misma escena con
WebGL/Three.js (vendido en `three.min.js`, servido por `/three.min.js`, sin
CDN) en vez de mostrar el MJPEG. En cuanto llega el primer bloque `mundo` y la
escena se construye, `activar3D` pasa al canvas y corta el flujo `/camara`
(quitando el atributo `src` del `<img>`, que no dispara `error`), con lo que
el servidor deja de calcular fotogramas en Python. No hay botón para volver a
la cámara (pedido 2026-09-27: "que solo se vea en 3D, la otra cámara es muy
fea"); si `three.min.js` no carga o no hay WebGL, la cámara sigue como en el
real. `/camara` y el trazador de `mundo.py` se conservan porque con hardware
real `/camara` es la cámara de verdad. Todo en `interfaz.html`, sin módulos
nuevos:

- La telemetría manda un bloque `escena` (colores, límite, FOV, medidas de
  aros/paredes, `luz_superficie`...) una vez por sondeo; `construirEscena3D`
  usa ese bloque para levantar la escena (terreno con el mismo relieve que
  `fondo()`, paredes en damero, aros, objetos y el modelo del submarino) la
  primera vez que se activa el botón, y ya no se reconstruye: cada fotograma
  (`bucle3D`, por `requestAnimationFrame`) solo actualiza pose, niebla y
  color de agua interpolando entre los dos últimos sondeos.
- Coordenadas: `w2t(x, y, z) = (x, -z, -y)` pasa del mundo (este, norte,
  profundidad hacia abajo) a Three.js (Y arriba, -Z al frente). La terna del
  mundo es zurda como sistema físico y Three es diestro, así que el mapeo lleva
  un espejo a propósito: con `(x, -z, y)` la escena salía en espejo respecto a
  la cámara de `mundo.py` (el este a la izquierda) y la orientación del
  submarino no era una rotación válida (aparecía de perfil y no seguía el
  rumbo). Ante cualquier duda, comparar el visor 3D con la cámara en la misma
  pose: deben coincidir lado a lado.
- El brillo de la superficie del agua (no hay "cielo" real en `mundo.py`, es
  agua hasta el fondo) se aproxima con una malla ancha en z=0 que la niebla
  ya atenúa con la distancia — no es igual de exacto que el fundido
  exponencial de `_renderizar`, pero visualmente cumple.
- **Decorado** (pedido 2026-09-27: "el mundo mucho más vistoso y el modelo
  del submarino también pero manteniendo estructura"): todo sigue en
  `interfaz.html`, sin ficheros nuevos ni cambios en la API ni en `mundo.py`.
  Solo aspecto: luz hemisférica + sol + rebote desde abajo (para que la
  superficie, vista por debajo, tenga sombreado); terreno con grano y dos
  capas de cáusticas que se deslizan; superficie ondulada (vértices
  recalculados cada fotograma) con dibujo de ondas y reflejo; rayos de sol
  (planos aditivos que siguen a la cámara, atenuados a mano por distancia y
  profundidad porque con mezcla aditiva la niebla del motor sumaría su
  color); "nieve marina" (700 puntos envueltos alrededor de la cámara);
  burbujas que salen de cada propulsor a ritmo de su consigna real
  (`control.izquierda/derecha/proa/popa`); rocas y algas colocadas con un
  generador de semilla fija (`azarFijo`), lejos de aros, objetos y punto de
  salida; aros con luz propia, el siguiente late. El modelo del submarino
  (`construirSub`) toma centro y semiejes de cada pieza de `MODELO_SUB` y
  sobre esas medidas pone casco brillante con franjas, cúpula transparente
  con lente, bastidor, patines, cuatro propulsores con carcasa y hélice que
  gira con la consigna, y dos faros con foco real (`SpotLight`) que alumbran
  también a bordo (se ocultan las mallas, no los focos). Nada de esto existe
  en la física ni en la cámara MJPEG: rocas y algas se atraviesan. Paredes
  en Lambert, no Phong: con especular los faros pintaban un manchón blanco.
- Three.js vendido es la **r128** (API vieja: `outputEncoding`, luces sin
  unidades físicas); se deja la codificación de color por defecto para que
  los colores de `mundo.py` se vean tal cual.
- `construirEscena3D` entero va en un único try/catch que hace
  `console.error` y devuelve `null` si falla algo (antes solo protegía la
  línea de `WebGLRenderer`; un fallo en cualquier otra parte —terreno,
  paredes, aros...— se perdía en silencio dentro del catch de `sondear()`,
  que no logea nada). Con un fallo real, el botón se queda sin activar y no
  hay pista alguna sin este cambio.
- Medido 2026-09-27: 60 fps constantes en ambas vistas (a bordo y desde
  fuera), sin caída de rendimiento; con el decorado, 0,70 ms por fotograma a
  bordo y 0,75 desde fuera a 545×408 (120 llamadas a `bucle3D()` seguidas de
  `gl.finish()`, en RTX 5090), muy por debajo de los 16,7 ms de 60 fps. En
  un móvil/iPad no está medido. Grabación en 3D usa
  `renderer.domElement.captureStream(10)` directamente (no hace falta el
  lienzo intermedio que sí usa el MJPEG).
- **Ojo con `interfaz.html` vs. `mundo.py`**: Flask sirve `interfaz.html` con
  `send_from_directory` (se lee del disco en cada petición, cambios se ven
  al recargar la página); pero `mundo.py` se importa una vez al arrancar
  (`debug=False`, sin autoreload), así que **tras tocar `mundo.py` hay que
  reiniciar el proceso** o la interfaz sigue viendo el bloque `escena`
  viejo. Un cambio de `mundo.py` sin reiniciar el servidor fue la causa real
  de que el botón de 3D pareciera no hacer nada, con cero errores visibles
  (la excepción quedaba dentro del catch mudo de arriba).

### Física

Hilo propio a 50 Hz, igual que en el rover. Por paso:

- **Propulsores**: consigna → empuje en N con retardo de primer orden de
  0,2 s; sin batería no hay empuje; popa al 85 %.
- **Avance** a lo largo del cuerpo con arrastre cuadrático; **guiñada** por la
  diferencia de los horizontales; **vertical** por la suma de los verticales
  contra la flotabilidad y el arrastre; **cabeceo** por la diferencia
  proa − popa, con par adrizante (el centro de flotación sobre el de
  gravedad devuelve el casco a horizontal) y arrastre. El roll se queda en 0
  (no hay propulsores laterales).
- Con el morro inclinado, parte del avance se convierte en vertical.
- **Colisión** con un objeto solo si el casco está a su altura y se acerca;
  si va por encima, pasa. Contra el límite del mundo, igual. Al chocar la
  velocidad de avance pasa a 0 (la IMU nota el frenazo). No sube de la
  superficie, no baja del fondo (`colision = "fondo"`) y se apoya encima de
  un objeto si cae sobre él.
- **Batería** como en el rover, repartida entre los cuatro (40 min a tope).

### Sensores

- **IMU**: misma forma y mismos signos que en el rover. El acelerómetro lleva
  la gravedad según pitch/roll y la aceleración vertical; el giróscopo y da
  la velocidad de cabeceo cambiada de signo (es la que usa el PID), z la de
  guiñada con sesgo fijo de 0,3°/s.
- **Presión**: profundidad con ruido de 1 cm.
- **Ecosonda**: distancia al fondo bajo el submarino, un ping cada 0,2 s
  (5 Hz), ruido de 5 cm, `null` si el fondo está a más de 30 m.
- **Cámara**: 320×240, 70° de campo, solidaria al cuerpo. Se ve agua turquesa
  de piscina de pruebas (más clara cerca de la superficie, más oscura al
  fondo), el brillo de la superficie al mirar hacia arriba (con un borde
  marcado: casi todo dentro de `VISIBILIDAD` metros del rayo hasta la
  superficie y casi nada más allá, `AGUDEZA_SUPERFICIE`), el suelo en baldosa
  clara con junta oscura (con sombreado según la pendiente) y niebla con la
  distancia (`VISIBILIDAD` 9 m), los objetos con sombra y los aros (los
  pasados, en gris). Los aros y el modelo del submarino se dibujan píxel a
  píxel con test de profundidad contra el fondo y los objetos, así un aro
  puede rodear la cámara o al submarino. Medido: 16 ms por fotograma a bordo,
  28 ms desde fuera.
  - El suelo se dibuja lanzando un rayo por columna y muestreándolo a
    `MUESTRAS` (200) distancias crecientes en logaritmo hasta `DIST_MAX`
    (40 m); pasados unos pocos metros la separación entre muestras supera el
    ancho de la línea (0,045 m) o incluso el de un parche entero (1 m), y el
    damero dejaba de verse como rejilla para verse como ruido de estática
    (pedido 2026-09-27, "eso es normal?" sobre una captura con mucho ruido).
    Arreglado con un fundido tipo mipmap: `AA_JUNTA` y `AA_LOSETA` (en
    `mundo.py`, precalculados una vez a partir de `_PASO_MUESTRA`, la
    separación aproximada entre muestras consecutivas) funden la línea y el
    parche hacia `TIERRA_MEDIA` (el color medio) en cuanto la separación
    entre muestras deja de poder resolver el detalle; la línea se funde antes
    (0,09–0,36 m de separación) que el parche entero (0,35–1,0 m) por ser
    más fina. Las paredes (`_pared()`) no lo necesitan: calculan el patrón a
    resolución nativa por columna, no por muestreo a lo largo del rayo.
    Probado con vistas mirando hacia abajo, rasante y de cerca: sin ruido y
    sin regresión de rendimiento (~24-35 ms/fotograma, igual que antes).
  - **El fondo es color tierra y las paredes color piscina** (pedido
    2026-09-27: "que el suelo del fondo sea color tierra aunque los laterales
    sean de piscina"): el suelo (`TIERRA_A`/`TIERRA_B`, damero, con línea de
    surco `SURCO` en vez de junta) ya no comparte color con las paredes
    (`PARED_A`/`PARED_B` con junta `JUNTA`, sin cambios) ni con la baldosa
    clara que tenían ambos antes de este pedido. Solo cambia el color y la
    línea del suelo; la mecánica de fundido anti-aliasing (`AA_JUNTA`/
    `AA_LOSETA`) es la misma. Probado de cerca junto al fondo real (sin
    niebla de por medio) y a media distancia: damero tierra con surco oscuro,
    transición correcta a la niebla azulada del agua.
- **Paredes de la piscina** (pedido 2026-09-27: "que parezca que está en una
  piscina de pruebas... para delimitar bien los contornos"): las cuatro caras
  verticales del cuadrado `x, y = ±25 m` (el mismo `LIMITE` que ya paraba al
  submarino; ni el terreno ni el límite físico cambian, solo lo que se ve) se
  dibujan como baldosa con junta, igual que el suelo pero algo más clara
  (`PARED_A`/`PARED_B`). Por columna de la imagen se calcula con cuál de las
  cuatro se cruza el rayo (la más cercana según su dirección) y se recorta en
  vertical desde la superficie hasta el suelo real de ese punto, con test de
  profundidad para no tapar el suelo, los objetos ni los aros que estén antes.
  Antes de este cambio el límite era invisible: el suelo seguía en gris liso
  hasta donde alcanzara la vista aunque la física ya parase ahí. Función
  `_pared()` en `mundo.py`. Probado con imágenes de prueba: pared de frente,
  pared vista de lejos, esquina (dos paredes a la vez, perspectiva correcta)
  y en vista desde fuera junto al submarino, sin regresión en aros ni objetos.
- **Vista desde fuera** (`vista = "tercera"`, botón junto a Grabar y la
  insignia "A BORDO / DESDE FUERA" en el móvil): la cámara se coloca 2,5 m
  detrás y 0,9 m por encima del submarino, mirando a él (sin salir del agua
  ni meterse en la arena), y se dibuja el modelo `MODELO_SUB`: siete
  elipsoides en ejes del cuerpo (casco amarillo tipo torpedo de 0,9 m,
  morro oscuro con la cámara, dos propulsores horizontales a popa y dos
  verticales sobre el casco), orientados con yaw, pitch y roll y sombreados
  con la normal. La forma es supuesta: cuando exista el submarino real, ajustar
  las medidas y colores en `MODELO_SUB`. La IMU, la presión y el resto no
  cambian: la vista solo afecta a `/camara`.

## Qué falta

- Hardware real: ESC de los cuatro propulsores, sensor de presión por I2C,
  ecosonda por serie, Picamera2. Medir los parámetros físicos y reajustar los
  PID.
- Mantener rumbo (PID de guiñada sobre la IMU) y `girar_grados()`.
- Servidor UDP, igual que en el rover.
