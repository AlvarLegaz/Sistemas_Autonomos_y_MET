'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { crearMotorAverias, CATALOGO } = require('../js/averias/motor.js');
const { CONSTANTES: C } = require('../js/configuracion/constantes.js');
const layout = require('../js/layout.js');
const { crearEstado } = require('../js/modelo/estado.js');

test('el catálogo tiene las 16 averías y el motor las lista con su estado', () => {
  const m = crearMotorAverias();
  assert.equal(m.listar().length, 16);
  assert.ok(m.listar().every(a => a.activa === false));
  m.inyectar('AV-FILTRO-OBSTRUIDO');
  assert.equal(m.listar().find(a => a.id === 'AV-FILTRO-OBSTRUIDO').activa, true);
});

test('inyectar devuelve una instancia, rellena los parámetros por defecto y quitar la retira', () => {
  const m = crearMotorAverias();
  const id = m.inyectar('AV-DERIVA-TT103');
  assert.ok(id);
  const a = m.activas()[0];
  assert.equal(a.id, 'AV-DERIVA-TT103'); assert.deepEqual(a.tags, ['TT-103']); assert.equal(a.parametros.offsetC, 3);
  assert.equal(m.quitar(id), true); assert.equal(m.activas().length, 0); assert.equal(m.quitar(id), false);
});

test('los parámetros numéricos se limitan al rango y las opciones deben ser válidas', () => {
  const m = crearMotorAverias();
  m.inyectar('AV-DERIVA-TT103', { offsetC: 50 });
  assert.equal(m.activas()[0].parametros.offsetC, 6);
  assert.equal(m.inyectar('AV-LAZO-ABIERTO', { tag: 'XX-999' }), null);
  assert.match(m.ultimoMotivoRechazo(), /debe ser uno de/);
  assert.equal(m.inyectar('AV-NO-EXISTE'), null);
  assert.equal(m.inyectar('AV-DERIVA-TT103', { offsetC: 'mucho' }), null);
});

test('rechaza averías incoherentes: la misma dos veces, dos de lazo en el mismo instrumento o dos de alimentación', () => {
  const m = crearMotorAverias();
  assert.ok(m.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' }));
  assert.equal(m.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' }), null);
  assert.equal(m.inyectar('AV-PT100-ABIERTA', { tag: 'TT-103' }), null);                  // un mismo lazo no puede tener dos averías
  assert.match(m.ultimoMotivoRechazo(), /incoherentes/);
  assert.ok(m.inyectar('AV-PT100-ABIERTA', { tag: 'TT-101' }));                           // otro instrumento sí
  assert.ok(m.inyectar('AV-FUSIBLE-F201'));
  assert.equal(m.inyectar('AV-FUENTE-24V'), null);
  assert.match(m.ultimoMotivoRechazo(), /alimentación/);
});

test('reparar: solo la acción y el equipo correctos quitan la avería; los intentos se anotan', () => {
  const m = crearMotorAverias();
  const id = m.inyectar('AV-FUSIBLE-F201');
  let r = m.reparar(id, { accion: 'limpiar', tag: 'F-001' });
  assert.equal(r.ok, false); assert.match(r.motivo, /no resuelve/);
  r = m.reparar(id, { accion: 'sustituir', tag: 'PS-001' });
  assert.equal(r.ok, false); assert.match(r.motivo, /no es el equipo averiado/);
  assert.equal(m.activas()[0].intentos, 2);
  r = m.reparar(id, { accion: 'sustituir', tag: 'F-001' });
  assert.equal(r.ok, true); assert.equal(m.activas().length, 0);
  assert.equal(m.reparar('I999', { accion: 'sustituir', tag: 'F-001' }).ok, false);
});

test('reparar una avería con parámetro de equipo pide el equipo concreto averiado', () => {
  const m = crearMotorAverias();
  const id = m.inyectar('AV-KM-NO-CIERRA', { tag: 'KM-201' });
  assert.equal(m.reparar(id, { accion: 'sustituir', tag: 'KM-203' }).ok, false);
  assert.equal(m.reparar(id, { accion: 'sustituir', tag: 'KM-201' }).ok, true);
});

test('gancho de instrumentos: lazo abierto, sonda abierta, sonda en corto, deriva y ruido', () => {
  const m = crearMotorAverias();
  const base = layout.aMilisamperios(73.5, 0, 100);
  assert.deepEqual(m.alLeerInstrumento('TT-103', 73.5, 0, base), { mA: base, calidad: 'OK' });
  m.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' });
  assert.deepEqual(m.alLeerInstrumento('TT-103', 73.5, 0, base), { mA: 0, calidad: 'ABIERTO' });
  assert.deepEqual(m.alLeerInstrumento('TT-104', 5, 0, 5), { mA: 5, calidad: 'OK' });            // el resto no se toca
  const n = crearMotorAverias();
  n.inyectar('AV-PT100-ABIERTA', { tag: 'TT-102' }); n.inyectar('AV-PT100-CORTO', { tag: 'TT-101' });
  assert.equal(n.alLeerInstrumento('TT-102', 60, 0, 12).mA, 21.5); assert.equal(n.alLeerInstrumento('TT-102', 60, 0, 12).calidad, 'CORTO');
  assert.equal(n.alLeerInstrumento('TT-101', 4, 0, 4.6).mA, 3.55);
  const d = crearMotorAverias(); d.inyectar('AV-DERIVA-TT103', { offsetC: -2 });
  const r = d.alLeerInstrumento('TT-103', 73.5, 0, base);
  assert.ok(Math.abs(r.mA - layout.aMilisamperios(71.5, 0, 100)) < 1e-9); assert.equal(r.calidad, 'DERIVA');
  const ru = crearMotorAverias(); ru.inyectar('AV-RUIDO-4-20', { tag: 'FT-101', amplitudMA: 8 });
  const muestras = []; for (let t = 0; t < 30; t += 0.1) muestras.push(ru.alLeerInstrumento('FT-101', 2000, t, 14.67).mA);
  assert.ok(Math.max(...muestras) - Math.min(...muestras) > 6);
  assert.equal(ru.alLeerInstrumento('FT-101', 2000, 1, 14.67).calidad, 'RUIDO');
});

test('gancho de salidas: contactor pegado conduce siempre, contactor que no cierra no conduce, bobina abierta no energiza', () => {
  const m = crearMotorAverias();
  assert.equal(m.alAccionarSalida('KM-201', 0), 0); assert.equal(m.alAccionarSalida('KM-201', 1), 1);
  m.inyectar('AV-KM-PEGADO', { tag: 'KM-201' }); m.inyectar('AV-KM-NO-CIERRA', { tag: 'KM-203' }); m.inyectar('AV-BOBINA-ABIERTA');
  assert.equal(m.alAccionarSalida('KM-201', 0), 1);
  assert.equal(m.alAccionarSalida('KM-203', 1), 0); assert.equal(m.alAccionarSalida('KM-202', 1), 1);
  assert.equal(m.alAccionarSalida('SV-101', 1), 0);
});

test('gancho de proceso: se aplican y se retiran (idempotente) fugas, obstrucción, aire, ventilador, vástago y falso contacto', () => {
  const m = crearMotorAverias(), e = crearEstado();
  m.alCalcularProceso(e);
  assert.equal(e.equipos['HX-101'].fugaPlaca01, 0); assert.equal(e.equipos['FRL-501'].presionBar, C.aire.presionNominalBar); assert.equal(e.equipos['P-101'].ventiladorOK, true);
  const ids = ['AV-PLACA-FUGA', 'AV-FILTRO-OBSTRUIDO', 'AV-AIRE-BAJO', 'AV-VFD-SOBRETEMP', 'AV-FDV-ATASCADA', 'AV-TSH-DISPARADO'].map(i => m.inyectar(i));
  m.inyectar('AV-KM-PEGADO', { tag: 'KM-202' });
  m.alCalcularProceso(e);
  assert.equal(e.equipos['HX-101'].fugaPlaca01, 0.9); assert.equal(e.equipos['FLT-101'].obstruccion01, 0.7); assert.equal(e.equipos['FRL-501'].presionBar, 3.5);
  assert.equal(e.equipos['P-101'].ventiladorOK, false); assert.equal(e.equipos['FDV-101'].atascada, true); assert.equal(e.equipos['TSH-201'].falsoContacto, true);
  assert.equal(e.equipos['KM-202'].pegado, true); assert.equal(e.equipos['KM-201'].pegado, false);
  for (const id of ids) m.quitar(id);
  m.alCalcularProceso(e);
  assert.equal(e.equipos['HX-101'].fugaPlaca01, 0); assert.equal(e.equipos['P-101'].ventiladorOK, true); assert.equal(e.equipos['FDV-101'].atascada, false);
});

test('alimentación: fuente degradada a 18 V o fusible fundido (sin tensión tras el fusible)', () => {
  const m = crearMotorAverias();
  assert.deepEqual(m.alimentacion(), { v24: 24, fusibleF201: true });
  const f = m.inyectar('AV-FUSIBLE-F201'); assert.deepEqual(m.alimentacion(), { v24: 24, fusibleF201: false }); m.quitar(f);
  m.inyectar('AV-FUENTE-24V'); assert.deepEqual(m.alimentacion(), { v24: 18, fusibleF201: true });
});

test('compartir una avería: el código la reproduce, y un código mal escrito se rechaza sin tocar lo activo', () => {
  const a = crearMotorAverias();
  a.inyectar('AV-DERIVA-TT103', { offsetC: -4 }); a.inyectar('AV-FILTRO-OBSTRUIDO', { obstruccion01: 0.5 }); a.inyectar('AV-LAZO-ABIERTO', { tag: 'PT-101' });
  const codigo = a.codigo();
  assert.match(codigo, /^HTST-[0-9a-f]+$/);
  const b = crearMotorAverias();
  const r = b.desdeCodigo(codigo);
  assert.equal(r.ok, true); assert.equal(r.instancias.length, 3);
  assert.deepEqual(b.activas().map(x => [x.id, x.parametros]), a.activas().map(x => [x.id, x.parametros]));
  assert.equal(b.codigo(), codigo);
  const roto = codigo.slice(0, -1) + (codigo.slice(-1) === '0' ? '1' : '0');
  assert.equal(b.desdeCodigo(roto).ok, false); assert.equal(b.desdeCodigo('HTST-zz').ok, false); assert.equal(b.desdeCodigo('hola').ok, false);
  assert.equal(b.activas().length, 3);
  assert.equal(crearMotorAverias().codigo(), crearMotorAverias().codigo());                // sin averías el código es siempre el mismo
});

test('la vida de una avería sigue al reloj de la simulación', () => {
  const m = crearMotorAverias();
  m.reloj(10); m.inyectar('AV-FILTRO-OBSTRUIDO'); m.reloj(75);
  assert.equal(m.activas()[0].vidaS, 65);
});

// Regresión del informe del tester: códigos con formato válido pero contenido malformado no deben borrar las averías activas ni lanzar excepciones.
function codigoDe(lista) {
  const m = crearMotorAverias();
  m.inyectar('AV-FILTRO-OBSTRUIDO');
  const bueno = m.codigo();                                   // HTST-<hex><suma>
  const hex = s => Buffer.from(s, 'utf8').toString('hex');
  const suma = h => { let s = 0; for (let i = 0; i < h.length; i += 2) s = (s + parseInt(h.slice(i, i + 2), 16)) & 0xff; return s.toString(16).padStart(2, '0'); };
  const cuerpo = hex(JSON.stringify(lista));
  return { bueno, falso: `HTST-${cuerpo}${suma(cuerpo)}` };
}

test('desdeCodigo rechaza contenido malformado sin lanzar excepciones y conserva las averías activas', () => {
  for (const lista of [[null], [5], [['AV-FILTRO-OBSTRUIDO', null]], [['AV-FILTRO-OBSTRUIDO', [1]]], [[1, {}]], 'texto', { a: 1 }]) {
    const m = crearMotorAverias();
    m.inyectar('AV-DERIVA-TT103');
    const { falso } = codigoDe(lista);
    let r;
    assert.doesNotThrow(() => { r = m.desdeCodigo(falso); });
    assert.equal(r.ok, false);
    assert.equal(m.activas().length, 1, `se perdieron averías con ${JSON.stringify(lista)}`);
  }
});
