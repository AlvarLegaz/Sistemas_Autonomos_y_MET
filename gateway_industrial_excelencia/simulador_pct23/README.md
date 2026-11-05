# Simulador autónomo de la planta Armfield PCT23

Subproyecto didáctico de `gateway_industrial_excelencia` basado en el **sinóptico HTML de la revisión 17**.

## Abrir

Abre `index.html` (elige entre **modo manual**, **modo automático** y **modo demostración**) en Chrome, Firefox o Edge. El simulador funciona **sin conexión a Internet** y no requiere Raspberry Pi, MQTT, Flask, dependencias ni instalación. También puedes probar el archivo único `pct23_simulador_autonomo.html` incluido en el paquete, si lo has copiado al mismo directorio.

## Uso recomendado

1. Pulsa **Preparar ejemplo** para arrancar N1, N2 y SOL3 y fijar las consignas iniciales; o enciende los equipos pulsando sobre el esquema.
2. Selecciona velocidad de simulación `1×`, `5×` o `20×`.
3. Observa los sensores T1–T5, F1 y L1, la variación de los depósitos A/B, la gráfica y el volumen procesado.
4. Usa SOL2 para escoger el depósito de origen (A o B) **en esta simplificación**, SOL1 para desviar producto, SOL4/SOL5 para rellenar depósitos y SOL3 para activar la refrigeración.
5. El panel **Electroválvulas** replica el del sinóptico real (SOL1-SOL5 en los relés K2-K6). Bajo cada bomba hay un conmutador de sentido de giro (heat unit = OUT05, feed unit = OUT06) y un deslizador de velocidad PWM. Entre las dos bombas está la tarjeta de **Calefacción**: interruptor on/off (OUT04) y potencia de la resistencia (230 V, ráfagas de 50 ciclos: 50 % = 25 ciclos). La resistencia solo calienta si está encendida y su potencia es mayor que 0.
6. **Pausar**, **Parar bombas**, **Parar todo** y **Reiniciar** tienen acciones diferentes. Parar todo no restablece temperaturas ni niveles instantáneamente.

## Modo automático

`index.html` ofrece dos modos. **`automatico.html`** tiene el mismo esquema y ejecuta la secuencia de pasteurización del manual (`manual.html` es el modo manual de siempre):
**arranque → precalentamiento → producción → lavado → parada**.

- **Fases:** arranque, precalentamiento (SOL1 activa: el producto recircula al tanque hasta que T1 queda en la banda 30 s; SOL3 ya abierta), producción (SOL3 abierta; SOL1 desvía en cuanto T1 baja de la consigna menos 2 °C y solo vuelve a la salida normal cuando T1 se mantiene en banda (consigna menos 0,5 °C) 30 s seguidos; sigue hasta agotar el tanque de origen, hasta alcanzar la *producción de referencia* (opcional, nunca mayor que lo que hay en el tanque de origen) o hasta pulsar *Terminar producción*, porque el manual no fija un volumen), lavado (simplificado: 2 min simulados de agua caliente recirculando) y parada (N2 sigue hasta que T2 baja de 45 °C).
- **Modos de regulación del calefactor**, los que cita el manual (operación manual, entradas ON/OFF, lazos simples, cascada y lazos múltiples; ganancias y consignas supuestas): *manual (potencia fija)*, *todo/nada sobre T2*, *lazo simple sobre T2*, *lazo simple sobre T1*, *cascada T1→T2* y *lazos múltiples (T1 y caudal F1)*. Los lazos son PI (sin término derivativo).
- **Alarmas con acción correctiva:** tanque vacío, corte térmico, consigna que el modelo no alcanza. Además hay *Pausar*, *Saltar fase*, *Parada ordenada* y *Emergencia*.
- Los valores por defecto (T1 de 60 °C, T2 de 80 °C, caudal del 50 %) son **supuestos didácticos**: el manual no da consignas. El modelo solo llega a ≈ 62 °C con ese caudal: el producto en circulación le quita calor al agua caliente (T2 baja al aumentar el caudal), un acoplamiento de coeficiente supuesto.

El producto desviado por SOL1 **vuelve al tanque** (como indica el manual): el volumen recirculado se cuenta aparte y el nivel no baja.

## Llenado de los depósitos

En el modo manual hay un panel *Depósitos de alimentación* y en el modo automático dos deslizadores (con la secuencia parada) para fijar el **porcentaje de llenado** de los tanques A y B sobre su capacidad (2400 ml en el modelo). Solo se ajusta con la simulación parada: en marcha el deslizador se bloquea y solo muestra el nivel, que baja con N1 y sube con SOL4/SOL5. El nivel cambia al instante en el esquema, en L1 y en los flotadores HL/LL, y con N1 se consume y con SOL4/SOL5 se repone. En el modo automático y en la demostración, el tanque que no es el de origen empieza **vacío**; al cambiar de origen, el nuevo recibe el llenado del anterior y este se vacía (en el automático puedes volver a llenar el otro con su deslizador). En el modo manual los dos tanques empiezan con su llenado normal.

## Modo demostración

`demostracion.html` es una versión mínima del modo automático: **solo marcas la temperatura** de pasteurización y la planta hace el resto. Elige el mayor caudal de N1 con el que el modelo llega a esa temperatura, regula el calefactor en cascada, produce hasta agotar el tanque que elijas (o hasta pulsar *Terminar producción*), lava y se para sola. Para ajustar todo, usa el modo automático.

## Ayuda

En `manual.html` y `automatico.html`, un **clic derecho** sobre un elemento del esquema (bombas, válvulas, sensores, depósitos, secciones del intercambiador, tuberías) o sobre una tarjeta de control abre una ventana con qué es, qué hace en el simulador, su estado actual y la página del manual de donde sale. Se cierra con la × o Esc. Además, el botón **? Ayuda** de cada pantalla abre una guía que explica todo (esquema, controles, modos, alarmas y qué viene del manual y qué es supuesto). Los textos están en `ayuda.js`.

## Estructura

- `index.html`: pantalla de inicio para elegir modo.
- `manual.html`: modo manual, interfaz y SVG.
- `estilos.css`: estilos originales más los paneles de simulación.
- `modelo.js`: modelo matemático desacoplado; sin API de control de dispositivos.
- `simulador.js`: interacción local, actualización de lecturas y gráfica.
- `automatico.html`, `secuencia.js`, `secuencia_ui.js`: modo automático (la lógica de `secuencia.js` es independiente de la interfaz) y su página.
- `ayuda.js`: ventana de ayuda con clic derecho.
- `pct23_simulador_autonomo.html`: versión opcional de archivo único, generada con los mismos archivos.

## Suposiciones y limitaciones

**Es una simulación cualitativa, no un gemelo digital validado ni un modelo de la Armfield PCT23 calibrado.** Los caudales, capacidades, niveles y tiempos térmicos son orientativos. El motor modela:

- Bomba de producto N1 con velocidad y selección A/B simplificada mediante SOL2; el giro B no tiene flujo hidráulico modelado.
- Bomba N2 y consignas R1/R2 con inercia de la temperatura del depósito caliente.
- Intercambio térmico aproximado entre agua caliente y producto y enfriamiento aproximado condicionado por SOL3.
- SOL4/5 como reposición simulada de A/B, respectivamente; una hipótesis para el aprendizaje.
- SOL1 como desvío del volumen procesado a un contador independiente.
- SOL3 como uso simulado de agua fría hacia desagüe; su estado no demuestra circulación física.
- Sonda T5 conectada a la sección de calentamiento: lee el producto a mitad de camino entre la entrada y T4 (supuesto).
- Sensores de nivel alto/bajo de B y termostato simulados.

V1, V2, V3, PRV1 y los conductos no señalados como motorizados se conservan como **gráficos**, sin control hidráulico activo. No se modelan PID, dinámica de presión, tiempos muertos físicos detallados, cavitación ni pérdidas de carga.

## Pruebas opcionales

Si tienes Node.js instalado puedes verificar el modelo con `node --test tests/modelo.test.js`. El simulador **no necesita Node.js** para ejecutarse.

## Seguridad y relación con el gateway real

El subproyecto es **independiente**: no usa `fetch`, `EventSource`, `WebSocket` ni conexiones a `/api/salidas`, `/api/eventos`, broker o hardware. No sustituyas el fichero de control real `pct23.html` por este `index.html`. Añade la carpeta `simulador_pct23/` al repositorio sin alterar el servicio Flask existente.

> Revisión base: 17 (sinóptico y geometría). Fecha de creación: noviembre de 2026.
