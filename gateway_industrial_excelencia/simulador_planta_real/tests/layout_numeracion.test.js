// Numeración de los equipos: la centena del número es el circuito. Si alguien añade o renombra un equipo, esta prueba obliga a mantener la regla en todos los planos
// (el sinóptico, el 3D, Fuerza y Mando salen todos de layout.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');

// La tabla completa, escrita a mano para que sea también la documentación de la regla.
const ESPERADO = {
  0: ['QE-001', 'PS-001', 'F-001', 'PB-001', 'ES-001', 'PLC-001', 'HMI-001', 'HL-001'],
  1: ['TK-101', 'FLT-101', 'P-101', 'VFD-101', 'HX-101', 'HT-101', 'FDV-101', 'SV-101', 'XV-101', 'XV-102', 'TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-106', 'FT-101', 'PT-101', 'PT-102',
    'LT-101', 'LSH-101', 'LSL-101', 'ZS-101', 'ZS-102'],
  2: ['HW-201', 'P-201', 'XV-201', 'XV-202', 'TT-201', 'TSH-201', 'LSL-201', 'LSH-201', 'KM-201', 'KM-202', 'KM-203', 'QF-201'],
  3: ['XV-301'],
  4: ['XV-401'],
  5: ['FRL-501', 'PSL-501'],
};

test('cada equipo está en el circuito que dice su número, y la tabla coincide con layout.js', () => {
  const tags = layout.EQUIPOS.map(e => e.tag);
  assert.equal(new Set(tags).size, tags.length, 'hay tags repetidos');
  for (const [circuito, lista] of Object.entries(ESPERADO)) for (const tag of lista) assert.equal(layout.circuitoDe(tag), Number(circuito), `${tag} debería ser del circuito ${circuito}`);
  assert.deepEqual([...tags].sort(), Object.values(ESPERADO).flat().sort(), 'falta o sobra algún equipo en la tabla de la prueba');
});

test('todos los circuitos tienen nombre y todos los equipos pertenecen a uno', () => {
  for (const e of layout.EQUIPOS) assert.ok(layout.CIRCUITOS[layout.circuitoDe(e.tag)], `${e.tag}: circuito sin nombre`);
  assert.equal(layout.circuitoDe('HW-201'), 2); assert.equal(layout.circuitoDe('XV-401'), 4); assert.equal(layout.circuitoDe('sin numero'), null);
});

test('un instrumento lleva el número del equipo en el que está: nivel y termostato del calentador, nivel del tanque', () => {
  for (const tag of ['LSL-201', 'LSH-201', 'TSH-201', 'TT-201', 'P-201', 'XV-201', 'XV-202']) assert.equal(layout.circuitoDe(tag), layout.circuitoDe('HW-201'), tag);
  for (const tag of ['LSL-101', 'LSH-101', 'LT-101']) assert.equal(layout.circuitoDe(tag), layout.circuitoDe('TK-101'), tag);
});

test('las señales del PLC solo hablan de equipos que existen', () => {
  const tags = new Set(layout.EQUIPOS.map(e => e.tag));
  for (const s of layout.SENALES) assert.ok(tags.has(s.tag), `la señal ${s.tag} no es un equipo`);
});
