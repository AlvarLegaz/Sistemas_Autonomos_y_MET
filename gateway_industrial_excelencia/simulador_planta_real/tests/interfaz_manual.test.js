'use strict';
// Pruebas del panel de modo MANUAL y de la franja de alarmas (lógica pura, sin navegador).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const manual = require('../js/interfaz/panel_manual.js');
const franja = require('../js/interfaz/franja_alarmas.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');

const enManual = () => { const sim = crearSimulacion({ semilla: 1 }); sim.ordenes.modo('MANUAL'); sim.paso(1); return sim; };

test('manual: cada actuador del contrato se manda desde una sola fila, agrupado por zona y sin tags inventados', () => {
  const tags = manual.MANDOS.map(m => m.tag);
  assert.equal(new Set(tags).size, tags.length);
  const DO = layout.SENALES.filter(s => s.tipo === 'DO' && s.tag !== 'HL-001').map(s => s.tag);       // la baliza la gobierna el PLC, no el operador
  for (const tag of DO) assert.ok(tags.includes(tag), `falta el mando de ${tag}`);
  assert.ok(tags.includes('VFD-101'));
  for (const m of manual.MANDOS) assert.ok(layout.equipo(m.tag), m.tag);
  assert.deepEqual(manual.ZONAS.map(z => z.id), ['entrada', 'regeneracion', 'agua_caliente', 'salida', 'agua_fria', 'cip', 'llenado']);
});

test('manual: la orden (salida del PLC) y el estado real se leen por separado', () => {
  const sim = enManual();
  assert.equal(manual.ordenDe(sim.estado(), 'P-102'), false);
  sim.ordenes.manual('P-102', 1); sim.paso(2);
  assert.equal(manual.ordenDe(sim.estado(), 'P-102'), true);
  assert.equal(manual.textoReal(sim.estado(), 'P-102'), 'en marcha');
  sim.ordenes.manual('VFD-101', 40); sim.ordenes.manual('P-101', 1); sim.paso(5);
  assert.equal(manual.ordenDe(sim.estado(), 'VFD-101'), 40);
  assert.match(manual.textoReal(sim.estado(), 'VFD-101'), /% de velocidad real/);
});

test('manual: una orden que no se cumple (contactor pegado o bobina abierta) se avisa como fallo', () => {
  const sim = enManual();
  sim.ordenes.manual('P-102', 1); sim.paso(2);
  assert.equal(manual.discrepancia(sim.estado(), 'P-102'), null);
  sim.averias.inyectar('AV-KM-NO-CIERRA', { tag: 'KM-102' }); sim.paso(3);          // el contactor de P-102 no cierra
  const d = manual.discrepancia(sim.estado(), 'P-102');
  assert.match(d || '', /Posible avería/);
  assert.match(d || '', /no se cumple/);
  assert.match(d || '', /multímetro/);
});

test('manual: enclavamientos con su motivo (nivel bajo, sin circulación, termostato, aire, seta, tanque vacío)', () => {
  const sim = enManual(), e = () => sim.estado();
  assert.match(manual.bloqueo(e(), 'KM-201'), /sin circulación/);                         // P-102 parada: los bancos no se pueden conectar
  assert.equal(manual.bloqueo(e(), 'P-102'), null);
  sim.ordenes.manual('P-102', 1); sim.paso(2);
  assert.equal(manual.bloqueo(e(), 'KM-201'), null);
  sim.ordenes.manual('XV-303', 1); sim.paso(700);                                         // depósito vacío
  assert.match(manual.bloqueo(e(), 'KM-202'), /LSL-301/);
  sim.ordenes.manual('XV-102', 1); sim.ordenes.manual('P-101', 0); sim.paso(900);        // tanque de balance vacío
  assert.match(manual.bloqueo(e(), 'P-101'), /LSL-101/);
  sim.ordenes.paroEmergencia(true); sim.paso(1);
  assert.match(manual.bloqueo(e(), 'XV-301'), /Paro de emergencia/);
});

test('manual: acciones peligrosas con su consecuencia (bancos, vaciados, FDV sin condiciones, CIP con leche)', () => {
  const sim = enManual();
  assert.match(manual.peligro(sim.estado(), 'KM-201'), /30 kW/);
  assert.match(manual.peligro(sim.estado(), 'XV-102'), /vaciar el tanque/);
  assert.match(manual.peligro(sim.estado(), 'XV-303'), /vaciar el depósito/);
  assert.match(manual.peligro(sim.estado(), 'SV-101'), /NO CONFORME/);
  assert.equal(manual.peligro(sim.estado(), 'XV-301'), null);
  assert.equal(manual.peligro(sim.estado(), 'P-103'), null);
});

test('manual: confirmación en dos pasos con plazo (el primer pulsado arma, el segundo confirma, y se desarma si pasa el tiempo)', () => {
  let ahora = 0, cambios = 0;
  const d = manual.crearDosPasos({ plazoMs: 5000, ahora: () => ahora, alCambiar: () => cambios++ });
  assert.equal(d.pulsar('KM-201'), 'armada'); assert.equal(d.estaArmada('KM-201'), true);
  ahora = 2000; assert.equal(d.pulsar('KM-201'), 'confirmada'); assert.equal(d.estaArmada('KM-201'), false);
  assert.equal(d.pulsar('KM-201'), 'armada');
  ahora = 8000; assert.equal(d.estaArmada('KM-201'), false);                               // caducó
  assert.equal(d.pulsar('KM-201'), 'armada');
  assert.equal(d.pulsar('XV-102'), 'armada'); assert.equal(d.estaArmada('KM-201'), false);  // armar otra acción desarma la anterior
  assert.ok(cambios > 0);
});

test('manual: «todo a parada segura» apaga bombas y calentador, deja la FDV en desvío y cierra todas las válvulas', () => {
  const sim = enManual();
  for (const tag of ['P-101', 'P-102', 'P-103', 'XV-301', 'XV-101', 'XV-302']) sim.ordenes.manual(tag, 1);
  sim.ordenes.manual('VFD-101', 60); sim.paso(3);
  for (const [tag, valor] of manual.PARADA_SEGURA) sim.ordenes.manual(tag, valor);
  sim.paso(5);
  const e = sim.estado();
  for (const tag of ['P-101', 'P-102', 'P-103']) assert.equal(manual.ordenDe(e, tag), false, tag);
  for (const tag of ['XV-301', 'XV-101', 'XV-302', 'XV-102', 'XV-303', 'XV-401', 'KM-201', 'KM-202', 'SV-101']) assert.equal(manual.ordenDe(e, tag), false, tag);
  assert.equal(manual.ordenDe(e, 'VFD-101'), 0);
  assert.equal(e.equipos['FDV-101'].posicion, 'DESVIO');
  assert.equal(e.modo, 'MANUAL');                                                           // sigue en manual: solo se paró todo
});

test('manual: el panel recoge las protecciones que siguen activas', () => {
  assert.ok(manual.PROTECCIONES.length >= 6);
  for (const palabra of ['ES-001', '24 V', 'TSH-101', 'PSL-201', 'LSL-301', 'LSL-101']) assert.ok(manual.PROTECCIONES.some(p => p.includes(palabra)), palabra);
});

test('franja de alarmas: orden por gravedad y antigüedad, contador sin las de «estado», formas por nivel', () => {
  const alarmas = [
    { codigo: 'A190', tag: 'P-101', nivel: 'aviso', texto: 'a', desdeS: 5 },
    { codigo: 'A140', tag: 'F-201', nivel: 'critica', texto: 'b', desdeS: 30 },
    { codigo: 'A170', tag: 'TSH-101', nivel: 'critica', texto: 'c', desdeS: 10 },
    { codigo: 'M100', tag: 'PLC-001', nivel: 'estado', texto: 'manual', desdeS: 0 },
    { codigo: 'A230', tag: 'LSL-301', nivel: 'alarma', texto: 'd', desdeS: 1 },
  ];
  const orden = franja.ordenarAlarmas(alarmas);
  assert.deepEqual(orden.map(a => a.codigo), ['A170', 'A140', 'A230', 'A190', 'M100']);        // críticas (la más antigua primero), alarma, aviso, estado
  assert.deepEqual(orden.map(a => a.simbolo), ['▲', '▲', '◆', '●', '■']);                       // forma distinta por nivel (no solo color)
  const r = franja.resumenFranja(orden, new Set());
  assert.equal(r.nivel, 'critica'); assert.equal(r.contador, 4); assert.equal(r.sinReconocer, true);
  assert.match(r.texto, /A170 .* \(y 3 más\)/);
  const todas = franja.resumenFranja(orden, new Set(orden.filter(a => a.nivel !== 'estado').map(a => a.clave)));
  assert.equal(todas.sinReconocer, false);                                                    // reconocidas: deja de parpadear
  const sola = franja.resumenFranja(franja.ordenarAlarmas([alarmas[3]]), new Set());
  assert.equal(sola.contador, 0); assert.equal(sola.nivel, 'estado'); assert.equal(sola.sinReconocer, false);
  assert.equal(franja.resumenFranja([], new Set()).nivel, 'ok');
});

test('franja de alarmas: solo se anuncian las alarmas nuevas', () => {
  const lista = franja.ordenarAlarmas([{ codigo: 'A1', tag: 'X', nivel: 'alarma', texto: 'a', desdeS: 0 }, { codigo: 'A2', tag: 'Y', nivel: 'aviso', texto: 'b', desdeS: 1 }]);
  const nuevas = franja.nuevasAlarmas(lista, new Set(['A1:X']));
  assert.deepEqual(nuevas.map(a => a.codigo), ['A2']);
  assert.equal(franja.formatoReloj(3725), '01:02:05');
});

test('manual: protección frente a avería frente a paro frente a falta de 24 V se distinguen en el diagnóstico', () => {
  // Marcha en seco: P-101 se para por LSL-101 y NO es una avería.
  const seco = enManual();
  seco.ordenes.manual('XV-102', 1); seco.paso(1500);                                       // tanque de balance a 0 %
  seco.ordenes.manual('P-101', 1); seco.paso(2);
  const c1 = manual.causaBloqueo(seco.estado(), 'P-101');
  assert.equal(c1.clase, 'proteccion');
  assert.match(manual.bloqueo(seco.estado(), 'P-101'), /^Protegida: tanque de balance vacío \(LSL-101\)/);
  assert.equal(manual.discrepancia(seco.estado(), 'P-101'), null);                         // y por tanto «Es un fallo» ya no sale
  // Fusible F-201 fundido: es falta de 24 V, no un paro de emergencia, aunque las entradas (también la seta) lean 0.
  const sin24 = enManual();
  sin24.averias.inyectar('AV-FUSIBLE-F201'); sin24.paso(3);
  const c2 = manual.causaBloqueo(sin24.estado(), 'XV-301');
  assert.equal(c2.clase, 'sin24v');
  assert.match(manual.bloqueo(sin24.estado(), 'XV-301'), /^Sin 24 V \(F-201\)/);
  assert.doesNotMatch(manual.bloqueo(sin24.estado(), 'XV-301'), /Paro de emergencia/);
  // Seta pulsada: paro de emergencia.
  const paro = enManual();
  paro.ordenes.paroEmergencia(true); paro.paso(2);
  assert.equal(manual.causaBloqueo(paro.estado(), 'XV-301').clase, 'paro');
  assert.match(manual.bloqueo(paro.estado(), 'XV-301'), /^Paro de emergencia \(ES-001\)/);
  // Avería de verdad: contactor que no cierra y ninguna protección lo explica.
  const averia = enManual();
  averia.ordenes.manual('P-102', 1); averia.paso(2);
  averia.averias.inyectar('AV-KM-NO-CIERRA', { tag: 'KM-102' }); averia.paso(3);
  assert.equal(manual.causaBloqueo(averia.estado(), 'P-102'), null);
  assert.match(manual.discrepancia(averia.estado(), 'P-102') || '', /Posible avería/);
});

test('franja: el resumen separa la más grave del resto y cuenta por nivel (el «y N más» es un desplegable)', () => {
  const alarmas = [
    { codigo: 'A170', tag: 'TSH-101', texto: 'disparado', desdeS: 5, nivel: 'critica' },
    { codigo: 'A140', tag: 'P-102', texto: 'x', desdeS: 6, nivel: 'alarma' }, { codigo: 'A141', tag: 'P-103', texto: 'x', desdeS: 7, nivel: 'alarma' },
    { codigo: 'A230', tag: 'HW-101', texto: 'x', desdeS: 8, nivel: 'aviso' }, { codigo: 'M100', tag: 'PLC-001', texto: 'x', desdeS: 9, nivel: 'estado' },
  ];
  const r = franja.resumenFranja(franja.ordenarAlarmas(alarmas), new Set());
  assert.equal(r.principal.codigo, 'A170');
  assert.equal(r.resto.length, 3);                                                         // las de «estado» no cuentan
  assert.deepEqual(r.porNivel, { critica: 1, alarma: 2, aviso: 1 });
});
