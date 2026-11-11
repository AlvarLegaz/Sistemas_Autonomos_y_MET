'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const t = require('../js/interfaz/visor3d/planta3d/tuberias.js');
const { ESQUEMA_PCT23 } = require('../js/interfaz/scada/esquema_pct23.js');
const { ALTURA_TUBO_CM } = require('../js/interfaz/visor3d/planta3d/layout.js');
const { ELEMENTOS } = require('../js/interfaz/ayuda_textos.js');
const estadoPlanta = require('../js/modelo/estado_planta.js');
const scada = require('../js/interfaz/scada/tuberia.js');

test('parsearPath: H y V encadenan, M abre un trazo nuevo y C se muestrea', () => {
  const trazos = t.parsearPath('M140 150 H190 M226 150 H238 V346');
  assert.deepEqual(trazos, [[{ x: 140, y: 150 }, { x: 190, y: 150 }], [{ x: 226, y: 150 }, { x: 238, y: 150 }, { x: 238, y: 346 }]]);
  const curva = t.parsearPath('M330 110 C310 110 310 80 330 80')[0];
  assert.equal(curva.length, 13);
  assert.deepEqual(curva[12], { x: 330, y: 80 });
  assert.throws(() => t.parsearPath('M0 0 Z9'), /no soportado|Comando/);
});

test('todos los paths del esquema se parsean y empiezan donde dice su M', () => {
  const visitar = nodo => {
    if (!Array.isArray(nodo)) return [];
    const [etiqueta, atributos = {}, ...hijos] = nodo;
    return [...(etiqueta === 'path' && atributos.d && /\btubo\b/.test(atributos.class || '') ? [atributos.d] : []), ...hijos.flatMap(visitar)];
  };
  const caminos = visitar(ESQUEMA_PCT23);
  assert.ok(caminos.length >= 15);
  for (const d of caminos) {
    const trazos = t.parsearPath(d);
    assert.ok(trazos.length >= 1 && trazos.every(p => p.length >= 2 && p.every(q => Number.isFinite(q.x) && Number.isFinite(q.y))), d);
  }
});

test('redondearEsquinas: suaviza el giro de 90° sin salirse de la esquina y deja los extremos', () => {
  const puntos = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const r = t.redondearEsquinas(puntos, 2);
  assert.deepEqual(r[0], puntos[0]);
  assert.deepEqual(r[r.length - 1], puntos[2]);
  assert.ok(r.length > 3);
  assert.ok(r.every(p => p.x <= 10 + 1e-9 && p.y >= -1e-9));
  assert.ok(!r.some(p => Math.abs(p.x - 10) < 1e-9 && Math.abs(p.y) < 1e-9), 'la esquina viva debe desaparecer');
  const recto = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
  assert.equal(t.redondearEsquinas(recto, 2).length, 3);
});

test('definirTubos: ids esperados, ayudas existentes, y los cruces pasan por encima', () => {
  const tubos = t.definirTubos(ESQUEMA_PCT23);
  const ids = tubos.map(x => x.id).sort();
  assert.deepEqual(ids, ['TUBO_COLECTOR_FRIO', 'TUBO_COLECTOR_SUPERIOR', 'TUBO_DESVIO', 'TUBO_FRIO', 'TUBO_N1', 'TUBO_N2', 'TUBO_PRODUCTO',
    'TUBO_SOL4', 'TUBO_SOL5', 'TUBO_TANQUE_A', 'TUBO_TANQUE_B']);
  for (const tubo of tubos) assert.ok(ELEMENTOS[tubo.ayuda], `${tubo.id}: ayuda ${tubo.ayuda} inexistente`);
  assert.equal(tubos.find(x => x.id === 'TUBO_N2').clase, 'caliente');
  assert.equal(tubos.find(x => x.id === 'TUBO_FRIO').clase, 'frio');
  assert.equal(tubos.find(x => x.id === 'TUBO_PRODUCTO').clase, 'producto');
  const cruces = tubos.flatMap(x => x.trazos).filter(z => z.cruce);
  assert.equal(cruces.length, 2);
  for (const c of cruces) {
    const alturaMaxima = Math.max(...c.puntos3D.map(p => p.y));
    assert.ok(alturaMaxima > ALTURA_TUBO_CM + 1.5, 'el cruce debe levantarse sobre el otro tubo');
    assert.ok(Math.abs(c.puntos3D[0].y - ALTURA_TUBO_CM) < 1e-9, 'y arrancar a la altura normal');
  }
  assert.ok(tubos.flatMap(x => x.trazos).filter(z => !z.cruce).every(z => z.puntos3D.every(p => p.y === ALTURA_TUBO_CM)));
  assert.equal(tubos.find(x => x.id === 'TUBO_N1').trazos.filter(z => z.sinFlujo).length, 2);
  assert.equal(tubos.find(x => x.id === 'TUBO_SOL5').trazos[0].inverso, true);
});

test('estadoTuberias sigue la lógica del esquema 2D', () => {
  const nuevo = ajustar => { const e = estadoPlanta.crearEstado(); ajustar(e); return t.estadoTuberias(e); };
  const reposo = nuevo(e => { e.salidas.SOL3 = false; });
  assert.equal(reposo.TUBO_N1.activo, false);
  assert.equal(reposo.TUBO_TANQUE_A.activo, true);         // !SOL2, como en el 2D
  assert.equal(reposo.TUBO_TANQUE_B.activo, false);
  assert.equal(reposo.TUBO_FRIO.activo, false);
  const marcha = nuevo(e => { e.salidas.N1 = true; e.salidas.N2 = true; e.consignas.velocidadN2Pct = 40; });
  assert.equal(marcha.TUBO_N1.activo, true);
  assert.equal(marcha.TUBO_PRODUCTO.activo, true);
  assert.equal(marcha.TUBO_DESVIO.activo, false);
  assert.equal(marcha.TUBO_N2.velocidadPct, 40);
  const desvio = nuevo(e => { e.salidas.N1 = true; e.salidas.SOL1 = true; });
  assert.equal(desvio.TUBO_PRODUCTO.activo, false);
  assert.equal(desvio.TUBO_DESVIO.activo, true);
  const tanqueB = nuevo(e => { e.salidas.SOL2 = true; });
  assert.equal(tanqueB.TUBO_TANQUE_B.activo, true);
  assert.equal(tanqueB.TUBO_TANQUE_A.activo, false);
  const frio = nuevo(e => { e.salidas.SOL4 = true; });
  assert.equal(frio.TUBO_SOL4.activo, true);
  assert.equal(frio.TUBO_COLECTOR_SUPERIOR.activo, true);
  assert.equal(frio.TUBO_COLECTOR_FRIO.activo, true);
  assert.equal(frio.TUBO_SOL5.activo, false);
  const inverso = nuevo(e => { e.salidas.N1 = true; e.giro.N1 = true; });
  assert.equal(inverso.TUBO_PRODUCTO.invertido, true);
  assert.equal(inverso.TUBO_N2.invertido, false);
});

test('segundosPorCiclo coincide con el del esquema 2D y la partícula avanza o retrocede según el sentido', () => {
  for (const v of [0, 10, 55, 100, 150]) assert.equal(t.segundosPorCiclo(v), scada.segundosPorCiclo(v));
  assert.ok(Math.abs(t.posicionParticula(0, 4, 0.25, 1) - 0.25) < 1e-12);
  assert.ok(Math.abs(t.posicionParticula(0, 4, 0.25, -1) - 0.75) < 1e-12);
  for (let i = 0; i < 6; i++) { const p = t.posicionParticula(i, 6, 3.7, -1); assert.ok(p >= 0 && p < 1); }
});

test('la velocidad es la misma en cm/s en todos los tubos, sea cual sea su longitud', () => {
  assert.ok(t.velocidadCmS(100) > t.velocidadCmS(10));
  // 10 cm de avance sobre un tubo corto y sobre uno largo: la partícula recorre los mismos cm (no la misma fracción)
  const corto = 60, largo = 240;
  const dCorto = (t.posicionParticulaCm(0, 10, corto, 10, 1) - 0) * corto;
  const dLargo = (t.posicionParticulaCm(0, 40, largo, 10, 1) - 0) * largo;
  assert.ok(Math.abs(dCorto - 10) < 1e-9 && Math.abs(dLargo - 10) < 1e-9);
  const p = t.posicionParticulaCm(3, 12, 100, 1234.5, -1);
  assert.ok(p >= 0 && p < 1);
});
