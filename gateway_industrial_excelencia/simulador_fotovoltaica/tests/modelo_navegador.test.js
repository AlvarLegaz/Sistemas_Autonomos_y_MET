'use strict';
// Los módulos del modelo se cargan en un «navegador» simulado (sin require ni module) en el orden documentado y dan el mismo resultado que en Node.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const RAIZ = path.join(__dirname, '..', 'js');
const ORDEN = ['layout.js', 'configuracion/constantes.js', 'modelo/sol.js', 'modelo/panel.js', 'modelo/cadena.js', 'modelo/seguidor.js', 'modelo/bateria.js', 'modelo/protecciones.js',
  'modelo/red_cargas.js', 'modelo/inversor_easun.js', 'modelo/inversor_zcs.js', 'modelo/medidas.js', 'averias/catalogo.js', 'averias/motor.js', 'modelo/simulacion.js'];

test('navegador: carga en el orden documentado y expone PCT.fv.crearSimulacion con el mismo resultado que en Node', () => {
  const ventana = {}; ventana.window = ventana;
  const ctx = vm.createContext(ventana);
  for (const f of ORDEN) vm.runInContext(fs.readFileSync(path.join(RAIZ, f), 'utf8'), ctx, { filename: f });
  assert.equal(typeof ventana.PCT.fv.crearSimulacion, 'function');
  const a = ventana.PCT.fv.crearSimulacion({ semilla: 4, horaSolar: 11, nubosidad: 0.2 });
  const b = require('../js/modelo/simulacion.js').crearSimulacion({ semilla: 4, horaSolar: 11, nubosidad: 0.2 });
  for (let k = 0; k < 120; k++) { a.paso(5); b.paso(5); }
  assert.equal(JSON.stringify(a.estado), JSON.stringify(b.estado));
  assert.ok(a.estado.campos.B.p > 1000);
});
