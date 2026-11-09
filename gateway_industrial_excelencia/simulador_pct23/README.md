# Simulador de la planta PCT23

Gemelo digital de la planta de pasteurización Armfield PCT23, para aprender cómo funciona el proceso.
Es una simulación aproximada: los valores no son los del fabricante.

## Cómo abrirlo

1. Descarga o copia la carpeta completa.
2. Haz doble clic en `index.html`. Se abre en el navegador (Chrome, Firefox o Edge).
3. Elige un modo:
   - **Manual**: tú accionas bombas, válvulas y la resistencia.
   - **Automático**: la planta ejecuta la secuencia de pasteurización; tú eliges la configuración.
   - **Demostración**: solo eliges la temperatura; la planta decide el resto (regulación en cascada). Si lo prefieres, el selector **Regulación** permite elegir *Todo o nada sobre T2* y ajustar la histéresis de T2, su consigna y el caudal de N1.
4. Pulsa el botón **? Ayuda** para leer la guía de cada pantalla, o haz **clic derecho** (o mantén pulsado 3 s en pantallas táctiles) sobre
   cualquier elemento del esquema para saber qué es.

No necesita instalación ni conexión a Internet.

## Cómo ejecutar los tests

Hace falta tener Node.js (versión 18 o superior). Desde la carpeta del simulador:

```
node --test
```

Los tests comprueban el modelo, los lazos de regulación, las fases y la secuencia.
`equivalencia.test.js` compara el cálculo con la versión original y necesita la carpeta original;
`ids_scada.test.js` se omite si no la encuentra.

## Estructura de carpetas

```
index.html, manual.html, automatico.html, demostracion.html   pantallas
css/          estilos
img/          logotipo e icono
js/           código del simulador (ver abajo)
tests/        pruebas automáticas
DISENO.md     documento de diseño interno
```

## Qué hace cada archivo

**js/configuracion**
- `constantes_fisicas.js`: medidas y constantes de la planta (volúmenes, caudales, tiempos térmicos).
- `constantes_control.js`: ajustes por defecto, modos de regulación, fases y textos de las fases.

**js/utilidades**
- `modulos.js`: crea el espacio común `PCT` donde se guardan los demás módulos.
- `matematicas.js`: funciones de límites y de aproximación exponencial.

**js/modelo** (física de la planta, sin pantalla)
- `estado_planta.js`: crea el estado inicial y ajusta los depósitos.
- `termica.js`: temperaturas del agua caliente, del termostato y del producto.
- `hidraulica.js`: caudales de producto, de agua fría y niveles de los depósitos.
- `planta.js`: avanza la simulación y calcula las lecturas de los sensores.

**js/control** (secuencia y regulación, sin pantalla)
- `alarmas.js`: dispara y reconoce alarmas, y cambia de fase.
- `regulacion.js`: lazos de control del calefactor y de la bomba N1.
- `alcanzabilidad.js`: calcula si una temperatura es posible con la configuración elegida.
- `fases.js`: qué hace la planta en cada fase (arranque, precalentamiento, producción, lavado, parada).
- `secuencia.js`: inicia, para, termina y avanza la secuencia.

**js/interfaz** (pantalla)
- `dom.js`: funciones pequeñas para leer y escribir en la página y dar formato a los números.
- `registro_eventos.js`: escribe las líneas del registro de eventos.
- `grafica.js`: dibuja la gráfica de temperaturas (pestaña Gráficas).
- `grafica_activaciones.js`: potencia de la resistencia y cronograma de bombas y electroválvulas, con el mismo eje de tiempo.
- `barra_operacion.js`: botones de velocidad, menú «Más» y pestañas.
- `bucle.js`: temporizador que hace avanzar la simulación.
- `ayuda_textos.js`: textos de la ayuda (solo datos).
- `ayuda.js`: ventana de ayuda por clic derecho o pulsación larga y guía de cada pantalla.
- `pulsacion_larga.js`: temporizador de pulsación larga (3 s) para pantallas táctiles.
- `panel_manual.js`: controles y lecturas del modo manual.
- `panel_automatico.js`: ajustes, lecturas y pista de fases de los modos automático y demostración.
- `pagina_manual.js`, `pagina_automatico.js`, `pagina_demostracion.js`: arrancan cada pantalla.

**js/interfaz/scada** (esquema de la planta)
- `canvas.js`: construye el dibujo SVG a partir de una descripción.
- `objeto_scada.js`, `scada_widget.js`: base de los elementos del esquema y su actualización.
- `bomba.js`, `valvula.js`, `sensor.js`, `deposito.js`, `resistencia.js`, `tuberia.js`, `etiqueta.js`: cada elemento del dibujo.
- `controles_scada.js`: deslizador y botón que se dibujan dentro del esquema (solo modo manual).
- `esquema_pct23.js`: describe el esquema completo de la planta.

**tests**
- `modelo.test.js`, `regulacion.test.js`, `fases.test.js`, `secuencia.test.js`: comprueban la lógica.
- `equivalencia.test.js`: compara con la versión original (necesita su carpeta).
- `ids_scada.test.js`: comprueba que el esquema tiene los mismos identificadores que el original.

## Aviso

Es una herramienta de aprendizaje. No está conectada a ningún equipo real.
