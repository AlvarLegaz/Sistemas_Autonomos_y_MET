# Planta real HTST de leche: arquitectura del segundo simulador

Segundo simulador, **separado del de la maqueta PCT23** (`simulador_pct23`), que representa una **planta industrial real de pasteurización HTST de leche** y sirve para formar a alumnos de **mantenimiento electrónico**: ven la planta en un SCADA 2D y en 3D, y el profesor provoca **averías electrónicas** que el alumno diagnostica con un multímetro y un osciloscopio virtuales.

Este documento lo escribe el arquitecto y lo siguen los agentes programador-modelo, programador-interfaz, diseñador y tester. Los datos compartidos (equipos, posiciones, señales) están en código en [`js/layout.js`](js/layout.js): **ese archivo es el contrato; no se cambia sin pedirlo al arquitecto**.

> **Todo lo numérico son valores típicos de la literatura, ilustrativos.** El 72 °C durante 15 s, los 0,07 bar de diferencial y los rangos de los instrumentos son ejemplos. Los plazos y requisitos legales dependen del producto y de la normativa del país y no sustituyen a la que aplique al centro.

## 1. Alcance

Dentro:
- Una planta HTST completa (tanque de balance → regeneración → calentamiento → tubo de residencia → válvula de desvío → regeneración → enfriamiento → salida), con agua caliente, agua fría, aire comprimido, armario eléctrico y PLC.
- Un **PLC simulado** con su programa (arranque, producción, desvío, paro de seguridad, CIP básico y alarmas) y su mapa de entradas y salidas (4–20 mA, 0–10 V, 24 V CC).
- Un **motor de averías electrónicas** (sensores, lazos, alimentación, actuadores, potencia, neumática y comunicaciones) más unas pocas de proceso visibles por instrumentación.
- **SCADA 2D** y **planta 3D** con las mismas lecturas, y ventana aparte para verlos a la vez (como en `simulador_pct23`).
- **Herramientas del alumno**: multímetro y osciloscopio virtuales, hoja de diagnóstico y hoja de calibración de lazos.
- **Panel del profesor** para elegir averías.

Fuera (de momento): fluidodinámica real, dosificación de CIP con conductividad, normativa de registros, múltiples líneas, modelos fotorrealistas y carga de `.glb` (solo se prepara el punto de entrada, §9).

## 2. La planta

### 2.1 Proceso (de la entrada a la salida)

```
 TK-101 → FLT-101 → P-101 (VFD-101) → FT-101 → HX-101/regeneración (lado crudo) → P-103 (booster)
        → HX-101/calentamiento (agua caliente) → HT-101 (tubo de residencia) → TT-103
        → FDV-101 ─┬─ AVANCE → HX-101/regeneración (lado pasteurizado, enfría al crudo) → HX-101/enfriamiento (agua fría) → TT-104 → SALIDA
                   └─ DESVÍO → vuelve a TK-101 (leche que no llegó a temperatura)
 Agua caliente: HW-101 (2 bancos de resistencias) + P-102 → HX-101/calentamiento   (TT-105, TSH-101)
 Agua fría: XV-301 → HX-101/enfriamiento.   CIP: XV-401 + agua caliente.   Aire: FRL-101 → SV-101 → FDV-101 (PSL-201).
```

Valores de ejemplo (ilustrativos): leche cruda a 4 °C; tras la regeneración ≈ 66 °C; tras el calentamiento ≈ 73,5 °C (consigna de TT-103); tras la regeneración del lado pasteurizado ≈ 11 °C; salida a ≈ 4 °C con agua fría. Caudal nominal 2000 L/h, máximo 2500 L/h. El tubo de residencia HT-101 tiene **10,5 L**, que a 2500 L/h da **15,1 s** (`PROCESO` en `layout.js`).

### 2.2 Lista cerrada de equipos

Los 42 equipos con su tag ISA, nombre, tipo y zona están en `EQUIPOS` de `layout.js`; su posición en el patín, en `POSICIONES_CM`. Resumen por grupo:

| Grupo | Tags |
|---|---|
| Proceso | TK-101 tanque de balance · FLT-101 filtro de aspiración · P-101 bomba centrífuga de alimentación (con variador) · P-103 bomba booster del lado crudo · HX-101 intercambiador de placas (regeneración, calentamiento, enfriamiento) · HT-101 tubo de residencia · FDV-101 válvula de desvío neumática de 3 vías |
| Neumática | SV-101 electroválvula piloto (24 V CC, muelle a desvío) · FRL-101 unidad de aire |
| Agua caliente y fría | HW-101 calentador de agua con dos bancos (con nivel de agua) · P-102 bomba del agua caliente · XV-301 agua fría · XV-401 CIP |
| Llenados y vaciados | XV-101 llenado y XV-102 vaciado del tanque de balance · XV-302 llenado y XV-303 vaciado del depósito de agua caliente · LSL-301 flotador de nivel bajo del agua caliente (protege las resistencias) |
| Temperatura | TT-101 entrada · TT-102 tras la regeneración (lado crudo) · TT-103 salida del tubo (**termómetro legal**) · TT-104 salida · TT-105 agua caliente · TSH-101 termostato de seguridad (NC) |
| Caudal, presión, nivel | FT-101 caudalímetro electromagnético · PT-101 y PT-102 presiones (crudo y pasteurizado) · LT-101 nivel · LSH-101 y LSL-101 flotadores |
| Posición y aire | ZS-101 y ZS-102 finales de carrera de la FDV · PSL-201 presostato de aire |
| Eléctrico y control | QE-001 armario · PS-001 fuente 24 V CC · F-201 fusible de 24 V · QF-102 magnetotérmico de P-102 y calentador · VFD-101 variador · KM-102, KM-103, KM-201, KM-202 contactores · ES-001 paro de emergencia · PB-001 pulsador · PLC-001 · HMI-001 · HL-001 baliza |

### 2.3 Control y enclavamientos (lo que hace el PLC)

- **Modos** (`MODOS`, con su texto en `MODOS_INFO`): `PARADA`, `MANUAL`, `RECIRCULACION_AGUA` (se calienta con agua hasta estabilizar), `PRODUCCION` y `CIP`.
- **Modo MANUAL:** el operador manda cada actuador con `ordenes.manual(tag, valor)`: P-101, P-102, P-103, KM-201, KM-202 (los dos bancos del calentador, 30 kW cada uno), SV-101 (FDV: 1 = avance, 0 = desvío), XV-301, XV-401, XV-101, XV-102, XV-302, XV-303 (todo: 0/1 o true/false) y `VFD-101` (velocidad 0–100 %). El PLC no automatiza nada: ni consigna de temperatura, ni caudal, ni FDV, ni reposición de niveles. Solo mantiene las **protecciones cableadas**: paro de emergencia ES-001 y pérdida de 24 V (paran toda la planta); termostato TSH-101 abierto, calentador sin nivel (LSL-301), sin P-102 en marcha o con TT-105 ≥ 88 °C (cortan el calentador); aire bajo PSL-201 (FDV a desvío); tanque de balance vacío (LSL-101) o fallo del variador (paran P-101). Al pasar a MANUAL cada actuador conserva lo que hacía (transferencia sin saltos); al volver a un modo automático (o a PARADA) se sueltan las órdenes manuales. Si se fuerza la FDV en avance sin cumplir las condiciones, el producto cuenta como **no conforme** y sale la alarma A220; la alarma de estado M100 («modo manual activo») no enciende la baliza.
- **Llenados y vaciados:** XV-101 llena el tanque de balance (2600 L/h) y XV-102 lo vacía (2400 L/h); XV-302 llena el depósito de agua caliente con agua de red a 15 °C (1500 L/h, enfría el agua) y XV-303 lo vacía (1800 L/h). Ambos depósitos tienen rebosadero (no pasan del 100 %). La masa de agua condiciona la inercia térmica del agua caliente. En los modos automáticos el PLC repone el tanque de balance con XV-101 (histéresis 85–95 % con LT-101) y el depósito de agua con XV-302 (al perderse LSL-301 llena hasta recuperarlo y 330 s más).
- **Calentamiento:** los bancos de HW-101 se conectan por todo/nada con histéresis sobre TT-105 y el banco 2 se ajusta en cascada con TT-103. Solo con P-102 en marcha y TSH-101 normal.
- **FDV (seguridad positiva):** SV-101 energizada = avance; sin tensión o sin aire el muelle la deja en **desvío**. Solo se pasa a avance si TT-103 ≥ 72 °C **y** el tiempo de residencia (volumen del tubo / caudal de FT-101) ≥ 15 s **y** ΔP de regeneración ≥ 0,07 bar **y** el aire está bien **y** TT-103 y FT-101 tienen lazo sano. Cualquier fallo de TT-103 o de FT-101 pasa a desvío.
- **Regeneración:** el lado pasteurizado debe estar a más presión que el crudo (PT-102 − PT-101 ≥ 0,07 bar). P-103 (booster) solo marcha con P-101 en marcha, FDV en avance y ΔP correcto.
- **Paro de seguridad:** ES-001 abierto, TSH-101 abierto, fuente 24 V caída o fallo del variador → desvío, bancos fuera, bombas paradas, baliza (en MANUAL solo ES-001 y los 24 V paran toda la planta; el resto son cortes locales, ver arriba).
- **Lazos 4–20 mA:** < 3,6 mA = hilo roto; > 21 mA = sobreescala/cortocircuito (`LIMITES_LAZO_MA`, criterio NAMUR NE43). El PLC marca la **calidad** de cada AI y no se fía de un valor con lazo en fallo.
- **Discrepancias:** orden del PLC ≠ realimentación (DO de un contactor frente a su auxiliar, SV-101 frente a ZS-101/102) durante más de 3 s → alarma.
- **CIP básico:** secuencia por tiempos (enjuague → sosa caliente → enjuague → ácido → enjuague) con XV-401, agua caliente y FDV en avance, sin modelar la dosificación ni la conductividad.
- **Alarmas** (códigos, ejemplos): A101 hilo roto, A102 sobreescala, A110 ΔP regeneración baja, A120 FDV no sigue la orden, A130 contactor no sigue la orden, A140 fuente o fusible, A150 variador, A160 aire bajo, A170 TSH, A180 ES, A190 comunicación.

## 3. Señales y PLC

El mapa completo está en `SENALES` de `layout.js` (35 señales: 9 AI, 16 DI, 9 DO, 1 AO) con tag, tipo, canal, señal, rango y lógica del 1. Resumen:

| Tarjeta | Canales | Señal |
|---|---|---|
| AI-1 | AI1.01–AI1.08: TT-101…TT-105, FT-101, PT-101, PT-102 | 4–20 mA (lazos de 2 hilos a 24 V) |
| AI-2 | AI2.01: LT-101 | 4–20 mA |
| DI-2 | DI2.01: LSL-301 nivel bajo del agua caliente (NC) | 24 V CC |
| DI-1 | DI1.01–DI1.16: ES-001, TSH-101, LSH-101, LSL-101, ZS-101, ZS-102, PSL-201, P-101 marcha, KM-102, KM-103, KM-201, KM-202, VFD-101 fallo, QF-102, PS-001, PB-001 | 24 V CC; los de seguridad son NC: **0 = fallo o hilo roto** |
| DO-1 | DO1.01–DO1.13: P-101, P-102, P-103, KM-201, KM-202, SV-101, XV-301, XV-401, HL-001, XV-101, XV-102, XV-302, XV-303 | relé, 24 V |
| AO-1 | AO1.01: referencia del variador | 0–10 V |

**Diferencia con la maqueta PCT23:** allí las señales son 0–3,3 V y 10 mV/°C; aquí son industriales. Hay que dejarlo claro a los alumnos.

## 4. Modelo de estado y flujo de datos

La simulación se hace en **capas**, y las averías actúan entre ellas:

```
proceso (física) → instrumentos [+ averías de sensor/lazo] → señales de PLC (AI/DI)
   → programa del PLC → salidas (DO/AO) → actuadores [+ averías de actuador/potencia] → proceso
```

El estado completo es un solo objeto (contrato **v1**, definido por el programador-modelo en `js/modelo/estado.js` y no cambiado sin avisar a interfaz y diseñador):

```js
estado = {
  version: 1, tiempoS, modo,                    // modo ∈ MODOS
  tanque: { nivelPct, volumenL, temperaturaC },
  proceso: { caudalLh, temperaturas: { entrada, trasRegeneracion, trasCalentamiento, salidaTubo, salidaFinal, aguaCaliente },
             presiones: { crudoBar, pasteurizadoBar }, tiempoResidenciaS },
  equipos: {                                    // un registro por tag de EQUIPOS, con los campos que tengan sentido
    'P-101': { marcha, velocidadPct, caudalLh, corrienteA, temperaturaDisipadorC, fallo },
    'FDV-101': { posicion, apertura01, aireOK }, // posicion ∈ POSICIONES_FDV
    'SV-101': { energizada, bobinaOhm },
    'HW-101': { banco1, banco2, potenciaKW, temperaturaC },
    'KM-201': { cerrado, pegado },               // pegado = avería
    'HX-101': { regeneracion: {...}, calentamiento: {...}, enfriamiento: {...}, fugaPlaca01 },
    'FLT-101': { obstruccion01 },                // …y el resto de tags
  },
  instrumentos: {                                // lo que ve el PLC, por tag de AI/DI
    'TT-103': { valorProceso, mA, valorPLC, calidad },   // calidad ∈ CALIDAD_SENAL
    'ES-001': { nivel },                                 // digitales: 0 o 1 (ya con la lógica NC aplicada)
  },
  salidasPLC: { DO: {…}, AO: {…} },
  alarmas: [{ codigo, tag, nivel, desdeS, texto }],
  contadores: { producidoL, desviadoL, energiaKWh, noConformeL },
  aguaCaliente: { nivelPct, volumenL, temperaturaC },     // depósito de HW-101; también equipos['HW-101'].nivelPct/volumenL
  // equipos['TK-101'].desbordando = true si se llena con rebosadero; equipos['XV-101'|'XV-102'|'XV-302'|'XV-303'].abierta; equipos['LSL-301'].contactoCerrado
  averiasActivas: [{ instancia, id, tags }],
}
```

**API de la simulación** (`PCT.htst.simulacion`), la única superficie que ven interfaz y diseñador:

```js
crearSimulacion({ semilla }) → {
  estado(),                       // el objeto de arriba, de solo lectura
  paso(dtS),                      // avanza el tiempo simulado; paso fijo interno de 0,1 s
  ordenes: { arrancar(), parar(), consignaTemperaturaC(c), consignaCaudalLh(q), modo(m), pulsador(tag), manual(tag, valor) },
  senales(),                      // { AI: { tag: { mA, valor, calidad } }, DI: { tag: 0|1 }, DO: {…}, AO: {…} }
  alarmas(), medidas,             // medidas: ver §6.3
  averias,                        // el motor de averías (§6.2)
  reiniciar()
}
```

## 5. Módulos y rutas de archivos

Todo lo propio vive en `simulador_planta_real/`; lo compartido se carga de `/simulador/js/...` (§7).

```
simulador_planta_real/
  ARQUITECTURA.md  index.html  visor3d.html  servir_local.py
  css/planta_real.css
  js/layout.js                           ← ARQUITECTO (contrato, no se toca)
  js/configuracion/constantes.js         ← MODELO   (parámetros físicos y de control)
  js/modelo/{estado,fisica_termica,fisica_hidraulica,instrumentos,medidas}.js   ← MODELO
  js/plc/{programa,alarmas,calidad_senal}.js    ← MODELO   (el programa del PLC, funciones puras)
  js/averias/{catalogo,motor}.js         ← MODELO
  js/interfaz/{pagina,panel_profesor,multimetro,osciloscopio,hoja_registro,textos_ayuda,visor_htst}.js   ← INTERFAZ
  js/scada2d/{esquema_htst,leyenda}.js   ← INTERFAZ   (esquema 2D con los objetos SCADA compartidos)
  js/visor3d_htst/*.js                   ← DISEÑADOR (escenas por equipo y el montaje de la planta)
  modelos/                               ← DISEÑADOR (vacío; los .glb, §9)
  tests/                                 ← cada uno los suyos (§8) y TESTER las de integración
```

**Contrato común de módulos.** Los módulos 3D siguen el de `layout.js` (`crear(THREE, estado)` → `{ grupo, elementos, actualizar, liberar }`). Los de modelo y PLC son **IIFE con doble exportación** (`module.exports` en Node, `PCT.htst*` en el navegador, como `estado_planta.js` o `lecturas.js` del simulador de la maqueta) y dejan en funciones **puras** todo lo calculable, para probarlo con `node --test`. El espacio de nombres es `PCT.htst*` para no chocar con `PCT.planta` del simulador de la maqueta (que se carga en la misma página).

## 6. Averías electrónicas

### 6.1 Esquema de datos de una avería (`js/averias/catalogo.js`)

```js
{
  id: 'AV-FUSIBLE-F201', nombre: 'Fusible de 24 V fundido',
  capa: 'sensor' | 'lazo' | 'alimentacion' | 'actuador' | 'potencia' | 'neumatica' | 'proceso' | 'comunicaciones',
  equipos: ['F-201'],                       // tags afectados (existen en EQUIPOS)
  dificultad: 1 | 2 | 3,
  parametros: { magnitud: { tipo: 'numero', min, max, defecto, unidad } },     // p. ej. el offset de una deriva
  efectos: [{ gancho: 'instrumento' | 'salida' | 'proceso' | 'alimentacion', tag, modificacion }],
  sintomasScada: ['Alarma A140 y todos los lazos a 0 mA…'],
  sintomas3d: [{ tag, efecto: 'resaltar_rojo' | 'cable_cortado' | 'goteo' | 'led_apagado' | 'contactos_cerrados' }],
  diagnostico: [{ paso, instrumento: 'multimetro' | 'osciloscopio', punto, esperado, conAveria }],
  solucion: { texto, accion: 'sustituir' | 'reparar' | 'ajustar' | 'limpiar' | 'recalibrar', tag },
  alarmasEsperadas: ['A140'], pistas: ['…']        // pistas graduales para la hoja del alumno
}
```

### 6.2 API del motor (`js/averias/motor.js`, funciones puras salvo el estado interno)

```js
crearMotorAverias(catalogo) → {
  listar(),                                  // el catálogo, para el panel del profesor
  inyectar(idCatalogo, parametros?),         // → idInstancia (varias a la vez; rechaza una incoherente con otra ya activa)
  quitar(idInstancia),                       // el profesor la retira
  reparar(idInstancia, { accion, tag }),     // el alumno ejecuta la solución: si es la correcta, se quita; si no, se anota el intento
  activas(),                                 // las instancias con su tiempo de vida e intentos
  // ganchos que usa la simulación en cada paso:
  alLeerInstrumento(tag, valorProceso, tS) → { mA, calidad },      // sensor/lazo
  alAccionarSalida(tag, ordenPLC, tS) → ordenFisica,               // actuador/potencia
  alCalcularProceso(estado) → void,                                // fugas, obstrucciones
  alimentacion(estado) → { v24, fusibleF201 },                     // fuente y fusible
  codigo() → 'HTST-…',  desdeCodigo(texto)                         // para compartir una avería sin servidor
}
```

**Cómo la elige el profesor.** Versión 1 (sin cambios en el servidor): panel del profesor en la página, visible solo para el profesor (el aula puede marcarlo, §7.3), que **inyecta averías** o genera un **código** (`HTST-…`) o un enlace (`?averia=`) que el alumno abre o pega para cargar exactamente la misma avería. Versión 2 (futura): asignación por alumno en el aula, con un endpoint del aula.

### 6.3 Medidas (`js/modelo/medidas.js`, propiedad del modelo, porque dependen de las averías)

Hay **puntos de medida** con identificador (`QE-001:X1.3`, `TT-103:+`, `F-201:ENTRADA`…) y una función pura `medir(instrumento, puntoA, puntoB, modo, estado)` que devuelve: para el multímetro, tensión, corriente (en serie), resistencia o continuidad; para el osciloscopio, una **forma de onda** (24 V CC con rizado, ruido en un 4–20 mA, PWM, etc.). Es lo que permite diagnosticar de verdad (medir 0 mA, medir 24 V antes y después del fusible, medir la bobina). La interfaz (`multimetro.js`, `osciloscopio.js`) solo la dibuja.

### 6.4 Catálogo inicial (16 averías)

| id | Equipo | Qué pasa | Síntomas SCADA | Síntomas 3D | Diagnóstico | Solución |
|---|---|---|---|---|---|---|
| AV-LAZO-ABIERTO | TT-10x, FT-101, PT-10x | Cable roto o bornas flojas en el lazo | 0 mA, calidad ABIERTO, A101; TT-103 o FT-101 → desvío | cable cortado y etiqueta roja | Medir mA en serie (0) y 24 V en las bornas del transmisor | Reconectar o sustituir el cable |
| AV-PT100-ABIERTA | TT-10x | Pt100 abierta; el transmisor da burnout alto | > 21 mA, A102, lectura a fondo de escala | sonda con elemento roto | Medir la resistencia de la Pt100 en frío (∞) | Sustituir la sonda |
| AV-PT100-CORTO | TT-10x | Pt100 en corto | lectura muy baja (≈ 3,6 mA), A102 | sonda en rojo | Resistencia ≈ 0 Ω | Sustituir la sonda |
| AV-DERIVA-TT103 | TT-103 | Deriva de calibración (parámetro: ±°C) | Sin alarma; si lee alto, el producto sale sin pasteurizar y solo el balance de temperaturas lo delata | sin cambio visible | Comparar con un termómetro patrón en baño y con TT-102/TT-104 | Recalibrar o sustituir (no se anula) |
| AV-RUIDO-4-20 | FT-101 (o cualquier AI) | Interferencia del variador: ruido de ± x mA | Lectura inestable, alarmas A102 intermitentes | cable sin apantallar junto al variador | Osciloscopio sobre el lazo: picos a la frecuencia del variador; malla sin tierra | Cable apantallado, malla a tierra en un extremo, separar de la potencia |
| AV-FUSIBLE-F201 | F-201 | Fusible de 24 V de instrumentos fundido | A140 y todos los lazos a 0 mA a la vez; desvío y paro | fusible con LED apagado | 24 V antes del fusible sí, después no | Buscar la causa del cortocircuito y sustituirlo |
| AV-FUENTE-24V | PS-001 | Fuente que baja a 18 V con rizado | Lazos saturados, A140, el PLC a veces se reinicia | LED de la fuente apagado o parpadeante | Multímetro: < 24 V; osciloscopio: rizado | Sustituir la fuente |
| AV-KM-PEGADO | KM-201 | Contactos soldados: el banco sigue calentando con orden 0 | A130 (DO = 0 y auxiliar = 1), T sube sin control, puede saltar TSH-101 | contactor con los contactos cerrados | Tensión en la carga con la orden a 0; resistencia de contactos | Sustituir el contactor y revisar la causa (arco o sobrecorriente) |
| AV-KM-NO-CIERRA | KM-102, KM-103 | Contactos quemados o bobina sin fuerza | A130 (DO = 1 y auxiliar = 0), P-102 parada, T no sube | contactor abierto | Tensión en bobina (24 V) y en bornas de la carga (0) | Sustituir el contactor |
| AV-BOBINA-ABIERTA | SV-101 | Bobina del piloto abierta | A120, la FDV nunca llega a avance (ZS-101 = 0), no hay producción | piloto sin brillo | 24 V en bornas del piloto con la orden; la bobina da ∞ Ω | Sustituir la bobina |
| AV-FDV-ATASCADA | FDV-101 | Vástago atascado en avance | A120: al pedir desvío, ZS-102 no llega; el PLC debe parar la bomba | FDV con vástago fuera | ZS-102 y presión de aire; accionar el piloto manual | Desmontar y reparar la válvula |
| AV-AIRE-BAJO | FRL-101 | Fuga o regulador mal ajustado | A160 (PSL-201 = 0), FDV lenta, conmutación a desvío | manómetro en rojo | Manómetro y presostato; buscar la fuga | Reparar la fuga y ajustar el regulador |
| AV-VFD-SOBRETEMP | VFD-101 | Disipador a más de 80 °C por ventilador parado o filtro sucio | A150, P-101 para, caudal 0 | variador en rojo | Temperatura del disipador, ventilador, filtro | Limpiar o sustituir el ventilador |
| AV-PLACA-FUGA | HX-101 | Placa perforada en la regeneración | A110: PT-102 − PT-101 por debajo de 0,07 bar o invertido | goteo en el bastidor | Comparar PT-101 y PT-102; prueba de presión | Localizar la placa y sustituirla (juntas incluidas) |
| AV-FILTRO-OBSTRUIDO | FLT-101 | Colador atascado | FT-101 y la presión de aspiración caen, P-101 con ruido y corriente baja | colador oscuro | Presión antes y después; caudal con velocidad constante | Limpiar el colador |
| AV-TSH-DISPARADO | TSH-101 | Disparo real o falso contacto del termostato | A170, calentador fuera, rearme manual | termostato en rojo | Continuidad del contacto NC en frío; temperatura real de TT-105 | Rearmar tras encontrar la causa; sustituir si no cierra en frío |

Quedan fuera de la primera versión (por si hace falta ampliar): fallo de comunicación SCADA–PLC (calidad CONGELADO), magnetotérmico QF-102 disparado, electrodos del FT-101 sucios o tubería no llena. Están ya previstos en `CALIDAD_SENAL` y `QF-102`.

## 7. Reutilización de `simulador_pct23` y servicio desde el aula

### 7.1 Qué se reutiliza sin copiar

Las páginas de la planta real cargan el código compartido **desde `/simulador/js/…`** (la carpeta `simulador_pct23`), no copian nada:

| Se reutiliza | Archivos |
|---|---|
| Base | `js/utilidades/modulos.js` (crea `PCT`), `matematicas.js`, `interfaz/dom.js`, `interfaz/bucle.js`, `css/interfaz.css` |
| Gráficas y SCADA 2D | `interfaz/grafica.js`, `escala_grafica.js`, `grafica_activaciones.js` (comprobar que sirven con otros datos); `interfaz/scada/*` (Canvas, ObjetoScada, Tuberia, Valvula, Sensor, Deposito, Etiqueta…). El **esquema de la HTST es nuevo** (`scada2d/esquema_htst.js`) |
| Ayuda | `interfaz/ayuda.js`, `pulsacion_larga.js`, `ayuda_textos.js` (se **amplía** con `Object.assign` sobre `ELEMENTOS` y `ETIQUETA_POR_TEXTO`, sin tocar el original) |
| Visor 3D | `visor3d/controles_orbita.js`, `visor3d.js` (con el cambio de §7.2), `especificaciones.js` (se extiende `MODELOS`), `lecturas.js`, `escena_valvula.js` (sirve para SV-101); `js/vendor/three.js` |
| **No se reutiliza** | la escena de bomba (`escena_bomba.js`) es **peristáltica**; en la planta real las bombas son centrífugas. Se toma solo el patrón. Tampoco los modelos de la maqueta |

### 7.2 Fase 0: tres puntos de extensión en `simulador_pct23` (los hace el programador-interfaz, con regresión del tester)

El visor 3D de la maqueta (con sus arreglos de rendimiento, el modo lento, el cierre en ventana aparte…) conviene **reutilizarlo y no duplicarlo**, y hoy tiene tres puntos fijos. Cambios mínimos y sin efecto sobre el simulador actual:

1. `visor3d.js`, en `iniciarMotor`: el mapa fijo `{ intercambiador:…, bomba:…, valvula:…, planta:… }` pasa a consultar antes un registro: `(PCT.visor3dEscenas && PCT.visor3dEscenas[MODELOS[clave].escena]) || mapaActual[...]`.
2. `visor3d.js`, en `fotograma`: usar `MODELOS[clave].lecturas` y `MODELOS[clave].observaciones` si existen, y si no, `lecturasModelo` y `PCT.planta.observaciones(estado)` de siempre.
3. `ayuda.js`: `TITULOS_GUIA[tipo]` con valor de reserva si el tipo es nuevo (`'planta_real'`).

Tras eso, la planta real solo **registra** su escena (`PCT.visor3dEscenas.htst = PCT.htstEscenaPlanta`), añade `MODELOS.HTST` con `escena: 'htst'` y deja sus ids con el prefijo `TUBO_` en las tuberías (el panel las oculta solas de la lista de etiquetas). Sin estos tres cambios habría que duplicar `visor3d.js`, que es la alternativa descartada: se perderían los arreglos de rendimiento que ya funcionan en el ordenador del usuario.

### 7.3 Cómo se sirve desde el aula

Hoy `aula_pct23/app.py` sirve **solo** `.html .css .js .png .svg .ico .json` desde `simulador_pct23` en `/simulador/`, con sesión de alumno autorizado o profesor. Propuesta:

| Archivo | Cambio (lo hace el programador-interfaz; el despliegue necesita el visto bueno del usuario) |
|---|---|
| `aula_pct23/app.py` | Nueva clave de configuración `planta_real` (`AULA_PLANTA_REAL`, por defecto `../simulador_planta_real`) y rutas `/planta-real/` y `/planta-real/<ruta>` que **reutilizan la misma función** de `/simulador/` (refactor a `servir(raiz, ruta, nombre_pagina)`), con la misma comprobación de acceso, las mismas extensiones y la misma exclusión de `tests`. `PAGINAS_SIMULADOR += ("planta_real",)`. La página `visor3d.html` de la planta real, como la de la maqueta, no lleva la barra del aula |
| `aula_pct23/Dockerfile` | `COPY simulador_planta_real /app/planta_real`, `RUN rm -rf /app/planta_real/tests /app/planta_real/*.md` y `ENV AULA_PLANTA_REAL=/app/planta_real` |
| `.dockerignore` | `!simulador_planta_real` y `simulador_planta_real/tests` |
| `deploy/desplegar_aula_vm.sh` | Añadir `simulador_planta_real` al `git archive` y excluir `simulador_planta_real/tests` |
| nginx | Sin cambios: todo pasa por el proxy |
| CSP del aula | Sin cambios: `default-src 'self'` y `script-src 'self' 'unsafe-inline'` cubren las rutas propias y las compartidas |
| Profesor | La barra del aula ya conoce `es_profesor`; para el panel de averías hay que exponer ese dato a la página (por ejemplo `window.PCT_ES_PROFESOR = true`, inyectado solo si la sesión es de profesor) |
| Pruebas del aula | Casos nuevos en `aula_pct23/tests/test_aula.py`: acceso a `/planta-real/`, exclusión de `tests`, extensiones |

**Rutas relativas entre las dos carpetas** (decisión): las páginas de la planta real usan **rutas absolutas con el mismo prefijo en local y en el aula**: `/simulador/js/...` para lo compartido y rutas relativas (`js/...`) para lo propio. Para que valga también en local, [`servir_local.py`](servir_local.py) (incluido en el esqueleto) sirve `/simulador/` → `simulador_pct23` y `/planta-real/` → esta carpeta, con las mismas rutas que el aula y sin caché, y bloquea las rutas con `../`. Se usa así: `python simulador_planta_real/servir_local.py` y se abre `http://localhost:8091/planta-real/`. El `deploy/servidor_sin_cache.py` existente sirve una sola carpeta y no sirve para esto.

## 8. Reparto de tareas (propiedad de archivos, sin solapes)

Regla: **cada archivo tiene un solo dueño**; quien necesite un cambio en un archivo ajeno lo pide, no lo hace. Nadie cambia `layout.js` ni el contrato v1 del estado sin pasar por el arquitecto.

### PROGRAMADOR-MODELO
- **Es dueño de:** `js/configuracion/*`, `js/modelo/*` (incluido `medidas.js`), `js/plc/*`, `js/averias/*`, y `tests/modelo_*.test.js`, `tests/plc_*.test.js`, `tests/averias_*.test.js`.
- **Entrega:** `PCT.htst.simulacion` (§4): física térmica e hidráulica por capas (regeneración con efectividad ≈ 0,9, calentamiento hacia la temperatura del agua, tiempo de residencia = volumen / caudal, presiones relativas), instrumentos con conversión 4–20 mA y calidad de señal, el programa del PLC (§2.3) en funciones puras, el motor y el catálogo de averías (§6) y las medidas (§6.3). Todo con `node:test`.
- **Criterio de hecho:** la planta arranca, estabiliza TT-103 en la consigna, pasa a producción, desvía si baja la temperatura, y **cada avería del catálogo** produce sus síntomas y se resuelve con su solución, con pruebas automáticas.

### PROGRAMADOR-INTERFAZ
- **Es dueño de:** `index.html`, `visor3d.html`, `css/planta_real.css`, `js/interfaz/*`, `js/scada2d/*`, y `tests/interfaz_*.test.js`. **Excepciones acordadas (archivos ajenos):** los tres puntos de §7.2 en `simulador_pct23/js/interfaz/{visor3d.js, ayuda.js}` y los cambios del aula de §7.3 (`aula_pct23/app.py`, `Dockerfile`, `.dockerignore`, `deploy/desplegar_aula_vm.sh`, `aula_pct23/tests/test_aula.py`). Cada uno de esos cambios va en su propio commit.
- **Entrega:** la página (SCADA 2D con los objetos compartidos, controles, alarmas, gráficas y registro CSV como en la maqueta), el botón «Planta 3D» en ventana aparte, el **panel del profesor**, el **multímetro y el osciloscopio virtuales** (solo dibujan lo que calcula `medidas.js`), las hojas de diagnóstico y de calibración de lazos, y las **ayudas por equipo** (`textos_ayuda.js`).
- **Criterio de hecho:** el flujo completo en el aula: el profesor inyecta una avería, el alumno la ve, mide, la resuelve y queda registrada.

### DISEÑADOR
- **Es dueño de:** `js/visor3d_htst/*`, `modelos/` y `tests/diseno_*.test.js`.
- **Entrega:** modelos 3D **procedurales** de acero inoxidable con acabado reconocible: tri-clamp, tubería sanitaria, bastidor de placas con paquetes de placas instanciadas, tanque de balance, bombas centrífugas con voluta y motor, FDV con actuador neumático, tubo de residencia en serpentín, calentador, armario eléctrico abierto con variador, contactores, bornas y fuente, sondas con cabezal, y el montaje de toda la planta (`escena_planta.js`). Cada equipo: `crear(THREE, estado)` según el contrato, con **ids = tag** y **anclas** para las etiquetas. Los **efectos visuales de las averías** (`cable_cortado`, `goteo`, `led_apagado`, `contactos_cerrados`, `resaltar_rojo`) se aplican leyendo `estado.averiasActivas` y el campo `sintomas3d` del catálogo.
- **Criterios de rendimiento (obligatorios):** el PC del usuario va justo y ya hubo cuelgues con una escena de 110 000 triángulos y materiales pesados. Por eso: **`MeshLambertMaterial` por defecto** (como la planta de la maqueta, con `?calidad=alta` opcional), **ni sombras ni `MeshPhysicalMaterial` ni antialias**; presupuesto: **≤ 500 llamadas de dibujo y ≤ 150 000 triángulos** en la escena completa; placas y tornillería con **`InstancedMesh`**; geometrías compartidas; sin crear objetos en `actualizar`; texturas de texto solo se redibujan si cambia el texto. Debe seguir funcionando el modo lento automático del visor.
- **Criterio de hecho:** se ve cada equipo, se selecciona, se anima según el estado y muestra su avería; la escena completa abre en un PC modesto sin colgarse.

### TESTER
- **Es dueño de:** `tests/integracion_*.test.js`, `tests/navegador/*` y `INFORME_TESTER.md`. **Solo lee** el código de los demás y les devuelve fallos; no lo arregla.
- **Entrega:** (1) pruebas `node:test` de contrato: `layout.js` coherente (tags únicos, canales sin repetir, señales y posiciones con equipo), el estado v1 con todos los campos que leen interfaz y diseñador, la API de simulación y del motor; (2) un **barrido de averías**: para cada una, inyectarla, comprobar los síntomas SCADA y los alarmas esperadas, aplicar la solución y comprobar que se apaga; y que ninguna avería rompe la seguridad positiva (la FDV desvía ante un fallo de TT-103 o de FT-101); (3) regresión de `simulador_pct23` (las 121 pruebas y apertura de sus modelos 3D) tras los cambios de §7.2; (4) pruebas en navegador (el navegador integrado de Claude, con la GPU real; Playwright con SwiftShader se ha mostrado inestable en este equipo) de apertura, giro, selección, ventana aparte, modo lento y ausencia de errores en la consola, con el recuento de llamadas de dibujo por escena frente al presupuesto.
- **Criterio de hecho:** informe con lo comprobado y lo no comprobado, y los fallos abiertos por agente.

### Interfaces entre agentes (congeladas en v1)
- Modelo → Interfaz y Diseñador: `PCT.htst.simulacion` y el estado de §4.
- Modelo → Interfaz: `medidas.medir(...)` (§6.3) y `averias.listar/inyectar/quitar/reparar` (§6.2).
- Interfaz ↔ Diseñador: la escena se registra como `PCT.visor3dEscenas.htst` y se abre con `PCT.visor3d.abrir('HTST', …)`; los `ELEMENTOS` de ayuda por tag los escribe Interfaz.
- Cualquiera → Arquitecto: cambios de contrato.

### Orden de trabajo
1. **Fase 0** (hecha por el arquitecto): este documento y el esqueleto.
2. **Fase 1, en paralelo:** Modelo (estado, física, instrumentos, PLC) · Diseñador (equipos y montaje de la planta con los tags y las posiciones de `layout.js`) · Interfaz (puntos de extensión de §7.2, página con SCADA 2D y servicio en el aula).
3. **Fase 2:** averías y medidas (Modelo) · efectos 3D de averías (Diseñador) · panel del profesor, multímetro y osciloscopio (Interfaz).
4. **Fase 3:** Tester de integración, hojas de registro, CIP básico y pulido de rendimiento.
5. **Fase 4 (opcional):** `.glb` (§9).

## 9. Modelos `.glb` (política y punto de carga; no implementar ahora)

- **Política:** si aparece un modelo de **mayor calidad** que el procedural y con **licencia compatible** (CC0, o CC-BY con atribución; nunca NC ni ND), se puede usar **sustituyendo un equipo concreto**. **No se descarga nada sin permiso explícito del usuario**: se le pide indicando el nombre del archivo, la fuente, el tamaño y la licencia, como con cualquier descarga. Cada modelo se anota en `modelos/CATALOGO.json` con autor, URL, licencia, fecha y hash.
- **Presupuesto:** ≤ 1,5 MB por modelo y ≤ 8 MB en total, sin texturas de más de 1024 px, sin compresión Draco o meshopt (para no añadir decodificadores). Un `.glb` casi no se comprime con gzip.
- **Punto de carga previsto:** un módulo `js/visor3d_htst/cargador_modelos.js` (del diseñador) con `cargarModelo(tag) → Promise<THREE.Group | null>` que, si no hay `.glb` o falla, devuelve `null` y el equipo se queda con su versión procedural. El visor no espera: carga en segundo plano y sustituye al terminar.
- **Cómo se incorporaría el `GLTFLoader`:** el `js/vendor/three.js` actual es el `three.cjs` de la r169 envuelto como script global y **no incluye** `GLTFLoader`. Habría que generar, una sola vez y fuera de línea, otro script global `simulador_planta_real/js/vendor/gltf_loader.js` (con `GLTFLoader` y sus dependencias, de la misma versión r169, MIT) con el mismo método con que se empaquetó Three.js (`scripts/empaquetar_three.py`, en el proyecto de origen), y cargarlo solo cuando exista un `.glb`.
- **Aula:** `EXTENSIONES_SIMULADOR` debe admitir `.glb` y servirlo como `model/gltf-binary`. Va en el mismo cambio de §7.3, solo cuando haga falta.

## 10. Riesgos y decisiones abiertas

- **Reutilizar el visor 3D** exige tocar `simulador_pct23` (§7.2). Es pequeño y con regresión, pero es la parte con más riesgo para el simulador que ya funciona. La alternativa (un visor propio) duplica los arreglos de rendimiento.
- **Compartir una avería sin servidor** (código o enlace) permite que un alumno la vea de antemano si conoce el código. Para exámenes harán falta las asignaciones del aula (versión 2).
- **El catálogo con soluciones viaja en el cliente.** Un alumno curioso puede leerlo. Es aceptable para formación; para evaluar, habría que servir las soluciones desde el aula.
- **Rendimiento:** el 3D completo es el punto crítico (ver el presupuesto del diseñador). Si un PC no lo aguanta, queda el SCADA 2D.
- **Datos de la planta:** son típicos, no de una instalación concreta. Si el centro tiene un pasteurizador real, convendría ajustar `PROCESO` y los rangos de `SENALES` a sus datos.
