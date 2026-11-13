'use strict';
// Firma de diagnóstico de cada avería (catalogo.js → firma): lo que dice cada medida clave es CIERTO con el modelo (planta sana frente a avería, con las
// funciones reales de los instrumentos), y con los instrumentos se distingue cada avería de todas las demás.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const Cat = require('../js/averias/catalogo.js');
const Medidas = require('../js/modelo/medidas.js');
const { crearSimulacion, avanzar } = require('./modelo_ayuda.js');

const INSTRUMENTOS = ['multimetro', 'pinza', 'megohmetro', 'trazadorIV', 'termografia'];
const nodos = new Set(Medidas.PUNTOS.map(p => p.id)), conductores = new Set(Medidas.CONDUCTORES.map(c => c.id));

/** Planta en el escenario de la avería `a`, estabilizada, con la avería `idAveria` activa (o ninguna) durante el tiempo del escenario. */
function montar(a, idAveria) {
  const sim = crearSimulacion({ semilla: 1, horaSolar: a.firma.escenario.horaSolar, nubosidad: 0 });
  const e = Cat.prepararEscenario(sim, a.firma);
  avanzar(sim, 400);
  if (idAveria) assert.equal(sim.ordenes.averias.activar(idAveria), true);
  avanzar(sim, e.esperaS);
  return sim;
}
/** Las medidas sin maniobras primero (abrir un seccionador para una medida cambia el estado de la planta para las siguientes). */
const enOrden = a => a.firma.medidasClave.slice().sort((x, y) => (x.preparar ? 1 : 0) - (y.preparar ? 1 : 0));
const disjuntos = (p, q) => p.max < q.min || q.max < p.min;

test('firma: las 18 averías tienen síntoma, medidas clave, tres pistas, explicación y distractores bien formados', () => {
  const ids = new Set(L.AVERIAS.map(a => a.id));
  assert.equal(Cat.CATALOGO.length, 18);
  for (const a of Cat.CATALOGO) {
    const f = a.firma;
    assert.ok(f && f.sintoma.length > 30, `${a.id} síntoma`); assert.ok(f.explicacion.length > 80, `${a.id} explicación`);
    assert.equal(f.pistas.length, 3, `${a.id} pistas`); for (const p of f.pistas) assert.ok(p.length > 20, `${a.id} pista`);
    assert.ok(f.distractores.length >= 1 && f.distractores.every(d => ids.has(d) && d !== a.id), `${a.id} distractores`);
    assert.ok(f.escenario.horaSolar >= 0 && f.escenario.esperaS > 0, `${a.id} escenario`);
    assert.ok(f.medidasClave.length >= 2, `${a.id} medidas clave`);
    assert.ok(f.medidasClave.some(m => disjuntos(m.esperadoSano, m.esperadoAveria)), `${a.id}: alguna medida debe separar sano de avería`);
    for (const m of f.medidasClave) {
      assert.ok(INSTRUMENTOS.includes(m.instrumento), `${a.id} instrumento ${m.instrumento}`); assert.ok(m.texto.length > 20, `${a.id} texto`);
      for (const rango of [m.esperadoSano, m.esperadoAveria]) assert.ok(rango && rango.min <= rango.max && typeof rango.unidad === 'string', `${a.id} rango`);
      if (m.instrumento === 'multimetro') {
        assert.ok(['tension', 'resistencia'].includes(m.modo)); for (const p of m.puntos.concat(m.referencia || [])) assert.ok(nodos.has(p), `${a.id}: nodo ${p}`);
      } else if (m.instrumento === 'pinza') { assert.ok(conductores.has(m.conductor), `${a.id}: conductor ${m.conductor}`); if (m.referencia) assert.ok(conductores.has(m.referencia)); }
      else assert.equal(typeof m.tag, 'string');
      for (const p of m.preparar || []) assert.ok(p.orden === 'abrir' && L.EQUIPOS.some(e => e.tag === p.tag), `${a.id}: maniobra`);
    }
    // compatibilidad: `diagnostico` sigue siendo la lista de textos y lleva la firma colgada
    assert.ok(Array.isArray(a.diagnostico) && a.diagnostico.length > 0 && typeof a.diagnostico[0] === 'string');
    assert.equal(a.diagnostico.sintoma, f.sintoma); assert.equal(a.diagnostico.medidasClave, f.medidasClave); assert.equal(a.diagnostico.pistas, f.pistas);
    assert.equal(a.diagnostico.explicacion, f.explicacion); assert.equal(a.diagnostico.distractores, f.distractores);
    assert.doesNotThrow(() => JSON.stringify(f));
  }
});

for (const a of Cat.CATALOGO) {
  test(`firma de ${a.id}: cada medida clave se cumple en la planta sana y con la avería (funciones reales de los instrumentos)`, () => {
    const sana = montar(a, null), mala = montar(a, a.id);
    assert.ok(mala.estado.averiasActivas.includes(a.id));
    for (const m of enOrden(a)) {
      const que = `${a.id} · ${m.instrumento} ${JSON.stringify(m.puntos || m.conductor || m.tag)} ${m.campo || m.modo || ''}`;
      const vs = Cat.leerMedida(sana, m, { maniobrar: true }), vm = Cat.leerMedida(mala, m, { maniobrar: true });
      assert.ok(vs.ok, `${que}: la medida en sano no se pudo hacer (${vs.texto})`); assert.ok(vm.ok, `${que}: la medida con avería no se pudo hacer (${vm.texto})`);
      assert.ok(Cat.cumple(vs.valor, m.esperadoSano), `${que}: sano ${vs.valor} fuera de [${m.esperadoSano.min}, ${m.esperadoSano.max}]`);
      assert.ok(Cat.cumple(vm.valor, m.esperadoAveria), `${que}: avería ${vm.valor} fuera de [${m.esperadoAveria.min}, ${m.esperadoAveria.max}]`);
    }
  });
}

test('firma: sin las maniobras previas, la medida que las exige avisa en lugar de dar un número', () => {
  const a = Cat.porId('FALLO_AISLAMIENTO_B'), sim = montar(a, a.id), m = a.firma.medidasClave.find(x => x.instrumento === 'megohmetro');
  const sin = Cat.leerMedida(sim, m); assert.equal(sin.ok, false); assert.match(sin.texto, /Abre el seccionador/);
  const con = Cat.leerMedida(sim, m, { maniobrar: true }); assert.equal(con.ok, true);
  assert.equal(sim.estado.protecciones['QS-201'].estado, 'CERRADO', 'la maniobra se deshace');
  const f = Cat.porId('FUSIBLE_F101'), s2 = montar(f, null), ohm = f.firma.medidasClave.find(x => x.modo === 'resistencia');
  assert.equal(Cat.leerMedida(s2, ohm).ok, false, 'en carga no se mide continuidad');
});

test('las 18 averías se distinguen entre sí con los instrumentos: la firma de una no se cumple con ninguna otra (ni con la planta sana)', () => {
  for (const a of Cat.CATALOGO) {
    for (const otra of [null].concat(Cat.CATALOGO.map(x => x.id).filter(id => id !== a.id))) {
      const sim = montar(a, otra);
      const todas = enOrden(a).every(m => { const v = Cat.leerMedida(sim, m, { maniobrar: true }); return v.ok && Cat.cumple(v.valor, m.esperadoAveria); });
      assert.equal(todas, false, `la firma de ${a.id} también se cumple con ${otra || 'la planta sana'}: no se distinguen`);
    }
  }
});

test('distractores: cada avería se separa de sus distractores por una medida concreta de su firma', () => {
  for (const a of Cat.CATALOGO) {
    for (const d of a.firma.distractores) {
      const sim = montar(a, d);
      const separa = enOrden(a).filter(m => { const v = Cat.leerMedida(sim, m, { maniobrar: true }); return !(v.ok && Cat.cumple(v.valor, m.esperadoAveria)); });
      assert.ok(separa.length >= 1, `${a.id} frente a ${d}`);
    }
  }
});
