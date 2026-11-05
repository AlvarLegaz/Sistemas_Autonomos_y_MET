# Simulador autónomo de la planta Armfield PCT23

Subproyecto didáctico de `gateway_industrial_excelencia` basado en el **sinóptico HTML de la revisión 17**.

## Abrir

Abre `index.html` en Chrome, Firefox o Edge. El simulador funciona **sin conexión a Internet** y no requiere Raspberry Pi, MQTT, Flask, dependencias ni instalación. También puedes probar el archivo único `pct23_simulador_autonomo.html` incluido en el paquete, si lo has copiado al mismo directorio.

## Uso recomendado

1. Pulsa **Preparar ejemplo** para arrancar N1, N2 y SOL3 y fijar las consignas iniciales; o enciende los equipos pulsando sobre el esquema.
2. Selecciona velocidad de simulación `1×`, `5×` o `20×`.
3. Observa los sensores T1–T5, F1 y L1, la variación de los depósitos A/B, la gráfica y el volumen procesado.
4. Usa SOL2 para escoger el depósito de origen (A o B) **en esta simplificación**, SOL1 para desviar producto, SOL4/SOL5 para rellenar depósitos y SOL3 para activar la refrigeración.
5. El panel **Electroválvulas** replica el del sinóptico real (SOL1-SOL5 en los relés K2-K6). Bajo cada bomba hay un conmutador de sentido de giro (heat unit = OUT05, feed unit = OUT06) y un deslizador de velocidad PWM. Entre las dos bombas está la tarjeta de **Calefacción**: interruptor on/off (OUT04) y potencia de la resistencia (230 V, ráfagas de 50 ciclos: 50 % = 25 ciclos). La resistencia solo calienta si está encendida y su potencia es mayor que 0.
6. **Pausar**, **Parar bombas**, **Parar todo** y **Reiniciar** tienen acciones diferentes. Parar todo no restablece temperaturas ni niveles instantáneamente.

## Estructura

- `index.html`: interfaz y SVG, conservado byte a byte respecto a la revisión 17.
- `estilos.css`: estilos originales más los paneles de simulación.
- `modelo.js`: modelo matemático desacoplado; sin API de control de dispositivos.
- `simulador.js`: interacción local, actualización de lecturas y gráfica.
- `pct23_simulador_autonomo.html`: versión opcional de archivo único, generada con los mismos archivos.

## Suposiciones y limitaciones

**Es una simulación cualitativa, no un gemelo digital validado ni un modelo de la Armfield PCT23 calibrado.** Los caudales, capacidades, niveles y tiempos térmicos son orientativos. El motor modela:

- Bomba de producto N1 con velocidad y selección A/B simplificada mediante SOL2; el giro B no tiene flujo hidráulico modelado.
- Bomba N2 y consignas R1/R2 con inercia de la temperatura del depósito caliente.
- Intercambio térmico aproximado entre agua caliente y producto y enfriamiento aproximado condicionado por SOL3.
- SOL4/5 como reposición simulada de A/B, respectivamente; una hipótesis para el aprendizaje.
- SOL1 como desvío del volumen procesado a un contador independiente.
- SOL3 como uso simulado de agua fría hacia desagüe; su estado no demuestra circulación física.
- Sonda T5 aislada y temperatura igual al ambiente, de acuerdo con el dibujo acordado.
- Sensores de nivel alto/bajo de B y termostato simulados.

V1, V2, V3, PRV1 y los conductos no señalados como motorizados se conservan como **gráficos**, sin control hidráulico activo. No se modelan PID, dinámica de presión, tiempos muertos físicos detallados, cavitación ni pérdidas de carga.

## Pruebas opcionales

Si tienes Node.js instalado puedes verificar el modelo con `node --test tests/modelo.test.js`. El simulador **no necesita Node.js** para ejecutarse.

## Seguridad y relación con el gateway real

El subproyecto es **independiente**: no usa `fetch`, `EventSource`, `WebSocket` ni conexiones a `/api/salidas`, `/api/eventos`, broker o hardware. No sustituyas el fichero de control real `pct23.html` por este `index.html`. Añade la carpeta `simulador_pct23/` al repositorio sin alterar el servicio Flask existente.

> Revisión base: 17 (sinóptico y geometría). Fecha de creación: noviembre de 2026.
