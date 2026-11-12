// Diagnóstico del alumno con el modelo REAL: por qué cada inversor produce o no, energía del día y punto de trabajo del MPPT frente al máximo ideal.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearSimulacion } = require('../js/modelo/simulacion.js');
const D = require('../js/interfaz/diagnostico_fv.js');
const G = require('../js/interfaz/grafica_fv.js');

const sim = (hora = 11, o = {}) => crearSimulacion(Object.assign({ semilla: 1, diaAnio: 172, horaSolar: hora, nubosidad: 0.1 }, o));
const marcha = (s, seg = 500) => { for (let t = 0; t < seg; t += 5) s.paso(5); return s.estado; };
const d = (e, t) => D.diagnosticoInversor(e, t);

test('funcionamiento normal al mediodía: los dos inversores en verde con causa y efecto', () => {
  const e = marcha(sim());
  for (const t of ['INV-101', 'INV-201']) { const x = d(e, t); assert.equal(x.nivel, 'ok', t); assert.ok(x.produce); assert.match(x.causa, /Produce/); assert.ok(x.efecto.length > 10); }
});

test('de noche explica que no hay irradiancia', () => {
  const e = marcha(sim(2), 300);
  assert.match(d(e, 'INV-101').causa, /noche/); assert.match(d(e, 'INV-201').causa, /noche/); assert.equal(d(e, 'INV-201').nivel, 'parado');
});

test('seccionadores y averías que cortan un campo: la causa nombra el equipo', () => {
  const s = sim(); s.ordenes.protecciones.abrir('QS-101'); s.ordenes.protecciones.abrir('QS-201'); const e = marcha(s);
  assert.match(d(e, 'INV-101').causa, /QS-101 abierto/); assert.match(d(e, 'INV-201').causa, /QS-201 abierto/);
});

test('sin batería (QB-101): el EASun en alarma explica por qué no produce', () => {
  const s = sim(); s.ordenes.protecciones.abrir('QB-101'); const x = d(marcha(s, 60), 'INV-101');
  assert.equal(x.nivel, 'alarma'); assert.match(x.causa, /QB-101/);
});

test('cadena abierta y fusible fundido: la producción baja y se avisa de la pérdida', () => {
  for (const id of ['CADENA_ABIERTA_A1', 'FUSIBLE_F101']) {
    const s = sim(); s.ordenes.averias.activar(id); const x = d(marcha(s), 'INV-101');
    assert.equal(x.nivel, 'aviso', id); assert.match(x.causa, /pierde producción/); assert.match(x.causa, /STR-101|F-101/);
  }
  const s = sim(); s.ordenes.averias.activar('CADENA_ABIERTA_B1'); assert.match(d(marcha(s), 'INV-201').causa, /STR-201/);
});

test('aislamiento, red caída, diferencial y sobretensión: el ZCS explica su desconexión', () => {
  const caso = (id, re) => { const s = sim(); s.ordenes.averias.activar(id); const x = d(marcha(s), 'INV-201'); assert.match(x.causa, re, id); assert.notEqual(x.nivel, 'ok', id); };
  caso('FALLO_AISLAMIENTO_B', /aislamiento/i); caso('RED_CAIDA', /red de la acometida/); caso('DIFERENCIAL_DISPARADO', /ID-301/); caso('SOBRETENSION_RED', /demasiado alta/);
});

test('el ZCS en arranque cuenta los segundos que faltan para conectar', () => {
  const x = d(marcha(sim(), 40), 'INV-201'); assert.match(x.causa, /faltan \d+ s|aislamiento/);
});

test('apagar un inversor desde el mando se explica', () => {
  const s = sim(); s.ordenes.inversor.encender('INV-101', false); s.ordenes.inversor.encender('INV-201', false); const e = marcha(s, 60);
  assert.match(d(e, 'INV-101').causa, /apagado/); assert.match(d(e, 'INV-201').causa, /apagado/);
});

test('sombra parcial: se avisa de la pérdida y, si el MPPT se engancha a un máximo local, se dice', () => {
  const s = sim(); for (const t of ['PV-101', 'PV-104']) s.ordenes.ambiente.sombra(t, 0.6); const e = marcha(s);
  assert.equal(d(e, 'INV-101').nivel, 'aviso'); assert.match(d(e, 'INV-101').causa, /máximo local|sombra/);
  assert.ok(D.perdidasCampo(e, 'A').some(t => /sombra|diodo/.test(t)));
});

test('batería llena sin cargas: el límite del EASun es normal (verde), no avería', () => {
  const s = sim(); s.ordenes.bateria.socInicial(100); s.ordenes.cargas.poner('LOAD-302', 0); s.ordenes.cargas.poner('LOAD-301', 0); const x = d(marcha(s, 400), 'INV-101');
  assert.equal(x.nivel, 'ok'); assert.match(x.causa, /ya no admite más/);
});

test('suciedad alta del campo A se enumera entre las pérdidas', () => {
  const s = sim(); s.ordenes.averias.activar('SUCIEDAD_ALTA_A'); assert.ok(D.perdidasCampo(marcha(s), 'A').some(t => /sucios/.test(t)));
});

test('energía del día: se cuenta desde la base y se reparte en producción, consumo, importada, exportada, autoconsumo y ahorro', () => {
  const s = sim(9); marcha(s, 60); const base = D.tomarBase(s.estado); marcha(s, 3 * 3600);
  const r = D.resumenEnergia(s.estado, base);
  assert.ok(r.prodA > 0 && r.prodB > 0 && r.consumo > 0); assert.ok(Math.abs(r.produccion - r.prodA - r.prodB) < 1e-6);
  assert.ok(r.autoconsumoPct >= 0 && r.autoconsumoPct <= 100); assert.ok(r.ahorroEuros >= 0); assert.ok(r.cubiertoPct >= 0 && r.cubiertoPct <= 100);
  assert.equal(D.filasEnergia(r).length, 7); assert.ok(D.filasEnergia(r).every(([n, v]) => n && !/NaN|undefined/.test(v)));
  const total = D.resumenEnergia(s.estado, null); assert.ok(total.produccion >= r.produccion);
});

test('punto de trabajo del MPPT frente al máximo ideal: en el máximo sin sombra, por debajo con sombra parcial', () => {
  let s = sim(), e = marcha(s), c = e.campos.A.cadenas[0], t = D.trabajoFrenteIdeal(c, s.curvaIV('STR-101', 80));
  assert.ok(t.perdidaPct < 6, `pérdida ${t.perdidaPct}`); assert.match(t.texto, /máximo/);
  s = sim(); s.ordenes.ambiente.sombra('PV-101', 0.7); e = marcha(s); c = e.campos.A.cadenas[0];
  const curva = s.curvaIV('STR-101', 80), u = D.trabajoFrenteIdeal(c, curva);
  assert.ok(u.idealW >= u.realW); assert.ok(G.maximosLocales(curva) >= 1);
  s = sim(); s.ordenes.averias.activar('CADENA_ABIERTA_A1'); assert.match(D.trabajoFrenteIdeal(marcha(s).campos.A.cadenas[0], []).texto, /abierta/);
});

test('el diagnóstico sin estado no rompe', () => { assert.equal(d(null, 'INV-101').nivel, 'parado'); assert.deepEqual(D.resumenEnergia(null, null).produccion, 0); assert.equal(D.trabajoFrenteIdeal(null), null); });
