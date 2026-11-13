# Plan: núcleo común de los simuladores

Objetivo: que la **planta real HTST** y la **instalación fotovoltaica** compartan **un mismo contrato de simulación**, **una definición de escenarios como datos** y **un mismo formato de eventos de aprendizaje**, para que el aula, los retos, los instrumentos y el modo Diagnóstico sirvan a los dos sin reescribirlos. La maqueta PCT23 y el UxS Trainer quedan fuera por ahora; el contrato se escribe para que puedan entrar después.

Patrón: **núcleo sin pantalla con paso fijo y determinista + puertos y adaptadores**. El núcleo no sabe nada de SVG, three.js ni del aula; sinóptico, 3D, pruebas, diagnóstico y aula son adaptadores que lo llaman.

## 1. Punto de partida (lo que hay hoy)

| | Fotovoltaica | Planta real |
|---|---|---|
| Creación | `PCT.fv.crearSimulacion({ semilla, … })` | `PCT.htst.crearSimulacion()` |
| Estado | `sim.estado` (objeto vivo) | `sim.estado()` (función) |
| Órdenes | `sim.ordenes.protecciones.abrir(tag)`… (funciones) | `sim.ordenes` (funciones) |
| Medidas | `sim.medir(a, b)`, `sim.puntos`, instrumentos | `sim.medidas.medir(instrumento, a, b, modo)` |
| Averías | Catálogo con firmas de diagnóstico | Catálogo y motor, sin firmas |
| Azar | Ninguno en el modelo (`Math.random` no aparece) | Ninguno |

Los dos ya separan modelo y vista y ninguno usa azar sin semilla: el cambio es de **contrato**, no de reescritura.

## 2. El contrato (cerrado: versión 1)

**El texto que manda es `comun/CONTRATO.md`; los tipos y las listas cerradas, `comun/tipos.js`.** Resumen:

- **Fábricas:** `simulador_fotovoltaica/js/modelo/contrato_fv.js` y `simulador_planta_real/js/modelo/contrato_htst.js` exportan `{ id, crearSimulacion }` y se registran con `PCT.contrato.registrar(id, fabrica)`. Las fábricas antiguas (`PCT.fv.crearSimulacion`, `PCT.htst.crearSimulacion`) no cambian; `sim.antigua()` da la API vieja por encima de `ejecutar` mientras la interfaz migra.
- **`Simulacion`:** `avanzar(dt)` con acumulador y paso fijo (FV 2 s, HTST 0,1 s), `avanzarPasos(n)`, `tiempo()`, `estado()` congelado en profundidad, `ejecutar(orden)` como única vía de cambio, `ordenesDisponibles()` (con un ejemplo por orden), `puntos()`/`medir()` (no cambian nada), `averias.catalogo()/activas()`, `suscribir`, `instantanea`/`restaurar` (se admite restaurar repitiendo el registro), `registro()`, `reiniciar()` (= simulación recién creada).
- **Errores:** nada lanza por datos de entrada; se devuelve `{ ok:false, motivo, texto }` con `motivo` de una lista cerrada, y una operación rechazada no cambia nada.
- **Determinismo:** igualdad exacta (JSON) dentro del mismo motor JS; `avanzar(0.1)`×10 ≡ `avanzar(1)`; el registro guarda las órdenes por número de paso (entero) y `repetir` se define con la API pública. Prohibido `Math.random`, `Date.now`, `performance.now`, `new Date(` y `crypto.` en modelo, averías, PLC y núcleo.
- **Órdenes:** `tipo` = ruta de la función antigua (FV `protecciones.abrir`; HTST `arrancar`) más las comunes `averias.activar/quitar/limpiar/reparar`; tablas de equivalencia completas en el contrato §4.
- **Medidas:** instrumentos `multimetro pinza megohmetro trazadorIV termografia osciloscopio termometro manometro` con magnitudes por simulador; tablas de equivalencia en §5.
- **Averías:** forma común con `firma` opcional; las 16 de la planta real no tienen firma todavía (las escribe el programador).
- **Eventos:** `EventoSim` (orden, orden_rechazada, alarma, disparo, averia, medida, reinicio, restauracion) y `EventoAprendizaje` con `POST /api/eventos` (formulario con `csrf`, lotes de hasta 50, 204 sin alumno, 400/413 en JSON, descarte por evento y sin duplicados).
- **Escenarios** JSON en `<simulador>/escenarios/` (ejemplo de cada uno en §7).
- **Presentación** (§12): variables `--pol-*` de `comun/UX_IDENTIDAD.md`, colores de estado aparte, Raleway, logo y copyright, radios ≤ 2/4 px, sin degradados ni emojis.
- **Criterios de aceptación:** C1–C37 (contrato), S1–S3 (reglas estáticas), A1–A10 (API del aula) y C38–C47 (presentación). Riesgos detectados en el código: §11 (R1–R15).

## 3. Los cinco agentes

Coordino yo: lanzo a cada agente con su encargo, recojo su informe, compruebo lo que entrega y te informo en cada punto de control. Ningún agente hace commit; commit, push y despliegue, con tu OK.

| Agente | Qué hace | Qué NO hace | Archivos que puede tocar |
|---|---|---|---|
| **Arquitecto** | Cierra el contrato a partir del código real de los dos simuladores: tipos, tabla de equivalencias de las órdenes y medidas actuales con las del contrato, reglas (paso fijo, sin azar, solo lectura del estado), reparto de archivos y criterios de aceptación. Al final revisa que lo programado cumple el contrato (solo lectura). | Programar. | `comun/CONTRATO.md`, `comun/tipos.js`, sección «Contrato» de `simulador_fotovoltaica/ARQUITECTURA.md` y del documento de la planta real, este plan. |
| **Programador** | Núcleo común (paso fijo, `azar(semilla)`, eventos, registro y repetición, envoltorio de API antiguas); adapta los modelos de la fotovoltaica y de la planta real al contrato **sin romper su API actual**; firmas de diagnóstico de las averías de la planta real; lógica pura de diagnóstico (nota, corrección); `POST /api/eventos` y la tabla del aula. | Pantallas, CSS, textos de ayuda, pruebas. | `comun/js/nucleo/*`, `comun/js/diagnostico/logica_*.js`, `*/js/modelo/*`, `*/js/averias/*`, `simulador_planta_real/js/plc/*`, `aula_pct23/app.py`. |
| **Interfaz gráfica** | Lleva a pantalla lo que diseña UX: maletín, cuaderno y hoja de diagnóstico comunes; modo Diagnóstico en la planta real; línea de tiempo de la sesión en la ficha del alumno del aula; adaptación de sinópticos y 3D al contrato. | Lógica del modelo, textos de ayuda, pruebas. | `comun/js/diagnostico/panel_*.js`, `comun/css/*`, `*/js/interfaz/*` (salvo textos), `*/js/scada2d/*`, `*/js/visor3d_*/*`, `*/index.html`, `*/css/*`, `aula_pct23/templates/*`, `aula_pct23/static/*`. |
| **UX** | Diseña los flujos antes de que se programen (qué ve y en qué orden el alumno en Diagnóstico de la planta real; qué ve el profesor en la línea de tiempo; pulsación larga y tamaños en iPad); escribe los textos de ayuda y de corrección; revisa en el navegador lo que entrega la interfaz y devuelve una lista de problemas. | Programar pantallas. | `comun/UX_*.md` (flujos y bocetos), `*/js/interfaz/textos_ayuda.js`, textos de las firmas de averías **solo** en coordinación con el programador. |
| **Pruebas** | Escribe las pruebas **a partir del contrato, sin mirar la implementación**: prueba de contrato genérica (recibe una fábrica `crearSimulacion`), determinismo, eventos del aula, regresión de lo existente; al final, pruebas de extremo a extremo en el navegador (local) y en vista iPad. Mantiene las pruebas existentes cuando cambia la API. | Arreglar el código que falla (lo informa). | `comun/tests/*`, `simulador_fotovoltaica/tests/*`, `simulador_planta_real/tests/*`, `aula_pct23/tests/*`. |

Regla de oro: **nadie toca archivos de otro agente**. Si un agente necesita un cambio fuera de su lista (por ejemplo, una prueba mal planteada), lo pide en su informe y lo reparto yo.

## 4. Orden y puntos de control

```
Fase 0  Arquitecto: contrato                          ──► punto de control: lo revisas tú
        Pruebas: prueba de contrato (en rojo: aún nadie lo cumple; en verde contra una simulación de juguete)
Fase 1  Programador: núcleo + adaptadores FV y HTST    ║  UX: flujos y textos (Diagnóstico HTST, línea de tiempo)
        Pruebas: determinismo, eventos del aula                                         en paralelo
                                                       ──► punto de control: contrato en verde en los dos simuladores
Fase 2  Interfaz gráfica: diagnóstico común, Diagnóstico HTST, línea de tiempo del aula
        Programador: lógica de diagnóstico común, /api/eventos
Fase 3  Pruebas: extremo a extremo y vista iPad  ║  UX: revisión de usabilidad  ║  Arquitecto: revisión de cumplimiento
        → arreglos (programador / interfaz) → nueva pasada de pruebas
Fase 4  Yo: informe con lo verificado y lo no verificado → commit, push y despliegue en la 120 con tu OK
```

## 5. Mejoras que se esperan

**Para el alumno**
- Modo Diagnóstico con instrumentos también en la **planta real** (hoy solo en la fotovoltaica).
- Mismo resultado en un iPad lento y en un PC (paso fijo). Hoy cada página decide cómo trocea el tiempo; está sin medir si eso cambia el resultado.

**Para el profesor**
- Ver **qué hizo** el alumno, en orden y con tiempos (maniobras, medidas, pistas), y **reproducir** su sesión.
- **Mismo reto para toda la clase** con la misma semilla y el mismo escenario.
- Un solo panel y un solo CSV para los dos simuladores; exportación compatible con xAPI (Moodle u otro LRS).

**Técnicas**
- Un simulador nuevo (la maqueta, después) solo escribe su modelo, su `layout.js` y su vista.
- Un fallo que reporte un alumno se reproduce exacto desde su registro.
- Las pruebas, escritas por un agente distinto del que programa, no heredan sus suposiciones.

**Lo que no mejora:** el aspecto y el 3D. En la fase 1 el alumno no nota nada; lo visible llega en la fase 2.

## 6. Decisiones abiertas

**Resueltas el 13-11-2026 (el usuario dio por buenas las propuestas):**
- 1: termómetro de contacto y manómetro entran como instrumentos de la planta real.
- 2: tope de 20 000 eventos por alumno y retención de un curso (365 días); el aula borra los más antiguos.
- 4: el control de temperatura y el llenado de la HTST pasan al modelo como órdenes; la interfaz deja de calcularlos.
- 5: si el iPad no llega con 1 s, se acepta subir el paso de la fotovoltaica a 2 s y, si no basta, a 5 s. **Aplicado (13-11-2026):** medido 1 s = 125–235 ms de CPU por segundo real a ×3600; 2 s ≈ 125 ms; 5 s ≈ 97 ms. `PASO_FIJO_S.fotovoltaica = 2`; 5 s queda de reserva.
- 4 (cierre): `controlTemperatura` y `llenarDepositos` son ya órdenes públicas de la planta real (CONTRATO.md §4.3), con `estado().operador`.
- `averias.quitar`: instancia mal formada → `instancia_desconocida`; bien formada pero no activa → `no_permitida` (CONTRATO.md §4.1).
- 6: la reproducción de la sesión entra en esta fase; el registro se sube en una petición aparte con su propio límite.
- 7: la barra del aula conserva los botones «píldora» como excepción de C43.
- 3 sigue abierta (maqueta y UxS Trainer, más adelante).

1. **Instrumentos de la planta real:** además del multímetro, ¿termómetro de contacto y manómetro en el maletín?
2. **Retención de eventos:** cuánto tiempo se guardan (protección de datos).
3. **Cuándo entran la maqueta y el UxS Trainer** (este con su propia aula: solo compartiría el formato de eventos).
4. **Control de temperatura y llenado de la HTST** (riesgo R6 del contrato): hoy los hace la interfaz cada 250 ms y su resultado depende de la velocidad. Propuesta del arquitecto: pasarlos al modelo como órdenes nuevas (p. ej. `controlTemperatura` { modo, consignaC, kp, ki, kd, bandaC } y `llenarDepositos` { activo }), que el PLC simulado ejecuta en cada paso fijo. Es un cambio de comportamiento: necesita tu visto bueno; mientras tanto se mandan como órdenes con `origen:'sistema'`.
5. **Paso fijo de la fotovoltaica:** 1 s (riesgo R12: a ×3600 son cinco veces más cálculos que hoy). Si el programador mide que el iPad no llega, ¿se acepta subirlo a 2 o 5 s (cambia el detalle de los transitorios de unos segundos)?
6. **Reproducir la sesión de un alumno en el panel del profesor:** hace falta subir el `registro()` al aula (puede pasar de los 32 KB de una petición) y repetirlo en el navegador del profesor, con diferencias pequeñas posibles entre el iPad y el PC (riesgo R11). ¿Entra en esta fase o solo la línea de tiempo de eventos?
7. **Identidad visual:** `comun/UX_IDENTIDAD.md` no existía al cerrar el contrato; se usaron los nombres de variables `--pol-*` acordados (incluidos `--pol-estado-servicio/aviso/alarma/parado`, `--pol-fuente` y `--pol-fuente-mono`). Si UX los cambia, se corrige el contrato §12 y `comun/tipos.js`. Pendiente también decidir si la barra del aula conserva sus botones «píldora» (radio 999px), hoy excepción en C43.

## 7. Riesgos

- Romper la interfaz fotovoltaica al adaptar el modelo → se mantiene la API antigua hasta que la interfaz migre.
- Que un modelo dependa sin saberlo del tamaño del paso → la prueba de contrato compara `avanzar(0.1)` diez veces con `avanzar(1)` una vez.
- Que pruebas y programador interpreten distinto el contrato → por eso el contrato se cierra y se revisa antes de que ninguno empiece.
