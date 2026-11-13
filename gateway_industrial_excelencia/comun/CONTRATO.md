# Contrato común de simulación · versión 1

Lo escribe el arquitecto y no cambia sin él. Los tipos en JSDoc están en `comun/tipos.js` (que además exporta las listas cerradas de este documento como constantes).
Ámbito: **planta real HTST** (`simulador_planta_real/`, id `planta_real`) y **fotovoltaica** (`simulador_fotovoltaica/`, id `fotovoltaica`). La maqueta (`maqueta`) y el UxS Trainer (`uxs`) entrarán después: nada de lo que sigue depende de que un simulador tenga PLC, campos FV o averías con instancias.

Convenciones de este documento:

- «DEBE», «NO DEBE», «PUEDE» tienen el sentido de RFC 2119.
- Unidades SI salvo donde el nombre del campo lleve la unidad (`tS`, `pct`, `caudalLh`, `temperaturaC`…). Los tags son los de `js/layout.js` de cada simulador.
- `JSON(x)` = `JSON.stringify(x)`. «Igual» entre dos estados = `JSON(a) === JSON(b)` (claves en el mismo orden: los adaptadores construyen los objetos siempre en el mismo orden).
- Archivo:línea se refiere al código de hoy (commit `a56a696`).

---

## 1. Registro de simuladores y archivos

| Qué | Dónde | Quién |
|---|---|---|
| Este contrato y los tipos | `comun/CONTRATO.md`, `comun/tipos.js` | arquitecto |
| Núcleo común (registro de fábricas, acumulador de paso fijo, eventos, registro y `repetir`, congelado del estado) | `comun/js/nucleo/*.js` | programador |
| Fábrica del contrato de la fotovoltaica | `simulador_fotovoltaica/js/modelo/contrato_fv.js` | programador |
| Fábrica del contrato de la planta real | `simulador_planta_real/js/modelo/contrato_htst.js` | programador |
| Prueba de contrato genérica | `comun/tests/contrato.test.js` (recibe una fábrica) | pruebas |
| Variables de identidad y de estado (§12) | `comun/css/identidad.css` (valores de `comun/UX_IDENTIDAD.md`) | interfaz gráfica |
| Prueba de presentación | `comun/tests/presentacion.test.js` (C38–C47) | pruebas |

Cada `contrato_*.js` es un IIFE con el doble export habitual:

```js
// Node
const { id, crearSimulacion } = require('../../simulador_fotovoltaica/js/modelo/contrato_fv.js');
// Navegador (después de comun/tipos.js, comun/js/nucleo/*.js y los módulos del modelo)
PCT.contrato.registrar('fotovoltaica', crearSimulacion);   // lo hace el propio archivo si PCT.contrato existe
PCT.contrato.fabrica('fotovoltaica')({ semilla: 7 });       // → Simulacion
PCT.fv.contrato = { id, crearSimulacion };                  // y PCT.htst.contrato para la planta real
```

`module.exports = { id, crearSimulacion }`. En Node el archivo NO depende de `window`. `PCT.contrato.registrar(id, fabrica)` lanza `Error('fabrica_duplicada')` si el id ya está registrado con otra fábrica (registrar la misma dos veces no hace nada).

**API antigua.** `PCT.fv.crearSimulacion` y `PCT.htst.crearSimulacion` NO cambian (sus pruebas siguen valiendo). Mientras la interfaz no migre, `Simulacion.antigua()` (§2.12) devuelve un objeto con la forma antigua cuyas órdenes pasan por `ejecutar` (así quedan en el registro). Cuando la interfaz migre se retira `antigua()` sin tocar el resto del contrato.

---

## 2. La interfaz `Simulacion`

```js
crearSimulacion({ semilla, escenario? }) → Simulacion

Simulacion = {
  id: 'planta_real' | 'fotovoltaica',          // 'maqueta' | 'uxs' cuando entren
  versionContrato: 1,
  pasoFijoS: number,                           // fotovoltaica 2 (decisión 5 del plan; antes 1) · planta_real 0.1
  avanzar(dtS) → Resultado,                    // acumula y da los pasos fijos que quepan
  avanzarPasos(n) → Resultado,                 // da exactamente n pasos fijos
  tiempo() → { pasos, tS, restoS },
  estado() → Estado,                           // instantánea congelada en profundidad
  ejecutar(orden) → Resultado,                 // ÚNICA vía para cambiar algo desde fuera
  ordenesDisponibles() → DescripcionOrden[],
  puntos() → PuntoMedida[],
  medir(peticion) → Medida,                    // no cambia nada
  averias: { catalogo() → Averia[], activas() → AveriaActiva[] },
  suscribir(fn) → cancelar(): void,
  instantanea() → Instantanea,
  restaurar(instantanea) → Resultado,
  registro() → Registro,
  reiniciar(opciones?) → Resultado,
  antigua?() → objeto con la API antigua (transitorio)
}
```

### 2.0 Errores: una sola regla

- **Ningún método de `Simulacion` lanza** por culpa de los datos que recibe. Los que pueden fallar devuelven `Resultado = { ok: false, motivo, texto }`; `medir` devuelve `Medida = { valida: false, motivo, texto }`. `motivo` es un código de la lista cerrada `MOTIVOS` (§9); `texto` es para el alumno, en español.
- Una operación que devuelve `ok:false` (o `valida:false`) **no cambia nada**: ni estado, ni tiempo, ni registro, ni emite eventos salvo `orden_rechazada` (§6).
- Solo lanza `crearSimulacion` con opciones imposibles (semilla no entera, escenario de otro simulador o de otra versión, escenario mal formado): `Error` con `codigo` ∈ `{ 'opciones_invalidas', 'escenario_invalido', 'simulador_incompatible', 'version_incompatible' }`. Es un error de programación, no del alumno.
- Si una función de un suscriptor lanza, el error se captura y se descarta (se puede anotar con `console.error`); los demás suscriptores reciben el evento igual y la simulación no se entera.

### 2.1 `crearSimulacion({ semilla, escenario? })`

- `semilla`: entero en [1, 2³²−1]. Obligatoria. La misma semilla y el mismo escenario dan siempre la misma simulación (§3).
- `escenario`: `Escenario` (§7). Si falta, el escenario por defecto del simulador (`condiciones: {}` y sin órdenes iniciales).
- Aplica `escenario.condiciones` al construir y luego ejecuta `escenario.ordenesIniciales` en orden con `pasos = 0`. Las órdenes iniciales **no** se apuntan en `registro().ordenes` (ya van en `registro().escenario`) ni emiten eventos. Si una orden inicial devuelve `ok:false`, `crearSimulacion` lanza `escenario_invalido`.
- Estado inicial: `tiempo()` = `{ pasos: 0, tS: 0, restoS: 0 }`, sin averías salvo las que active el escenario, sin suscriptores.

### 2.2 Tiempo: `avanzar(dtS)`, `avanzarPasos(n)`, `tiempo()`

- `avanzar(dtS)`: `dtS` debe ser un número finito con `0 ≤ dtS ≤ DT_MAX_S` (3600). Si no: `{ ok:false, motivo:'dt_invalido' }` (negativo, `NaN`, `±Infinity`, no número) o `'dt_excesivo'` (> 3600). La interfaz trocea ella las esperas largas.
- Acumulador: `restoS += dtS`; mientras `restoS ≥ pasoFijoS − EPS_PASO_S` (EPS_PASO_S = 1e-9) da un paso fijo y resta `pasoFijoS`. Al terminar, si `restoS < 0` se pone a 0. Devuelve `{ ok:true, datos: { pasos: k } }` con `k` = pasos dados en esta llamada.
- `avanzar(0)` es un no-op: no da pasos, no recalcula nada, no emite eventos. (Hoy `paso(0)` de la fotovoltaica sí recalcula: ver R2.)
- `avanzarPasos(n)`: `n` entero `0 ≤ n ≤ PASOS_MAX_POR_LLAMADA` (36 000). Si no, `'pasos_invalidos'`. No toca `restoS`.
- Un paso fijo usa siempre el mismo `pasoFijoS`, sin importar la velocidad de la interfaz ni los fotogramas: «acelerar» = más pasos por llamada.
- `tiempo()` → `{ pasos, tS, restoS }`: `pasos` entero de pasos dados desde la creación o el último `reiniciar`; `tS = pasos × pasoFijoS` (producto, no suma acumulada); `restoS` lo que queda en el acumulador. El tiempo propio del estado (`estado().t` en la FV, `estado().tiempoS` en la HTST) puede diferir de `tS` en el redondeo de la suma; el autoritativo es `pasos`.
- Durante una llamada a `avanzar`/`avanzarPasos`/`ejecutar`/`restaurar`/`reiniciar`, otra llamada a cualquiera de ellas (desde un suscriptor) devuelve `{ ok:false, motivo:'reentrada' }`.

### 2.3 `estado()`

- Devuelve el estado propio de cada simulador (forma documentada en su `ARQUITECTURA.md`: FV §3, HTST §4), **congelado en profundidad** (`Object.freeze` recursivo). Intentar mutarlo lanza en modo estricto y no hace nada fuera de él; en ningún caso cambia la simulación.
- PUEDE devolver el mismo objeto en dos llamadas seguidas si entre ellas no ha cambiado nada (así no cuesta copiar en cada fotograma); DEBE devolver uno nuevo después de cualquier cambio.
- Sin `NaN` en ningún número. Se admiten `±Infinity` (p. ej. `tiempoResidenciaS` sin caudal en la HTST): en `JSON` salen como `null`, y así se comparan.
- Es una foto del final de la última operación completa (paso, orden, restauración o reinicio).

### 2.4 `ejecutar(orden)`

- `Orden = { tipo, destino?, valores?, origen }` (§4). Validación, en este orden: forma (`'orden_invalida'`: no es objeto plano, falta `tipo` u `origen`, `origen` fuera de `ORIGENES`, `valores` no es objeto plano) → `tipo` (`'orden_desconocida'` si no está en `ordenesDisponibles()`) → `destino` (`'destino_desconocido'`) → `valores` (`'valores_invalidos'`: falta uno obligatorio, tipo equivocado, fuera de rango, opción no válida; **no se recorta en silencio**) → estado (`'no_permitida'`: p. ej. cerrar un fusible fundido) → averías (`'averia_desconocida'`, `'averia_incompatible'`, `'instancia_desconocida'` solo si la instancia está mal formada —una bien formada que no está activa es `'no_permitida'`, §4.1—, `'codigo_invalido'`).
- La orden se aplica de inmediato al estado interno. Lo que depende del PLC (HTST) se ve en el siguiente paso fijo, porque el PLC la lee en su ciclo; lo que la FV recalcula al instante (topología, MPP) se ve ya en `estado()`.
- Si `ok:true`: se apunta en el registro `{ paso: tiempo().pasos, orden }` (copia profunda y congelada de la orden recibida, tal cual, con su `origen`) y se emite el evento `orden`. `ejecutar` NO DEBE mutar la orden recibida (se le puede pasar congelada).
- `Resultado = { ok, motivo?, texto?, aviso?, datos? }`. `aviso` = maniobra peligrosa o dudosa que se ha hecho igualmente (p. ej. abrir un seccionador de continua en carga): no impide, avisa. `datos` = respuesta propia de la orden (p. ej. `{ instancia }` al activar una avería).
- Una orden válida que no cambia nada (abrir un interruptor ya abierto) es `ok:true` y se registra: el alumno la hizo.

### 2.5 `ordenesDisponibles()`

Lista estática (no depende del estado) de `DescripcionOrden = { tipo, texto, destinos?, valores?, ejemplo }`:

- `destinos`: lista cerrada de tags; si falta, la orden no lleva `destino` (y llevarlo es `'destino_desconocido'`).
- `valores`: `{ nombre: EsquemaValor }` con `EsquemaValor = { tipo: 'numero'|'entero'|'booleano'|'texto'|'opcion', min?, max?, opciones?, unidad?, nulo?: true /* admite null */, opcional?: true }`.
- `ejemplo`: una `Orden` válida de ese tipo (con `origen:'guion'`). Ejecutarla en una simulación recién creada da `ok:true` o `motivo:'no_permitida'`.

### 2.6 `puntos()` y `medir(peticion)`

- `puntos()` → `PuntoMedida[]` estática: `{ id, instrumento, magnitudes, texto, equipo, grupo? }`. La clave única es `(instrumento, id)`: el mismo id puede ser nodo del multímetro, conductor de la pinza y polo del megóhmetro (p. ej. `STR-201.+`).
- `medir(peticion)` → `Medida` (§5). **Nunca cambia la simulación**: ni estado, ni tiempo, ni registro. Sí emite el evento `medida` (sirve para el cuaderno y los eventos de aprendizaje). Si la medida exige una maniobra previa (abrir un seccionador para el megóhmetro), devuelve `{ valida:false, motivo:'requiere_maniobra' }`: la maniobra la hace el alumno con una orden.

### 2.7 `averias`

- `catalogo()` → `Averia[]` (§5.4), estática, mismo orden siempre.
- `activas()` → `AveriaActiva[] = [{ instancia, id, tags, parametros, desdePaso }]` ordenadas por `desdePaso` y luego por `instancia`. En la FV `instancia === id` (una por avería). En la HTST `instancia` es la del motor (`'I1'`, `'I2'`…) y puede haber dos instancias del mismo `id` en tags distintos.

### 2.8 `suscribir(fn)`

- `fn(evento: EventoSim)` se llama de forma síncrona. Devuelve `cancelar()`, idempotente. Suscribir la misma función dos veces la llama dos veces.
- Los eventos de una llamada se emiten **al final de esa llamada**, en orden de paso, cuando el estado ya está completo; dentro de `fn`, `estado()` devuelve el estado final de la llamada (no el de cada paso intermedio).
- Las suscripciones no forman parte del estado: sobreviven a `restaurar` y a `reiniciar`.

### 2.9 `instantanea()` y `restaurar(x)`

- `Instantanea = { simulador, versionContrato, pasoFijoS, semilla, escenario, pasos, restoS, datos }`. `datos` es opaco para todos menos para el adaptador. La instantánea entera DEBE sobrevivir a `JSON.parse(JSON.stringify(x))` sin cambiar (nada de `Infinity`, `NaN`, `undefined`, funciones ni ciclos: el adaptador codifica lo que haga falta).
- **Garantía de `restaurar(x)`**: tras `ok:true`, `estado()`, `tiempo()`, `registro()` y `averias.activas()` son iguales (JSON) a los del momento en que se tomó `x`; y desde ahí, la misma secuencia de llamadas produce los mismos estados y los mismos eventos que habría producido la simulación original.
- Implementación libre: serializar el estado interno, **o** guardar en `datos` el registro y restaurar repitiéndolo (§3.3). La segunda es la recomendada para la FV (su estado interno vive en cierres: ver R5).
- Errores: `'instantanea_invalida'` (forma), `'simulador_incompatible'`, `'version_incompatible'`, `'paso_incompatible'` (otro `pasoFijoS`). Con error no cambia nada.
- Emite el evento `restauracion`. No toca las suscripciones.

### 2.10 `registro()`

`Registro = { simulador, versionContrato, semilla, escenario, pasoFijoS, pasos, ordenes: [ { paso, orden } ] }` — copia nueva cada vez (mutarla no afecta). `pasos` = `tiempo().pasos` en el momento de pedirlo. `ordenes` en el orden en que se ejecutaron; `paso` no decrece. Solo las órdenes con `ok:true` y ejecutadas después de crear la simulación. Las medidas **no** van en el registro (no cambian el estado; van en los eventos de aprendizaje).

### 2.11 `reiniciar(opciones?)`

`opciones = { semilla?, escenario? }`; lo que falte se toma de la creación anterior. Deja la simulación **igual que `crearSimulacion` con esas opciones**: mismo estado, `tiempo()` a cero, sin averías (salvo las del escenario), registro nuevo vacío. Conserva las suscripciones. Emite `reinicio`. Opciones inválidas → `ok:false` con `'opciones_invalidas'`, `'escenario_invalido'`, `'simulador_incompatible'` o `'version_incompatible'`, y no cambia nada. (Ojo: el `reiniciar()` antiguo de la HTST conserva las averías y no reinicia el contador de instancias: R8.)

### 2.12 `antigua()` (transitorio)

Devuelve un objeto con la forma de la API antigua de ese simulador (`ordenes.*`, `estado`, `paso`, medidas, `averias`…) cuyas órdenes se traducen a `ejecutar` con `origen:'alumno'` según las tablas de §4. Su `paso(dt)` llama a `avanzar(dt)`. No forma parte de la prueba de contrato.

---

## 3. Determinismo y paso fijo

### 3.1 Reglas

1. Todo el azar del modelo sale de generadores con semilla. Código nuevo: `PCT.nucleo.azar(semilla)` del núcleo común. Se aceptan los que ya existen: `crearRng` de `simulador_fotovoltaica/js/configuracion/constantes.js:39` y `calidad.ruido(semilla, …)` de la HTST (cambiarlos alteraría resultados que hoy prueban otros tests).
2. **Prohibido** `Math.random`, `Date.now`, `performance.now`, `new Date(` y `crypto.` en `*/js/modelo/`, `*/js/averias/`, `simulador_planta_real/js/plc/` y `comun/js/nucleo/`. (La interfaz sí puede usarlos, p. ej. para el id de sesión; nunca para algo que llegue al modelo.)
3. El resultado de la simulación depende solo de: semilla, escenario y la secuencia `(paso, orden)`. No depende de cómo se trocee el tiempo en llamadas a `avanzar`.
4. Dentro del mismo motor JS la igualdad es **exacta** (JSON idéntico, sin tolerancia): con paso fijo, las dos ejecuciones hacen exactamente las mismas operaciones de coma flotante en el mismo orden, así que una tolerancia solo escondería un fallo. Entre motores distintos (V8 en el PC frente a JavaScriptCore en el iPad) `Math.exp`, `Math.sin`, `Math.log`… pueden diferir en el último bit y no se garantiza la igualdad (R11): la prueba de contrato compara siempre dentro del mismo motor.

### 3.2 Comprobables (los usa la prueba de contrato)

- `avanzar(0.1)` ×10 ≡ `avanzar(1)` ×1 ≡ `avanzarPasos(Math.floor(1 / pasoFijoS))`: mismo `tiempo().pasos` y `estado()` igual. (Con `pasoFijoS` > 1 s, como la FV a 2 s, `avanzar(1)` da 0 pasos y deja `restoS = 1`; la equivalencia sigue valiendo. Para forzar un paso en cualquier simulador: `avanzar(pasoFijoS)`.)
- `avanzar(0.25)` ×40 ≡ `avanzar(10)` ×1, y `avanzar(7)` + `avanzar(3)` ≡ `avanzar(10)`.
- Dos simulaciones con la misma semilla, escenario y órdenes en los mismos pasos → `estado()` igual tras cada operación y la misma secuencia de eventos.

### 3.3 `repetir(registro, crearSimulacion)`

Vive en el núcleo (`PCT.contrato.repetir`; en Node, `require('comun/js/nucleo/registro.js').repetir`) y se define solo con la interfaz pública, así que la prueba la puede reproducir sin conocer la implementación:

```js
function repetir(r, crear) {
  const s = crear({ semilla: r.semilla, escenario: r.escenario });
  if (s.pasoFijoS !== r.pasoFijoS || s.id !== r.simulador || s.versionContrato !== r.versionContrato) → lanza 'registro_incompatible'
  for (const { paso, orden } of r.ordenes) { s.avanzarPasos(paso - s.tiempo().pasos); s.ejecutar(orden); }   // ok:false → lanza 'registro_inconsistente'
  s.avanzarPasos(r.pasos - s.tiempo().pasos);
  return s;
}
```

Garantía: `JSON(repetir(r).estado()) === JSON(original.estado())` y `JSON(repetir(r).registro()) === JSON(r)` (avanzar pasos de más en tramos de 36 000 si hace falta).

---

## 4. Órdenes como datos

```js
Orden = { tipo, destino?, valores?, origen }        // origen ∈ 'alumno' | 'profesor' | 'guion' | 'sistema'
```

- `tipo` = la ruta de la función antigua dentro de `sim.ordenes` (FV) o su nombre (HTST), para que la traducción sea mecánica; las averías usan los tipos comunes `averias.*` en los dos.
- `origen`: `alumno` (lo hace en pantalla), `profesor` (panel del profesor), `guion` (escenario, reto, preparación automática), `sistema` (lo que la interfaz hace por su cuenta sin que lo pida el alumno, p. ej. activar `llenarDepositos` al preparar un nivel inicial; el control y el llenado de la HTST ya son órdenes del modelo: §4.3). Solo las de `alumno` generan el evento de aprendizaje `acciono`.

### 4.1 Tipos comunes (todos los simuladores con averías)

| tipo | destino | valores | Efecto |
|---|---|---|---|
| `averias.activar` | — | `{ id, parametros? }` | Activa la avería. `datos: { instancia }`. FV: ya activa → `ok:true` y sustituye parámetros (hoy `motor.activar`). HTST: incoherente con otra activa → `'averia_incompatible'` con el texto del motor. Id inexistente → `'averia_desconocida'`. Parámetro fuera de rango o de lista → `'valores_invalidos'` (la FV hoy recorta: el adaptador valida antes). |
| `averias.quitar` | — | `{ instancia }` | La retira el profesor. **Regla única** (misma en §2.4, §4.2, §4.3 y C35): `instancia` con forma que no es la de una instancia (FV: no es el `id` de ninguna avería del catálogo; HTST: no cumple `/^I\d+$/`) → `'instancia_desconocida'`; con forma válida pero que no está activa (FV: id del catálogo no activo; HTST: `I7` inexistente o ya retirada) → `'no_permitida'`. Ambos sin cambiar nada. |
| `averias.limpiar` | — | — | Quita todas. |
| `averias.reparar` | tag | `{ accion }` (`ACCIONES_REPARACION`) | El alumno ejecuta una reparación. Si alguna avería activa tiene `solucion.accion === accion` y su tag de solución (o, si es `null`, alguno de sus `tags`) es `destino`, se quita: `datos: { correcta: true, ids }`. Si no: `ok:true`, `datos: { correcta: false }` y (HTST) se anota un intento en cada instancia activa. |

Consultas que no son órdenes: `averias.activas()`, `averias.catalogo()`.

### 4.2 Fotovoltaica (`simulador_fotovoltaica/js/modelo/simulacion.js`)

| Función de hoy | Orden del contrato | destino | valores |
|---|---|---|---|
| `ordenes.reloj.poner({ diaAnio, horaSolar })` :337 | `reloj.poner` | — | `{ diaAnio?: entero 1–365, horaSolar?: 0 ≤ h < 24 }` (al menos uno) |
| `ordenes.ambiente.poner({ nubosidad, temperaturaAmbienteC, suciedadA, suciedadB })` :344 | `ambiente.poner` | — | `{ nubosidad?: 0–1, temperaturaAmbienteC?: −30–60 o null (= automática), suciedadA?: 0–1, suciedadB?: 0–1 }` (al menos uno) |
| `ordenes.ambiente.sombra(tag, valor01)` :351 | `ambiente.sombra` | `PV-101…PV-106`, `PV-201…PV-208` | `{ valor01: 0–1 }` |
| `ordenes.protecciones.cerrar(tag)` :354 | `protecciones.cerrar` | `QS-101 QB-101 QS-201 QF-301 ID-301 QF-302 QF-303 F-101 F-102 FB-101` | — (fusible fundido → `'no_permitida'`) |
| `ordenes.protecciones.abrir(tag)` :355 | `protecciones.abrir` | los mismos | — |
| `ordenes.protecciones.rearmar(tag)` :356 | `protecciones.rearmar` | los mismos + `SPD-101 SPD-201 SPD-301` | — (nada que rearmar → `'no_permitida'`) |
| `ordenes.red.disponible(v)` :358 | `red.disponible` | `RED-301` | `{ disponible: booleano }` |
| `ordenes.red.tension(v)` :358 | `red.tension` | `RED-301` | `{ tensionV: 0–300 }` |
| `ordenes.cargas.poner(tag, w)` :359 | `cargas.poner` | `LOAD-301 LOAD-302` | `{ w: ≥ 0 o null (= perfil automático) }` |
| `ordenes.inversor.modoEasun(m)` :361 | `inversor.modoEasun` | `INV-101` | `{ modo: 'SOLAR_PRIMERO'｜'RED_PRIMERO'｜'BATERIA_PRIMERO' }` |
| `ordenes.inversor.encender(tag, v)` :362 | `inversor.encender` | `INV-101 INV-201` | `{ encendido: booleano }` |
| `ordenes.bateria.socInicial(pct)` :364 | `bateria.socInicial` | `BAT-101` | `{ pct: 0–100 }` |
| `ordenes.averias.activar(id, parametros)` :371 | `averias.activar` | — | `{ id, parametros? }` |
| `ordenes.averias.desactivar(id)` :372 | `averias.quitar` | — | `{ instancia: id }` (id del catálogo no activo → `'no_permitida'`; texto que no es id del catálogo → `'instancia_desconocida'`: §4.1) |
| `ordenes.averias.limpiar()` :374 | `averias.limpiar` | — | — |
| `ordenes.averias.activas()` :373 | (consulta) `averias.activas()` | | devuelve `AveriaActiva[]`, no ids |
| `paso(dt)` :326 | `avanzar(dt)` | | |
| `reiniciar(opts)` :327 | `reiniciar({ semilla?, escenario? })` | | `diaAnio`, `horaSolar`, `nubosidad` pasan a `escenario.condiciones` |
| `crearSimulacion({ semilla, diaAnio, horaSolar, nubosidad })` :65 | `crearSimulacion({ semilla, escenario: { condiciones: { diaAnio, horaSolar, nubosidad } } })` | | |

`condiciones` de la FV: `{ diaAnio?: 1–365 (172), horaSolar?: 0–24 (9), nubosidad?: 0–1 (0.1) }` (las opciones de la fábrica antigua; lo demás, con órdenes iniciales).

### 4.3 Planta real HTST (`simulador_planta_real/js/modelo/simulacion.js` y `js/averias/motor.js`)

| Función de hoy | Orden del contrato | destino | valores |
|---|---|---|---|
| `ordenes.arrancar()` :147 | `arrancar` | — | — |
| `ordenes.parar()` :148 | `parar` | — | — |
| `ordenes.consignaTemperaturaC(c)` :149 | `consignaTemperaturaC` | — | `{ temperaturaC: 60–85 }` (hoy recorta; el contrato rechaza) |
| `ordenes.consignaCaudalLh(q)` :150 | `consignaCaudalLh` | — | `{ caudalLh: 0–2500 }` (`layout.PROCESO.caudalMaximoLh`) |
| `ordenes.modo(m)` :151 | `modo` | — | `{ modo: 'PARADA'｜'MANUAL'｜'RECIRCULACION_AGUA'｜'PRODUCCION'｜'CIP' }` |
| `ordenes.pulsador(tag)` :152 | `pulsador` | `PB-001 TSH-201` | — |
| `ordenes.manual(tag, valor)` :156 | `manual` | `P-101 P-201 KM-201 KM-202 SV-101 XV-301 XV-401 XV-101 XV-102 XV-201 XV-202 VFD-101` (`DO_MANUALES` de `plc/programa.js:16` + `VFD-101`) | `{ valor }`: salidas digitales `0｜1｜true｜false｜null`; `VFD-101` número 0–100 o `null`. `null` = devolver el mando al PLC. |
| `ordenes.paroEmergencia(activo)` :157 | `paroEmergencia` | `ES-001` | `{ activo: booleano }` |
| `ordenes.nivelDeposito(cual, pct)` :159 | `nivelDeposito` | `TK-101` (= `'tanque'`) · `HW-201` (= `'aguaCaliente'`) | `{ pct: 0–100 }` |
| (nueva; antes la hacía la interfaz, R6) `controlTemperatura` | `controlTemperatura` | — | `{ modo: 'off'｜'histeresis'｜'pid', consignaC?: 20–85 °C, bandaC?: 0,5–20 °C, kp?: 0–100, ki?: 0–5, kd?: 0–500 }`; `modo` obligatorio, el resto opcional (lo que falte se conserva) y fuera de rango → `'valores_invalidos'` (el modelo recortaba; el contrato rechaza). Cada orden reinicia el controlador (PID sin memoria). `origen`: `'alumno'` si lo cambia el alumno en pantalla, `'sistema'` si lo pone la interfaz por su cuenta. |
| (nueva) `llenarDepositos` | `llenarDepositos` | — | `{ activo: booleano }`: `true` abre XV-101 y XV-201 hasta que TK-101 (≥ 99 %) y HW-201 (LSH-201) estén llenos y entonces las cierra; `false` cancela y las cierra. Al salir del modo MANUAL el modelo también lo cancela (`final = 'cancelado'`, XV-101/XV-201 vuelven al PLC, cerradas); solo en la transición desde MANUAL: un llenado iniciado fuera de MANUAL sigue. `origen`: `'alumno'` o `'sistema'`. |
| `averias.inyectar(id, parametros)` motor.js:60 | `averias.activar` | — | `{ id, parametros? }` → `datos: { instancia }` |
| `averias.quitar(instancia)` motor.js:69 | `averias.quitar` | — | `{ instancia }` (`/^I\d+$/` no activa → `'no_permitida'`; otra forma → `'instancia_desconocida'`: §4.1) |
| (quitar todas: `reiniciar({ quitarAverias:true })` :178) | `averias.limpiar` | — | — |
| `averias.reparar(instancia, { accion, tag })` motor.js:77 | `averias.reparar` | tag | `{ accion }` (sin instancia: §4.1) |
| `averias.desdeCodigo(texto)` motor.js:159 | `averias.cargarCodigo` (solo HTST) | — | `{ codigo: 'HTST-…' }` → `'codigo_invalido'` o `'averia_incompatible'` |
| `averias.codigo()`, `listar()`, `activas()`, `puedeInyectar()` | consultas, no órdenes: `averias.catalogo()`, `averias.activas()`; `codigo()` sigue en `antigua()` | | |
| `paso(dtS)` :141 | `avanzar(dtS)` | | |
| `reiniciar({ quitarAverias })` :178 | `reiniciar()` (siempre sin averías; ver R8) | | |
| `senales()`, `alarmas()` :170, :184 | están en `estado()` (`instrumentos`, `salidasPLC`, `alarmas`); `senales()` sigue en `antigua()` | | |
| `crearSimulacion({ semilla, valvulasManuales })` :18 | `crearSimulacion({ semilla, escenario: { condiciones: { valvulasManuales } } })` | | |

`condiciones` de la HTST: `{ valvulasManuales?: booleano (false) }`.

**Órdenes `controlTemperatura` y `llenarDepositos` (públicas desde esta versión; decisión 4 del plan, cerrado R6).** Entran en `ORDENES_POR_SIMULADOR.planta_real` y, por tanto, en `ordenesDisponibles()` con `ejemplo` ejecutable (C14/C15). Son órdenes de la planta como las demás: se registran, se repiten y emiten el evento `orden`; los automatismos los ejecuta el modelo en **cada paso fijo de 0,1 s**, así que el resultado ya no depende de la velocidad de la interfaz y no hay ráfagas de órdenes `manual` (el modelo escribe él mismo `ord.manual`; esas escrituras NO son órdenes del registro). Ejemplos (con `origen:'guion'`, como exige §2.5): `{ tipo:'controlTemperatura', valores:{ modo:'pid', consignaC:70 } }` y `{ tipo:'llenarDepositos', valores:{ activo:true } }`. **Ninguno necesita preparación**: en una simulación recién creada devuelven `ok:true` (nunca `no_permitida`). Ojo: el control solo actúa con `estado().modo === 'MANUAL'` (el PLC no cede el mando en otro modo) y el llenado se cancela solo con paro de seguridad; son efectos de estado, no condiciones de aceptación de la orden. Al salir del modo MANUAL (transición desde MANUAL), el modelo suelta las órdenes manuales, pone el control en `'off'` y cancela el llenado (`activo:false`, `final:'cancelado'`); un llenado iniciado fuera de MANUAL no se toca.

`estado().operador` (planta real; congelado como el resto del estado):

| Campo | Significado |
|---|---|
| `operador.control.modo` | `'off'｜'histeresis'｜'pid'` (inicial `'off'`) |
| `operador.control.consignaC`, `bandaC`, `kp`, `ki`, `kd` | parámetros vigentes (iniciales 70 °C, 4 °C, 10, 0,05, 0) |
| `operador.control.salidaPct` | salida calculada 0–100 % (histéresis: 0 ó 100) |
| `operador.control.encendido` | estado de la histéresis |
| `operador.control.integral`, `ultimoError` | memoria del PID (`ultimoError: null` hasta el primer cálculo) |
| `operador.control.sinLectura` | `true` si TT-201 no tiene lectura válida: bancos apagados |
| `operador.llenado.activo` | `true` mientras llena |
| `operador.llenado.final` | `''` (en curso o sin empezar) · `'lleno'` · `'paro'` (cortado por paro de seguridad) · `'cancelado'` (por `llenarDepositos {activo:false}` o al salir de MANUAL) |

Reparto del PID: bancos KM-201/KM-202 (30 kW cada uno) por modulación de tiempo en ventanas de 30 s; hasta el 50 % solo el banco 1.

---

## 5. Medidas y averías

### 5.1 `PeticionMedida` y `Medida`

```js
PeticionMedida = { instrumento, magnitud, a?, b?, conductor?, elemento?, opciones? }
Medida = { valida, valor?, unidad?, texto, motivo?, datos? }
```

- Campos de la petición según el instrumento: multímetro → `a` (punta roja) y `b` (negra; en la HTST se ignora porque mide contra masa); pinza → `conductor`; megóhmetro, trazador, termografía, termómetro, manómetro → `elemento`; osciloscopio → `a`. `opciones` solo para `puntos` de las curvas (entero 4–400, 60 por defecto).
- `valida:false` ⇒ sin `valor`; `motivo` ∈ `'instrumento_desconocido'`, `'magnitud_invalida'` (esa magnitud no existe o no vale en ese punto: es el «modo no válido» de la HTST), `'punto_desconocido'`, `'con_tension'` (óhmetro con tensión o en carga), `'requiere_maniobra'` (megóhmetro con el seccionador cerrado), `'sin_referencia'` (FV: puntas en grupos sin referencia común), `'peticion_invalida'` (forma). `texto` dice por qué, para la pantalla del instrumento.
- `valida:true` ⇒ `valor` número (o `Infinity` = «OL», circuito abierto: entonces `datos.ol = true`) y `unidad`; las magnitudes compuestas (`curva`, `curvaReferencia`, `imagen`, `formaOnda`) no llevan `valor` y van en `datos`. Los campos extra del resultado antiguo van en `datos` (`tipo`, `vdc`, `vac`, `continuidad`, `abierto`, `tensionPruebaV`, `minimoMohm`, `correcto`, `lecturaTransmisor`, el resumen I‑V entero…).
- Instrumentos de la lista cerrada `INSTRUMENTOS`: `multimetro`, `pinza`, `megohmetro`, `trazadorIV`, `termografia`, `osciloscopio`, `termometro`, `manometro`. Se conserva `trazadorIV` (y no `trazador_iv` como decía el borrador) porque es el que usan ya las 18 firmas de la FV.

### 5.2 Fotovoltaica: equivalencias

| Hoy | `PeticionMedida` | Medida |
|---|---|---|
| `sim.medir(a, b)` (medidas.js:240) | `{ instrumento:'multimetro', magnitud:'tension', a, b }` | `valor` = V con signo en DC / eficaz en AC; `datos: { tipo:'DC'｜'AC', vdc, vac }`. `tipo:'sin_referencia'` → `valida:false, motivo:'sin_referencia'`; `'desconocido'` → `'punto_desconocido'` |
| `sim.resistencia(a, b)` (:254) | `{ instrumento:'multimetro', magnitud:'resistencia', a, b }` | `valor` = Ω (`Infinity` = OL); `datos: { continuidad, abierto }`. `conTension` → `'con_tension'` con `datos.voltios` |
| (misma función) | `{ instrumento:'multimetro', magnitud:'continuidad', a, b }` | igual que `resistencia` (el zumbador es `datos.continuidad`) |
| `sim.corriente(id)` (:293) | `{ instrumento:'pinza', magnitud:'corriente', conductor: id }` | `valor` = A; `datos: { tipo }` |
| `sim.aislamiento('STR-201.+')` (simulacion.js:447) | `{ instrumento:'megohmetro', magnitud:'aislamiento', elemento:'STR-201.+' }` | `valor` = MΩ, `unidad:'MΩ'`; `datos: { tensionPruebaV, minimoMohm, correcto }`. Seccionador cerrado → `'requiere_maniobra'`. La forma sin polo (`'STR-201'`) no entra en el contrato |
| `sim.resumenIV(id)` (:399) | `{ instrumento:'trazadorIV', magnitud: campo, elemento: id }` con `campo` ∈ `voc isc vmpp impp pmpp factorForma desviacionPct desviacionVocPct desviacionIscPct escalones`; o `magnitud:'resumen'` (valor = `pmpp`) | `datos` = el resumen entero (`valida`, `estable`, `abierta`…). OJO: `resumen.valida:false` (poca luz) sigue siendo `Medida.valida:true`: el trazador mide, pero la medida no vale según la norma; eso va en `datos.valida` y en `texto` |
| `sim.curvaIV(id, n)` (:386) | `{ instrumento:'trazadorIV', magnitud:'curva', elemento: id, opciones:{ puntos:n } }` | `datos: { puntos: [{ v, i, p }] }` |
| `sim.curvaIVReferencia(id, n)` (:388) | `{ …, magnitud:'curvaReferencia' }` | igual |
| `sim.termografia()` (medidas.js:310) | `{ instrumento:'termografia', magnitud:'imagen' }` | `datos` = el resultado entero |
| (un elemento de la termografía) | `{ instrumento:'termografia', magnitud:'temperatura'｜'deltaC', elemento: tag }` | `valor` = °C; `datos: { tempC, deltaC, nota, tipo, zona }` |
| `sim.puntos`, `sim.conductores`, `sim.puntosAislamiento` | `puntos()` con `instrumento` `multimetro` / `pinza` / `megohmetro`; más una entrada por cadena (`trazadorIV`) y por elemento de la termografía | |
| `sim.continuidad(a, b)`, `sim.potencial(n)`, `sim.medidas` (burbujas) | sin equivalente: no son instrumentos; se quedan en `antigua()` | |

Precisiones de la FV (ya implementadas en `contrato_fv.js`):

- **Multímetro:** `b` es **obligatorio** (`tension`, `resistencia`, `continuidad`). Sin `b` (o no texto) → `valida:false, motivo:'peticion_invalida'`; `b` que no es un punto → `'punto_desconocido'`. (En la HTST sigue ignorándose.)
- **Termografía:** el punto de la imagen completa es `{ id:'IMAGEN', instrumento:'termografia', magnitudes:['imagen'], equipo:'CAS-001' }` y la petición `{ instrumento:'termografia', magnitud:'imagen' }` (sin `elemento`; `datos` = resultado entero, `unidad:'°C'`). Cada elemento de la termografía es otro punto (`id` = su tag, `magnitudes:['temperatura','deltaC']`, `grupo` = su zona).
- **Unidades de las medidas del trazador I-V** (`Medida.unidad`): `voc`, `vmpp` en `'V'`; `isc`, `impp` en `'A'`; `pmpp` y `resumen` en `'W'`; `desviacionPct`, `desviacionVocPct`, `desviacionIscPct` en `'%'`; `factorForma` en `'p.u.'` (por unidad, adimensional); `escalones` en `'escalones'` (número de escalones de la curva). Las firmas usan esas mismas unidades en sus `Rango.unidad`.

Magnitudes por instrumento (FV): multímetro `tension resistencia continuidad`; pinza `corriente`; megóhmetro `aislamiento`; trazadorIV `resumen curva curvaReferencia voc isc vmpp impp pmpp factorForma desviacionPct desviacionVocPct desviacionIscPct escalones`; termografía `imagen temperatura deltaC`.

### 5.3 Planta real: equivalencias (`sim.medidas.medir(instrumento, a, b, modo)`, medidas.js:152)

| Hoy (`instrumento`, `modo`) | `PeticionMedida` | Medida |
|---|---|---|
| `multimetro`, `'V'` | `{ instrumento:'multimetro', magnitud:'tension', a }` | V |
| `multimetro`, `'mA'` (en serie con el lazo) | `{ instrumento:'multimetro', magnitud:'corriente', a }` | mA (`unidad:'mA'`, como hoy) |
| `multimetro`, `'ohm'` | `{ instrumento:'multimetro', magnitud:'resistencia', a }` | Ω (`Infinity` = OL) |
| `multimetro`, `'continuidad'` | `{ instrumento:'multimetro', magnitud:'continuidad', a }` | Ω; `datos.continuidad` |
| `multimetro`, `'temperatura'` | `{ instrumento:'termometro', magnitud:'temperatura', elemento: a }` | °C; `datos.lecturaTransmisor` en `TT-103:BANO` |
| `multimetro`, `'presion'` | `{ instrumento:'manometro', magnitud:'presion', elemento: a }` | bar |
| `osciloscopio` | `{ instrumento:'osciloscopio', magnitud:'formaOnda', a }` | `datos: { muestras, unidad, dtMs }` |
| `{ ok:false, texto:'Modo … no válido…' }` | | `valida:false, motivo:'magnitud_invalida'` |
| `{ ok:false, texto:'Punto de medida desconocido…' }` | | `valida:false, motivo:'punto_desconocido'` |
| `medidas.PUNTOS` `[{ id, descripcion, modo }]` | `puntos()`: `{ id, instrumento, magnitudes:[magnitud del modo], texto: descripcion, equipo: id.split(':')[0] }`; los de `temperatura` y `presion` salen con `termometro` / `manometro`; los de lazo, fuente y `SV-101:BORNAS`, además con `osciloscopio` | |

Hoy el multímetro de la HTST mide temperatura y presión; en el contrato son `termometro` y `manometro` (decisión abierta 1 del plan: si se enseñan como instrumentos aparte en el maletín es cosa de UX; el dato ya va separado).

Magnitudes por instrumento (HTST): multímetro `tension corriente resistencia continuidad`; osciloscopio `formaOnda`; termómetro `temperatura`; manómetro `presion`.

### 5.4 `Averia` y `Firma`

```js
Averia = { id, titulo, descripcion?, equipos: string[], dificultad: 1|2|3, sintomas: string[],
           parametros: { nombre: EsquemaValor & { defecto } }, solucion: { texto, accion, tag: string|null }, firma?: Firma }
Firma  = { sintoma, escenario: Escenario, esperaS,
           medidasClave: [ { peticion: PeticionMedida, referencia?: PeticionMedida, preparar?: Orden[],
                             esperadoSano: Rango, esperadoAveria: Rango, texto } ],
           pistas: [string, string, string], explicacion, distractores: string[] }
Rango  = { min: number|null, max: number|null, unidad }     // null = sin límite (así sobrevive a JSON; Infinity como valor medido cumple max:null)
```

- FV: `titulo` ← `titulo`; `equipos` ← `[tag]`; `sintomas` ← `sintomas`; `firma` ← `firma` convertida: `escenario` pasa a `Escenario` (`diaAnio, horaSolar, nubosidad` → `condiciones`; `socInicialPct, modoEasun, cargas, sombras` → `ordenesIniciales`), `esperaS` sube a la firma; cada medida clave `{ instrumento, puntos|conductor|tag, modo, campo }` → `peticion` según §5.2 (`trazadorIV` con `campo` → `magnitud: campo`; termografía con `campo` → `magnitud: campo === 'deltaC' ? 'deltaC' : 'temperatura'`); `preparar: [{ orden:'abrir', tag }]` → `[{ tipo:'protecciones.abrir', destino: tag, origen:'guion' }]`; `max: Infinity` → `null`.
- HTST: `titulo` ← `nombre`; `equipos` ← `equipos`; `sintomas` ← `sintomasScada`; `solucion` igual; `firma`: **ninguna de las 16 averías la tiene hoy** (su `diagnostico` son pasos con textos, sin rangos numéricos ni escenario). Las escribe el programador, con UX para los textos: `AV-LAZO-ABIERTO`, `AV-PT100-ABIERTA`, `AV-PT100-CORTO`, `AV-DERIVA-TT103`, `AV-RUIDO-4-20`, `AV-FUSIBLE-F201`, `AV-FUENTE-24V`, `AV-KM-PEGADO`, `AV-KM-NO-CIERRA`, `AV-BOBINA-ABIERTA`, `AV-FDV-ATASCADA`, `AV-AIRE-BAJO`, `AV-VFD-SOBRETEMP`, `AV-PLACA-FUGA`, `AV-FILTRO-OBSTRUIDO`, `AV-TSH-DISPARADO`. Requisitos de cada firma nueva: 3 pistas (hoy algunas tienen 2), rangos numéricos con `medir` del contrato, escenario donde la avería se manifiesta, y que se distinga de las otras 15 y de la planta sana (como ya está probado en la FV).
- `firma` es opcional en el tipo: una avería sin firma no puede salir en un reto de diagnóstico.

---

## 6. Eventos de la simulación (`EventoSim`)

```js
EventoSim = { tipo, paso, tS, ...campos del tipo }
```

| tipo | Cuándo | Campos |
|---|---|---|
| `orden` | `ejecutar` con `ok:true` | `orden`, `resultado` |
| `orden_rechazada` | `ejecutar` con `ok:false` | `orden` (copia; puede estar mal formada), `resultado` |
| `alarma` | una alarma aparece o desaparece en `estado().alarmas` (comparación por `codigo`+`tag` al final de cada paso fijo o de cada orden) | `codigo`, `tag`, `nivel` ∈ `NIVELES_ALARMA`, `texto`, `activa: boolean` |
| `disparo` | una protección o seguridad actúa sola o se rearma | `tag`, `causa`, `activo: boolean`. FV: una protección pasa a `DISPARADO`/`FUNDIDO`/`AGOTADO` (y `activo:false` al volver a `CERRADO`). HTST: paro de seguridad del PLC (`estado.plc.paro`, `tag:'QE-001'`, `causa` = motivos), `TSH-201` disparado, `P-101.fallo` del variador (`tag:'VFD-101'`) |
| `averia` | cambia el conjunto de averías activas | `accion` ∈ `'activada'｜'quitada'｜'reparada'｜'reparacion_fallida'｜'retirada_por_maniobra'` (FV: el rearme de una protección retira su avería), `id`, `instancia`, `tags` |
| `medida` | `medir` (válida o no) | `peticion`, `medida` |
| `reinicio` | `reiniciar` con `ok:true` | `semilla`, `escenario` |
| `restauracion` | `restaurar` con `ok:true` | `pasos` |

- `paso` y `tS` son los de `tiempo()` en el momento del hecho (para los de `avanzar`, el del paso en que ocurrió).
- Orden de emisión dentro de una llamada: por `paso` y, dentro de un paso, `orden` → `averia` → `disparo` → `alarma`.
- Determinismo: repetir un registro produce la misma secuencia de eventos de tipo `orden`, `averia`, `disparo` y `alarma` (las medidas no están en el registro).
- Los eventos son objetos nuevos y congelados; el suscriptor no puede alterar los de otro.

---

## 7. Escenarios como datos

```js
Escenario = { simulador, versionContrato: 1, id, titulo, descripcion?, condiciones, ordenesIniciales: Orden[], esperaS?, objetivos?: Objetivo[] }
Objetivo  = { texto, comprobar: { tipo:'estado', ruta: string[], criterio } | { tipo:'medida', peticion: PeticionMedida, criterio } }
Criterio  = { igual?: valor } | { min?: number, max?: number, unidad? }
```

- JSON puro, en `<simulador>/escenarios/<id>.json`; `id` = nombre del archivo, `[a-z0-9_]{3,40}`.
- `condiciones`: solo las opciones de construcción del simulador (FV §4.2, HTST §4.3); clave desconocida → `escenario_invalido`. Todo lo demás, con `ordenesIniciales` (`origen:'guion'`).
- `ruta` es una lista de claves (`['cargas','LOAD-302','alimentada']`), no un texto con puntos: los tags y los puntos de medida de la FV llevan puntos.
- `esperaS`: segundos simulados que hay que dejar correr antes de que el escenario «se vea» (lo usa el modo Diagnóstico).
- Un **reto** del aula = `escenario` + avería oculta (`averias.activar` con `origen:'profesor'`, que la interfaz no enseña) + `semilla`: el mismo para toda la clase.

Ejemplo de la fotovoltaica (`simulador_fotovoltaica/escenarios/noche_bateria_primero.json`; es el escenario de la firma de `BMS_CORTE_BATERIA`, catalogo.js):

```json
{
  "simulador": "fotovoltaica", "versionContrato": 1, "id": "noche_bateria_primero",
  "titulo": "Noche de verano: las cargas protegidas tiran de la batería",
  "condiciones": { "diaAnio": 172, "horaSolar": 23, "nubosidad": 0 },
  "ordenesIniciales": [
    { "tipo": "bateria.socInicial", "destino": "BAT-101", "valores": { "pct": 70 }, "origen": "guion" },
    { "tipo": "inversor.modoEasun", "destino": "INV-101", "valores": { "modo": "BATERIA_PRIMERO" }, "origen": "guion" },
    { "tipo": "cargas.poner", "destino": "LOAD-302", "valores": { "w": 500 }, "origen": "guion" }
  ],
  "esperaS": 120,
  "objetivos": [
    { "texto": "LOAD-302 está alimentada", "comprobar": { "tipo": "estado", "ruta": ["cargas", "LOAD-302", "alimentada"], "criterio": { "igual": true } } },
    { "texto": "La batería se descarga: mide con la pinza en el cable positivo", "comprobar": { "tipo": "medida",
      "peticion": { "instrumento": "pinza", "magnitud": "corriente", "conductor": "BAT-101.cable+" }, "criterio": { "max": -5, "unidad": "A" } } }
  ]
}
```

Ejemplo de la planta real (`simulador_planta_real/escenarios/arranque_recirculacion.json`; niveles de `NIVELES_INICIALES.normal` de `js/interfaz/pagina_simple.js:11`):

```json
{
  "simulador": "planta_real", "versionContrato": 1, "id": "arranque_recirculacion",
  "titulo": "Arranque en recirculación de agua con los depósitos llenos",
  "condiciones": { "valvulasManuales": false },
  "ordenesIniciales": [
    { "tipo": "nivelDeposito", "destino": "TK-101", "valores": { "pct": 100 }, "origen": "guion" },
    { "tipo": "nivelDeposito", "destino": "HW-201", "valores": { "pct": 100 }, "origen": "guion" },
    { "tipo": "arrancar", "origen": "guion" }
  ],
  "esperaS": 60,
  "objetivos": [
    { "texto": "La planta está en recirculación de agua", "comprobar": { "tipo": "estado", "ruta": ["modo"], "criterio": { "igual": "RECIRCULACION_AGUA" } } },
    { "texto": "Hay 24 V después del fusible F-001", "comprobar": { "tipo": "medida",
      "peticion": { "instrumento": "multimetro", "magnitud": "tension", "a": "F-001:SALIDA" }, "criterio": { "min": 22, "max": 26, "unidad": "V" } } }
  ]
}
```

---

## 8. Eventos de aprendizaje y API del aula

### 8.1 `EventoAprendizaje` (compatible con xAPI)

```js
EventoAprendizaje = {
  id,                          // texto [A-Za-z0-9_-]{1,40}, único dentro de la sesión (para no duplicar al reintentar)
  verbo,                       // VERBOS
  objeto: { simulador, reto?, escenario?, elemento? },     // simulador ∈ SIMULADORES; reto = id entero del reto del aula; elemento = tag o id de punto
  resultado?: { nota?, acierto?, duracionS?, valor?, unidad?, texto? },
  contexto: { sesion, intento, tSimS },                    // sesion [A-Za-z0-9_-]{8,64} (la genera la página al cargar); intento entero ≥ 1; tSimS = tiempo().tS
  marca,                       // ISO 8601 UTC del navegador, p. ej. '2026-11-13T09:30:00Z'
}
```

| verbo | Lo genera | Cuándo | xAPI (exportación) |
|---|---|---|---|
| `inicio` | interfaz | abre el simulador, empieza un reto o un escenario | `http://adlnet.gov/expapi/verbs/initialized` |
| `acciono` | interfaz, desde `EventoSim.orden` con `origen:'alumno'` | cada maniobra del alumno; `elemento` = destino | `http://adlnet.gov/expapi/verbs/interacted` |
| `midio` | interfaz, desde `EventoSim.medida` | cada medida; `resultado.valor/unidad` | `http://adlnet.gov/expapi/verbs/interacted` + extensión `instrumento` |
| `pidio_pista` | interfaz | pide una pista; `resultado.valor` = nº de pista (1–3) | `http://adlnet.gov/expapi/verbs/asked` |
| `entrego` | **solo el servidor**, desde `POST /api/reto/resultado` | entrega la hoja de diagnóstico | `http://adlnet.gov/expapi/verbs/answered` |
| `completo` | interfaz | cumple los objetivos de un escenario | `http://adlnet.gov/expapi/verbs/completed` |
| `abandono` | interfaz | cierra la página o cambia de reto sin entregar | `https://w3id.org/xapi/adl/verbs/abandoned` |

Sin datos personales en el evento: el alumno lo pone el servidor a partir de la sesión.

### 8.2 `POST /api/eventos`

- Cuerpo `application/x-www-form-urlencoded` (como `/api/uso` y `/api/reto/resultado`, porque `comprobar_csrf` de `aula_pct23/app.py:633` lee `request.form`): `csrf` = el valor de `#aula-barra input[name=csrf]` (como `aula_pct23/static/uso.js:4`), `eventos` = texto JSON con una lista de `EventoAprendizaje`.
- Límites: lote de 1 a `EVENTOS_MAX_POR_LOTE` = 50 eventos; cada evento serializado ≤ 1 000 caracteres; el campo `eventos` ≤ 24 000 caracteres; la petición entera ≤ 32 KB (`MAX_CONTENT_LENGTH`, app.py:496). Por alumno se guardan como máximo `EVENTOS_MAX_GUARDADOS_POR_ALUMNO` = 20 000 (se borran los más antiguos; la retención en días es la decisión abierta 2).
- Orden de las comprobaciones y respuestas:
  1. CSRF ausente o distinto → **400** `{ "guardados": 0, "error": "…" }` (JSON, como hoy en `/api/reto`: el `errorhandler(400)` de app.py:654 debe responder JSON también para `/api/eventos`).
  2. Más de 32 KB → **413** con JSON `{ "guardados": 0, "error": "…" }` (hoy el 413 es HTML: app.py:664).
  3. Sin alumno autorizado en la sesión (anónimo, profesor sin cuenta de alumno, alumno pendiente) → **204** sin cuerpo (no se guarda nada; el simulador funciona sin aula).
  4. `eventos` ausente, no es JSON, no es una lista, está vacía o tiene más de 50 elementos, o pasa de 24 000 caracteres → **400** JSON.
  5. Cada evento se valida aparte; el que no cumple se **descarta** sin tumbar el lote: verbo fuera de `VERBOS` o `entrego` (lo genera el servidor); `objeto.simulador` fuera de `SIMULADORES` o no asignado al alumno; `contexto.sesion`/`id` con otro formato; `intento` fuera de 1–999; `tSimS` fuera de 0–10⁷; `marca` no ISO 8601 o más de 24 h en el futuro respecto al servidor; `resultado.nota` fuera de 0–10, `acierto` ∉ {0, 0,5, 1}, `duracionS` fuera de 0–86 400, `valor` no finito; textos de más de 120 caracteres se recortan con `limpiar()`; campos desconocidos se ignoran; `objeto.reto` que no es del alumno → se guarda sin reto.
  6. Duplicado (mismo alumno, `sesion` e `id`) → no se guarda otra vez.
  7. **200** `{ "guardados": n, "descartados": d, "duplicados": k }` con `n + d + k` = tamaño del lote.
- El servidor guarda además su propia hora de recepción; la línea de tiempo se ordena por `(sesion, marca, recepción, orden en el lote)`.
- `POST /api/reto/resultado` sigue igual y además inserta un evento `entrego` (`resultado: { nota, acierto, duracionS: segundos }`, `objeto.simulador` = el de los retos, `objeto.reto` = el reto del alumno si la avería entregada es la del reto, si no ninguno). Campo de formulario **`sesion`** (opcional): si cumple `[A-Za-z0-9_-]{8,64}` es el `contexto.sesion` del evento; si falta o no es válido, `contexto.sesion = 'sin_sesion'` (constante `SESION_DESCONOCIDA`). `contexto.intento` = el del diagnóstico (máx. 999), `tSimS` = 0; el `id` del evento es `entrego_<id de la fila de diagnósticos>` (único, no se duplica). Un `sesion` inválido NO provoca error. Sin alumno con retos → 204 como antes. Sus errores 400 salen en JSON `{ "guardado": false, "error": … }`.
- **`POST /api/registro_sesion`** (reproducción de la sesión; decisión 6): formulario con `csrf`, `sesion` (mismo formato), `simulador` (∈ simuladores del contrato **y asignado al alumno**) y `registro` = texto JSON de un `Registro` (§2.10; objeto cuyo `simulador`, si existe, coincide con `simulador`). Límite propio: `registro` ≤ 1 048 576 caracteres (`REGISTRO_SESION_MAX_CARACTERES`; la petición admite ese tamaño + 16 KB, no los 32 KB del resto). Se guarda **uno por alumno, sesión y simulador** (el último enviado sustituye al anterior) y como máximo 50 por alumno (`REGISTROS_SESION_MAX_POR_ALUMNO`, se borran los de recepción más antigua). Respuestas: CSRF falso → 400 JSON; sin alumno autorizado → 204 sin cuerpo; `sesion` mal formada, simulador no válido o no asignado, `registro` vacío, mayor del límite, no JSON, no objeto o de otro simulador → 400 JSON `{ "guardado": false, "error": … }`; correcto → 200 `{ "guardado": true }`.
- Los campos `sesion` de `/api/eventos` van dentro de cada evento (`contexto.sesion`, §8.1), no en el formulario; el duplicado se define por (alumno, `sesion`, `id`). En el servidor se guardan además `recibido` y el orden dentro del lote.

### 8.3 Lectura (profesor)

- `GET /aula/alumno/<id>/sesion/<sesion>` → página con la línea de tiempo (solo profesor; si no, redirige a `/aula` como el resto del panel; alumno inexistente o `sesion` mal formada → 404). Hoy es una tabla mínima (hora UTC, verbo, simulador, elemento, resultado, `tSimS`) con un enlace por cada registro guardado; la interfaz gráfica la rediseñará.
- `GET /aula/alumno/<id>/sesion/<sesion>/registro_<simulador>.json` → el `registro` guardado tal cual (`application/json`; solo profesor, 404 si no hay).
- `GET /aula/eventos.xapi.json?desde=<ISO 8601>` → lista de sentencias xAPI con los verbos de §8.1 (`actor` = `{ "account": { "homePage": <url del aula>, "name": <id interno del alumno> } }`, sin nombre ni correo). Solo profesor; `desde` inválido → 400.

---

## 9. Listas cerradas (en `comun/tipos.js`)

`VERSION_CONTRATO` = 1 · `SIMULADORES` = `planta_real fotovoltaica maqueta uxs` · `ORIGENES` · `MOTIVOS` (todos los códigos de este documento) · `TIPOS_EVENTO_SIM` · `NIVELES_ALARMA` = `estado info aviso alarma critica` · `INSTRUMENTOS` · `MAGNITUDES_POR_SIMULADOR` · `ORDENES_COMUNES` · `ORDENES_POR_SIMULADOR` · `ACCIONES_REPARACION` = `rearmar sustituir reparar ajustar limpiar recalibrar despejar` · `VERBOS` · `VERBOS_XAPI` · `PASO_FIJO_S` (FV 2 s, HTST 0,1 s) · `MODOS_CONTROL_TEMPERATURA` · `FINALES_LLENADO` · `FORMA_INSTANCIA_HTST` · `UNIDADES_ESPECIALES` · `SESION_DESCONOCIDA` · `REGISTRO_SESION_MAX_CARACTERES` · `REGISTROS_SESION_MAX_POR_ALUMNO` · `DT_MAX_S` · `EPS_PASO_S` · `PASOS_MAX_POR_LLAMADA` · `EVENTOS_MAX_POR_LOTE` · `EVENTO_MAX_CARACTERES` · `LOTE_MAX_CARACTERES` · `EVENTOS_MAX_GUARDADOS_POR_ALUMNO` · presentación (§12): `VARIABLES_IDENTIDAD`, `VARIABLES_ESTADO`, `NARANJA_POLITECNICO`, `TEXTO_SOBRE_NARANJA`, `SIMBOLOS_PERMITIDOS`, `EXCEPCIONES_RADIO`, `SOMBRAS_PERMITIDAS`, `FUENTE`, `COPYRIGHT`, `RADIO_MAX_BOTON_PX`, `RADIO_MAX_PANEL_PX`.

---

## 10. Criterios de aceptación

La prueba de contrato genérica recibe `crearSimulacion` y nada más (en Node). «Fresca» = `crearSimulacion({ semilla: 7 })`. «Igual» = JSON idéntico. «Orden de ejemplo» = los `ejemplo` de `ordenesDisponibles()`. Cada criterio se comprueba con las dos fábricas.

**Forma**

- **C1.** `id` ∈ `SIMULADORES`, `versionContrato === 1`, `pasoFijoS` es número > 0 e igual a `PASO_FIJO_S[id]`; todos los métodos de §2 (salvo `antigua`) son funciones; `averias.catalogo` y `averias.activas` también.
- **C2.** Fresca: `tiempo()` es `{ pasos:0, tS:0, restoS:0 }`; `registro().ordenes` está vacío; `registro().semilla === 7`.
- **C3.** `crearSimulacion` lanza un `Error` con `codigo` para: semilla `1.5`, `0`, `'x'`; escenario de otro simulador (`simulador_incompatible`); escenario con `versionContrato: 2` (`version_incompatible`); escenario con una clave de `condiciones` desconocida (`escenario_invalido`).

**Tiempo y paso fijo**

- **C4.** `avanzar(x)` con `x` ∈ `{ -1, NaN, Infinity, -Infinity, '1', null, undefined, {} }` → `ok:false, motivo:'dt_invalido'`; con `3600.5` → `'dt_excesivo'`; en ambos casos `tiempo()` y `estado()` iguales a antes y ningún evento.
- **C5.** `avanzar(0)` no cambia `tiempo()` ni `estado()` y no emite eventos.
- **C6.** Tras `avanzar(1)`: `tiempo().pasos === Math.floor((1 + EPS_PASO_S) / pasoFijoS)` (10 en la HTST, 0 en la FV a 2 s) y `datos.pasos` igual a eso; `restoS` = `1 − pasos × pasoFijoS` (0 en la HTST, 1 en la FV); `tS === pasos × pasoFijoS`. Tras `avanzar(pasoFijoS)` sobre otra fresca: exactamente 1 paso y `restoS` 0 (con ello la FV sigue cubierta aunque `avanzar(1)` no dé pasos).
- **C7.** Sobre dos frescas: `avanzar(0.1)` ×10 frente a `avanzar(1)` → mismos `pasos` y `estado()` igual. Ídem `avanzar(0.25)` ×40 frente a `avanzar(10)`, y `avanzar(7)`+`avanzar(3)` frente a `avanzar(10)`.
- **C8.** `avanzarPasos(n)` con `n` = `Math.round(10 / pasoFijoS)` (5 en la FV a 2 s, 100 en la HTST) deja el mismo estado que `avanzar(10)`; `avanzarPasos(-1)`, `(1.5)`, `(36001)` → `'pasos_invalidos'` sin cambios.
- **C9.** Determinismo: dos frescas con la misma semilla, la misma secuencia de órdenes de ejemplo intercaladas con `avanzar(5)` → `estado()` igual tras cada operación y la misma lista de eventos (JSON).
- **C10.** Semilla: el `estado()` tras `avanzar(600)` de dos frescas con semillas 7 y 8 es distinto en al menos un número (los dos modelos usan la semilla: FV en el desajuste de paneles y la nubosidad; HTST en el ruido de los lazos, para lo que la prueba activa antes `AV-RUIDO-4-20`; si `averias.catalogo()` no la tiene, el criterio se da por cumplido con la FV).

**Estado**

- **C11.** `estado()` está congelado en profundidad (todo objeto alcanzable cumple `Object.isFrozen`); en modo estricto, asignar a una propiedad lanza; después `estado()` es igual al de antes.
- **C12.** Ningún número de `estado()` es `NaN`, en la fresca y tras `avanzar(3600)`.
- **C13.** `JSON.parse(JSON.stringify(estado()))` no lanza (sin ciclos ni `BigInt`).

**Órdenes**

- **C14.** `ordenesDisponibles()` no está vacía, cada `tipo` es único, todos los `ORDENES_COMUNES` están, y todos los tipos pertenecen a `ORDENES_COMUNES ∪ ORDENES_POR_SIMULADOR[id]`; cada descripción tiene `texto` y `ejemplo` con `ejemplo.tipo === tipo`.
- **C15.** Cada `ejemplo` ejecutado en una fresca da `ok:true` o `motivo:'no_permitida'`.
- **C16.** Rechazos, cada uno sin cambiar `estado()`, `tiempo()` ni `registro()`, y emitiendo un único evento `orden_rechazada`: `ejecutar(null)`, `ejecutar({ tipo:'x' })` sin `origen` y con `origen:'hacker'` → `'orden_invalida'`; tipo inexistente → `'orden_desconocida'`; una orden de ejemplo con destino `'NO-EXISTE'` (si la orden lleva destino) → `'destino_desconocido'`; con un valor numérico 10⁹ (si tiene valores numéricos con `max`) → `'valores_invalidos'`.
- **C17.** `ejecutar` acepta una orden congelada en profundidad sin lanzar y no la modifica.
- **C18.** Tras `avanzar(2)` y una orden con `ok:true`, la última entrada de `registro().ordenes` es `{ paso: tiempo().pasos, orden }` con la orden igual a la enviada; se ha emitido un evento `orden` con ese `paso`.
- **C19.** `registro()` devuelve un objeto nuevo: mutarlo no cambia el siguiente `registro()`.

**Repetición, instantáneas y reinicio**

- **C20.** Repetición: una sesión con 5 órdenes de ejemplo en pasos distintos, una avería activada, `avanzar` con trozos irregulares (0.07, 0.33, 1, 2.5, 13) y un `avanzar(0.05)` final; repetir su `registro()` con el algoritmo de §3.3 (escrito en la prueba con la API pública) → `estado()` igual, `registro()` igual y los mismos eventos `orden`/`averia`/`disparo`/`alarma`.
- **C21.** `instantanea()` sobrevive a `JSON.parse(JSON.stringify(x))` con igualdad profunda.
- **C22.** Tomar `x = instantanea()` en `t1`; avanzar y ejecutar órdenes; `restaurar(JSON.parse(JSON.stringify(x)))` → `ok:true` y `estado()`, `tiempo()`, `registro()`, `averias.activas()` iguales a los de `t1`; después, la misma secuencia de operaciones que siguió a `t1` en la original da el mismo `estado()` final (incluido `restoS`: la secuencia empieza con `avanzar(0.05)`).
- **C23.** `restaurar` de una instantánea de otro simulador, con `versionContrato: 2`, con otro `pasoFijoS` o con `{}` → `ok:false` con el motivo de §2.9, sin cambios.
- **C24.** `reiniciar()` tras avanzar, ejecutar órdenes y activar una avería → `estado()` igual al de una fresca con la misma semilla, `tiempo()` a cero, `averias.activas()` vacía, `registro().ordenes` vacío; los suscriptores siguen recibiendo eventos (llega `reinicio`). `reiniciar({ semilla: 8 })` ≡ fresca con semilla 8.

**Eventos**

- **C25.** `suscribir` devuelve una función; tras llamarla (dos veces, sin error) ya no llegan eventos.
- **C26.** Un suscriptor que lanza no impide que otro suscriptor reciba el mismo evento ni cambia el `Resultado`.
- **C27.** Desde dentro de un suscriptor, `avanzar`, `ejecutar`, `restaurar` y `reiniciar` devuelven `'reentrada'`; `estado()` y `medir` funcionan.
- **C28.** Todo evento tiene `tipo` ∈ `TIPOS_EVENTO_SIM`, `paso` entero y `tS` número; los `paso` de una misma llamada no decrecen; los eventos están congelados.
- **C29.** Activar una avería del catálogo (la primera que no requiera parámetros, con sus valores por defecto) emite `averia` con `accion:'activada'`; quitarla emite `'quitada'`.

**Medidas**

- **C30.** `puntos()` no está vacía; cada punto tiene `id`, `instrumento` ∈ `INSTRUMENTOS`, `magnitudes` ⊆ `MAGNITUDES_POR_SIMULADOR[id][instrumento]`, `texto`; `(instrumento, id)` es único.
- **C31.** Para cada punto (muestra de hasta 200) y cada magnitud suya, `medir` devuelve una `Medida` con `valida` booleano y `texto` no vacío; si `valida`, `valor` es número no `NaN` (o falta en magnitudes compuestas) y hay `unidad`; si no, `motivo` ∈ `MOTIVOS`.
- **C32.** `medir` no cambia `estado()`, `tiempo()` ni `registro()` (ni con la muestra completa de C31).
- **C33.** `medir` con instrumento inexistente → `'instrumento_desconocido'`; con punto inexistente → `'punto_desconocido'`; con una magnitud de otro instrumento → `'magnitud_invalida'`; con `null` → `'peticion_invalida'`. Emite el evento `medida` también para las no válidas.

**Averías**

- **C34.** `averias.catalogo()` no vacío; ids únicos; cada avería tiene `titulo`, `equipos` no vacío, `dificultad` ∈ {1,2,3}, `sintomas` (lista), `solucion.accion` ∈ `ACCIONES_REPARACION`; si tiene `firma`: 3 pistas, `medidasClave` no vacía, cada `peticion` cumple C30 contra `puntos()` (salvo `elemento` de termografía, que se comprueba con `medir`), los `distractores` existen en el catálogo, `escenario.simulador === id`, y la firma entera sobrevive a JSON con igualdad.
- **C35.** `averias.activar` con id inexistente → `'averia_desconocida'`; `averias.quitar` con una instancia **mal formada** (p. ej. `'NO-EXISTE'`, que no es id del catálogo FV ni `I<número>` de la HTST) → `'instancia_desconocida'`; con una **bien formada pero no activa** (la prueba la toma del catálogo: `catalogo()[0].id` en la FV, `'I99'` en la HTST; también la de un `quitar` ya hecho) → `'no_permitida'`; `averias.limpiar` deja `activas()` vacía. Esto es compatible con C15: el `ejemplo` de `averias.quitar` es una instancia bien formada y no activa en la simulación fresca, o sea `'no_permitida'`, que C15 admite. La prueba NO DEBE derivar el caso mal formado de una instancia «inexistente» sin más: debe usar una cadena que no sea ni id de catálogo ni `I<n>`.
- **C36.** `averias.reparar` con una acción y destino que no corresponden a ninguna avería activa → `ok:true, datos.correcta:false`, y la avería sigue en `activas()`; con la `solucion` del catálogo (accion y tag) → `datos.correcta:true` y la avería ya no está.
- **C37 (solo cuando el programador cierre las firmas HTST).** Toda avería de los dos catálogos tiene `firma`, y para cada una: en su escenario, tras `esperaS`, todas sus `medidasClave` (con `preparar` ejecutado como órdenes) caen en `esperadoAveria` con la avería y en `esperadoSano` sin ella. Mientras falten firmas HTST, la prueba lo marca como pendiente (`todo`), no como fallo. **Repaso tras pasar la FV a 2 s:** `esperaS` y el escenario van en segundos, no en pasos, así que no se reescriben; hay que comprobar que (a) `avanzarLargo(s, esperaS)` deja el estado esperado con el acumulador (si `esperaS` no fuera múltiplo de 2 sobra un `restoS` sin consumir: los de hoy, 120/700/2400 s, lo son); (b) todas las medidas clave siguen cayendo en `esperadoAveria` con la avería y en `esperadoSano` sin ella (los márgenes de los rangos pueden estar ajustados al paso de 1 s); (c) ninguna firma depende de un transitorio de menos de 2 s; (d) las medidas con `preparar` (abrir un seccionador y medir enseguida) no suponen que `avanzar(1)` da un paso.

**Reglas estáticas**

- **S1.** Ningún archivo `.js` de `simulador_fotovoltaica/js/modelo/`, `simulador_fotovoltaica/js/averias/`, `simulador_planta_real/js/modelo/`, `simulador_planta_real/js/averias/`, `simulador_planta_real/js/plc/` ni `comun/js/nucleo/` contiene `Math.random`, `Date.now`, `performance.now`, `new Date(` ni `crypto.` (fuera de comentarios).
- **S2.** `contrato_fv.js` y `contrato_htst.js` se cargan con `require` en Node sin `window` y exportan `{ id, crearSimulacion }`.
- **S3.** Las pruebas existentes de los dos simuladores siguen pasando (la API antigua no cambia).

**API de eventos del aula** (pruebas en `aula_pct23/tests/`, con el cliente de Flask)

- **A1.** `POST /api/eventos` sin `csrf` o con uno falso → 400 con JSON que tiene `guardados: 0` y `error`.
- **A2.** Con CSRF válido y sin alumno autorizado (anónimo; profesor) → 204 y nada guardado.
- **A3.** Alumno autorizado, lote de 3 eventos válidos → 200 `{ guardados:3, descartados:0, duplicados:0 }` y la línea de tiempo del profesor los muestra en orden; el alumno guardado es el de la sesión aunque el cuerpo traiga otro campo `usuario`.
- **A4.** `eventos` que no es JSON, que es un objeto, una lista vacía o de 51 elementos, o de más de 24 000 caracteres → 400 JSON y nada guardado.
- **A5.** Petición de más de 32 KB → 413 con JSON.
- **A6.** Lote con 1 válido, 1 con verbo `'hackeo'`, 1 con verbo `'entrego'`, 1 con `nota: 11` y 1 con `simulador` no asignado → `{ guardados:1, descartados:4, duplicados:0 }`.
- **A7.** Reenviar el mismo lote → `{ guardados:0, descartados:0, duplicados:n }`.
- **A8.** `POST /api/reto/resultado` válido sigue devolviendo `{ guardado: true }` y además deja un evento `entrego` con la nota.
- **A9.** `GET /aula/eventos.xapi.json` sin profesor → no da datos (redirige o 403); con profesor → lista de sentencias con `verb.id` de `VERBOS_XAPI` y un `actor` sin nombre ni correo; `desde=xx` → 400.
- **A10.** Con 20 000 eventos guardados de un alumno, uno nuevo hace que se borre el más antiguo (el total no pasa de 20 000).

**De presentación** (§12; estáticos, sobre los archivos, sin navegador salvo C47). «Hojas» = `simulador_fotovoltaica/css/*.css`, `simulador_planta_real/css/*.css`, `comun/css/*.css`, `aula_pct23/static/**/*.css` y los bloques `<style>` de los `*.html` de esas carpetas y de `aula_pct23/templates/`. «Interfaz» = `*/index.html`, `*/*.html`, `*/js/interfaz/*.js`, `*/js/scada2d/*.js`, `comun/js/diagnostico/*.js`, `aula_pct23/templates/*.html`.

- **C38 (presentación).** Las hojas no contienen colores literales (`#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(`, `rgba(`, `hsl(`, `hsla(`) fuera de bloques `:root { … }` (o `:root[data-…]`/`@media (prefers-color-scheme)` que solo redefinen variables). Excepción permitida: `transparent`, `currentColor`, `inherit`. Los `var(--x, #fallback)` cuentan como literales (hay que quitarlos).
- **C39 (presentación).** El naranja de marca `#F68B11` (en cualquier capitalización, y su `rgb(246, 139, 17)`) aparece como valor solo en la definición de `--pol-naranja`; ningún `.js` de la interfaz escribe colores de marca literales (sí `var(--pol-…)`).
- **C40 (presentación).** La hoja común define en `:root` todas las variables de `VARIABLES_IDENTIDAD` y `VARIABLES_ESTADO` de `comun/tipos.js` (`--pol-*`, `--estado-servicio`, `--estado-aviso`, `--estado-alarma`, `--estado-parado`), con `--pol-naranja: #F68B11`, `--pol-sobre-naranja: #212121`, `--pol-radio-boton: 2px` y `--pol-radio-panel` ≤ 4px; ninguna `--estado-*` vale lo mismo que `--pol-naranja` ni apunta a una `--pol-*`.
- **C41 (presentación).** Ninguna hoja ni `.js` de la interfaz contiene `linear-gradient`, `radial-gradient` ni `conic-gradient`.
- **C42 (presentación).** Todo `box-shadow` es `none`, `var(--pol-sombra)`, tiene desenfoque ≤ 3px y opacidad ≤ 0,12 (el máximo de la guía), o es la marca de alarma `inset 0 -4px 0 var(--error)` / `inset 0 -4px 0 var(--estado-alarma)` (indicador de estado, no decoración); ningún `text-shadow` salvo `none`.
- **C43 (presentación).** Toda regla cuyo selector incluya `button`, `.boton`, `[role=button]` o `input[type=button|submit]` tiene `border-radius` `var(--pol-radio-boton)` o ≤ 2px; ninguna regla tiene `border-radius` > 4px salvo: (a) `50%` en elementos circulares (LED, indicador); (b) las píldoras de estado de la guía §5 (`.etiqueta`, chips de estado del aula, insignias de alarma), que se leen como indicador y no como botón; (c) la barra del aula (`#aula-barra` y sus botones, `aula_pct23/templates/barra_simulador.html`), que conserva sus píldoras por decisión 7 del usuario: aquí manda el contrato aunque la guía diga 4px. Las excepciones se leen de `EXCEPCIONES_RADIO` de `comun/tipos.js`.
- **C44 (presentación).** Toda declaración `font-family` de las hojas es `var(--pol-fuente)`, `var(--pol-mono)` o un alias antiguo (`var(--fuente)`) que apunte a ellas, y la hoja común define `--pol-fuente: Raleway, "Segoe UI", Roboto, Arial, sans-serif` y `--pol-mono` terminada en `monospace`. Única excepción: el `@font-face` de `Raleway` de la hoja común, que carga `comun/css/fuentes/raleway-latin-wght-normal.woff2` (SIL OFL 1.1, licencia en `comun/css/fuentes/OFL-Raleway.txt`) y que el aula sirve en `/comun/` junto con `.js` y `.css`.
- **C45 (presentación).** La interfaz no contiene emojis: ningún carácter en los rangos U+1F300–U+1FAFF, U+1F000–U+1F2FF, U+2600–U+27BF (salvo los de `SIMBOLOS_PERMITIDOS`: ⚠ U+26A0, ✔ U+2714, ✕ U+2715, ✖ U+2716 y ✘ U+2718) ni el selector de variación U+FE0F. Siguen prohibidos, entre otros, ★ U+2605 y ♪ U+266A. Los símbolos técnicos fuera de esos rangos (⎓, ∿, Ω…) se admiten.
- **C45b (presentación).** Toda regla de botón cuyo `background`/`background-color` sea `var(--pol-naranja)` tiene `color: var(--pol-sobre-naranja)` (nunca blanco); ninguna regla usa `color: var(--pol-naranja)` (para texto, `--pol-naranja-texto`).
- **C46 (presentación).** Cada `index.html` de simulador tiene en su cabecera (`<header>`) un `<img>` cuyo `src` contiene `logo-politecnico` y con `alt` no vacío, y el nombre del simulador en un encabezado; y su pie (`<footer>`) contiene literalmente «© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.»
- **C47 (presentación, en navegador).** En cada `index.html` cargado, `getComputedStyle(document.body).fontFamily` empieza por `Raleway` y los elementos marcados como medida (`.medida`, `[data-medida]`) usan `--pol-mono`.

---

## 11. Riesgos detectados (no arreglados; los resuelve el adaptador o se deciden)

- **R1. La fotovoltaica depende del troceo del tiempo.** `simulador_fotovoltaica/js/modelo/simulacion.js:317-321`: `avanzar` trocea en micro-pasos de hasta 5 s con el último más corto, y cada micro-paso saca números del generador (`:114-115`, ruido de nubes con `sqrt(dt)·normal`), integra con exponenciales (`:186`) y avanza el ruido de cargas (`red_cargas.js:26-28`): `paso(1)` y diez `paso(0.1)` dan resultados distintos. Además la interfaz llama a `paso(0.2)` al pausar (`js/interfaz/pagina_simple.js:160, 199`) y subdivide según la velocidad (`:286, :383`). El adaptador DEBE llamar al micro-paso siempre con `pasoFijoS` (decidido: 2 s; ver R12).
- **R2. `paso(0)` de la FV no es neutro.** `simulacion.js:319` hace `micro(0)` y `publicar()`; y cada orden antigua llama a `refrescar()` (`:323`) que hace otro `micro(0)` (que no saca azar, `:113, :190`, pero sí pasa `dt = 0` por EASun, ZCS, batería y cargas). El contrato pide `avanzar(0)` sin efectos; las órdenes sí pueden refrescar (es determinista porque las órdenes están en el registro).
- **R3. Estado vivo y mutable en la FV.** `simulacion.js:68` y `:297`: `sim.estado` es el mismo objeto siempre, modificado con `Object.assign`. El adaptador debe publicar una copia congelada (`estado()`), y la API antigua conserva su objeto vivo.
- **R4. `leerMedida` maniobra.** `simulador_fotovoltaica/js/averias/catalogo.js:351-373`: con `maniobrar` abre y vuelve a cerrar protecciones (y cada una refresca el modelo). En el contrato `medir` no cambia nada; la preparación son órdenes `preparar` explícitas.
- **R5. Instantánea cara en la FV.** El estado interno vive en cierres (`cadenas`, `referencia`, EASun, ZCS, batería, cargas y el generador `rng` con su estado en una variable local: `constantes.js:40`). Serializarlo obliga a tocar seis módulos. Recomendado: instantánea por repetición del registro (coste proporcional al tiempo simulado: una hora a 1 s son 3 600 pasos).
- **R6. RESUELTO (§4.3): el control y el llenado son órdenes del modelo.** Texto original: Control y llenado de la HTST en la interfaz. `simulador_planta_real/js/interfaz/pagina_simple.js:398-410` (PID o histéresis del calentador con `dtS = 0.25 × velocidad`) y `:298-302` (llenado de depósitos), ejecutados en el temporizador de 250 ms (`:476-479`): su resultado depende de la velocidad elegida, y mandan hasta ~12 órdenes `manual` por segundo, que llenarían el registro. Con el contrato funcionan (son órdenes con `origen:'sistema'` y se repiten bien), pero el resultado sigue dependiendo de la velocidad. Propuesta en el plan §6.
- **R7. Recorte silencioso.** `simulador_planta_real/js/modelo/simulacion.js:142` limita `dt` a 3600 sin avisar; `:149-150` recortan las consignas; `simulador_fotovoltaica/js/averias/motor.js:18-19` recorta parámetros de avería. El contrato rechaza (`'dt_excesivo'`, `'valores_invalidos'`): el adaptador valida antes de llamar.
- **R8. `reiniciar` de la HTST conserva cosas.** `simulacion.js:178-182`: conserva las averías por defecto, no reinicia el contador de instancias del motor (`motor.js:19, :64`: tras reiniciar, la siguiente es `I3` y no `I1`) ni cambia la semilla. El adaptador debe crear un motor nuevo.
- **R9. `Infinity` en el estado de la HTST.** `js/modelo/estado.js:17, :41` y `fisica_hidraulica.js:14` (`tiempoResidenciaS` sin caudal), `simulacion.js:41` (`bobinaOhm` con `AV-BOBINA-ABIERTA`). En `JSON` salen `null`: vale para comparar, pero una instantánea serializada tal cual perdería el valor (C21/C22). Igual con los rangos `OL` de las firmas FV (`catalogo.js:125`).
- **R10. Estado de la HTST fuera de `estado`.** `simulacion.js:21-24`: `mem` (memoria del PLC), `salidas`, `ord` (órdenes pendientes que el PLC consume en el siguiente tick, `:127-129`), `pbRestoS`, `pulsoTSH`, `restoDt`, `registroAI`, `modoAnterior` y las instancias del motor. Una instantánea que solo guardara `estado()` no restauraría bien: o se serializa todo eso o se restaura por repetición.
- **R11. Coma flotante entre motores.** El modelo usa `Math.exp`, `Math.sin`, `Math.log`, `Math.sqrt`… cuya precisión no fija la especificación de JS: un registro grabado en Safari del iPad puede no dar exactamente el mismo estado al repetirlo en Node o en Chrome, y una alarma de umbral puede saltar en un paso distinto. El contrato solo garantiza la igualdad en el mismo motor. Para «reproducir la sesión de un alumno» en el panel del profesor, la repetición debe hacerse en el navegador del profesor y aceptar diferencias pequeñas.
- **R12. Coste del paso en la FV. RESUELTO: `PASO_FIJO_S.fotovoltaica = 2`.** Hoy a ×3600 se dan micro-pasos de 5 s (720 por segundo real). Medido por el programador: con 1 s cuesta 125–235 ms de CPU por segundo real a ×3600 (0,6–1 s en un iPad lento); con 2 s ≈ 125 ms; con 5 s ≈ 97 ms. Decisión del usuario: 2 s y, solo si hiciera falta, 5 s (basta cambiar esa constante: los registros guardan su `pasoFijoS` y `repetir` rechaza uno distinto, así que un registro grabado con otro paso no se repite). Consecuencias: (a) `avanzar(1)` en la FV da 0 pasos y acumula en `restoS`; (b) las firmas, escenarios y `esperaS` se expresan en **segundos** y no en pasos, así que no cambian, pero `esperaS` conviene que sea múltiplo del paso (los de hoy, 120/700/2400 s, lo son) y los transitorios más cortos que 2 s ya no se resuelven; (c) las medidas de las firmas pueden moverse algo (detalle de los transitorios) y C37 debe repasarse (§10).
- **R13. La HTST mide «contra masa».** `simulador_planta_real/js/modelo/medidas.js:149`: `puntoB` se ignora. Coherente con el contrato (la HTST ignora `b`), pero una medida diferencial entre dos puntos de la HTST no existe.
- **R14. `manual(tag, valor)` admite cualquier tag.** `simulacion.js:156` guarda lo que le llegue en `ord.manual` (el PLC lo filtra después). El contrato restringe los destinos a §4.3.
- **R15. Errores 400/413 del aula en HTML.** `aula_pct23/app.py:654-658` solo responde JSON para `/api/reto`; `:664-666` el 413 es siempre HTML. Hay que extenderlos a `/api/eventos` (A1, A5).

---

## 12. Presentación: identidad y textos

Obliga a todo simulador del contrato y al aula (`aula_pct23`). **En presentación manda `comun/UX_IDENTIDAD.md`** (la escribe y mantiene UX): valores, usos y excepciones están allí; este apartado solo fija lo que se puede comprobar de forma automática, con los nombres de variables de la guía.

1. **Colores de marca** (CIFP Politécnico de Cartagena) solo con las variables `--pol-*` de la guía (§1.1): `--pol-naranja` (#F68B11), `--pol-naranja-texto`, `--pol-naranja-suave`, `--pol-sobre-naranja`, `--pol-gris-oscuro`, `--pol-gris`, `--pol-gris-claro`, `--pol-blanco`, `--pol-titulo`, `--pol-texto`, `--pol-texto-suave`, `--pol-borde`, `--pol-borde-fuerte`, `--pol-foco`. Se definen una vez en `:root` de la hoja común (`comun/css/identidad.css`, que carga cada página antes de su propia hoja) y en ningún otro sitio se escribe un color de marca a mano: ni en CSS, ni en atributos `style`, ni en el SVG que generan los `.js` de la interfaz (usan `var(--pol-…)`). Las variables antiguas (`--acento`, `--acento-texto`, `--texto`, `--foco`, `--fuente`…) pueden quedarse como alias que apuntan a las `--pol-*`.
2. **Botón primario:** fondo `var(--pol-naranja)` con texto `var(--pol-sobre-naranja)` (#212121); el blanco sobre el naranja no cumple el contraste WCAG. El naranja nunca se usa para texto pequeño sobre blanco (para eso, `--pol-naranja-texto`).
3. **Colores de estado** del sinóptico, aparte y comunes, sin prefijo de marca: `--estado-servicio` (verde, en servicio), `--estado-aviso` (ámbar), `--estado-alarma` (rojo), `--estado-parado` (gris). No cambian ni se sustituyen por los de marca, y el naranja de marca no se usa dentro del sinóptico. `--ok`, `--aviso`, `--error` y `--apagado` quedan como alias suyos.
4. **Tipografía:** `--pol-fuente: Raleway, "Segoe UI", Roboto, Arial, sans-serif` para todo; `--pol-mono` (monoespaciada) para las medidas numéricas, que se marcan con la clase `medida` o el atributo `data-medida`.
5. **Cabecera y pie:** cabecera con el logo del centro (`logo-politecnico.png`, el de `simulador_pct23/img/` y `aula_pct23/static/img/`, con `alt`) y el nombre del simulador; pie con el copyright existente «© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.»
6. **Formas:** `--pol-radio-boton` (2px) en botones y `--pol-radio-panel` (4px, máximo) en paneles y tarjetas; sin degradados; `--pol-sombra` (`none`; como mucho `0 1px 3px rgba(0,0,0,.12)` en una capa flotante); sin emojis (sí símbolos técnicos normalizados como ⚠, ⎓, ∿, Ω, y ✔ ✕ ✖ ✘ como marcas). Excepciones decididas: la marca de alarma `inset 0 -4px 0` en rojo de estado (es un indicador, no una sombra); las píldoras de estado de la guía §5 (`.etiqueta`, chips de estado, insignias de alarma); y la barra del aula (`#aula-barra`, `aula_pct23/templates/barra_simulador.html`), que conserva sus píldoras por decisión del usuario aunque la guía diga 4px: en este punto manda el contrato.
7. **Textos:** voz de profesor de FP, tuteando, frases cortas, sin relleno, según la sección «Textos» de `comun/UX_IDENTIDAD.md`. Afecta a los `texto` de `Resultado`, `Medida`, `DescripcionOrden`, avisos y firmas de avería que produce el modelo, además de la interfaz. No es comprobable automáticamente: lo revisa UX en la fase 3.

Los criterios automáticos son C38–C47 (con C45b) (§10, «De presentación»): el agente de pruebas los pone en un archivo aparte (`comun/tests/presentacion.test.js`) para no mezclarlos con la prueba de contrato del modelo. Hoy fallarán casi todos (las hojas actuales usan colores literales y `var(--x, #fallback)`): es trabajo de la interfaz gráfica en la fase 2.

---

## 13. Estado de cumplimiento

Fotografía del arquitecto a 13-11-2026, a la vista de lo entregado por el programador (núcleo `comun/js/nucleo/*`, `contrato_fv.js`, `contrato_htst.js`, automatismos del operador en `simulacion.js` de la HTST, `aula_pct23/app.py`) y de la lectura del código. **Las suites no se han ejecutado en esta pasada**: «cumple» significa «implementado como dice el contrato»; lo confirma el agente de pruebas. Estados: **cumple** · **pendiente pruebas** (hay que escribir, ajustar o ejecutar la prueba) · **pendiente interfaz** (lo hace la interfaz gráfica).

| Criterio | Estado | Nota |
|---|---|---|
| C1–C3 forma y creación | cumple | C1: con `PASO_FIJO_S.fotovoltaica = 2` la prueba sigue valiendo (compara con la constante) |
| C4, C5 | cumple | |
| C6 | pendiente pruebas | Redefinido para `pasoFijoS` > 1 s (FV a 2 s: `avanzar(1)` = 0 pasos, `restoS` 1) |
| C7, C8 | pendiente pruebas | Siguen valiendo; comprobar que no suponen 1 paso por `avanzar(1)` y que `Math.round(10 / pasoFijoS)` da 5 en la FV |
| C9, C10 | cumple | Repasar C10 con la FV a 2 s (la semilla debe seguir moviendo el estado tras `avanzar(600)`) |
| C11–C13 estado | cumple | |
| C14 | pendiente pruebas | `controlTemperatura` y `llenarDepositos` pasan a ser públicas: ya no son «ocultas» y deben aparecer en `ordenesDisponibles()` |
| C15 | cumple | `ejemplo` de las dos órdenes nuevas: `ok:true` sin preparación; `averias.quitar` (instancia bien formada no activa): `no_permitida` |
| C16–C19 órdenes | cumple | |
| C20–C24 repetición, instantáneas, reinicio | cumple | Comprobar que el registro de la FV graba `pasoFijoS: 2` y que `repetir` rechaza uno distinto |
| C25–C29 eventos | cumple | |
| C30–C33 medidas | cumple | FV: `b` obligatorio, `IMAGEN` y `CAS-001`, unidades `p.u.` y `escalones` (§5.2) |
| C34 | cumple | |
| C35 | pendiente pruebas | Regla única nueva en §4.1: mal formada → `instancia_desconocida`; bien formada no activa → `no_permitida` |
| C36 | cumple | |
| C37 FV | pendiente pruebas | Repaso por el paso de 2 s (§10, C37) |
| C37 HTST | pendiente pruebas | Mientras falten firmas se queda en `todo`; si el programador las ha cerrado, debe pasar a exigencia |
| S1, S2 | cumple | |
| S3 (API antigua) | pendiente pruebas | Ejecutar las suites de los dos simuladores tras el cambio de paso fijo |
| A1–A10 API del aula | pendiente pruebas | Implementadas en `aula_pct23/app.py` (§8); faltan/ejecutar las de `aula_pct23/tests/` y las de `/api/registro_sesion` y del campo `sesion` de `/api/reto/resultado` |
| C38–C47, C45b presentación | pendiente interfaz | Hoy fallarán casi todos (§12); `comun/css/identidad.css` y la migración de hojas y `.js` de la interfaz |
| Migración de la interfaz a `Simulacion` (retirar `antigua()`) | pendiente interfaz | |
| Línea de tiempo y reproducción de la sesión (§8.3) | pendiente interfaz | La página actual es mínima, sin plantilla propia |

---

## 14. Historial

- v1 (13-11-2026): primera versión cerrada a partir del código del commit `a56a696`. Añadido el apartado 12 (presentación) a petición del usuario.
- v1.1 (13-11-2026, tras la entrega del programador): `controlTemperatura` y `llenarDepositos` y `estado().operador` pasan a la parte pública (§4.3, R6 resuelto); regla única de `averias.quitar` (§4.1, C35); `PASO_FIJO_S.fotovoltaica` = 2 (R12 resuelto; C6, C7, C8 y C37 ajustados); precisiones de la FV (`b` obligatorio, `IMAGEN`/`CAS-001`, unidades `p.u.` y `escalones`); `sesion` en `/api/reto/resultado` y `/api/registro_sesion` (§8.2); sección «Estado de cumplimiento».
