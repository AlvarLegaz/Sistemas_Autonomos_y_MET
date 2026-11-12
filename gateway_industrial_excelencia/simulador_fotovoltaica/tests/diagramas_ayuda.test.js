// Fichas de ayuda (PCT.fvTextos): una por cada equipo de layout.js, completas, con riesgos y con sus averías.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');
const T = require('../js/interfaz/textos_ayuda.js');
const H = require('./diagramas_comun.js');

test('TAGS cubre todos los equipos de layout.js y fichaDe existe para cada uno', () => {
  assert.deepEqual([...T.TAGS].sort(), layout.EQUIPOS.map(e => e.tag).sort());
  for (const e of layout.EQUIPOS) assert.ok(T.fichaDe(e.tag), `sin ficha para ${e.tag}`);
  assert.equal(T.fichaDe('XX-999'), null);
});
test('cada ficha tiene qué es, para qué sirve, cómo falla, qué medir (con un valor) y riesgos', () => {
  for (const e of layout.EQUIPOS) {
    const f = T.fichaDe(e.tag);
    assert.ok(f.titulo.startsWith(e.tag), e.tag); assert.ok(f.etiqueta, e.tag);
    assert.ok(f.queEs.length > 60, `${e.tag}: «qué es» demasiado corto`); assert.ok(f.paraQue.length > 50, `${e.tag}: «para qué sirve»`);
    assert.ok(f.fallos.length >= 1 && f.fallos.every(x => x.length > 30), `${e.tag}: fallos`);
    assert.ok(f.medir.length >= 1, `${e.tag}: medir`); assert.ok(f.medir.some(x => /\d/.test(x)), `${e.tag}: sin ningún valor esperado al medir`);
    assert.ok(f.riesgos.length >= 1, `${e.tag}: riesgos`);
  }
});
test('toda avería de AVERIAS aparece en la ficha de su equipo, con su título', () => {
  for (const a of layout.AVERIAS) {
    const f = T.fichaDe(a.tag);
    assert.ok(f.averias.some(x => x.id === a.id && x.titulo === a.titulo), `${a.id} no está en la ficha de ${a.tag}`);
  }
});
test('las fichas de las averías relacionadas apuntan solo a averías que existen', () => {
  const ids = new Set(layout.AVERIAS.map(a => a.id));
  for (const tag of T.TAGS) for (const a of T.fichaDe(tag).averias) assert.ok(ids.has(a.id), `${tag}: ${a.id}`);
  for (const f of Object.values(T.FICHAS)) for (const id of f.relacionadas) assert.ok(ids.has(id), id);
});
test('los riesgos de la continua advierten de que no se puede apagar con luz y del arco, en paneles, cadenas, seccionadores y fusibles', () => {
  for (const tag of ['PV-101', 'STR-101', 'QS-101', 'QS-201', 'F-101', 'CB-101']) {
    const r = T.fichaDe(tag).riesgos.join(' ');
    assert.match(r, /arco|luz|tensión/i, tag);
  }
  assert.match(T.fichaDe('QS-101').riesgos.join(' '), /arco/i); assert.match(T.fichaDe('PV-101').riesgos.join(' '), /NO se puede apagar/);
  assert.match(T.fichaDe('BAT-101').riesgos.join(' '), /cortocircuito/i); assert.match(T.fichaDe('INV-101').riesgos.join(' '), /litio|condensadores/i);
});
test('los paneles y los fusibles gemelos comparten ficha y las fichas se distinguen por equipo', () => {
  assert.equal(T.fichaDe('PV-101').queEs, T.fichaDe('PV-208').queEs); assert.equal(T.fichaDe('F-101').queEs, T.fichaDe('F-102').queEs);
  assert.notEqual(T.fichaDe('QF-302').queEs, T.fichaDe('QF-303').queEs); assert.notEqual(T.fichaDe('INV-101').queEs, T.fichaDe('INV-201').queEs);
  assert.match(T.fichaDe('PV-105').averias.map(a => a.id).join(), /DIODO_BYPASS_PV104/);                // mismo campo
  assert.ok(!T.fichaDe('PV-205').averias.some(a => a.id === 'DIODO_BYPASS_PV104'));                      // otro campo
  assert.ok(T.fichaDe('PV-205').averias.some(a => a.id === 'SOMBRA_PARAPETO'));
});
test('construirElementos da la forma de ayuda_fv.js (con mantenimiento) para todos los equipos', () => {
  const el = T.construirElementos();
  assert.equal(Object.keys(el).length, layout.EQUIPOS.length);
  for (const [tag, v] of Object.entries(el)) { assert.ok(v.titulo && v.etiqueta && v.queEs && v.enSimulador && v.mantenimiento, tag); assert.match(v.mantenimiento, /QUÉ MEDIR/); }
});
test('estadoVivo da un texto para los equipos con medida y no se rompe sin estado', () => {
  const e = H.base();
  for (const tag of ['PV-101', 'STR-101', 'INV-101', 'INV-201', 'BAT-101', 'RED-301', 'MED-201', 'LOAD-301', 'LOAD-302', 'COM-101', 'CAS-001', 'CB-101', 'QA-301', 'QS-101', 'F-101']) assert.ok(T.estadoVivo(tag, e).length > 3, tag);
  assert.equal(T.estadoVivo('QS-101', e), 'CERRADO'); assert.equal(T.estadoVivo('QS-101', H.conProt('QS-101', 'DISPARADO')), 'DISPARADO · prueba');
  assert.match(T.estadoVivo('STR-101', H.cadenaAbierta('STR-101')), /ABIERTA/);
  for (const tag of T.TAGS) { assert.equal(T.estadoVivo(tag, null), ''); assert.doesNotThrow(() => T.estadoVivo(tag, {})); }
});
test('la guía general tiene secciones con título y contenido', () => {
  assert.ok(T.GUIA.length >= 3); for (const [t, h] of T.GUIA) assert.ok(t && h.includes('<p>'));
});
