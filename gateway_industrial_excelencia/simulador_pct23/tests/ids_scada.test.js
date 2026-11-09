'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ESQUEMA_PCT23 } = require('../js/interfaz/scada/esquema_pct23.js');

function idsDelEsquema(spec, acumulado = []) {
  if (!Array.isArray(spec)) return acumulado;
  const atributos = spec[1];
  if (atributos && typeof atributos === 'object' && !Array.isArray(atributos) && atributos.id) acumulado.push(atributos.id);
  spec.forEach(hijo => idsDelEsquema(hijo, acumulado));
  return acumulado;
}

test('el esquema no repite ningún id', () => {
  const ids = idsDelEsquema(ESQUEMA_PCT23);
  assert.equal(new Set(ids).size, ids.length);
});
