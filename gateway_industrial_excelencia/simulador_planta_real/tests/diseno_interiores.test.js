'use strict';
// Pruebas de las funciones puras de la vista interior de los equipos (se abre al pulsar un equipo) y de los textos «Cómo funciona».
const assert = require('node:assert/strict');
const { test } = require('node:test');
const I = require('../js/visor3d_htst/interiores.js');
const CF = require('../js/visor3d_htst/como_funciona.js');
const K = require('../js/visor3d_htst/kit.js');
const layout = require('../js/layout.js');
const { estadoDemo } = require('../js/visor3d_htst/estado_demo.js');
const cerca = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

test('los equipos con interior son los que se pidieron y todos existen en el layout', () => {
  assert.deepEqual([...I.TAGS_CON_INTERIOR].sort(), ['FDV-101', 'FLT-101', 'HW-201', 'HX-101', 'P-101', 'P-201', 'SV-101', 'TK-101']);
  const tags = new Set(layout.EQUIPOS.map(e => e.tag));
  for (const tag of I.TAGS_CON_INTERIOR) assert.ok(tags.has(tag), tag);
  assert.equal(I.tieneInterior('HT-101'), false);
});

test('todos los equipos con interior tienen su texto «Cómo funciona» (2-4 frases, con señales y fallos)', () => {
  assert.deepEqual([...CF.TAGS_CON_INTERIOR].sort(), [...I.TAGS_CON_INTERIOR].sort());
  for (const tag of I.TAGS_CON_INTERIOR) {
    const texto = CF.textoComoFunciona(tag);
    assert.ok(texto.length > 120, `${tag}: texto demasiado corto`);
    const frases = texto.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    assert.ok(frases >= 2 && frases <= 5, `${tag}: ${frases} frases`);
    assert.match(texto, /fall|aver|Si |sin /i, `${tag}: no dice qué suele fallar`);
  }
  assert.equal(CF.textoComoFunciona('HT-101'), '');
});

test('esCarcasa: solo las piezas indicadas de cada equipo pasan a semitransparentes', () => {
  assert.equal(I.esCarcasa('TK-101', 'inox'), true);
  assert.equal(I.esCarcasa('TK-101', 'azul'), false);              // el motorreductor del agitador sigue opaco
  assert.equal(I.esCarcasa('HW-201', 'gris'), true);
  assert.equal(I.esCarcasa('HX-101', 'instanciada'), true);
  assert.equal(I.esCarcasa('HT-101', 'inox'), false);               // sin interior
  assert.equal(I.esCarcasa('P-101', undefined), false);
  assert.ok(I.OPACIDAD_CARCASA > 0.15 && I.OPACIDAD_CARCASA < 0.5);
});

test('columnaLiquido: el nivel real manda y nunca da altura cero', () => {
  assert.ok(cerca(I.columnaLiquido(50, 22, 56).alto, 28));
  assert.ok(cerca(I.columnaLiquido(50, 22, 56).y, 22 + 14));
  assert.equal(I.columnaLiquido(100, 11, 54.5).alto, 54.5);
  assert.equal(I.columnaLiquido(0, 11, 54.5).visible, false);
  assert.ok(I.columnaLiquido(0, 11, 54.5).alto > 0);
  assert.equal(I.columnaLiquido(250, 0, 10).alto, 10);              // se limita a 100 %
  assert.equal(I.columnaLiquido(undefined, 0, 10).visible, false);
});

test('velocidadRodeteRadS: gira solo en marcha y sin fallo, y proporcional a la velocidad del variador', () => {
  assert.equal(I.velocidadRodeteRadS({ marcha: false, velocidadPct: 100 }), 0);
  assert.equal(I.velocidadRodeteRadS({ marcha: true, fallo: true, velocidadPct: 100 }), 0);
  assert.ok(I.velocidadRodeteRadS({ marcha: true, velocidadPct: 100 }) > I.velocidadRodeteRadS({ marcha: true, velocidadPct: 40 }));
  assert.ok(cerca(I.velocidadRodeteRadS({ marcha: true, velocidadPct: 100 }), Math.PI * 3));
  assert.ok(I.velocidadRodeteRadS({ marcha: true }) > 0);           // sin variador: velocidad nominal
  assert.equal(I.velocidadRodeteRadS(undefined), 0);
});

test('posicionesFDV: el vástago, el tapón y la membrana suben al pasar a avance y el muelle se comprime', () => {
  const desvio = I.posicionesFDV(0), avance = I.posicionesFDV(1), medio = I.posicionesFDV(0.5);
  assert.ok(avance.tapon > desvio.tapon && avance.membrana > desvio.membrana);
  assert.ok(medio.tapon > desvio.tapon && medio.tapon < avance.tapon);
  assert.ok(avance.pasoMuelle < desvio.pasoMuelle);                  // más comprimido en avance
  assert.ok(cerca(avance.vastagoLargo, avance.membrana - avance.tapon));
  assert.ok(cerca(desvio.vastagoY, (desvio.membrana + desvio.tapon) / 2));
  assert.deepEqual(I.posicionesFDV(7), I.posicionesFDV(1));          // se limita a 0..1
  assert.deepEqual(I.posicionesFDV(undefined), I.posicionesFDV(0));  // sin datos: desvío (seguridad positiva)
});

test('alturaNucleoSV: el núcleo de la piloto sube al energizar la bobina', () => {
  assert.ok(I.alturaNucleoSV(true) > I.alturaNucleoSV(false));
});

test('canalesHX: canales alternos de producto y del otro fluido, ordenados por paquete', () => {
  const c = I.canalesHX();
  assert.ok(c.length > 30);
  assert.ok(c.every(k => k.fluido === 0 || k.fluido === 1));
  assert.deepEqual([...new Set(c.map(k => k.paquete))], ['regeneracion', 'calentamiento', 'enfriamiento']);
  const reg = c.filter(k => k.paquete === 'regeneracion');
  reg.forEach((k, i) => assert.equal(k.fluido, i % 2));
  for (let i = 1; i < c.length; i++) assert.ok(c[i].x > c[i - 1].x);
});

test('velocidadesHX y coloresHX salen del estado: parada = sin flujo; producción = flujo en el producto y en el agua', () => {
  const parada = I.velocidadesHX(estadoDemo({ modo: 'PARADA' }));
  assert.ok(Object.values(parada).every(p => p[0] === 0 && p[1] === 0));
  const prod = I.velocidadesHX(estadoDemo({ modo: 'PRODUCCION' }));
  assert.ok(prod.calentamiento[0] > 0 && prod.calentamiento[1] > 0 && prod.enfriamiento[1] > 0);
  const col = I.coloresHX(estadoDemo({ modo: 'PRODUCCION' }));
  assert.equal(col.enfriamiento[1], K.AZUL_AGUA);                    // agua fría azul
  assert.notEqual(col.calentamiento[1], col.calentamiento[0]);       // el agua caliente no es del color del producto
  assert.equal(I.velocidadesHX(undefined).regeneracion[0], 0);       // tolerante a un estado vacío
});

test('faseFlujo se mantiene en [0, 1) con cualquier reloj y velocidad', () => {
  for (const [i, n, r, v] of [[0, 3, 0, 10], [2, 3, 12.7, 22], [1, 3, 1e6, 6], [0, 3, 5, 0]]) {
    const f = I.faseFlujo(i, n, r, v, 58); assert.ok(f >= 0 && f < 1, `${i} ${r} ${v} → ${f}`);
  }
});
