# Simulador de la instalación fotovoltaica de la cubierta: arquitectura

Tercer simulador del aula (junto al de la maqueta `simulador_pct23` y la planta real HTST `simulador_planta_real`), para formar a alumnos de **mantenimiento electrónico** en una instalación fotovoltaica real: la de la cubierta del CIFP Politécnico (fotos del profesor). Se hace **primero solo en local**; conectarlo al aula (`/fotovoltaica/`, tercera tarjeta de `/simuladores`) es un paso posterior.

Sigue la estructura de `simulador_planta_real` (léela como ejemplo: `ARQUITECTURA.md`, `js/layout.js`, `js/interfaz/pagina_simple.js`, `js/scada2d/esquema_htst.js`, `js/visor3d_htst/*`): módulos IIFE con doble exportación (`module.exports` / `window.PCT.*`), **todo en español** (comentarios, textos, nombres), pruebas con node:test, SVG por especificaciones `['tag', {attrs}, ...hijos]` con `PCT.canvas.Canvas`, 3D con three.js procedural (el de `simulador_pct23/js/vendor/three.js`) y el visor compartido de `simulador_pct23/js/interfaz/visor3d/`. Reutiliza el código compartido de `/simulador/js/...` (rutas absolutas, como hace el cargador de la planta real).

**El contrato es `js/layout.js`** (equipos, circuitos, especificaciones, averías): no se cambia sin pedirlo al arquitecto. **Todas las especificaciones son supuestos** a partir de las fotos (marcas EASun y ZCS Azzurro, batería LiFePO4 25,6 V 100 Ah, dos campos de paneles); están agrupadas en `layout.js` para que el profesor las corrija.

## 1. La instalación (de las fotos)

- **Cubierta plana** con pretil y barandilla, césped artificial, bandeja de rejilla con cables rojo/negro y conectores MC4, bloques de hormigón (los de los paneles nuevos son triangulares) y una **caseta metálica** (gris pardo, puerta corredera) con los equipos dentro, sobre fondo de tablero claro, canaletas blancas y cintas protectoras «Unex»/«Efapel».
- **Campo A** (6 paneles policristalinos de marco plateado, inclinación baja, 2 cadenas de 3) → caja de continua **«HT 8WAY»** (fusibles de cadena, seccionador, descargador) → inversor híbrido **EASun** (pantalla azul, rejilla de ventilación, dongle de comunicaciones) → **batería LiFePO4 25,6 V 100 Ah** (con magnetotérmico 2P de continua y portafusible en los cables) y salida de alterna.
- **Campo B** (8 paneles monocristalinos negros sobre bloques triangulares, 3 filas, 2 cadenas de 4) → pequeña caja de continua → inversor híbrido **ZCS Azzurro** (pantalla con LEDs On-Grid / Off-Grid / Alarm, conectores MC4 y de alterna por debajo) → red. Sin batería (supuesto).
- **Cuadro de alterna** estanco transparente con diferenciales y magnetotérmicos, toma schuko, rejillas de ventilación en lo alto de la caseta. Cajas de registro blancas.
- Otro grupo de paneles antiguos a la derecha de la foto 2: **no conectado** a este simulador (3D: de adorno).

## 2. Qué se simula (modelo, `js/modelo/`)

1. **Reloj y sol:** día del año y hora solar; posición del sol (declinación, ángulo horario, altura, azimut); irradiancia de cielo despejado sobre plano horizontal (modelo simple tipo Meinel/Hottel con masa de aire) y sobre el plano de cada campo (inclinación y azimut de `CAMPOS`) con directa + difusa + albedo; **nubosidad** 0–1 (reduce directa mucho y difusa poco, con algo de variación lenta), temperatura ambiente con ciclo diario y estacional (Cartagena), **suciedad** por campo (% de pérdida) y **sombras** por panel (0–1, también una sombra del pretil que depende de la altura del sol para la fila delantera del campo B cuando se activa su avería).
2. **Panel y cadena:** modelo de un diodo simplificado o equivalente por curva I‑V (`I(V)` por interpolación o resolución numérica estable), con tensión/corriente a la irradiancia y temperatura de célula (NOCT), **3 subcadenas con diodo de paso** (la sombra en una subcadena la puentea y pierde un tercio de la tensión), cadena = paneles en serie (la corriente la limita el peor panel), **mismatch** entre paneles. Debe poder calcular el **punto de máxima potencia** y la curva I‑V/P‑V de cualquier cadena (la interfaz la dibuja).
3. **Inversor EASun (INV-101):** MPPT (60–145 V) con eficiencia de seguimiento, cargador de batería (etapas corriente constante / absorción / flotación), modos `SOLAR_PRIMERO`, `RED_PRIMERO`, `BATERIA_PRIMERO` (prioridad de la fuente para alimentar las cargas LOAD-302), paso a red cuando la batería baja de `tensionCorteBajaV` y rearme a `tensionRearmeV`, límite de potencia de 3 kW, temperatura interna (sube con la potencia y la ventilación de la caseta; por encima de ~75 °C reduce potencia).
4. **Inversor ZCS (INV-201):** dos MPPT independientes (una cadena cada uno, rango 90–450 V, arranque a 100 V, corriente máxima), **comprobación de aislamiento** previa, **conexión a red con espera** (`tiempoReconexionS`), vertido o autoconsumo medidos con `MED-201`, limitación de 3 kW, **anti-isla** (sin red se desconecta y se enciende el LED Off-Grid/Alarm), reducción por tensión de red alta, eficiencia con curva realista.
5. **Batería:** SoC por integración de corriente (Wh, rendimiento de carga/descarga), tensión por curva LiFePO4 (plana, con subidas y bajadas en los extremos) más caída por resistencia interna, límites del **BMS** (corte por celda alta/baja, sobrecorriente), temperatura.
6. **Red y cargas:** red 230 V (se puede cortar o subir la tensión), contabilidad de energía importada/exportada, cargas `LOAD-301` y `LOAD-302` en W con perfil por defecto (aula de mañana/tarde, noche baja) y modo manual.
7. **Protecciones:** `QS-101`, `QB-101`, `QS-201`, `QF-301`, `ID-301`, `QF-302`, `QF-303` (abiertos/cerrados/disparados), fusibles `F-101`, `F-102`, `FB-101`, descargadores `SPD-*` (sanos/agotados). Un elemento abierto o fundido corta lo que cuelga de él (el modelo lo resuelve por topología, ver §3).
8. **Averías:** `AVERIAS` de `layout.js`; el motor las activa/desactiva y sus efectos (ver §3) salen de la física, no de números cableados en la interfaz.

Orden de integración por paso: reloj → ambiente y plano de cada campo → paneles/cadenas (con averías y sombras) → inversores (MPPT, temperatura) → batería → balance de potencia en alterna con la red y las cargas → energías acumuladas → alarmas. El modelo debe ser **estable y determinista con semilla** y admitir pasos de hasta ~5 s simulados (la interfaz subdivide pasos mayores).

## 3. API del modelo (contrato con la interfaz y con el 3D)

Espacio `PCT.fv`. Archivo principal `js/modelo/simulacion.js`: `PCT.fv.crearSimulacion({ semilla, diaAnio = 172, horaSolar = 9, nubosidad = 0.1 })` devuelve:

```
sim.paso(dtSimS)                      // avanza dtSimS segundos SIMULADOS (el llamador subdivide a ≤ 5 s)
sim.estado                            // objeto vivo, ver abajo (solo lectura para la interfaz)
sim.reiniciar(opciones?)              // vuelve a las condiciones iniciales (misma semilla)
sim.ordenes = {
  reloj:      { poner({ diaAnio, horaSolar }) },
  ambiente:   { poner({ nubosidad, temperaturaAmbienteC /*null = automática*/, suciedadA, suciedadB }),   // 0–1
                sombra(tagPanel, valor01) },
  protecciones: { cerrar(tag), abrir(tag), rearmar(tag) },       // QS-101, QB-101, QS-201, QF-301, ID-301, QF-302, QF-303 y fusibles (solo rearmar = sustituir)
  red:        { disponible(bool), tension(v) },
  cargas:     { poner(tag, watios | null /* null = perfil automático */) },
  inversor:   { modoEasun('SOLAR_PRIMERO'|'RED_PRIMERO'|'BATERIA_PRIMERO'), encender(tag, bool) },
  bateria:    { socInicial(pct) },
  averias:    { activar(id), desactivar(id), activas() /* ids */, limpiar() },
}
sim.curvaIV(idCadena, puntos = 60)    // → [{ v, i, p }] de la cadena en las condiciones actuales (con sombras, bypass y averías)
sim.medidas                           // puntos de medida para el multímetro (lo define el modelo; ver tests): { 'STR-101.v': V, 'BAT-101.v': V, ... } con función sim.medir(puntoA, puntoB)
```

`sim.estado` (todo en unidades SI salvo donde se dice; `p` en W, `v` en V, `i` en A, `e` en Wh):

```
t                       // s simulados desde el inicio
reloj: { diaAnio, horaSolar, texto /* "21 jun · 09:30" */, esDia }
sol:   { alturaGrados, azimutGrados }
ambiente: { ghWm2, nubosidad, temperaturaAmbienteC, suciedad: { A, B } }
campos: { A: { gPlanoWm2, p, v, i, cadenas: [ { id, abierta, v, i, p, voc, vmpp, impp, mppEnCurso, paneles: [ { tag, p, v, tempCelulaC, sombra01, bypass: [bool,bool,bool] } ] } ] }, B: { … } }
inversores: {
  'INV-101': { estado: 'APAGADO'|'ESPERA'|'OPERANDO'|'FALLO'|'REDUCIDO', modo, pvV, pvI, pvP, bateriaP /* + carga, − descarga */, redP /* + importa */, cargaP, temperaturaC, eficiencia, etapaCarga: 'CC'|'ABSORCION'|'FLOTACION'|'NINGUNA', alarma: '' | texto, leds: { red: bool, bateria: bool, fallo: bool } },
  'INV-201': { estado: 'APAGADO'|'ESPERA_AISLAMIENTO'|'ESPERA_RED'|'OPERANDO'|'FALLO'|'REDUCIDO', mppt: [ { v, i, p, activo } , { … } ], acP, acV, acF, vertidoP /* + exporta */, temperaturaC, eficiencia, aislamientoMohm, leds: { onGrid, offGrid, alarma }, alarma, segundosParaConexion }
}
bateria: { tag:'BAT-101', soc01, v, vCeldaMin, vCeldaMax, i /* + carga */, p, temperaturaC, bms: 'OK'|'CORTE_BAJA'|'CORTE_ALTA'|'CORTE_CORRIENTE', energiaWh }
red: { disponible, v, f, p /* + importa del centro */, energiaImportadaWh, energiaExportadaWh }
cargas: { 'LOAD-301': { w, manual }, 'LOAD-302': { w, manual, alimentada } }
protecciones: { [tag]: { estado: 'CERRADO'|'ABIERTO'|'DISPARADO'|'FUNDIDO'|'AGOTADO', causa } }
energia: { produccionAWh, produccionBWh, consumoWh, autoconsumoPct, ahorroEuros /* tarifa supuesta 0,15 €/kWh */ }
alarmas: [ { codigo, texto, tag, severidad: 'info'|'aviso'|'alarma' } ]
averiasActivas: [ id ]
```

Convenciones: `v` de una cadena abierta = su `voc`, `i` = 0. Un campo/inversor sin sol da 0 W, no `NaN`. Los tags de `estado` son los de `layout.js`.

## 4. Interfaz (`index.html`, `js/interfaz/`, `js/scada2d/`, `css/`)

Misma filosofía que `pagina_simple.js` de la planta real, adaptada:

- Página sencilla: cabecera (centro, nombre, reloj solar) y barra (Iniciar/Pausar/Restablecer, **velocidades** ×1, ×60, ×600, ×3600 del reloj solar), **sinóptico SVG** a la izquierda con los dos campos, cajas de continua, inversores, batería, cuadro de alterna, red y cargas, **flujos de potencia animados** con el sentido y la potencia en cada tramo, y **burbujas de medida** (V, A, W) en cada punto; panel lateral con pestañas (**Mando** | **Lecturas**); **gráficas** debajo a todo el ancho (potencia FV por campo, consumo y red; SoC y tensión de batería; irradiancia y temperatura; cronograma de estados de inversores/protecciones) y una gráfica **I‑V / P‑V** de la cadena seleccionada.
- **Clic izquierdo acciona** (abrir/cerrar un interruptor, rearmar, encender/apagar un inversor) y **clic derecho abre la ficha** del equipo (con «Ver en 3D» aislado a esa pieza); Enter/Espacio acciona, tecla de menú abre la ficha; ventanas emergentes.
- **Modos:** **Normal** (la instalación funciona sola: el alumno elige día, hora, nubosidad y observa) y **Revisión** (el alumno controla todo: sombras por panel, suciedad, interruptores, red, cargas, modo del EASun, SoC inicial; y el **panel de averías** del profesor con `AVERIAS`). En Revisión no hay cuadros de confirmación: se avisa de la consecuencia pero no se pregunta.
- Páginas aparte (ventanas emergentes): **Unifilar** (`unifilar.html`: esquema unifilar de continua y de alterna con el estado en vivo de cada protección) y **Cableado** (`cableado.html`: bornas y conductores de las cajas y los inversores con sección y color).
- Pie con el copyright «© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.» y barra de colores/estados como en la planta real (verde = en servicio, ámbar = aviso, rojo = alarma, gris = parado).
- Todo con teclado y con foco visible; textos de ayuda con un lenguaje que entienda un alumno de grado medio/superior.

## 5. 3D (`js/visor3d_fv/`, `visor3d.html`)

Con el visor compartido y el patrón de `visor3d_htst` (`escena_planta.js` con `crear(THREE, …)` → `{ grupo, elementos, actualizar(estado, lecturas), liberar, vistaDe, aislar, … }`, `kit.js` de materiales con dos calidades alta/baja, `?foco=TAG&solo=1`): la **cubierta** (pretil, barandilla, césped artificial, bloques de hormigón, tuberías y conductos de fondo, cielo y edificios lejanos), los **dos campos** con sus bloques y perfiles, la **bandeja de rejilla** con los cables rojo/negro y MC4, la **caseta metálica** con la puerta corredera abierta y los equipos dentro (EASun con su pantalla y LEDs vivos, ZCS con su LED, batería con etiquetas, cajas de continua, cuadro de alterna con transparencia, canaletas, rejillas de ventilación, cintas «Unex»/«Efapel»), y el **otro grupo de paneles antiguos** de adorno. Todo con geometría procedural (sin descargas). La luz sigue el reloj solar (sol según `estado.sol`, sombras, color del cielo, noche) y las pantallas/LEDs/animaciones reflejan `estado`. Cada equipo de `EQUIPOS` es seleccionable con su ficha.

## 6. Reparto de archivos (nadie toca los del otro)

| Agente | Archivos |
|---|---|
| Modelo | `js/configuracion/constantes.js`, `js/modelo/*`, `js/averias/*`, `tests/modelo_*.test.js`, `tests/averias_*.test.js` |
| Interfaz | `index.html`, `css/*`, `js/interfaz/cargador.js`, `pagina_simple.js`, `grafica_fv.js`, `ayuda_fv.js`, `panel_*.js`, `js/scada2d/esquema_fv.js`, `tests/interfaz_*.test.js` |
| 3D | `visor3d.html`, `js/visor3d_fv/*`, `tests/diseno_*.test.js` |
| Documentación eléctrica | `unifilar.html`, `cableado.html`, `js/scada2d/diagrama_unifilar.js`, `diagrama_cableado.js`, `js/interfaz/ventana_diagrama.js`, `js/interfaz/textos_ayuda.js`, `tests/diagramas_*.test.js` |

El cargador (`js/interfaz/cargador.js`) lo escribe la interfaz y tiene listas por agente (como el de la planta real) para que un módulo que falte no rompa la página.

## 7. Pruebas y servidor

Pruebas desde `simulador_fotovoltaica` con VS Code como Node (PowerShell): `$env:ELECTRON_RUN_AS_NODE=1; & "C:/Users/alegaz/AppData/Local/Programs/Microsoft VS Code/Code.exe" --test (Get-ChildItem tests\*.test.js | % FullName)` (filtra con `| % { "$_" } | Select-String "✖|ℹ (tests|pass|fail)"`; sin la variable `ELECTRON_RUN_AS_NODE` se abriría VS Code). Servidor local para ver las páginas: `python simulador_fotovoltaica/servir_local.py 8110` y abrir `http://localhost:8110/fotovoltaica/` (sirve también `/simulador/` y `/planta-real/`).
