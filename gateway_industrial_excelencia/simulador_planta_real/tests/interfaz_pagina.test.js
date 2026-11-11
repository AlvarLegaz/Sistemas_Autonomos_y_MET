'use strict';
// Pruebas de la interfaz de la planta real: esquema 2D, textos de ayuda, gráficas, página y lecturas del visor 3D (lógica pura).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const esquema = require('../js/scada2d/esquema_htst.js');
const textos = require('../js/interfaz/textos_ayuda.js');
const grafica = require('../js/interfaz/grafica_htst.js');
const leyenda = require('../js/scada2d/leyenda.js');
const visor = require('../js/interfaz/visor_htst.js');
const ayuda = require('../js/interfaz/ayuda_htst.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');
const pagina = require('../js/interfaz/pagina.js');

const produciendo = () => { const sim = crearSimulacion({ semilla: 1 }); sim.ordenes.modo('PRODUCCION'); sim.ordenes.arrancar(); for (let i = 0; i < 6000; i++) sim.paso(0.5); return sim; };

test('el esquema 2D tiene todos los equipos del contrato (data-tag) y ningún tag inventado', () => {
  const tags = esquema.tagsDelEsquema();
  for (const e of layout.EQUIPOS) assert.ok(tags.has(e.tag), `falta ${e.tag} en el esquema`);
  for (const t of tags) assert.ok(layout.equipo(t), `${t} no existe en el contrato`);
});

test('los ids del esquema no se repiten', () => {
  const ids = [];
  (function r(n) { if (!Array.isArray(n)) return; const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null; if (a && a.id) ids.push(a.id); n.forEach(r); })(esquema.ESQUEMA_HTST);
  assert.equal(new Set(ids).size, ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
});

test('tubos activos según el estado real: parada, producción con avance y desvío por fallo de TT-103', () => {
  const sim = crearSimulacion({ semilla: 1 });
  assert.deepEqual(esquema.estadoTubos(sim.estado()), { crudo: false, avance: false, desvio: false, caliente: false, fria: false });
  const prod = produciendo(), t = esquema.estadoTubos(prod.estado());
  assert.equal(t.crudo, true); assert.equal(t.avance, true); assert.equal(t.desvio, false); assert.equal(t.caliente, true); assert.equal(t.fria, true);
  prod.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' });
  for (let i = 0; i < 40; i++) prod.paso(0.5);
  const d = esquema.estadoTubos(prod.estado());
  assert.equal(d.avance, false); assert.equal(d.desvio, true);                           // la FDV desvía y la leche vuelve al tanque
});

test('lectura de instrumentos en el esquema: valor con unidad o fallo del lazo, y alarma', () => {
  const prod = produciendo();
  assert.match(esquema.textoInstrumento(prod.estado(), 'TT-103'), /^7\d,\d °C$/);
  assert.match(esquema.textoInstrumento(prod.estado(), 'FT-101'), /L\/h$/);
  assert.equal(esquema.alarmaInstrumento(prod.estado(), 'TT-103'), false);
  prod.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-102' });
  prod.paso(1);
  assert.match(esquema.textoInstrumento(prod.estado(), 'TT-102'), /ABIERTO/);
  assert.equal(esquema.lecturasEsquema(prod.estado())['TT-102'], true);
});

test('los LEDs del armario: la seta pulsada y el fusible fundido se ven en rojo, y la baliza con una alarma', () => {
  const led = tag => esquema.LEDS.find(l => l[0] === tag);
  const prod = produciendo();
  assert.equal(led('PS-001')[2](prod.estado()), true);
  assert.equal(led('F-201')[3](prod.estado()), false);
  prod.averias.inyectar('AV-FUSIBLE-F201');
  for (let i = 0; i < 20; i++) prod.paso(0.5);
  assert.equal(led('F-201')[3](prod.estado()), true);
  assert.equal(led('HL-001')[3](prod.estado()), true);
});

test('hay ficha de ayuda para cada equipo y el estado vivo se calcula con el modelo real', () => {
  const el = textos.construirElementos();
  for (const e of layout.EQUIPOS) { assert.ok(el[e.tag], e.tag); assert.ok(el[e.tag].queEs.length > 15, `${e.tag}: texto muy corto`); assert.ok(el[e.tag].etiqueta); }
  assert.match(el['FDV-101'].enSimulador, /DESVÍO/);
  const prod = produciendo();
  assert.match(textos.estadoVivo('TT-103', prod.estado()), /°C · \d+,\d+ mA · calidad OK/);
  assert.match(textos.estadoVivo('FDV-101', prod.estado()), /posicion: AVANCE/);
  assert.equal(textos.estadoVivo('TT-103', null), '');
  assert.ok(textos.GUIA.length >= 4);
});

test('el historial de gráficas guarda cada intervalo, se reinicia con el tiempo atrás y limita su tamaño', () => {
  const h = grafica.crearHistorial(5, 2);
  assert.equal(h.registrar(0, { a: 1 }), true); assert.equal(h.registrar(1, { a: 2 }), false); assert.equal(h.registrar(2, { a: 3 }), true);
  for (let t = 4; t <= 20; t += 2) h.registrar(t, { a: t });
  assert.equal(h.longitud(), 5);
  assert.equal(h.ventana(null).length, 5); assert.equal(h.ventana(4).length, 3);
  h.registrar(0, { a: 9 });                                                               // la simulación se reinició
  assert.equal(h.longitud(), 1);
});

test('rango del eje y puntos de la serie: margen, mínimo de alto, recorte y huecos si falta el valor', () => {
  const r = grafica.rangoDe([72, 74], 10);
  assert.ok(r.maximo - r.minimo >= 10); assert.ok(r.minimo <= 68 && r.maximo >= 78);
  assert.deepEqual(grafica.rangoDe([], 1), { minimo: 0, maximo: 1 });
  const filas = [{ t: 0, v: { x: 0 } }, { t: 5, v: {} }, { t: 10, v: { x: 10 } }];
  const p = grafica.puntosDeSerie(filas, 'x', 100, 50, { minimo: 0, maximo: 10 }, 0, 10);
  assert.deepEqual(p[0], [0, 50]); assert.equal(p[1], null); assert.deepEqual(p[2], [100, 0]);
});

test('la leyenda cubre producto, agua caliente, agua fría y los LED', () => {
  assert.deepEqual(leyenda.ELEMENTOS.map(e => e.clave), ['producto', 'caliente', 'frio', 'parado', 'ok', 'alarma']);
});

test('página: elegir la simulación real, resumen del estado y lista de alarmas', () => {
  const real = { crearSimulacion };
  assert.equal(pagina.localizarSimulacion({ htst: { simulacion: real } }), real);
  assert.equal(pagina.localizarSimulacion({ htstSimulacion: real }), real);
  assert.equal(pagina.localizarSimulacion({}), null);
  assert.equal(pagina.localizarSimulacion({ htst: {} }), null);
  const prod = produciendo();
  assert.match(pagina.resumenEstado(prod.estado()), /^Producción · TT-103 7\d,\d °C · caudal \d{4} L\/h · FDV AVANCE$/);
  assert.equal(pagina.resumenEstado(null), '—');
  assert.equal(pagina.formatoReloj(3725), '01:02:05');
  prod.averias.inyectar('AV-FUSIBLE-F201');
  for (let i = 0; i < 20; i++) prod.paso(0.5);
  const alarmas = pagina.listaAlarmas(prod.estado());
  assert.ok(alarmas.some(a => /A140/.test(a.texto)));
  assert.ok(alarmas.every(a => a.clave && typeof a.desdeS === 'number'));
});

test('visor 3D: las lecturas de las etiquetas salen del estado (valor, fallo de lazo, FDV, fusible)', () => {
  const prod = produciendo();
  let l = visor.lecturasHtst(prod.estado()).sensores;
  assert.match(l['TT-103'].texto, /°C/); assert.equal(l['TT-103'].alarma, false);
  assert.equal(l['FDV-101'].texto, 'AVANCE'); assert.equal(l['P-101'].activo, true);
  assert.equal(l['F-201'].texto, 'OK');
  prod.averias.inyectar('AV-FUSIBLE-F201');
  for (let i = 0; i < 20; i++) prod.paso(0.5);
  l = visor.lecturasHtst(prod.estado()).sensores;
  assert.equal(l['F-201'].texto, 'FUNDIDO'); assert.equal(l['F-201'].alarma, true);
  assert.match(l['TT-101'].texto, /ABIERTO/);                                           // sin los 24 V todos los lazos caen
  assert.deepEqual(visor.lecturasHtst(null).sensores, {});
});

test('visor 3D: solo llevan etiqueta los equipos principales (los tubos y el resto, no)', () => {
  assert.equal(visor.sinEtiqueta('TUBO_CRUDO'), true);
  assert.equal(visor.sinEtiqueta('KM-102'), true);
  for (const tag of ['TT-103', 'FDV-101', 'P-101', 'HX-101', 'TK-101']) assert.equal(visor.sinEtiqueta(tag), false, tag);
  for (const tag of visor.CON_ETIQUETA) assert.ok(layout.equipo(tag), tag);
});

test('adaptar la escena: si el diseñador ya ofrece crearEscena se usa tal cual', () => {
  const modulo = { crearEscena() {} };
  assert.equal(visor.adaptarEscena(modulo), modulo);
  assert.equal(typeof visor.adaptarEscena({ crear() {} }).crearEscena, 'function');
});

test('ayuda: el tag del equipo se saca del elemento pulsado o de sus padres', () => {
  const raiz = { dataset: {}, parentNode: null };
  const g = { dataset: { tag: 'P-101' }, parentNode: raiz }, hijo = { dataset: {}, parentNode: g };
  assert.equal(ayuda.tagDelElemento(hijo, raiz), 'P-101');
  assert.equal(ayuda.tagDelElemento({ dataset: {}, parentNode: raiz }, raiz), null);
});
