# Diseño: simulador PCT23 (reescritura)

> Nota: esta reescritura sustituyó al simulador original, que se retiró del repositorio. El original sigue en el historial de git (último commit con él: `082baf0`).

Origen (solo lectura): `Sistemas_Autonomos_y_MET/gateway_industrial_excelencia/simulador_pct23/`.
Reglas: todo en castellano (archivos, funciones, variables, constantes); identificadores sin tildes ni ñ, en camelCase
(`aguaCalienteC`, `depositoAMl`) y constantes globales en MAYUSCULAS_CON_GUION. Funciones <= 20 líneas, una responsabilidad.
Comentario solo si el nombre no basta. Sin clases, sin proxies, sin `this`. Mismas ecuaciones, mismo orden de operaciones, mismos números.

## 1. Árbol de archivos
```
simulador_pct23/
  index.html  manual.html  automatico.html  demostracion.html
  DISENO.md  README.md
  css/interfaz.css
  img/                      (copiar favicon.png y logo-politecnico.png)
  js/
    configuracion/
      constantes_fisicas.js     CONSTANTES_FISICAS (ex PARAMS) y SALIDAS
      constantes_control.js     CONFIG_BASE, MODOS_REGULACION, FASES, NOMBRES_FASE, ORDEN_FASES, CAUDALES_DEMO, MARGEN_DEMO
    utilidades/
      modulos.js                crea PCT (solo navegador)
      matematicas.js            limitar, acercarExponencial
    modelo/                     FISICA, sin DOM ni control
      estado_planta.js          crearEstado, activarEjemplo, ponerLlenado, porcentajeLlenado
      termica.js                agua caliente, termostato, temperaturas del producto
      hidraulica.js             depósitos, caudal de producto, frío, desviado/final
      planta.js                 avanzar, avanzarPaso, observaciones (orquesta termica + hidraulica)
    control/                    SECUENCIA Y REGULACION, sin DOM
      alarmas.js                dispararAlarma, reconocer
      regulacion.js             lazos PI y modos del calefactor
      alcanzabilidad.js         t1Estacionaria, t1Alcanzable, t1MaximaDemostracion, configDemostracion
      fases.js                  una función por fase y controlar
      secuencia.js              crearSecuencia, iniciar, ordenarParada, emergencia, terminarProduccion, saltarFase, paso
    interfaz/                   DOM
      dom.js                    $, ponerTexto, ponerClase, marcarEncendido
      registro_eventos.js       lista del registro
      grafica.js                muestrear, pintarGrafica, ajustarLienzo
      scada/                    canvas.js, scada_widget.js, objeto_scada.js, bomba.js, valvula.js, sensor.js, deposito.js, tuberia.js, intercambiador.js, resistencia.js, etiqueta.js, esquema_pct23.js (ver 2b)
      barra_operacion.js        velocidad, menú Más, pestañas (ex interfaz_comun)
      bucle.js                  temporizador de simulación común
      panel_manual.js           controles del modo manual (ex simulador.js)
      panel_automatico.js       ajustes, lecturas y pista de fases (ex secuencia_ui + interfaz_auto)
      ayuda_textos.js           textos de ayuda (datos puros)
      ayuda.js                  ventana de ayuda y guía
      pagina_manual.js  pagina_automatico.js  pagina_demostracion.js   (arranque de cada HTML)
  tests/
    modelo.test.js  regulacion.test.js  fases.test.js  secuencia.test.js  equivalencia.test.js
```

## 2. API pública (nombres exactos)
- **constantes_fisicas.js**: `CONSTANTES_FISICAS` (congelado): `temperaturaAmbienteC, capacidadDepositoMl, caudalMaxN1MlMin, llenadoMlMin, refrigeracionMlMin, vaciadoMlMin, constanteCalentadorS, constanteEnfriamientoS, limiteTermicoC, margenDisparoC, temperaturaRearmeC, constanteCorteS, subidaCalentadorC, eficienciaIntercambio, reduccionPorCaudal, acoplamientoCaudal`. Y `SALIDAS = ['N1','N2','SOL1','SOL2','SOL3','SOL4','SOL5','RES']`.
- **constantes_control.js**: `CONFIG_BASE`, `MODOS_REGULACION`, `FASES`, `NOMBRES_FASE`, `ORDEN_FASES`, `CAUDALES_DEMO`, `MARGEN_DEMO`.
- **matematicas.js**: `limitar(valor, minimo, maximo)`, `acercarExponencial(actual, objetivo, dt, constanteS)`.
- **estado_planta.js**: `crearEstado()`, `activarEjemplo(estado)`, `ponerLlenado(estado, deposito, porcentaje)`, `porcentajeLlenado(estado, deposito)`.
- **termica.js**: `factorAcoplamiento(n2Encendida, caudalPct, fraccionCaudal)`, `avanzarAguaCaliente(estado, dt)`, `revisarTermostato(estado)`, `avanzarTemperaturasProducto(estado, dt)`.
- **hidraulica.js**: `reponerYVaciarDepositos(estado, dt)`, `calcularCaudalProducto(estado, dt)` (devuelve ml drenados), `repartirProductoDrenado(estado, ml)`, `calcularCaudalFrio(estado, dt)`.
- **planta.js**: `avanzar(estado, segundos)`, `avanzarPaso(estado, dt)`, `observaciones(estado)`.
- **alarmas.js**: `dispararAlarma(secuencia, estado, causa, accion)`, `reconocer(secuencia, estado)`.
- **regulacion.js**: `regular(secuencia, estado, dt, fase)`, `lazoT2`, `lazoT1`, `lazoCascada`, `lazoCaudal`, `lazoTodoNada` (mismos argumentos que los originales).
- **alcanzabilidad.js**: `t1Estacionaria(config)`, `t1Alcanzable(caudalPct, potenciaPct)`, `t1MaximaDemostracion()`, `configDemostracion(temperaturaC, origen)`.
- **fases.js**: `controlar(secuencia, estado, dt)`, `controlarArranque`, `controlarPrecalentamiento`, `controlarProduccion`, `controlarLavado`, `controlarParada`, `fijarSalidasComunes`.
- **secuencia.js**: `crearSecuencia(config)`, `iniciar`, `ordenarParada`, `emergencia`, `terminarProduccion`, `saltarFase`, `paso(secuencia, estado, dt)`, `cambiarFase`, `registrarEvento`, `apagarTodo`, `volumenOrigen`, `referenciaMaxima`.
- **interfaz**: `dom.$`, `ponerTexto(id, texto)`, `ponerClase(id, clase)`, `marcarEncendido(id, encendido)`; `registrarEventoEnPantalla(texto)`; `muestrear(estado)`, `pintarGrafica()`, `ajustarLienzo()`; `new ScadaWidget(idContenedor, canvas)`, `crearCanvasPct23()`, `lecturasDeEstado(estado)`; `iniciarBarra(opciones)`; `iniciarBucle(alPaso)`; `iniciarPanelManual(estado)`; `iniciarPanelAutomatico(estado, secuencia)`, `pintarPistaFases(secuencia)`; `iniciarAyuda()`.

## 3. Equivalencias (antiguo -> nuevo)
**Modelo**: `PARAMS`->`CONSTANTES_FISICAS`; `ambiente`->`temperaturaAmbienteC`; `capacidadMl`->`capacidadDepositoMl`; `caudalN1MaxMlMin`->`caudalMaxN1MlMin`; `tauCalentadorS`->`constanteCalentadorS`; `tauEnfriamientoS`->`constanteEnfriamientoS`; `rearmeC`->`temperaturaRearmeC`; `tauCorteS`->`constanteCorteS`; `deltaCalentadorC`->`subidaCalentadorC`; `OUTPUT_IDS`->`SALIDAS`; `clamp`->`limitar`; `crearEstado, activarEjemplo, avanzar, avanzarPaso, observaciones, ponerLlenado, porcentajeLlenado, factorAcoplamiento` se mantienen.
**Estado**: `v3`->`valvulaV3`; `consignas{R,N1V,N2V}`->`consignas{potenciaPct, velocidadN1Pct, velocidadN2Pct}`; `aMl`->`depositoAMl`; `bMl`->`depositoBMl`; `t1,t3,t4,t5`->`t1C,t3C,t4C,t5C`; el resto (`tiempo, ejecutando, velocidad, salidas, giro, aguaCalienteC, caudalProductoMlMin, caudalFrioMlMin, finalMl, desviadoMl, desagueMl, temperaturaCorte, vacio`) igual. Las claves de `observaciones` (T1..T5, F1, L1, HL, LL, TERM) se mantienen: son nombres de sensor.
**Secuencia**: `PCT23Modelo`->`PCT.planta`; `PCT23Secuencia`->`PCT.secuencia` (ver §5); `MODOS`->`MODOS_REGULACION`; `NOMBRES`->`NOMBRES_FASE`; `ORDEN`->`ORDEN_FASES`; `sec`->`secuencia`; `sec.cfg`->`secuencia.config`; `tFase`->`segundosFase`; `tTotal`->`segundosTotal`; `integral`->`integralT2`; `integral2`->`integralInterna`; `enBanda`->`segundosEnBanda`; `resOn`->`resistenciaActiva`; `estable`->`segundosEstable`; `evento`->`registrarEvento`; `dispararAlarma, reconocer, iniciar, ordenarParada, emergencia, saltarFase, terminarProduccion, referenciaMaxima, controlar, paso, volumenOrigen, t1Estacionaria, t1Alcanzable, t1MaximaDemostracion, configDemostracion, lazoT1, lazoT2, lazoCascada, lazoCaudal, regular` se mantienen.
**CONFIG_BASE**: `modoControl`->`modoRegulacion`; `consignaT1/T2`->`consignaT1C/consignaT2C`; `consignaF1`->`consignaF1MlMin`; `estabilizacionS`->`segundosEstabilizacion`; `arranqueS`->`segundosArranque`; `lavadoS`->`segundosLavado`; `tiempoMaxPrecalentamientoS`->`segundosMaxPrecalentamiento`; `kp, ki`->`gananciaP, gananciaI`; `kpExterno, kiExterno`->`gananciaPExterna, gananciaIExterna`; `t2Max`->`consignaT2MaxC`; los demás ya son claros (`potenciaManualPct, histeresisT2C, toleranciaDesvioC, histeresisC, origen, caudalPct, volumenObjetivoMl, volumenAgotadoMl, potenciaPrecalentamientoPct, potenciaMaxPct, enfriarHastaC, volumenMinimoMl`).
**Interfaz**: `simulador.js`->`panel_manual.js` (`actualizarIndicadores`->`actualizarEsquema`; `registrar`->`registrarEventoEnPantalla`; `configurarControles`->`iniciarPanelManual`; `marcar`->`marcarEncendido`; `consigna`->`ponerConsigna`; `actualizar`->`refrescarPantalla`); `secuencia_ui.js`->`panel_automatico.js` (`leerConfig`->`leerConfiguracionDelPanel`; `bloquearConfig`->`bloquearAjustes`; `drenarEventos`->`volcarEventosAlRegistro`; `pintar`->`pintarPanel`; `chip`->`ponerEtiqueta`; `aplicarDeposito`->`aplicarDepositoOrigen`; `vaciarNoSeleccionado`->`vaciarDepositoNoElegido`; `iniciarSelectorModos`->`iniciarSelectorRegulacion`; `reiniciar`->`reiniciarPlanta`; `configurar`->`iniciarPanelAutomatico`); `interfaz_auto.js` (`termometro`->`pintarTermometro`; `pieT2`->`textoPieT2`; `pintar`->`pintarPistaFases`); `interfaz_comun.js`->`barra_operacion.js`; `ayuda.js` (`clave`->`claveDelElemento`; `viva`->`textoEstadoVivo`; `abrir`->`abrirAyuda`; `cerrar`->`cerrarAyuda`; `montar`->`montarAyuda`); `grafica`/`ajustarLienzo`/`muestrear` se mantienen.
**Archivos**: `modelo.js`->`modelo/*`; `secuencia.js`->`control/*`; `interfaz.css`->`css/interfaz.css`. Los ids y clases del DOM/SVG NO se renombran (el CSS se copia tal cual; el SVG pasa a generarse desde esquema_pct23.js con los mismos ids/clases).

## 4. Orden de carga (`<script src>` clásicos, sin type=module)
Todas las páginas, en este orden:
1. `utilidades/modulos.js`, `utilidades/matematicas.js`
2. `configuracion/constantes_fisicas.js`, `configuracion/constantes_control.js`
3. `modelo/estado_planta.js`, `termica.js`, `hidraulica.js`, `planta.js`
4. (solo automático y demostración) `control/alarmas.js`, `regulacion.js`, `alcanzabilidad.js`, `fases.js`, `secuencia.js`
5. `interfaz/dom.js`, `registro_eventos.js`, `grafica.js`, `esquema.js`, `barra_operacion.js`, `bucle.js`, `ayuda_textos.js`, `ayuda.js`
6. `panel_manual.js` + `pagina_manual.js` (manual) o `panel_automatico.js` + `pagina_automatico.js` / `pagina_demostracion.js`
Regla de dependencias: un archivo solo usa los de más arriba; modelo no conoce control; control no conoce interfaz.

## 5. Navegador y Node sin bundler
Convención única, la misma 4 líneas en todos los archivos de configuracion, utilidades, modelo y control:
```js
// cabecera: una línea por dependencia
const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
// ... código en funciones sueltas ...
// pie
const api = { avanzarAguaCaliente, revisarTermostato };
if (typeof module !== 'undefined') module.exports = api; else PCT.termica = api;
```
- `utilidades/modulos.js` solo hace `var PCT = {};` (en Node no se carga). Los archivos se envuelven en `(function () { ... })();` para no ensuciar el ámbito global; el pie va dentro.
- Nombres en `PCT`: `matematicas, constantesFisicas, constantesControl, estadoPlanta, termica, hidraulica, planta, alarmas, regulacion, alcanzabilidad, fases, secuencia`.
- La interfaz usa solo `PCT.*` y no se prueba en Node (no hay DOM); sus funciones de cálculo puro (formato de textos) se dejan en funciones sueltas separadas.
- Los tests hacen `require('../js/modelo/planta.js')` directamente.

## 6. Tests (`node --test tests/`)
Portar `modelo.test.js` y `secuencia.test.js` del original con los nombres nuevos; añadir `regulacion.test.js` y `fases.test.js` pequeños (un caso por lazo/fase). `equivalencia.test.js`: ejecuta modelo+secuencia antiguos (require de la carpeta original, solo lectura) y nuevos en 3 escenarios (ejemplo manual 600 s; automático en cascada hasta finalizar; demostración a 70 C) y compara con `assert.strictEqual` temperaturas, niveles y volúmenes cada 10 s (tolerancia 0).

## 7. Lotes (cada uno <= ~300 líneas; hacerlos en orden; tras cada lote `node --test tests/`)
1. **L1** utilidades/* + constantes_fisicas.js + constantes_control.js (~150). Prueba: se pueden `require` sin error.
2. **L2** estado_planta.js + termica.js (~150).
3. **L3** hidraulica.js + planta.js + tests/modelo.test.js (~250). Prueba: modelo.test en verde.
4. **L4** alarmas.js + regulacion.js + alcanzabilidad.js (~200) + regulacion.test.js.
5. **L5** fases.js + secuencia.js (~280) + fases.test.js.
6. **L6** secuencia.test.js (portar) + equivalencia.test.js (~300). Hito: toda la lógica en verde y numéricamente idéntica.
7. **L7** css/interfaz.css e img copiados + dom.js + registro_eventos.js + grafica.js (~180).
8. **L8a** scada/canvas.js + scada_widget.js + objeto_scada.js + etiqueta.js + tuberia.js (~200). **L8b** bomba.js, valvula.js, sensor.js, deposito.js, intercambiador.js, resistencia.js (~250). **L8c** esquema_pct23.js (declaración con los ids del SVG original, ~250) + tests/ids_scada.test.js + bucle.js + barra_operacion.js (~150, puede ser L8d).
9. **L9** panel_manual.js + pagina_manual.js + manual.html (con contenedor vacío para el widget, sin SVG pegado) + index.html (~250 JS).
10. **L10** panel_automatico.js, parte 1: ajustes y lectura de configuración (~250).
11. **L11** panel_automatico.js, parte 2: pintarPanel, lecturas, pintarPistaFases + pagina_automatico.js + automatico.html (~250). Si pasa de 300, separar `panel_lecturas.js`.
12. **L12** pagina_demostracion.js + demostracion.html (~80).
13. **L13** ayuda_textos.js (solo datos; dividir en `ayuda_textos_esquema.js` y `ayuda_textos_guia.js`) (~300 en dos archivos).
14. **L14** ayuda.js (~200) + README.md breve + revisión final: buscar nombres en inglés o abreviados, funciones > 20 líneas, abrir los 4 HTML sin errores de consola, comprobar que funciona con doble clic (file://).

Reglas para el programador: no cambiar ninguna fórmula ni el orden de operaciones; mantener ids/clases del DOM originales; un archivo = un tema; nada de `this`, clases, `Proxy`, `reduce` encadenados ni operadores crípticos; preferir `for` simples y variables intermedias con nombre.
