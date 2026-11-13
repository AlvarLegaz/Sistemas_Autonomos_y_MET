# Identidad visual y textos · CIFP Politécnico de Cartagena

Guía común para el aula (`aula_pct23`), la instalación fotovoltaica (`simulador_fotovoltaica`) y la planta real HTST (`simulador_planta_real`). La maqueta (`simulador_pct23`) solo se ve afectada por la barra del aula que se inyecta en todos los simuladores.

Alcance del cambio decidido por el usuario: **solo** identidad del centro y textos más cortos. No cambian la estructura de las páginas, las tarjetas, la norma ISA-101, los colores de estado del sinóptico ni el 3D.

Referencia: la web del centro, https://elpolitecnico.es (clara, naranja y grises, Raleway, botones casi rectos, sin sombras).

---

## 1. Variables CSS

Se declaran una sola vez en `:root`, en una hoja común. Las variables que ya existen (`--acento`, `--texto`…) pasan a apuntar a estas para no tocar cada regla.

### 1.1 Marca (`--pol-*`)

| Variable | Valor | Uso |
|---|---|---|
| `--pol-naranja` | `#F68B11` | Color corporativo. Fondo del botón primario, línea fina de la cabecera, pestaña activa, foco de marca, iconos de acento, motivo de la línea curva. **No** se usa para texto pequeño sobre blanco: contraste 2,4:1. |
| `--pol-naranja-texto` | `#A85200` | Naranja oscuro para texto sobre claro: enlaces, títulos naranja, texto del botón secundario. Contraste 5,3:1 sobre blanco. Ya existe como `--acento-texto`. |
| `--pol-naranja-suave` | `#FEF3E7` | Fondo de resalte (fila seleccionada, aviso informativo de marca, `hover` del botón secundario). |
| `--pol-sobre-naranja` | `#212121` | Texto encima del naranja. Ver la decisión del apartado 4. |
| `--pol-gris-oscuro` | `#2F2F2F` | Bandas y pie oscuros, como en la web. |
| `--pol-gris` | `#444444` | Segunda banda oscura, texto de la marca «Politécnico» y separadores fuertes. |
| `--pol-gris-claro` | `#F3F3F3` | Fondo general de página. |
| `--pol-blanco` | `#FFFFFF` | Paneles, tarjetas, cabecera. |
| `--pol-titulo` | `#212121` | Títulos y cifras importantes sobre claro. |
| `--pol-texto` | `#444444` | Texto de cuerpo. Contraste 9,7:1 sobre blanco. La web usa `#666666`, pero en una interfaz técnica de lectura continua conviene más contraste. |
| `--pol-texto-suave` | `#666666` | Texto secundario, etiquetas, pies, `small`. Es el gris de cuerpo de la web, con 5,7:1 sobre blanco y 5,2:1 sobre `#F3F3F3`. |
| `--pol-borde` | `#E0E0E0` | Borde fino de paneles, tarjetas, tablas y campos. Sustituye a las sombras. |
| `--pol-borde-fuerte` | `#BDBDBD` | Borde de campos de formulario y de botones neutros, para que se vea el límite del control (3:1 frente a blanco no lo da `#E0E0E0`). |
| `--pol-foco` | `#0B5CAD` | Anillo de foco de teclado. Ya existe como `--foco`. Se mantiene azul y no naranja, porque en la planta el naranja significa agua caliente. |

### 1.2 Estado del sinóptico (`--estado-*`)

Son variables comunes aparte. **No forman parte de la marca y no cambian.** Tienen significado técnico (ISA-101): verde en servicio, ámbar aviso, rojo alarma, gris parado. El color nunca va solo: lo acompañan la forma (cuchilla abierta o cerrada, hilo roto, aspa) y el texto de estado.

| Variable | Claro (actual) | Oscuro (actual) | Hoy se llama |
|---|---|---|---|
| `--estado-servicio` | `#1A7F4B` | `#4CC28A` | `--ok` |
| `--estado-aviso` | `#9A5B00` | `#E0A33A` | `--aviso` |
| `--estado-alarma` | `#C0262D` | `#F0605F` | `--error` |
| `--estado-parado` | `#9AA6B1` | `#6B6567` | `--apagado` |

Las demás variables de proceso tampoco cambian:
- Planta: `--tubo`, `--agua`, `--caliente`, `--frio`, `--producto`.
- Fotovoltaica: `--fv`, `--bat`, `--redc`, `--consumo`, `--hilo`.
- Colores de conductor: `--dg-c-*`.

Las antiguas (`--ok`, `--aviso`, `--error`, `--apagado`) se dejan como alias de las `--estado-*`, para no tocar las reglas del sinóptico.

> El ámbar de estado (`#9A5B00`) y el naranja de marca (`#F68B11`) se parecen. Para no confundirlos, en el sinóptico **no** se usa el naranja de marca: ni en bordes de equipos ni en resaltes de selección. El naranja queda para la cabecera, los botones y las pestañas, fuera del dibujo.

### 1.3 Forma y tipografía

```css
:root {
  --pol-fuente: Raleway, "Segoe UI", Roboto, Arial, sans-serif;
  --pol-mono: ui-monospace, Consolas, "Roboto Mono", monospace;
  --pol-radio-boton: 2px;
  --pol-radio-panel: 4px;     /* máximo */
  --pol-sombra: none;         /* si hace falta separar una capa flotante: 0 1px 3px rgba(0,0,0,.12) */
}
```

Correspondencia con lo existente:
- `--fuente` pasa a ser `var(--pol-fuente)`.
- Hoy es `Bahnschrift, "DIN Alternate", …`.

---

## 2. Tipografía

**Familia: Raleway**, igual que en toda la web del centro. Roboto queda como secundaria.

> **Pendiente:** no hay permiso para descargar ni enlazar tipografías. La pila `Raleway, "Segoe UI", Roboto, Arial, sans-serif` usa Raleway si el equipo la tiene instalada; si no, cae a la del sistema. Cuando haya permiso, alojar Raleway (400, 500, 700, 800) en `/static/fuentes/` con `@font-face` y `font-display: swap`. No enlazar Google Fonts, por privacidad del alumnado.

| Elemento | Tamaño | Peso | Color |
|---|---|---|---|
| Título de página (`h1`) | 28px (24px en móvil) | 800 | `--pol-titulo` |
| Título de sección (`h2`) | 20px | 700 | `--pol-titulo` |
| Subtítulo o título de panel (`h3`, cabecera de panel lateral) | 15px | 700 | `--pol-titulo` |
| Nombre del simulador en la cabecera | 22px | 300 (ligero, como los titulares finos de la web) | `--pol-gris` |
| Cuerpo | 15px, interlineado 1,5 | 400 | `--pol-texto` |
| Etiquetas, ayudas, pies, `small` | 13px | 500 | `--pol-texto-suave` |
| Botones | 15px | 600 | según el tipo |
| Medidas numéricas (chips, reloj, lecturas, tablas de medidas) | igual que su contexto | 600–700 | `--pol-titulo` |

Reglas de tipografía:
- **Sin mayúsculas forzadas** (`text-transform: uppercase`) ni espaciado de letras en etiquetas, botones o títulos de panel. Hoy las llevan, por ejemplo, `.etq-vel`, `.zoom-esquema`, `.chip small`, `.lateral-simple h2` y `.diag-estado`.
  - Excepción: las etiquetas ISA del sinóptico (TT-101, QS-101…), que ya son mayúsculas por norma.
  - Excepción: los textos de seguridad que el código escribe en mayúsculas («CON TENSIÓN», «NO CONFORME»).
- **Medidas numéricas:** `font-variant-numeric: tabular-nums` (ya está). Los relojes y los valores que cambian en directo van en `--pol-mono`, como hoy `.chip-reloj`.
- **Sin emojis** en ninguna interfaz. Los símbolos técnicos (⚠, ⎓, ∿, Ω) sí se usan, porque son símbolos normalizados.

---

## 3. Fondos: claro u oscuro

**Aula y página de elección de simulador: siempre claras**, como la web del centro.
- Fondo: `--pol-gris-claro`.
- Paneles, tarjetas y formularios: `--pol-blanco` con borde `--pol-borde`.
- Se quita el bloque `@media (prefers-color-scheme: dark)` de `aula.css`. Son páginas de gestión y de entrada, no de operación, y deben parecerse a la web del centro.

**Simuladores (fotovoltaica y planta real):**

| Zona | Claro (por defecto) | Si el sistema está en oscuro |
|---|---|---|
| Cabecera (logo + simulador + mención) | `--pol-blanco`, línea inferior de 3px `--pol-naranja` | Banda `--pol-gris-oscuro` con el logo en versión clara y la línea naranja. Es como las bandas oscuras de la web. |
| Barra de mando, pestañas, panel lateral, diálogos, fichas | Paneles `--pol-blanco` sobre `--pol-gris-claro`, borde `--pol-borde` | Tema oscuro actual (`--panel #221E1F`, `--borde #403B3C`), con el naranja de marca |
| Fondo del sinóptico y sus burbujas | **Sin cambios:** `--fondo #E2E7EB` / `--panel #F5F7F8` | **Sin cambios:** el oscuro actual |
| Visor 3D | Sin cambios | Sin cambios |

Justificación:
1. Los colores de estado (`--estado-*`) y de proceso tienen dos juegos, claro y oscuro, calibrados para leerse sobre el fondo gris neutro del sinóptico, como pide ISA-101 (fondo gris apagado para que solo destaque lo anormal). Pasar el dibujo a blanco puro o al gris de la web cambiaría el contraste del ámbar y del gris «parado», que ya son los más justos. Por eso el área del sinóptico conserva sus variables. Para que no herede `--pol-gris-claro`, se fija en `.escena`, `.lienzo` y `.dg-*`.
2. El marco del simulador (cabecera, barras, paneles) sí toma la identidad. En claro es lo que ve el alumno casi siempre, y queda igual que el aula.
3. Se mantiene el soporte de tema oscuro en los simuladores. Se usan en aula con proyector y en pantallas de taller, y quitarlo obligaría a recalibrar los estados. El aula no lo necesita.

---

## 4. Botones

| Tipo | Fondo | Texto | Borde | `hover` |
|---|---|---|---|---|
| Primario (Entrar, Asignar reto, Iniciar…) | `--pol-naranja` | `--pol-sobre-naranja` (`#212121`), peso 600 | ninguno | fondo `#E07A05` |
| Secundario (Ver en 3D, Ayuda, ventanas, Filtrar…) | transparente | `--pol-naranja-texto` | 1px `--pol-naranja` | fondo `--pol-naranja-suave` |
| Neutro (velocidad, zoom, botones de tabla) | `--pol-blanco` | `--pol-titulo` | 1px `--pol-borde-fuerte` | borde `--pol-naranja` |
| Peligro (Paro de emergencia, Eliminar, Anular) | `--estado-alarma` | blanco | 2px `--estado-alarma` | sin cambio de color |

Reglas comunes a todos los botones:
- `border-radius: var(--pol-radio-boton)` (2px). Hoy los secundarios son píldoras (`999px`) y deben pasar a 2px.
- Altura mínima 44px en los simuladores (táctil, iPad), 40px en el aula.
- Texto en minúscula normal, sin `uppercase`.
- Sin degradados ni sombras.

**Decisión sobre el texto del botón primario.** La web pone texto blanco sobre el naranja. Ese par da 2,4:1 y no cumple WCAG AA ni para texto grande. El código actual ya usa texto oscuro (`--sobre-acento #16202A`). Se mantiene texto `#212121` (6,6:1): el botón conserva el naranja exacto de la marca y se puede leer.
- Si se quisiera texto blanco, habría que oscurecer el fondo a `#B85C00` (4,6:1), y entonces ya no es el naranja corporativo.
- El botón de peligro sí lleva texto blanco (`#C0262D`: 5,9:1).

---

## 5. Radios, bordes y sombras

- **Botones:** 2px.
- **Paneles, tarjetas, diálogos, fichas, campos:** máximo 4px. Hoy hay 6–8px en `.lateral-simple`, `.chip`, `.aviso-clic`, `.zoom-esquema button`, `.alarmas-fv li` y en las tarjetas del aula.
- **Píldoras de estado** (`.etiqueta`, chips de estado del aula, insignias de alarma): pueden seguir redondas, porque se leen como indicador, no como botón.
- **La barra del aula inyectada (`#aula-barra`)** pasa a 4px y borde `--pol-borde`, sin sombra.
- **Separación de capas:** con borde de 1px `--pol-borde`, sin sombras.
  - Solo las capas flotantes (diálogo modal, aviso de clic, barra del aula) pueden llevar como mucho `0 1px 3px rgba(0,0,0,.12)`.
  - Se quitan `0 4px 18px rgba(0,0,0,.35)` y `0 2px 10px rgba(0,0,0,.18)`.
- **Las marcas de estado de la barra se mantienen:**
  - `box-shadow: inset 0 -4px 0 var(--error)` cuando hay alarma.
  - El borde ámbar del modo Revisión.
  - Las dos son indicadores, no decoración.
- **Sin degradados** en ningún elemento de interfaz.

---

## 6. Cabecera

```
[logo CIFP Politécnico Cartagena] │ Nombre del simulador (Raleway 300, 22px)      [botones secundarios]
                                  │ Red Estatal de Centros de Excelencia de FP · Sector Químico (13px, --pol-texto-suave)
───────────────────────────────────────────── línea 3px --pol-naranja ─────────────────────────────────────────────
```

- **Logo:** `/static/img/logo-politecnico.png` en el aula y `/simulador/img/logo-politecnico.png` en los simuladores. Ya está, a 60px de alto (44px en móvil). El separador vertical entre logo y nombre (1px `--pol-borde`) ya existe.
- **Nombre:** el que ya genera cada simulador.
  - Fotovoltaica: `centro · corto` + `nombre`.
  - Planta real: `fábrica · corto` + `estación · HTST de leche`.
  - Aula: «GEMELO DIGITAL PCT23+». Se recomienda escribirlo sin mayúsculas forzadas: «Gemelo digital PCT23+».
- **Mención del centro:** «Red Estatal de Centros de Excelencia de Formación Profesional · Sector Químico».
  - Una línea, 13px, `--pol-texto-suave`.
  - En el aula va bajo el nombre.
  - En los simuladores sustituye al `<small>` solo en pantallas de 1200px o más. Por debajo se oculta, para no robar alto al sinóptico.
- **Fondo:** `--pol-blanco`, sin sombra. La línea naranja inferior de 3px es el motivo de la web.
  - La línea curva fina naranja de la web se puede reproducir como un único SVG decorativo en el pie o en la cabecera del aula, con trazo de 1,5px `--pol-naranja` y `aria-hidden="true"`.
  - Nunca dentro de los simuladores.

## 7. Pie

- **Aula:**
  - Banda `--pol-gris-oscuro` con texto `#FFFFFF` al 80 % y el lema «Formando profesionales desde 1902».
  - Enlace a https://elpolitecnico.es.
  - Debajo, la línea de copyright actual, **sin modificar**: «© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.»
- **Simuladores:** el pie actual (`.pie-copyright`), en 12px `--pol-texto-suave`. Sin banda oscura, para no quitar alto.

## 8. Otros elementos

- **Pestañas** (aula y paneles laterales):
  - Activa: texto `--pol-titulo` y línea inferior de 3px `--pol-naranja`.
  - Inactivas: texto `--pol-texto-suave`.
  - Sin fondo de píldora.
- **Tablas del aula:**
  - Cabecera en `--pol-gris-claro` con texto `--pol-titulo` 600.
  - Filas separadas por 1px `--pol-borde`.
  - Sin cebreado fuerte.
- **Campos de formulario:**
  - Fondo blanco, borde 1px `--pol-borde-fuerte` y radio 2px.
  - Foco con 2px `--pol-foco`.
- **Tarjetas de la elección de simulador:**
  - Blanco, borde `--pol-borde`, radio 4px, sin sombra.
  - `hover`: borde `--pol-naranja`.
  - Etiqueta superior en `--pol-naranja-texto` y 13px, sin mayúsculas.
  - Se mantienen la imagen y la estructura.
- **Avisos del aula:** fondo blanco con banda izquierda de 4px del color que toque.
  - `--estado-aviso`: aviso.
  - `--estado-alarma`: error.
  - `--estado-servicio`: correcto.
  - `--pol-naranja`: información de la marca.

## 9. Qué NO cambia

- Colores, formas y textos de estado del sinóptico (`--estado-*`), así como los colores de proceso y de conductores.
- Fondo del área del sinóptico y su tema oscuro.
- Visor 3D: materiales, luz y fondo.
- Estructura de las páginas, tarjetas y paneles. Este cambio no quita ni mueve nada.
- Animaciones de flujo, LED y parpadeo de alarmas, que son indicadores.
- La maqueta (`simulador_pct23`), salvo lo que hereda de `interfaz.css` si se cambian allí las variables comunes. En ese caso, comprobar que su sinóptico sigue igual.

---

## 10. Textos

### 10.1 Criterio de estilo (para todo texto nuevo)

- **Voz de profesor de FP:** directa, tuteando, frases cortas. Una idea por frase.
- **Primero el dato, luego la explicación**, si hace falta. Por ejemplo, «Bobina abierta: la FDV no avanza (A120).» en vez de «Si la bobina se abre, la FDV nunca avanza (alarma A120).».
- **No explicar lo obvio de la interfaz:**
  - Un botón «Guardar» no necesita ayuda.
  - Los subtítulos no repiten el título.
- **Sin relleno:** nada de «fácilmente», «de forma sencilla», «potente», «Aquí podrás…», «No solo X, sino también Y», listas de tres por inercia ni signos de admiración.
- **El separador «·»** solo sirve para datos en línea (estado, metadatos). No se usa como adorno.
- **Se conserva siempre:** unidades, valores, normas (IEC 62446-1, ISA-101, REBT), códigos de alarma, etiquetas de equipo y avisos de seguridad.
  - La seguridad va en mayúsculas solo cuando lo es: «CON TENSIÓN», «NO CONFORME».
- **Abreviaturas admitidas:** «mín.» y «máx.», y los símbolos V⎓, V∿ y ≈ en fichas técnicas.
- **Botones:** verbo en infinitivo o sustantivo corto, sin «?» delante («Ayuda», «Reintentar», «Asignar reto»).
- **Vacíos:** «Sin X» o «No hay X», sin añadir cuándo aparecerá.
- **Sin emojis.**
- **Antes de cambiar un texto**, buscarlo en `*/tests/`. Si una prueba lo fija, no se toca y se anota abajo.

### 10.2 Textos bloqueados por pruebas

No se han cambiado porque una prueba los comprueba. El agente de pruebas puede actualizar la prueba y después aplicar la propuesta.

**Aula (`aula_pct23/tests`)**

| Archivo | Texto actual | Prueba | Propuesta |
|---|---|---|---|
| `templates/aula_panel.html` | «Diagnóstico de averías · resumen por avería» (h2) | `test_retos.py` · `test_csv_de_notas_y_resumen_por_averia` («resumen por avería») | «Resumen por avería» |
| `templates/aula_panel.html` | «Reto de diagnóstico fotovoltaico para los N alumnos de esta lista:» | `test_retos.py:353` | «Reto fotovoltaico para los N de la lista:» |
| `templates/aula_panel.html` | «Al azar, distinta para cada alumno» | `test_retos.py:354` | «Al azar (una por alumno)» |
| `templates/aula_panel.html` | «Asignar a toda la lista» | `test_aula.py:687` | «Asignar a la lista» |
| `templates/aula_panel.html` | «PIN por defecto en uso (…)» | `test_aula.py:304, 460` | se mantiene (ya recortado el resto del aviso) |
| `templates/aula_panel.html` | «No hay alumnos pendientes» | `test_aula.py:474` | se mantiene |
| `templates/simuladores.html` | «…no te ha asignado ningún simulador…» | `test_aula.py:658` | «Aún no tienes simuladores. Cuando el profesor te los asigne, recarga la página.» |
| `templates/simuladores.html` | «Tienes N reto(s) de diagnóstico pendiente(s)» | `test_retos.py:515` | se mantiene (recortado lo que sigue) |
| `templates/aula_pin.html` | «Escribe el PIN…» | `test_aula.py:272, 525, 530` | se mantiene («Escribe el PIN del aula.») |
| `templates/pendiente.html` | «Esperando autorización», «Acceso no concedido» | `test_aula.py:141, 185` | se mantienen |

**Fuera del alcance (no son plantillas), propuesta para el programador.** Las descripciones de las tarjetas de simulador están en `aula_pct23/app.py`, líneas 49–53.
- Maqueta → «Maqueta del aula con sensores, bombas y PLC: manual, automático y demostración.»
- Planta real → «Estación EP-01 a escala industrial: sinóptico, 3D por equipo, esquemas de fuerza y mando, y averías en Revisión.»
- Fotovoltaica → «Dos campos FV, inversores EASun y ZCS, batería y cuadro de alterna: sol, sombras, averías, unifilar, cableado y 3D.»

**Instalación fotovoltaica (`simulador_fotovoltaica/tests`)**

| Archivo | Texto actual | Prueba | Propuesta |
|---|---|---|---|
| `js/interfaz/pagina_simple.js` (guía, paso 2) | «Continuidad de las tierras» | `interfaz_instrumentos.test.js:226` | «Continuidad de tierras» |
| `js/interfaz/pagina_simple.js` (guía, iPad) | «mantén pulsado 3 s» | `interfaz_toque_largo.test.js:64` | «mantén 3 s» |
| `js/interfaz/pagina_simple.js` `textoEstado` (Normal/Revisión) | «Normal · en marcha · de día · FV 1,2 kW · batería 78 % · sin alarmas» | `interfaz_pagina.test.js:83, 85` | quitar «· de día / de noche», que ya da el reloj |
| `js/interfaz/reto_fv.js` `textoEscenario` | «21 jun · 23:00 (hora solar), de noche · cielo despejado · batería al 70 % · EASun en modo bateria primero · LOAD-302 consumiendo 500 W» | `interfaz_reto.test.js:86` | «21 jun · 23:00 solar, de noche · despejado · batería 70 % · EASun: batería primero · LOAD-302: 500 W» (y corregir la tilde de «batería») |
| `js/interfaz/panel_diagnostico.js` `textoEnvio` | todos los mensajes repiten «Queda guardado en este equipo.» | `interfaz_reto.test.js:203` | decirlo una sola vez, en línea aparte |

Además hay palabras que las pruebas exigen y que se han conservado dentro de textos ya acortados:
- Avisos de los instrumentos: ROJA, NEGRA, ALTERNA, CONTINUA, FUGA, ABIERTA, NO CONCLUYENTE, PUNTO CALIENTE, IEC 62446-1…
- «MANIOBRA PELIGROSA … A de continua».
- En las fichas: «NO se puede apagar» y «QUÉ MEDIR», además de las longitudes mínimas de `queEs`, `paraQue` y `fallos`.

**Planta real HTST (`simulador_planta_real/tests`)**

| Archivo | Texto actual | Prueba | Propuesta |
|---|---|---|---|
| `js/interfaz/pagina_simple.js` `decidirClic` | «Para accionar X, pasa a Revisión (modo manual).» | prueba de `pagina_simple` («Revisión (modo manual)») | «Para accionar X, pasa a Revisión.» |
| `js/interfaz/pagina_simple.js` `textoEstado` | «… · en marcha · tanque 60 % · agua caliente: nivel normal · sin alarmas» | `interfaz_pagina_simple.test.js:99` | «… · en marcha · tanque 60 % · agua: normal · sin alarmas» |
| `js/interfaz/niveles.js` `estadoSimple` | «Todo bien: la leche llega a X °C y pasa a la salida.» | `interfaz_niveles.test.js:93` | «Bien: X °C, la leche sale.» |
| `js/interfaz/niveles.js` `estadoSimple` | «Atención: la leche no llega a 72 °C, se está desviando.» | `interfaz_niveles.test.js:97` | «Atención: menos de 72 °C, se desvía.» |
| `js/interfaz/niveles.js` tarjetas | «Atención: aún no llega a 72 °C» | `interfaz_pagina.test.js:287`, `interfaz_niveles.test.js:111` | «Atención: menos de 72 °C» |
| `js/interfaz/textos_ayuda.js` (fichas de instrumentos TT, FT, PT, LT, LS, TSH, ZS, PSL) | «Qué es» con más de 100 caracteres | `diseno_instrumentos3d.test.js:83` | bajar el mínimo de la prueba a 60 caracteres y acortar esas fichas |

Fragmentos que las pruebas exigen y que se mantienen sin propuesta:
- `panel_manual.js`:
  - «Posible avería», «no se cumple», «multímetro»
  - «Protegida: tanque de balance vacío (LSL-101)»
  - «Sin 24 V (F-001)», «Paro de emergencia (ES-001)», «sin circulación»
  - «vaciar el tanque», «vaciar el depósito», «30 kW», «NO CONFORME», «nivel bajo»
- `multimetro.js`: «SIN tensión», «EN SERIE», «normalmente», «Elige».
- `hoja_registro.js`: «No se detecta ninguna avería en…», «no está cargado».
- `panel_profesor.js`: «Código no válido».
- `pagina.js`: «El PLC automatiza:», «manda cada actuador».
- Los textos «Cómo funciona» de los equipos con interior no están en `js/interfaz` y una prueba los limita a 2–5 frases. No se han tocado.
