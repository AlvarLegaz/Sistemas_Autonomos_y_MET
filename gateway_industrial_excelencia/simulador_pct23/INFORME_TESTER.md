# Informe del tester: simulador PCT23

> Nota: esta reescritura sustituyó al simulador original, que se retiró del repositorio. El original sigue en el historial de git (último commit con él: `082baf0`).

Comparación frente al original (solo lectura): `C:\Users\alegaz\Desktop\Sistemas_Autonomos_y_MET\gateway_industrial_excelencia\simulador_pct23\`.
No se ha modificado ningún archivo del proyecto. Los escenarios extra están en el scratchpad del tester (ver sección 2).

## Resumen

| Comprobación | Resultado |
|---|---|
| 1. Tests del proyecto (6 archivos, 70 casos) | 70/70 pasan |
| 2. Escenarios extra de equivalencia (46 casos, tolerancia 0) | 46/46 pasan. Mutación de control: 38 fallan al cambiar un solo coeficiente |
| 3. Navegador (index, manual, automático, demostración) | Sin errores de consola. Esquema SCADA pintado en las 4 páginas. Controles responden. Ciclo automático avanza a 20×. Ayuda por clic derecho abre. **Gráfica del automático sin líneas de consigna (confirmado, media: regresión frente al original)** |
| 4. Legibilidad | Sin identificadores de dominio en inglés. Una función de más de 20 líneas. Duplicación de fórmulas térmicas e hidráulicas. Líneas y textos de ayuda muy largos |

## 1. Tests

Node no está en PATH. Se usó el ejecutable de VS Code con `ELECTRON_RUN_AS_NODE=1`:

```
ELECTRON_RUN_AS_NODE=1 "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" --test tests/equivalencia.test.js tests/fases.test.js tests/ids_scada.test.js tests/modelo.test.js tests/regulacion.test.js tests/secuencia.test.js
```

Resultado: `tests 70, pass 70, fail 0`. `ids_scada.test.js` no necesita el original, así que no se omite.

## 2. Equivalencia numérica: escenarios adicionales

Archivo (fuera del proyecto): `C:\Users\alegaz\AppData\Local\Temp\claude\0b7520fe3d3b5931\47535d9b-5218-4bbe-9fb3-888599c2f860\scratchpad\tester_escenarios.test.js`.
Compara en cada segundo: fase, alarma, motivo, eventos (tiempo y texto), tiempos, planta completa (temperaturas, caudales, volúmenes, salidas, giros, consignas de potencia y velocidades, corte y vacío). Tolerancia 0.

Cubre:
- Los 6 modos (`manual`, `onoff`, `T2`, `T1`, `cascada`, `multiple`), con ajustes base y alternos, origen A y B.
- Manual con potencia baja: alarma de precalentamiento.
- Origen B y arranque con tanque A o B casi vacío (150 ml): rechazado con la misma alarma.
- Producción de referencia limitada al contenido del tanque (1760 ml) y terminada por volumen.
- Corte térmico (T2 en 90,99 °C al arrancar), con reconocimiento posterior.
- Parada ordenada, parada de emergencia en arranque y en producción, reconocer, saltar fase, terminar producción a mano.
- Modo demostración a 30, 45, 60, 70, 80, 85 y 999 °C, origen A y B; configuración y secuencia.
- `t1MaximaDemostracion`, `t1Alcanzable` (malla), `t1Estacionaria` (modos y ajustes) y valores por defecto de `CONFIG_BASE`.

Resultado: 46/46 pasan. Mutación de control (`reduccionPorCaudal` 0,25 -> 0,26 en una copia temporal): 38 fallan, así que el arnés detecta diferencias.

Nota de método: dos escenarios no alcanzaban lo que pretendían y se ajustaron (ver hallazgos H3 y H4, que son comportamientos del original, no del nuevo).

## 3. Navegador

Servidor local `python -m http.server 8765` sobre la carpeta de la reescritura. Páginas abiertas en el navegador integrado.

- Consola: sin errores en `index`, `manual`, `automatico` ni `demostracion`.
- Esquema SCADA: 139 nodos SVG en `manual`, `automatico` y `demostracion`.
- Manual: `b-SOL1` y `b-N2` cambian de estado y de etiqueta al pulsarlos.
- Automático: a 20×, el reloj avanza 20 s por segundo real; la fase pasa de Reposo/Arranque a Precalentamiento; la secuencia llega a Finalizada sin alarma (no se observó la fase de producción en directo).
- Clic derecho sobre la resistencia del esquema abre la ventana de ayuda (`ventana-ayuda`).

Aviso conocido, líneas de consigna: **confirmado**. Ver H1.

## 4. Hallazgos

Gravedad: **bloqueante** = impide un uso previsto; **media** = comportamiento incorrecto o engañoso sin impedir el uso; **menor** = estilo o mantenibilidad.

### H1. Gráfica del automático sin líneas de consigna (regresión) — media

- Original: `simulador_pct23\secuencia_ui.js:224-226` dibuja la consigna de T1 (gris, discontinua) y, en `cascada`/`T2`/`onoff`, la de T2 (naranja). La leyenda de `automatico.html` original (línea 194) dice «La línea discontinua es la consigna».
- Nuevo: `js/interfaz/grafica.js:55-69` solo dibuja la rejilla y las tres curvas. No hay `setLineDash` en todo `js/`. La leyenda de `automatico.html:56` ya no menciona la consigna.
- Pero `js/interfaz/ayuda_textos.js:192` sigue diciendo «La línea gris discontinua es la consigna de T1 y la naranja, la de T2».
- Reproducir: abrir `automatico.html`, elegir cualquier modo, iniciar la secuencia. La gráfica muestra solo T1, T2 y T3; la ayuda promete las líneas.

### H2. La alarma de tanque vacío no llega a dispararse en producción — media (heredada del original)

- `js/control/fases.js:69` (controlarProduccion): la fase pasa a lavado cuando el volumen llega a `volumenAgotadoMl` (2 ml por defecto). `fases.js:100` (`estado.vacio`, alarma) necesita volumen < 1 ml, así que nunca se alcanza antes del cambio de fase. En lavado se excluye expresamente.
- Con `volumenAgotadoMl: 0` (no expuesto en la interfaz) tampoco se dispara: la fase cambia en el mismo paso en que el volumen llega a 0.
- Reproducir: tanque A a 300 ml, origen A, producción sin volumen objetivo. Acaba en lavado con «tanque A agotado», sin alarma. Escenario: `tester_escenarios.test.js`, «agotado en produccion».
- Es idéntico en el original. Se reporta porque la alarma existe en la ayuda y en el código pero es inalcanzable en la práctica.

### H3. El corte térmico no se alcanza desde frío con la configuración normal — menor (heredada)

- `js/configuracion/constantes_control.js:38`: `potenciaMaxPct: 90`. Con 90 % la asíntota de T2 es unos 84 °C, muy por debajo de `limiteTermicoC - margenDisparoC` (90,95 °C).
- Con 100 % y sin caudal, T2 tiende a 91 °C pero llega a 90,95 °C solo de forma asintótica; el corte no se observó en 4000 s.
- Reproducir: `modoControl: 'manual'`, `potenciaManualPct: 100`, `potenciaMaxPct: 100`, arranque desde frío: no hay corte. Desde T2 = 90,99 °C sí salta (escenario «Corte térmico» del arnés).
- Igual en el original (`simulador_pct23\modelo.js:8`).

### H4. Aviso de la ayuda y leyenda ya no coinciden (depende de H1) — menor

- `ayuda_textos.js:192` vs `automatico.html` (leyenda sin consigna). Corregir junto con H1.

### H5. Duplicación de fórmulas térmicas e hidráulicas — menor

- Eficiencia `eficienciaIntercambio * (1 - reduccionPorCaudal * v / 100)`: `js/control/alcanzabilidad.js:23` y `:36`, `js/control/regulacion.js:8`, `js/modelo/termica.js:8` (rama con N2) y `:38` (`factorFlujo`).
- Cálculo de `k = factorAcoplamiento(...)` con caudal de la misma forma: `alcanzabilidad.js:24` y `:34`, `regulacion.js:13`, `termica.js:20`.
- Temperatura de agua a partir de la potencia (`ambiente + subidaCalentadorC * pct / 100 / (1 + k)`): `alcanzabilidad.js:13`, `:25`, `:35`, y la inversa en `regulacion.js:14`.
- Propuesta de mejora (no aplicada): una sola función de eficiencia y una sola de agua-potencia en `termica.js`.

### H6. Función de más de 20 líneas — menor

- `js/interfaz/ayuda.js:104` `claveDelElemento` (32 líneas, detección de clic derecho). Es la única función de más de 20 líneas en `js/` (sin contar las envolturas IIFE).

### H7. Líneas y textos muy largos — menor

- `js/interfaz/ayuda_textos.js`: 101 líneas de más de 160 caracteres; la máxima, la 107, tiene 614. Los textos de la ayuda están en una sola línea por entrada.
- `js/control/regulacion.js:42`, `js/control/fases.js:97,101,124`, `js/control/alcanzabilidad.js:22`: más de 160 caracteres.

### H8. Abreviaturas poco claras — menor

- Variables de una letra o casi: `k` (acoplamiento, `termica.js:20`, `regulacion.js:13`, `alcanzabilidad.js:24,34`), `r` (fracción de potencia, `termica.js:15`), `c` (constantes, `termica.js:28`), `i` (índice en `secuencia.js:84`), `t` (temperatura, `alcanzabilidad.js:50`).
- Claves de la interfaz `R`, `N1V`, `N2V` (`js/interfaz/panel_manual.js:14-16`); el texto visible sí lo explica, pero como identificador interno es opaco.
- Identificadores de dominio en inglés: ninguno. Los nombres en inglés que aparecen son de la API del DOM (`getBBox`, `setInterval`), no del dominio.

### H9. Código no exportado pero usado por la interfaz — no es fallo

- `alarmas.reconocer` lo llama `panel_automatico.js:434`. `secuencia.js` no lo reexporta. Funciona, pero conviene saber dónde vive.

## Conclusión

Los tests y la equivalencia numérica son correctos. No se ha encontrado ninguna diferencia de cálculo entre el modelo o la secuencia nuevos y los originales en los escenarios probados. No hay hallazgos bloqueantes. El más relevante es H1, la gráfica sin consignas: está confirmado y es una regresión frente al original (gravedad media). H2 y H3 son limitaciones heredadas del original que conviene documentar.
