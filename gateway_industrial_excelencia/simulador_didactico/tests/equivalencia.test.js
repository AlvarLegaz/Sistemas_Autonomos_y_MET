'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

// Código original (solo lectura) y reescritura, ejecutados en paralelo con la misma entrada.
const ORIGEN = path.join(__dirname, '..', '..', '..', 'Sistemas_Autonomos_y_MET', 'gateway_industrial_excelencia', 'simulador_pct23');
const modeloViejo = require(path.join(ORIGEN, 'modelo.js'));
const secuenciaVieja = require(path.join(ORIGEN, 'secuencia.js'));
const estadoPlanta = require('../js/modelo/estado_planta.js');
const planta = require('../js/modelo/planta.js');
const secuencia = require('../js/control/secuencia.js');
const alcanzabilidad = require('../js/control/alcanzabilidad.js');

function compararModelo(v, n, etiqueta) {
  const pares = [
    ['tiempo', v.tiempo, n.tiempo],
    ['T1', v.t1, n.t1C], ['T3', v.t3, n.t3C], ['T4', v.t4, n.t4C], ['T5', v.t5, n.t5C], ['T2', v.aguaCalienteC, n.aguaCalienteC],
    ['A', v.aMl, n.depositoAMl], ['B', v.bMl, n.depositoBMl],
    ['final', v.finalMl, n.finalMl], ['desviado', v.desviadoMl, n.desviadoMl], ['desague', v.desagueMl, n.desagueMl],
    ['F1', v.caudalProductoMlMin, n.caudalProductoMlMin], ['frio', v.caudalFrioMlMin, n.caudalFrioMlMin],
    ['potencia', v.consignas.R, n.consignas.potenciaPct], ['N1V', v.consignas.N1V, n.consignas.velocidadN1Pct],
  ];
  for (const [nombre, antes, despues] of pares) assert.strictEqual(despues, antes, `${etiqueta}: ${nombre}`);
  assert.strictEqual(n.temperaturaCorte, v.temperaturaCorte, `${etiqueta}: corte`);
  assert.strictEqual(n.vacio, v.vacio, `${etiqueta}: vacio`);
  for (const id of modeloViejo.OUTPUT_IDS) assert.strictEqual(n.salidas[id], v.salidas[id], `${etiqueta}: ${id}`);
}

function compararSecuencia(cfgViejo, cfgNuevo, etiqueta, maxS) {
  const v = modeloViejo.crearEstado(), n = estadoPlanta.crearEstado();
  const secV = secuenciaVieja.crearSecuencia(cfgViejo), secN = secuencia.crearSecuencia(cfgNuevo);
  assert.strictEqual(secuencia.iniciar(secN, n), secuenciaVieja.iniciar(secV, v), `${etiqueta}: iniciar`);
  for (let t = 1; t <= maxS && secV.fase !== 'finalizada' && secV.fase !== 'alarma'; t++) {
    secuenciaVieja.paso(secV, v, 1);
    secuencia.paso(secN, n, 1);
    assert.strictEqual(secN.fase, secV.fase, `${etiqueta} t=${t}: fase`);
    if (t % 10 === 0) compararModelo(v, n, `${etiqueta} t=${t}`);
  }
  compararModelo(v, n, `${etiqueta} final`);
  assert.strictEqual(secN.fase, secV.fase, `${etiqueta}: fase final`);
  assert.deepStrictEqual(secN.alarma, secV.alarma, `${etiqueta}: alarma`);
  assert.strictEqual(secN.segundosTotal, secV.tTotal, `${etiqueta}: tiempo total`);
  assert.strictEqual(secN.eventos.length, secV.eventos.length, `${etiqueta}: nº de eventos`);
  return secV.fase;
}

test('Ejemplo manual de 600 s: planta idéntica al original cada 10 s', () => {
  const v = modeloViejo.activarEjemplo(modeloViejo.crearEstado());
  const n = estadoPlanta.activarEjemplo(estadoPlanta.crearEstado());
  compararModelo(v, n, 'inicio');
  for (let t = 1; t <= 600; t++) {
    modeloViejo.avanzar(v, 1);
    planta.avanzar(n, 1);
    if (t % 10 === 0) compararModelo(v, n, `t=${t}`);
  }
});

test('Automático en cascada hasta finalizar: secuencia idéntica al original', () => {
  const fase = compararSecuencia({ modoControl: 'cascada' }, { modoRegulacion: 'cascada' }, 'cascada', 8000);
  assert.equal(fase, 'finalizada');
});

test('Demostración a 70 °C hasta finalizar: secuencia idéntica al original', () => {
  const cfgViejo = secuenciaVieja.configDemostracion(70, 'A');
  const cfgNuevo = alcanzabilidad.configDemostracion(70, 'A');
  assert.strictEqual(cfgNuevo.caudalPct, cfgViejo.caudalPct);
  assert.strictEqual(cfgNuevo.consignaT1C, cfgViejo.consignaT1);
  const fase = compararSecuencia(cfgViejo, cfgNuevo, 'demo 70', 8000);
  assert.equal(fase, 'finalizada');
});
