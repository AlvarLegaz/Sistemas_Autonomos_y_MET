'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { ESQUEMA_PCT23 } = require('../js/interfaz/scada/esquema_pct23.js');

const ORIGINAL = path.join(__dirname, '..', '..', 'simulador_pct23', 'manual.html');

function idsDelEsquema(spec, acumulado = []) {
  if (!Array.isArray(spec)) return acumulado;
  const atributos = spec[1];
  if (atributos && typeof atributos === 'object' && !Array.isArray(atributos) && atributos.id) acumulado.push(atributos.id);
  spec.forEach(hijo => idsDelEsquema(hijo, acumulado));
  return acumulado;
}

function idsDelSvgOriginal() {
  const html = fs.readFileSync(ORIGINAL, 'utf8');
  const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
  return Array.from(svg.matchAll(/ id="([^"]+)"/g), m => m[1]);
}

test('el esquema no repite ningún id', () => {
  const ids = idsDelEsquema(ESQUEMA_PCT23);
  assert.equal(new Set(ids).size, ids.length);
});

test('los ids del esquema coinciden con los del SVG original', { skip: !fs.existsSync(ORIGINAL) }, () => {
  assert.deepEqual(idsDelEsquema(ESQUEMA_PCT23).sort(), idsDelSvgOriginal().sort());
});
