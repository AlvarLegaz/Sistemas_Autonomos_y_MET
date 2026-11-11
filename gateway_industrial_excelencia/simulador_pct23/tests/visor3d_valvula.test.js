'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const v = require('../js/interfaz/visor3d/escena_valvula.js');
const { MODELOS } = require('../js/interfaz/visor3d/especificaciones.js');
const { lecturasModelo } = require('../js/interfaz/visor3d/lecturas.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const planta = require('../js/modelo/planta.js');

const lecturas = (clave, activa) => {
  const e = estadoPlanta.crearEstado();
  e.salidas[MODELOS[clave].salida] = activa;
  return lecturasModelo(clave, e, planta.observaciones(e));
};

test('el émbolo sube con la bobina activa y baja sin corriente', () => {
  assert.equal(v.alturaObjetivoEmbolo(false), 0);
  assert.equal(v.alturaObjetivoEmbolo(true), v.ELEVACION_EMBOLO_CM);
});

test('el émbolo se acerca al objetivo sin pasarse y sin depender de los fotogramas por segundo', () => {
  let a = 0;
  for (let i = 0; i < 6; i++) { const nuevo = v.suavizar(a, 2.2, 1 / 60); assert.ok(nuevo > a && nuevo < 2.2); a = nuevo; }
  assert.ok(Math.abs(v.suavizar(0, 2.2, 10) - 2.2) < 1e-6);
  const unPaso = v.suavizar(0, 2.2, 0.1), dosPasos = v.suavizar(v.suavizar(0, 2.2, 0.05), 2.2, 0.05);
  assert.ok(Math.abs(unPaso - dosPasos) < 1e-9);
  assert.equal(v.suavizar(1, 2.2, 0), 1);
});

test('camino del fluido: 2 vías solo pasa abierta; 3 vías siempre pasa por un camino', () => {
  assert.deepEqual(v.caminosIluminados(2, 'cerrada'), []);
  assert.deepEqual(v.caminosIluminados(2, 'abierta'), ['ENTRADA', 'SALIDA']);
  assert.deepEqual(v.caminosIluminados(3, 'reposo'), ['COMUN', 'VIA_REPOSO']);
  assert.deepEqual(v.caminosIluminados(3, 'activa'), ['COMUN', 'VIA_ACTIVA']);
});

test('cada modelo de válvula tiene un puerto dibujado por cada conexión y su camino es coherente con las lecturas', () => {
  for (const clave of ['VALV_SOL1', 'VALV_SOL2', 'VALV_SOL3', 'VALV_SOL4', 'VALV_SOL5']) {
    const m = MODELOS[clave];
    assert.equal(m.escena, 'valvula');
    for (const c of m.conexiones) assert.ok(v.PUERTOS[c.id], `${clave}: falta el puerto ${c.id}`);
    for (const activa of [false, true]) {
      const l = lecturas(clave, activa);
      assert.equal(l.sensores.BOBINA.activo, activa);
      const ilum = v.caminosIluminados(l.vias, l.camino);
      for (const id of ilum) assert.ok(m.conexiones.some(c => c.id === id), `${clave}: ${id} no es una conexión`);
      if (m.vias === 2) assert.equal(ilum.length > 0, activa);
      else assert.equal(ilum.includes(activa ? 'VIA_ACTIVA' : 'VIA_REPOSO'), true);
    }
  }
});

test('producto en verde para SOL1 y SOL2 y agua fría en azul para el resto', () => {
  assert.equal(v.colorFluido('SOL1'), 0x2f9e44);
  assert.equal(v.colorFluido('SOL2'), 0x2f9e44);
  for (const s of ['SOL3', 'SOL4', 'SOL5']) assert.equal(v.colorFluido(s), 0x2f7fc7);
});
