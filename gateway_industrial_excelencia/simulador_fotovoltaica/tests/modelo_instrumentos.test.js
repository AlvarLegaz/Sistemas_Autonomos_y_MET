'use strict';
// Instrumentos de medida virtuales (API_INSTRUMENTOS.md): multímetro (tensión y óhmetro), pinza amperimétrica, megóhmetro, trazador I-V y cámara termográfica.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../js/layout.js');
const Medidas = require('../js/modelo/medidas.js');
const { crear, avanzar, buscarNoFinito } = require('./modelo_ayuda.js');

const cerca = (x, y, tol) => Math.abs(x - y) <= tol;
const cad = (s, id) => s.estado.campos.A.cadenas.concat(s.estado.campos.B.cadenas).find(c => c.id === id);
const termo = (s, tag) => s.termografia().elementos.find(e => e.tag === tag);
const equipos = new Set(L.EQUIPOS.map(e => e.tag));

test('multímetro: los nodos de siempre siguen y hay bornes de cada panel, tomas de celda, señalización de descargadores y comunicaciones', () => {
  const s = crear(), ids = new Set(s.puntos.map(p => p.id));
  assert.equal(ids.size, s.puntos.length, 'ids únicos');
  for (const id of ['STR-101.+', 'F-101.1', 'CB-101.bus+', 'QS-101.2', 'INV-101.pv+', 'BAT-101.+', 'FB-101.1', 'QB-101.2', 'INV-101.bat+', 'QS-201.4', 'INV-201.mppt2-', 'RED-301.L', 'N', 'TIERRA',
    'QF-301.1', 'ID-301.2', 'QF-302.1', 'QF-303.2', 'INV-101.ac.L', 'INV-201.ac.L', 'LOAD-301.L', 'LOAD-302.L', 'TC-301.L', 'INV-101.salida.L', 'BAT-101.c0', 'BAT-101.c8',
    'SPD-101.11', 'SPD-201.12', 'SPD-301.11', 'COM-101.5V', 'COM-101.A']) assert.ok(ids.has(id), id);
  for (const e of L.EQUIPOS.filter(x => x.tipo === 'panel')) assert.ok(ids.has(`${e.tag}.+`) && ids.has(`${e.tag}.-`), e.tag);
  for (const p of s.puntos) {
    assert.ok(p.descripcion.length > 5 && p.grupo && equipos.has(p.equipo), `${p.id}: equipo ${p.equipo}`);
    assert.ok(Number.isFinite(s.potencial(p.id)), `potencial de ${p.id}`);
  }
});

test('multímetro: la suma de las tensiones de los paneles es la de la cadena (más la caída del cable) y cada panel da su parte', () => {
  const s = crear();
  for (const k of ['A', 'B']) for (const c of L.CAMPOS[k].cadenas) {
    const e = cad(s, c.id), vs = c.paneles.map(t => s.medir(`${t}.+`, `${t}.-`).valor), suma = vs.reduce((x, y) => x + y, 0);
    for (const v of vs) assert.ok(v > 20 && v < 40, `${c.id} panel ${v}`);
    assert.ok(suma > e.v && suma < e.v + 0.13 * e.i + 0.01, `${c.id}: suma ${suma} frente a ${e.v}`);
    assert.ok(cerca(s.medir(`${c.id}.+`, `${c.id}.-`).valor, e.v, 1e-9));
    // entre dos paneles vecinos solo hay un conector MC4: milivoltios
    const caida = s.medir(`${c.paneles[0]}.+`, `${c.paneles[1]}.-`).valor;
    assert.ok(caida > 0 && caida < 0.1, `caída en un MC4 sano ${caida}`);
  }
  // de noche no hay tensión en ningún panel
  const n = crear({ horaSolar: 2 });
  assert.ok(Math.abs(n.medir('PV-101.+', 'PV-101.-').valor) < 0.5 && Math.abs(n.medir('STR-201.+', 'STR-201.-').valor) < 0.5);
});

test('multímetro: tomas de celda de la batería suman la tensión del pack y coinciden con estado.bateria.celdasV', () => {
  const s = crear(), b = s.estado.bateria;
  assert.equal(b.celdasV.length, 8);
  assert.ok(cerca(s.medir('BAT-101.c8', 'BAT-101.c0').valor, b.v, 1e-6));
  b.celdasV.forEach((v, k) => { assert.ok(v > 2.4 && v < 3.8); assert.ok(cerca(s.medir(`BAT-101.c${k + 1}`, `BAT-101.c${k}`).valor, v, 1e-9)); });
  assert.ok(cerca(Math.min(...b.celdasV), b.vCeldaMin, 1e-9) && cerca(Math.max(...b.celdasV), b.vCeldaMax, 1e-9));
  assert.match(s.medir('BAT-101.c3', 'BAT-101.c2').texto, /^3\.\d{3} V continua$/);
});

test('multímetro: TIERRA sirve de referencia a la continua (campo flotante centrado) y el resto de grupos siguen sin referencia común', () => {
  const s = crear();
  const mas = s.medir('STR-201.+', 'TIERRA'), menos = s.medir('STR-201.-', 'TIERRA');
  assert.equal(mas.tipo, 'DC'); assert.ok(mas.valor > 30 && cerca(mas.valor, -menos.valor, 15), `${mas.valor} / ${menos.valor}`);
  assert.ok(cerca(mas.valor - menos.valor, cad(s, 'STR-201').v, 1e-6));
  assert.ok(cerca(s.medir('TIERRA', 'STR-201.+').valor, -mas.valor, 1e-9));
  assert.ok(cerca(s.medir('BAT-101.+', 'TIERRA').valor, s.estado.bateria.v / 2, 1e-6));
  assert.equal(s.medir('STR-101.+', 'BAT-101.-').tipo, 'sin_referencia'); assert.equal(s.medir('STR-101.+', 'N').tipo, 'sin_referencia');
  assert.equal(s.medir('RED-301.L', 'TIERRA').tipo, 'AC');
  // con el fallo de aislamiento, el punto de la fuga queda a 0 V de tierra
  s.ordenes.averias.activar('FALLO_AISLAMIENTO_B'); avanzar(s, 30);
  assert.ok(Math.abs(s.medir(Medidas.FUGA.nodo, 'TIERRA').valor) < 1e-6);
  assert.ok(s.medir('STR-201.-', 'TIERRA').valor < -60 && s.medir('STR-201.+', 'TIERRA').valor > 20);
});

test('óhmetro: no mide con tensión ni en carga; sin tensión da ohmios o «OL»', () => {
  const s = crear();
  // en carga
  let x = s.resistencia('F-101.1', 'F-101.2'); assert.equal(x.ok, false); assert.equal(x.conTension, true); assert.match(x.texto, /no se puede medir continuidad con tensión/); assert.match(x.texto, /QS-101/);
  // alterna con tensión
  x = s.resistencia('QF-302.1', 'QF-302.2'); assert.equal(x.ok, false); assert.equal(x.conTension, true); assert.match(x.texto, /no se puede medir continuidad con tensión/);
  // tensión entre las puntas
  x = s.resistencia('BAT-101.+', 'BAT-101.-'); assert.equal(x.ok, false); assert.ok(x.conTension && x.voltios > 20);
  // sin carga: el fusible sano tiene centésimas de ohmio
  s.ordenes.protecciones.abrir('QS-101');
  x = s.resistencia('F-101.1', 'F-101.2'); assert.ok(x.ok && x.continuidad && !x.abierto && x.ohm < 0.1, JSON.stringify(x));
  x = s.resistencia('QS-101.1', 'QS-101.2'); assert.equal(x.ok, false, 'con sol hay tensión entre los bornes del seccionador abierto');
  // de noche y sin red: todo se puede medir; el interruptor abierto da OL
  const n = crear({ horaSolar: 2 }); n.ordenes.protecciones.abrir('QF-301'); n.ordenes.protecciones.abrir('QS-101');
  x = n.resistencia('QS-101.1', 'QS-101.2'); assert.ok(x.ok && x.abierto && x.ohm === Infinity && !x.continuidad); assert.match(x.texto, /OL/);
  x = n.resistencia('QF-302.1', 'QF-302.2'); assert.ok(x.ok && x.continuidad && x.ohm < 0.1);
  x = n.resistencia('STR-102.+', 'CB-101.bus+'); assert.ok(x.ok && x.ohm > 0.03 && x.ohm < 0.2, 'cable + fusible');
  x = n.resistencia('RED-301.L', 'TC-301.L'); assert.ok(!x.ok && x.conTension, 'la acometida sigue con tensión aunque QF-301 esté abierto');
  x = n.resistencia('QF-301.2', 'TC-301.L'); assert.ok(x.ok && x.continuidad, 'aguas abajo de QF-301 abierto ya no hay tensión');
  n.ordenes.protecciones.abrir('ID-301'); x = n.resistencia('QF-301.2', 'TC-301.L'); assert.ok(x.ok && x.abierto, 'ID-301 abierto');
  x = n.resistencia('STR-101.+', 'BAT-101.c3'); assert.ok(x.ok && x.abierto, 'circuitos distintos');
  assert.equal(n.resistencia('NOEXISTE', 'N').ok, false); assert.equal(n.resistencia('N', 'N').ohm, 0);
  // contacto de señalización del descargador
  assert.ok(n.resistencia('SPD-201.11', 'SPD-201.12').continuidad);
  n.ordenes.averias.activar('SPD_DISPARADO_A'); assert.ok(n.resistencia('SPD-101.11', 'SPD-101.12').abierto);
  n.ordenes.protecciones.rearmar('SPD-101'); assert.ok(n.resistencia('SPD-101.11', 'SPD-101.12').continuidad);
});

test('pinza: lista de conductores estable y corrientes coherentes con el estado (Kirchhoff en la caja, la batería y el cuadro)', () => {
  const s = crear(), e = s.estado, ids = new Set(s.conductores.map(c => c.id));
  assert.equal(ids.size, s.conductores.length);
  for (const id of ['STR-101.+', 'STR-101.-', 'STR-202.+', 'CB-101.salida+', 'BAT-101.cable+', 'BAT-101.cable-', 'INV-201.mppt1+', 'INV-201.mppt2-', 'RED-301.L', 'RED-301.N', 'QF-302.L', 'INV-101.salida.L',
    'LOAD-302.L', 'QF-303.L', 'LOAD-301.L', 'TC-301.L', 'ID-301.L+N', 'PE.CB-101', 'PE.QS-201', 'PE.QA-301']) assert.ok(ids.has(id), id);
  for (const c of s.conductores) {
    assert.ok(c.descripcion.length > 10 && c.grupo && c.desde && c.hasta && ['DC', 'AC'].includes(c.tipo) && equipos.has(c.equipo), c.id);
    const x = s.corriente(c.id); assert.ok(x.ok && Number.isFinite(x.valor) && x.tipo === c.tipo && /A (continua|alterna)/.test(x.texto), c.id);
    if (c.tipo === 'AC') assert.ok(x.valor >= 0);
  }
  const i = id => s.corriente(id).valor;
  assert.ok(i('STR-101.+') > 4 && cerca(i('STR-101.+'), cad(s, 'STR-101').i, 1e-9) && cerca(i('STR-101.-'), -i('STR-101.+'), 1e-9));
  assert.ok(cerca(i('CB-101.salida+'), i('STR-101.+') + i('STR-102.+'), 1e-6), 'la salida de la caja es la suma de las dos cadenas');
  assert.ok(cerca(i('INV-201.mppt1+'), e.inversores['INV-201'].mppt[0].i, 1e-9) && cerca(i('STR-202.+'), i('INV-201.mppt2+'), 1e-9));
  assert.ok(cerca(i('BAT-101.cable+'), e.bateria.i, 1e-9) && cerca(i('BAT-101.cable-'), -e.bateria.i, 1e-9));
  assert.ok(cerca(i('RED-301.L') * 230, Math.abs(e.red.p), 1) && cerca(i('LOAD-302.L') * 230, e.cargas['LOAD-302'].w, 1e-6) && cerca(i('LOAD-301.L') * 230, e.cargas['LOAD-301'].w, 1));
  assert.ok(cerca(i('QF-303.L') * e.inversores['INV-201'].acV, e.inversores['INV-201'].acP, 1e-6));
  assert.ok(i('ID-301.L+N') > 0 && i('ID-301.L+N') < 0.01, 'fuga normal de unos mA, muy por debajo de 30 mA');
  assert.ok(i('PE.QS-201') < 1e-4 && i('PE.CB-101') < 1e-4);
  assert.match(s.corriente('ID-301.L+N').texto, /mA/);
  assert.equal(s.corriente('NOEXISTE').ok, false);
  // seccionador abierto: no pasa corriente; de noche tampoco
  s.ordenes.protecciones.abrir('QS-201'); assert.equal(i('STR-201.+'), 0);
  const n = crear({ horaSolar: 2 }); assert.equal(n.corriente('STR-101.+').valor, 0); assert.equal(n.corriente('QF-303.L').valor, 0);
});

test('megóhmetro: exige el seccionador abierto, decenas de MΩ en sano y décimas con la avería, con influencia de humedad y temperatura', () => {
  const s = crear();
  assert.equal(s.puntosAislamiento.length, 8);
  for (const p of s.puntosAislamiento) {
    const x = s.aislamiento(p.id); assert.equal(x.ok, false, p.id); assert.match(x.texto, /^Abre el seccionador antes de medir el aislamiento/); assert.ok(x.texto.includes(p.seccionador));
  }
  s.ordenes.protecciones.abrir('QS-101'); s.ordenes.protecciones.abrir('QS-201');
  for (const p of s.puntosAislamiento) {
    const x = s.aislamiento(p.id); assert.ok(x.ok && x.correcto && x.mohm > 15 && x.mohm < 300, `${p.id} ${x.mohm}`);
    assert.equal(x.tensionPruebaV, /STR-1/.test(p.id) ? 250 : 500); assert.equal(x.minimoMohm, /STR-1/.test(p.id) ? 0.5 : 1); assert.match(x.texto, /MΩ a tierra \(correcto\)/);
  }
  const sol = s.aislamiento('STR-202.+').mohm;
  // forma antigua (sin polo): se conserva y no exige seccionador
  const viejo = crear(); for (const id of ['STR-101', 'STR-102', 'STR-201', 'STR-202']) assert.ok(viejo.aislamiento(id).ok && viejo.aislamiento(id).mohm > 20);
  assert.equal(s.aislamiento('XXX').ok, false); assert.equal(s.aislamiento('STR-999.+').ok, false);
  // avería
  s.ordenes.averias.activar('FALLO_AISLAMIENTO_B');
  for (const polo of ['+', '-']) { const x = s.aislamiento(`STR-201.${polo}`); assert.ok(x.ok && !x.correcto && x.mohm > 0.02 && x.mohm < 0.5, `${x.mohm}`); assert.match(x.texto, /FALLO/); }
  assert.ok(s.aislamiento('STR-202.+').correcto && s.aislamiento('STR-101.+').correcto);
  // humedad (cielo cubierto) baja el aislamiento; el frío de la noche lo sube respecto a los paneles calientes, la humedad de la noche lo baja
  const nublado = crear({ nubosidad: 1 }); nublado.ordenes.protecciones.abrir('QS-201');
  const noche = crear({ horaSolar: 2 }); noche.ordenes.protecciones.abrir('QS-201');
  const a = nublado.aislamiento('STR-202.+').mohm, b = noche.aislamiento('STR-202.+').mohm;
  assert.ok(a > 15 && b > 15 && Math.abs(a - sol) > 0.5 && Math.abs(b - sol) > 0.5 && Math.abs(a - sol) < 0.6 * sol, `sol ${sol} nublado ${a} noche ${b}`);
});

test('trazador I-V: referencia de datasheet, resumen coherente con la curva y validez según la irradiancia', () => {
  const s = crear();
  for (const id of ['STR-101', 'STR-102', 'STR-201', 'STR-202']) {
    const r = s.resumenIV(id), curva = s.curvaIV(id, 120), ref = s.curvaIVReferencia(id, 120);
    assert.ok(r.ok && r.valida && r.estable && !r.abierta && r.irradianciaWm2 > 800, id);
    assert.equal(ref.length, 120); assert.ok(ref[0].v <= 0.5 && cerca(ref[ref.length - 1].v, r.vocEsperada, 0.5) && cerca(Math.max(...ref.map(q => q.p)), r.pmppEsperada, 0.01 * r.pmppEsperada));
    assert.ok(cerca(Math.max(...curva.map(q => q.p)), r.pmpp, 0.01 * r.pmpp) && cerca(curva[curva.length - 1].v, r.voc, 0.5) && cerca(curva[0].i, r.isc, 0.05));
    assert.ok(Math.abs(r.desviacionPct) < 3 && Math.abs(r.desviacionVocPct) < 2 && Math.abs(r.desviacionIscPct) < 3 && r.escalones === 0, `${id} ${JSON.stringify(r)}`);
    assert.ok(r.factorForma > 0.6 && r.factorForma < 0.85 && cerca(r.factorForma, r.pmpp / (r.voc * r.isc), 1e-9) && cerca(r.factorForma, r.factorFormaEsperado, 0.03));
    assert.ok(cerca(r.vmpp * r.impp, r.pmpp, 1e-6) && r.temperaturaCelulaC > 30);
    assert.equal(buscarNoFinito(r), null);
  }
  // la referencia a 1000 W/m² y 25 °C es el datasheet
  const esp = L.PANEL_B, r = s.resumenIV('STR-201');
  assert.ok(r.iscEsperada > 0.9 * esp.isc && r.iscEsperada < 1.1 * esp.isc && r.vocEsperada < 4 * esp.voc && r.vocEsperada > 0.8 * 4 * esp.voc);
  // sombra en un panel: un escalón; en dos paneles con distinta sombra, más
  s.ordenes.ambiente.sombra('PV-202', 0.3);
  let x = s.resumenIV('STR-201'); assert.equal(x.escalones, 1); assert.ok(x.desviacionPct < -5 && Math.abs(x.desviacionIscPct) < 3); assert.match(x.texto, /1 escalón/);
  s.ordenes.ambiente.sombra('PV-204', 0.5); assert.ok(s.resumenIV('STR-201').escalones >= 2);
  // la referencia no cambia con las sombras
  assert.ok(cerca(s.resumenIV('STR-201').pmppEsperada, r.pmppEsperada, 1));
  // cadena desconocida
  assert.equal(s.resumenIV('XXX').ok, false); assert.deepEqual(s.curvaIVReferencia('XXX'), []);
  // poca luz: no válida (la norma pide 400 W/m²)
  const tarde = crear({ horaSolar: 18.5 }); x = tarde.resumenIV('STR-101');
  assert.ok(x.ok && !x.valida && x.irradianciaWm2 < 400); assert.match(x.texto, /400 W\/m²/);
  const noche = crear({ horaSolar: 2 }); x = noche.resumenIV('STR-101'); assert.ok(x.ok && !x.valida && x.pmpp === 0 && x.desviacionPct === 0);
  // luz cambiante: hay momentos en que la medida no es válida por inestable
  const nubes = crear({ semilla: 3, nubosidad: 0.5 }); let inestables = 0;
  for (let k = 0; k < 120; k++) { nubes.paso(5); const q = nubes.resumenIV('STR-201'); if (!q.estable) { inestables++; assert.equal(q.valida, false); } }
  assert.ok(inestables > 5, `inestables ${inestables}`);
});

test('trazador I-V: un fusible fundido no cambia la curva de la cadena; un MC4 suelto la deja sin curva', () => {
  const s = crear(), antes = s.resumenIV('STR-101');
  s.ordenes.averias.activar('FUSIBLE_F101');
  let r = s.resumenIV('STR-101'); assert.ok(!r.abierta && cerca(r.pmpp, antes.pmpp, 0.02 * antes.pmpp)); assert.ok(s.curvaIV('STR-101', 40).some(q => q.i > 5));
  assert.equal(cad(s, 'STR-101').abierta, true); assert.equal(cad(s, 'STR-101').abiertaFisica, false);
  s.ordenes.protecciones.rearmar('F-101'); s.ordenes.averias.activar('CADENA_ABIERTA_A1');
  r = s.resumenIV('STR-101'); assert.ok(r.abierta && !r.valida && r.isc === 0 && r.pmpp === 0); assert.match(r.texto, /Sin curva/);
  assert.ok(s.curvaIV('STR-101', 40).every(q => q.i === 0)); assert.equal(cad(s, 'STR-101').abiertaFisica, true);
});

test('termografía: todos los elementos, de noche todo a su ambiente, de día paneles calientes y aparamenta según la corriente (I²R)', () => {
  const s = crear(), t = s.termografia(), tags = new Set(t.elementos.map(e => e.tag));
  assert.equal(tags.size, t.elementos.length);
  for (const e of L.EQUIPOS.filter(x => x.tipo === 'panel')) for (const suf of ['', '.s1', '.s2', '.s3']) assert.ok(tags.has(e.tag + suf), e.tag + suf);
  for (const tag of ['STR-101.mc4.0', 'STR-101.mc4.3', 'STR-202.mc4.2', 'STR-202.mc4.4', 'F-101', 'F-102', 'FB-101', 'CB-101', 'QS-101', 'QS-201', 'SPD-101', 'SPD-201', 'SPD-301', 'QB-101', 'BAT-101',
    'INV-101', 'INV-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303', 'TC-301', 'CAS-001', 'CAS-001.rejilla']) assert.ok(tags.has(tag), tag);
  for (const e of t.elementos) {
    assert.ok(Number.isFinite(e.tempC) && Number.isFinite(e.deltaC) && typeof e.nota === 'string' && e.tipo && equipos.has(e.equipo) && ['cubierta', 'caseta'].includes(e.zona), JSON.stringify(e));
    assert.ok(e.tempC > t.ambienteC - 3 && e.tempC < 90, `${e.tag} ${e.tempC}`);
  }
  assert.ok(cerca(t.ambienteC, s.estado.ambiente.temperaturaAmbienteC, 1e-9) && cerca(t.casetaC, s.estado.ambiente.temperaturaCasetaC, 1e-9) && t.irradianciaWm2.A > 800);
  const de = tag => t.elementos.find(e => e.tag === tag);
  assert.ok(de('PV-101').tempC > t.ambienteC + 20 && Math.abs(de('PV-101').deltaC) < 2 && Math.abs(de('PV-203.s2').deltaC) < 2, 'paneles sanos: calientes e iguales');
  assert.ok(Math.abs(de('STR-202.mc4.2').deltaC) < 2 && de('STR-202.mc4.2').tempC > t.ambienteC + 3);
  assert.ok(de('F-101').deltaC > 3 && de('F-101').deltaC < 20 && de('QF-303').deltaC > 1 && de('TC-301').deltaC === 0);
  assert.ok(cerca(de('INV-101').tempC, s.estado.inversores['INV-101'].temperaturaC, 1e-9) && cerca(de('INV-201').tempC, s.estado.inversores['INV-201'].temperaturaC, 1e-9));
  assert.ok(t.elementos.every(e => e.nota === ''), 'planta sana: sin notas ' + t.elementos.filter(e => e.nota).map(e => e.tag + ': ' + e.nota).join('; '));
  // más corriente de batería, más caliente el magnetotérmico y el portafusible
  const fuerte = crear({ horaSolar: 23, socInicial: 80 }); const frio = termo(fuerte, 'QB-101').deltaC;
  fuerte.ordenes.inversor.modoEasun('BATERIA_PRIMERO'); fuerte.ordenes.cargas.poner('LOAD-302', 2000); avanzar(fuerte, 60);
  assert.ok(Math.abs(fuerte.estado.bateria.i) > 60 && termo(fuerte, 'QB-101').deltaC > frio + 10 && termo(fuerte, 'FB-101').deltaC > 10, `${fuerte.estado.bateria.i} ${termo(fuerte, 'QB-101').deltaC}`);
  // de noche: paneles y conectores a temperatura ambiente; la aparamenta sin corriente, a la de la caseta
  const n = crear({ horaSolar: 2, estabilizar: 1200 }), tn = n.termografia();
  for (const e of tn.elementos.filter(x => x.zona === 'cubierta')) assert.ok(cerca(e.tempC, tn.ambienteC, 0.5), `${e.tag} ${e.tempC} frente a ${tn.ambienteC}`);
  for (const tag of ['F-101', 'F-102', 'CB-101', 'QS-101', 'QS-201', 'QF-303']) assert.ok(cerca(tn.elementos.find(e => e.tag === tag).tempC, tn.casetaC, 0.01), tag);
});

test('termografía: conector resistivo muy caliente (proporcional a I²·R), diodo en corto, punto caliente, sombra fría y suciedad', () => {
  const s = crear();
  s.ordenes.averias.activar('CONECTOR_RESISTIVO_B2'); avanzar(s, 120);
  const malo = termo(s, 'STR-202.mc4.2'), i = s.corriente('STR-202.+').valor;
  assert.ok(malo.deltaC > 40 && /PUNTO CALIENTE/.test(malo.nota) && cerca(malo.deltaC, 0.45 * i * i, 3), `${malo.deltaC} con ${i} A`);
  assert.ok(Math.abs(termo(s, 'STR-202.mc4.1').deltaC) < 2 && Math.abs(termo(s, 'STR-201.mc4.2').deltaC) < 2, 'solo ese conector');
  assert.ok(cerca(s.medidas['STR-202.conectorC'], malo.tempC, 1e-9), 'la lectura suelta del conector es la misma que ve la cámara');
  assert.ok(cerca(s.medir('PV-206.+', 'PV-207.-').valor, i * 1.004, 0.01), 'caída I·R en el conector');
  s.ordenes.averias.activar('CONECTOR_RESISTIVO_B2', { resistenciaOhm: 0.3 }); avanzar(s, 120);
  assert.ok(termo(s, 'STR-202.mc4.2').deltaC < 0.5 * malo.deltaC, 'menos resistencia, menos calor');
  s.ordenes.averias.limpiar(); avanzar(s, 60); assert.ok(Math.abs(termo(s, 'STR-202.mc4.2').deltaC) < 2);

  s.ordenes.averias.activar('DIODO_BYPASS_PV104'); avanzar(s, 60);
  assert.ok(termo(s, 'PV-104.s1').deltaC > 3 && Math.abs(termo(s, 'PV-104.s2').deltaC) < 2 && /cortocircuito/.test(termo(s, 'PV-104.s1').nota) && termo(s, 'PV-104').nota !== '');
  s.ordenes.averias.limpiar();

  s.ordenes.ambiente.sombra('PV-202', 0.3); avanzar(s, 600);
  const fria = termo(s, 'PV-202.s1'); assert.ok(fria.deltaC < -5 && /sombra/.test(fria.nota), `sombra con diodo sano: ${fria.deltaC}`);
  s.ordenes.ambiente.sombra('PV-202', 0); s.ordenes.ambiente.sombra('PV-203', 0.3); s.ordenes.averias.activar('DIODO_BYPASS_ABIERTO_PV203'); avanzar(s, 600);
  const pc = termo(s, 'PV-203.s1'); assert.ok(pc.deltaC > 25 && /PUNTO CALIENTE/.test(pc.nota) && termo(s, 'PV-203').deltaC > 8 && termo(s, 'PV-203.s3').deltaC < pc.deltaC - 15, `punto caliente ${pc.deltaC}`);
  s.ordenes.averias.limpiar(); s.ordenes.ambiente.sombra('PV-203', 0);

  s.ordenes.averias.activar('SUCIEDAD_ALTA_A'); avanzar(s, 600);
  const subsA = s.termografia().elementos.filter(e => e.tipo === 'subcadena' && /^PV-1/.test(e.tag)), dA = subsA.map(e => e.deltaC);
  assert.ok(Math.max(...dA) - Math.min(...dA) > 2 && subsA.every(e => /suciedad/.test(e.nota)), 'manchas irregulares en todo el campo A');
  assert.ok(s.termografia().elementos.filter(e => e.tipo === 'subcadena' && /^PV-2/.test(e.tag)).every(e => e.nota === ''));

  // cadena sin corriente (fusible fundido): sus paneles algo más calientes y su fusible frío
  const f = crear(); f.ordenes.averias.activar('FUSIBLE_F101'); avanzar(f, 600);
  assert.ok(termo(f, 'PV-101').tempC > termo(f, 'PV-104').tempC + 1.5 && termo(f, 'F-101').deltaC < 0.5 && termo(f, 'F-102').deltaC > 3 && /frío/.test(termo(f, 'F-101').nota));
});

test('instrumentos: con todas las averías a la vez ninguna lectura es NaN', () => {
  const s = crear();
  for (const a of L.AVERIAS) s.ordenes.averias.activar(a.id);
  avanzar(s, 600);
  for (const p of s.puntos) assert.ok(Number.isFinite(s.potencial(p.id)), p.id);
  for (const c of s.conductores) assert.ok(Number.isFinite(s.corriente(c.id).valor), c.id);
  assert.equal(buscarNoFinito(s.termografia()), null);
  for (const id of ['STR-101', 'STR-102', 'STR-201', 'STR-202']) { assert.equal(buscarNoFinito(s.resumenIV(id)), null, id); assert.equal(buscarNoFinito(s.curvaIVReferencia(id, 30)), null); }
  assert.equal(buscarNoFinito(s.estado), null);
});
