'use strict';
// Núcleo común: repetir(registro, crearSimulacion) (CONTRATO.md §3.3 y R12). Con las dos fábricas reales (y el juguete):
//  - el registro graba el pasoFijoS de la fábrica (FV 2 s, HTST 0,1 s);
//  - repetir lo rehace con el mismo estado y registro;
//  - repetir RECHAZA un registro con otro pasoFijoS (también otro simulador o versión) con codigo 'registro_incompatible'.
const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, test } = require('node:test');
const T = require('../tipos.js');
const { repetir } = require('../js/nucleo/registro.js');
const { repetir: repetirPrueba } = require('./contrato.js');

const RAIZ = path.resolve(__dirname, '..', '..');
const J = x => JSON.stringify(x);
const clonar = x => JSON.parse(J(x));

const FABRICAS = [
  ['fotovoltaica', 'simulador_fotovoltaica/js/modelo/contrato_fv.js'],
  ['planta_real', 'simulador_planta_real/js/modelo/contrato_htst.js'],
];

function lanza(fn, codigo, que) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof Error, `${que}: debía lanzar un Error`);
  assert.equal(err.codigo, codigo, `${que}: codigo del Error (mensaje: ${err.message})`);
}

for (const [id, ruta] of FABRICAS) {
  describe(`repetir con la fábrica ${id}`, () => {
    const { crearSimulacion } = require(path.join(RAIZ, ruta));
    const sesion = () => {
      const s = crearSimulacion({ semilla: 7 });
      const ej = s.ordenesDisponibles().map(d => d.ejemplo).find(e => !e.tipo.startsWith('averias.') && s.ejecutar(JSON.parse(J(e))).ok === true);
      assert.ok(ej, 'ningún ejemplo válido');
      s.avanzar(20);
      return s;
    };

    test('el registro graba el pasoFijoS de la fábrica (PASO_FIJO_S)', () => {
      const s = crearSimulacion({ semilla: 7 });
      assert.equal(s.registro().pasoFijoS, T.PASO_FIJO_S[id]);
      assert.equal(sesion().registro().pasoFijoS, T.PASO_FIJO_S[id]);
    });

    test('repetir rehace la sesión: mismo estado y mismo registro', () => {
      const s = sesion();
      const r = clonar(s.registro());
      const t = repetir(r, crearSimulacion);
      assert.equal(J(t.estado()), J(s.estado()));
      assert.equal(J(t.registro()), J(r));
      const u = repetirPrueba(clonar(r), crearSimulacion);          // el algoritmo de §3.3 escrito en la prueba da lo mismo
      assert.equal(J(u.estado()), J(s.estado()));
    });

    test('repetir rechaza un registro con pasoFijoS distinto del de la fábrica', () => {
      const r = clonar(sesion().registro());
      for (const otro of [r.pasoFijoS * 2, r.pasoFijoS / 2, 1, 5]) {
        if (otro === r.pasoFijoS) continue;
        lanza(() => repetir({ ...clonar(r), pasoFijoS: otro }, crearSimulacion), 'registro_incompatible', `pasoFijoS ${otro}`);
        assert.throws(() => repetirPrueba({ ...clonar(r), pasoFijoS: otro }, crearSimulacion), /registro_incompatible/, `la repetición de la prueba acepta pasoFijoS ${otro}`);
      }
    });

    test('repetir rechaza otro simulador u otra versión del contrato, y un registro mal formado', () => {
      const r = clonar(sesion().registro());
      lanza(() => repetir({ ...clonar(r), simulador: id === 'fotovoltaica' ? 'planta_real' : 'fotovoltaica' }, crearSimulacion), 'registro_incompatible', 'otro simulador');
      lanza(() => repetir({ ...clonar(r), versionContrato: 2 }, crearSimulacion), 'registro_incompatible', 'versión 2');
      lanza(() => repetir(null, crearSimulacion), 'registro_incompatible', 'null');
      lanza(() => repetir({ ...clonar(r), ordenes: 'no' }, crearSimulacion), 'registro_incompatible', 'ordenes que no es lista');
    });

    test('un registro cuyos pasos van hacia atrás se rechaza como inconsistente', () => {
      const s = crearSimulacion({ semilla: 7 });
      const ej = s.ordenesDisponibles().map(d => d.ejemplo).find(e => !e.tipo.startsWith('averias.'));
      const r = clonar(s.registro());
      r.ordenes = [{ paso: 5, orden: clonar(ej) }, { paso: 2, orden: clonar(ej) }];
      r.pasos = 10;
      lanza(() => repetir(r, crearSimulacion), 'registro_inconsistente', 'paso decreciente');
    });
  });
}
