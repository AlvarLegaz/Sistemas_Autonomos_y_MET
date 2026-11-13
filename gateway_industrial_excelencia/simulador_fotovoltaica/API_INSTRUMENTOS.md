# API de los instrumentos de medida virtuales (modelo → interfaz)

Estado: **IMPLEMENTADA Y PROBADA** (`tests/modelo_instrumentos.test.js` y `tests/averias_diagnostico.test.js`). La mantiene el agente del MODELO.
Todo cuelga de la simulación (`const sim = PCT.fv.crearSimulacion(...)`). Nada de lo que ya existía cambia de forma (`sim.medir`, `sim.continuidad`,
`sim.potencial`, `sim.puntos`, `sim.medidas`, `sim.aislamiento`, `sim.curvaIV`, `sim.estado`); solo se AÑADE. Todas las funciones son de solo lectura
(no avanzan la simulación) y leen el estado ya publicado: llámalas después de `sim.paso()` o de una orden.

Convenio de las respuestas: `{ ok, …, texto }`. `ok:false` = la medida no se puede hacer (punto desconocido, hay tensión, falta abrir un seccionador…) y
`texto` dice por qué, en lenguaje de alumno: enséñalo tal cual en la pantalla del instrumento.

## 1. Multímetro

```
sim.puntos                // [ { id, grupo, descripcion, equipo } ]  nodos donde se pueden poner las puntas (equipo = tag de layout.EQUIPOS para situarlo en el sinóptico)
sim.medir(a, b)           // TENSIÓN entre dos nodos → { ok, valor, vdc, vac, tipo: 'DC'|'AC'|'sin_referencia'|'desconocido', texto }   (como antes)
sim.resistencia(a, b)     // ÓHMETRO / CONTINUIDAD → { ok, ohm, abierto, continuidad, conTension, voltios, texto }
sim.continuidad(a, b)     // (como antes) booleano topológico, sin las reglas del instrumento: NO lo uses para el multímetro, usa sim.resistencia
```

- `sim.medir`: `valor` con signo en continua (punta roja = `a`), eficaz ≥ 0 en alterna. Entre dos grupos sin referencia común → `tipo:'sin_referencia'`, 0 V.
  **Novedad:** `TIERRA` sirve de referencia también para los nodos de continua (`A_DC`, `B_DC`, `BAT`): un campo FV aislado y sano «flota» centrado
  (≈ +Voc/2 el positivo y ≈ −Voc/2 el negativo); con el fallo de aislamiento el punto de la fuga queda a 0 V de tierra (así se localiza el panel).
- `sim.resistencia(a, b)`:
  - `ok:true` → `ohm` (número; `Infinity` = circuito abierto, el multímetro marca «OL»), `abierto` (bool), `continuidad` (bool: pita, < 50 Ω).
  - `ok:false, conTension:true, voltios` → hay tensión entre las puntas, el elemento está en carga (pasa corriente) o es un circuito de alterna con tensión:
    `texto` = «No se puede medir continuidad con tensión…» y dice qué abrir. Con el circuito de alterna hay que abrir aguas arriba (p. ej. `QF-301`);
    un fusible o interruptor de continua se mide sin carga (abre `QS-101` para `F-101`/`F-102`, de noche, etc.).
  - `ok:false` sin `conTension` → punto desconocido.
- Nodos (`sim.puntos`, `grupo` entre paréntesis). Los de antes siguen igual; **nuevos en negrita**:
  - (A_DC) `STR-101.+ STR-101.- STR-102.+ STR-102.-`, `F-101.1 F-101.2 F-102.1 F-102.2`, `CB-101.bus+ CB-101.bus-`, `QS-101.1 QS-101.2`, `INV-101.pv+ INV-101.pv-`,
    **`PV-101.+ PV-101.-` … `PV-106.+ PV-106.-`** (bornes de cada panel).
  - (BAT) `BAT-101.+ BAT-101.-`, `FB-101.1 FB-101.2`, `QB-101.1 QB-101.2`, `INV-101.bat+ INV-101.bat-`,
    **`BAT-101.c0` … `BAT-101.c8`** (tomas de equilibrado del BMS: la celda k se mide entre `c{k}` y `c{k-1}`; `c0` = negativo).
  - (B_DC) `STR-201.+ STR-201.- STR-202.+ STR-202.-`, `QS-201.1 … QS-201.4`, `INV-201.mppt1+ mppt1- mppt2+ mppt2-`, **`PV-201.+ PV-201.-` … `PV-208.+ PV-208.-`**.
  - (AC) `RED-301.L`, `N`, `TIERRA`, `QF-301.1/.2`, `ID-301.1/.2`, `QF-302.1/.2`, `QF-303.1/.2`, `INV-101.ac.L`, `INV-201.ac.L`, `LOAD-301.L`, `LOAD-302.L`, `TC-301.L`,
    **`INV-101.salida.L`** (salida de alterna del EASun).
  - (SPD-101 / SPD-201 / SPD-301) **`SPD-101.11 SPD-101.12`, `SPD-201.11 SPD-201.12`, `SPD-301.11 SPD-301.12`**: contacto de señalización del descargador
    (cerrado ≈ 0,1 Ω con el cartucho sano; abierto «OL» con el cartucho agotado). Sin tensión: se mide con el óhmetro.
  - (COM) **`COM-101.5V COM-101.GND COM-101.A COM-101.B`**: alimentación (5 V) y par RS485 del módulo de comunicaciones del EASun (A–B ≈ 2,3 V con el bus vivo; ≈ 0 V si el módulo no comunica).
- Orden de los bornes de panel dentro de una cadena: `STR-x.-` = `PV-primero.-` … `PV-k.+` ─MC4─ `PV-(k+1).-` … `PV-último.+` ─cable de bajada─ `STR-x.+`.
  La tensión de un panel es `sim.medir('PV-104.+', 'PV-104.-')`; la caída en un conector MC4 es `sim.medir('PV-206.+', 'PV-207.-')` (cambiada de signo).

## 2. Pinza amperimétrica

```
sim.conductores           // [ { id, descripcion, grupo, desde, hasta, tipo: 'DC'|'AC', equipo } ]
sim.corriente(idConductor)// → { ok, valor (A, con signo en DC; eficaz ≥ 0 en AC), tipo: 'DC'|'AC', texto }
```

Signo en continua: positivo en el sentido `desde → hasta` del conductor (en los «+», de los paneles al inversor; en los «−» sale negativo: es el retorno;
en la batería, positivo = carga). `texto` usa mA por debajo de 1 A.

| grupo | ids |
|---|---|
| `A_DC` | `STR-101.+` `STR-101.-` `STR-102.+` `STR-102.-` `CB-101.salida+` `CB-101.salida-` |
| `BAT` | `BAT-101.cable+` `BAT-101.cable-` |
| `B_DC` | `STR-201.+` `STR-201.-` `STR-202.+` `STR-202.-` `INV-201.mppt1+` `INV-201.mppt1-` `INV-201.mppt2+` `INV-201.mppt2-` |
| `AC` | `RED-301.L` `RED-301.N` (acometida) · `QF-302.L` (entrada de red del EASun) · `INV-101.salida.L` (salida del EASun) · `LOAD-302.L` · `QF-303.L` (línea del ZCS) · `LOAD-301.L` · `TC-301.L` · `ID-301.L+N` (fase y neutro juntos dentro de la pinza: corriente diferencial o de fuga) |
| `PE` | `PE.CB-101` (tierra del campo A) · `PE.QS-201` (tierra del campo B: sube a mA con el fallo de aislamiento) · `PE.QA-301` (tierra del cuadro de alterna) |

## 3. Megóhmetro

```
sim.puntosAislamiento     // [ { id, descripcion, cadena, seccionador } ]   ids: 'STR-101.+', 'STR-101.-', … 'STR-202.+', 'STR-202.-'
sim.aislamiento(id)       // → { ok, mohm, tensionPruebaV, minimoMohm, correcto, texto }
```

- `id` = `'STR-xxx.+'` o `'STR-xxx.-'` (polo a tierra). **Exige el seccionador de esa cadena ABIERTO** (`QS-101` para el campo A, `QS-201` para el B); si no:
  `{ ok:false, mohm:0, texto:'Abre el seccionador antes de medir el aislamiento' }` (el texto añade cuál).
- `tensionPruebaV` y `minimoMohm` según IEC 62446-1 (campo A, Voc < 120 V: 250 V y 0,5 MΩ; campo B: 500 V y 1 MΩ). `correcto = mohm ≥ minimoMohm`.
- Sano: decenas de MΩ (más bajo con humedad —cielo cubierto, noche— y con calor); con `FALLO_AISLAMIENTO_B`, `STR-201.+` y `STR-201.-` dan décimas/centésimas de MΩ.
- Compatibilidad: `sim.aislamiento('STR-201')` (sin polo, la forma antigua) sigue funcionando y NO exige el seccionador; el instrumento debe usar los ids con polo.

## 4. Trazador de curvas I‑V

```
sim.curvaIV(idCadena, puntos = 60)            // (como antes) → [ { v, i, p } ] medida en bornes de la cadena (con sombras, diodos, suciedad y averías)
sim.curvaIVReferencia(idCadena, puntos = 60)  // → [ { v, i, p } ] la esperada por el datasheet a la irradiancia y temperatura de célula actuales, sin sombras ni averías
sim.resumenIV(idCadena)                       // → { ok, voc, isc, vmpp, impp, pmpp, factorForma, vocEsperada, iscEsperada, pmppEsperada, factorFormaEsperado,
                                              //     desviacionPct, desviacionVocPct, desviacionIscPct, escalones, irradianciaWm2, temperaturaCelulaC,
                                              //     estable, valida, abierta, texto }
```

- `desviacionPct` = 100·(pmpp/pmppEsperada − 1) (negativa = rinde menos). `escalones` = nº de escalones de la curva por diodos de paso conduciendo.
- `valida:false` si la irradiancia del plano es < 400 W/m² (la norma pide ≥ 400) o no es estable (`estable:false`: ha variado más de un 3 % en el último medio minuto); `texto` lo explica.
- `abierta:true` (cadena sin continuidad: MC4 suelto o cable cortado): no hay curva (isc = 0). Un FUSIBLE fundido NO afecta a la curva (el trazador se conecta a la cadena, antes del fusible).
- Cadena desconocida: `curvaIV`/`curvaIVReferencia` → `[]`, `resumenIV` → `{ ok:false, texto }`.

## 5. Cámara termográfica

```
sim.termografia()   // → { ambienteC, casetaC, irradianciaWm2: { A, B }, elementos: [ { tag, tipo, tempC, deltaC, nota, equipo, zona } ] }
```

- `tipo`: `'panel'` (`PV-104`), `'subcadena'` (`PV-104.s1`…`.s3`, siempre las 3 de cada panel), `'conector'` (MC4: `STR-202.mc4.0` … `STR-202.mc4.N`; `0` = extremo negativo,
  `k` = entre el panel k y el k+1, `N` = extremo positivo), `'fusible'` (`F-101`, `F-102`, `FB-101`), `'caja'` (bornas de `CB-101`), `'seccionador'` (`QS-101`, `QS-201`),
  `'descargador'` (`SPD-*`), `'magnetotermico'` (`QB-101`, `QF-301`, `QF-302`, `QF-303`), `'diferencial'` (`ID-301`), `'bateria'` (bornes de `BAT-101`), `'inversor'` (`INV-101`, `INV-201`),
  `'toma'` (`TC-301`), `'caseta'` (`CAS-001`: aire interior) y `'rejilla'` (`CAS-001.rejilla`).
- `deltaC` = diferencia con sus iguales: paneles, subcadenas y conectores, contra la mediana de los de su mismo campo; aparamenta, batería e inversores, contra el aire de la caseta (`casetaC`);
  la caseta (`CAS-001`), contra el ambiente exterior; la rejilla, contra el aire de la caseta. `nota` = texto corto cuando hay algo que destacar (`''` si no). `equipo` = tag de `layout.EQUIPOS`; `zona` = `'cubierta'` | `'caseta'`.
- Coherente con la corriente (I²·R) y la irradiancia: de noche los paneles y conectores están a temperatura ambiente.

## 6. Firma de diagnóstico de cada avería (`PCT.fv.catalogoAverias`)

Cada entrada de `CATALOGO` conserva sus campos y gana **`firma`** (objeto plano, serializable). Por compatibilidad `diagnostico` sigue siendo la lista de textos de antes
(`a.diagnostico.length`, `a.diagnostico[0]`…) y además lleva colgadas las mismas propiedades (`a.diagnostico.sintoma`, `a.diagnostico.medidasClave`…): son el mismo contenido que `a.firma`.

```
firma = {
  sintoma,                       // qué ve el alumno sin instrumentos
  escenario: { horaSolar, nubosidad, socInicialPct, modoEasun?, cargas?: { tag: W }, sombras?: { tagPanel: 0–1 }, esperaS },   // condiciones en las que la avería se manifiesta (para el modo de avería oculta)
  medidasClave: [ { instrumento: 'multimetro'|'pinza'|'megohmetro'|'trazadorIV'|'termografia',
                    puntos: [a, b] | conductor: id | tag: id,       // según el instrumento
                    modo?: 'tension'|'resistencia',                 // multímetro
                    campo?: 'desviacionPct'|'escalones'|'deltaC'|…, // qué campo del resultado se mira (trazador y termografía)
                    referencia?: [a, b] | conductor,                // si está, la lectura es la DIFERENCIA con esta otra medida (comparar con un igual: el panel vecino, la otra cadena, otra celda)
                    preparar?: [ { orden: 'abrir', tag } ],          // maniobras previas (abrir un seccionador…)
                    esperadoSano: { min, max, unidad }, esperadoAveria: { min, max, unidad }, texto } ],
  pistas: [ pista1 (general), pista2 (zona), pista3 (instrumento y punto) ],
  explicacion,                   // por qué ocurre y cómo se repara
  distractores: [ ids ],         // averías con un síntoma parecido
}
PCT.fv.catalogoAverias.leerMedida(sim, medidaClave, { maniobrar })   // → { ok, valor, texto }  hace la medida con las funciones reales. Con maniobrar:true aplica antes `preparar` y lo deshace después;
                                                                    // sin él, mide tal como está la planta (si falta abrir algo → ok:false con el aviso del instrumento)
PCT.fv.catalogoAverias.cumple(valor, rango)           // → bool  (min ≤ valor ≤ max; Infinity vale como «OL»)
PCT.fv.catalogoAverias.prepararEscenario(sim, firma)  // aplica firma.escenario a la simulación (hora, sombras, cargas, modo, SoC); no activa la avería ni avanza el tiempo
```

## 7. `sim.estado`: campos nuevos (la forma no cambia)

- `estado.bateria.celdasV` = `[ 8 tensiones de celda ]` (las mismas que se miden en `BAT-101.c0…c8`).
- `estado.campos.X.cadenas[k].abiertaFisica` (bool: MC4 suelto o cable cortado; `abierta` sigue incluyendo además el fusible fundido).

`ESCENARIO_BASE` = `{ diaAnio: 172, horaSolar: 11, nubosidad: 0, socInicialPct: 30, esperaS: 120 }`; `firma.escenario` ya viene completo (base + lo propio de la avería).
Escenarios especiales: `DIODO_BYPASS_ABIERTO_PV203` (sombra del 30 % en PV-203: sin sombra la avería es latente), `SOMBRA_PARAPETO` (8 h solares), `BMS_CORTE_BATERIA`
(23 h, `BATERIA_PRIMERO`, 500 W en LOAD-302, SoC 70 %) y `VENTILACION_TAPADA` (40 min para que la caseta se caliente). `esperaS` = segundos simulados que tarda en verse.
«Sano» en `esperadoSano` es la planta sin la avería en ese MISMO escenario. `Infinity` en un rango es el «OL» del óhmetro (ojo: `JSON.stringify` lo convierte en `null`).
`a.diagnostico` es un array con propiedades colgadas: al serializarlo con JSON solo quedan los textos; para serializar usa `a.firma`.
Las 18 firmas se distinguen entre sí (probado: la firma de una avería no se cumple con ninguna de las otras 17 ni con la planta sana).

## 8. Cambios de comportamiento a tener en cuenta (pequeños)

- `sim.curvaIV` es ahora la curva EN BORNES DE LA CADENA (como un trazador, antes del fusible): con `F-101` fundido ya no sale plana; con MC4 suelto o cable cortado, sí.
- Potenciales con la cadena interrumpida: `F-101.1` (lado caja) toma la tensión de la barra si el fusible conduce (antes 0 V) y `QS-201.1` pasa a 0 V (antes Voc):
  el corte está entre `STR-x.+` (cubierta) y la caja, así que `sim.medir('STR-101.+', 'F-101.1')` da la tensión que «falta».
- `sim.medidas['STR-202.conectorC']` es ahora la misma temperatura que ve la cámara en `STR-202.mc4.2` (de noche, la ambiente).
