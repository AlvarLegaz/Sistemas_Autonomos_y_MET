'use strict';
// Pruebas del diseño 3D de los instrumentos de la planta HTST: montaje, tipos, alturas de los interruptores de nivel, fichas de ayuda y, si el Three.js
// del simulador está a mano, que cada instrumento se construya con su id seleccionable, pocos triángulos y los efectos de avería sin errores.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const INS = require('../js/visor3d_htst/instrumentos.js');
const layout = require('../js/layout.js');
const textos = require('../js/interfaz/textos_ayuda.js');
const { estadoDemo } = require('../js/visor3d_htst/estado_demo.js');

const TODOS = ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-106', 'TT-201', 'TSH-201', 'FT-101', 'PT-101', 'PT-102', 'LT-101', 'LSH-101', 'LSL-101', 'LSL-201', 'LSH-201', 'ZS-101', 'ZS-102', 'PSL-501'];
const TK = { cx: -135, cz: -35, r: 33 }, HW = { cx: 20, cz: 45, r: 17 };

test('existen todos los instrumentos, con su tag en el layout, su tipo y su sitio de montaje', () => {
  assert.deepEqual([...INS.TAGS].sort(), [...TODOS].sort());
  const enLayout = new Set(layout.EQUIPOS.map(e => e.tag));
  for (const tag of TODOS) {
    assert.ok(enLayout.has(tag), `${tag} no está en el layout`);
    assert.ok(INS.TIPO[tag], `${tag} sin tipo`);
    const m = INS.montaje(tag);
    assert.ok(Array.isArray(m) && m.length === 3 && m.every(Number.isFinite), `${tag} sin montaje`);
  }
  for (const viejo of ['LSL-301', 'HW-101']) assert.ok(!INS.TAGS.includes(viejo), `tag antiguo ${viejo}`);
});

test('los tipos distinguen el tanque de leche (sanitario) del depósito de agua caliente (flotadores)', () => {
  assert.equal(INS.TIPO['LSH-101'], 'horquilla_vibrante');
  assert.equal(INS.TIPO['LSL-101'], 'capacitivo');
  assert.equal(INS.TIPO['LT-101'], 'hidrostatico');
  assert.match(INS.TIPO['LSL-201'], /^flotador/);
  assert.match(INS.TIPO['LSH-201'], /^flotador/);
  assert.equal(INS.TIPO['TT-201'], 'pt100_rosca');                // agua: racor roscado
  for (const t of ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-106']) assert.equal(INS.TIPO[t], 'pt100_clamp');   // leche: tri-clamp
});

test('LSL-201 y LSH-201 están a alturas distintas y coherentes con sus niveles (≈ 15 % y ≈ 90 %), en la pared del depósito HW-201', () => {
  const lsl = INS.montaje('LSL-201'), lsh = INS.montaje('LSH-201');
  assert.ok(lsh[1] > lsl[1] + 30, 'el de nivel alto va bastante más arriba');
  assert.equal(lsh[0], lsl[0]); assert.equal(lsh[2], lsl[2]);
  assert.ok(Math.abs(INS.nivelDeMontaje('LSL-201') - 15) < 2, `LSL-201 al ${INS.nivelDeMontaje('LSL-201')} %`);
  assert.ok(Math.abs(INS.nivelDeMontaje('LSH-201') - 90) < 2, `LSH-201 al ${INS.nivelDeMontaje('LSH-201')} %`);
  for (const m of [lsl, lsh]) assert.ok(Math.abs(Math.hypot(m[0] - HW.cx, m[2] - HW.cz) - HW.r) < 0.01, 'sobre la pared del depósito');
  // el depósito de agua caliente no mide porcentaje: no tiene transmisor de nivel
  assert.ok(!INS.TAGS.some(t => /^LT-2/.test(t)));
});

test('en el tanque TK-101, LSL ≈ 10-15 %, LSH ≈ 90 % y LT-101 queda bajo el nivel bajo, a ras del fondo', () => {
  const nl = INS.nivelDeMontaje('LSL-101'), nh = INS.nivelDeMontaje('LSH-101');
  assert.ok(nl >= 10 && nl <= 15, `LSL-101 al ${nl} %`);
  assert.ok(Math.abs(nh - 90) < 2, `LSH-101 al ${nh} %`);
  assert.ok(INS.montaje('LT-101')[1] < INS.montaje('LSL-101')[1], 'el transmisor hidrostático va por debajo del interruptor de nivel bajo');
  for (const t of ['LT-101', 'LSH-101', 'LSL-101']) {
    const m = INS.montaje(t);
    assert.ok(Math.abs(Math.hypot(m[0] - TK.cx, m[2] - TK.cz) - TK.r) < 0.01, `${t} sobre la pared del tanque`);
  }
});

test('los instrumentos de pared miran hacia fuera del depósito', () => {
  for (const [tag, c] of [['LT-101', TK], ['LSH-101', TK], ['LSL-101', TK], ['LSL-201', HW], ['LSH-201', HW], ['TSH-201', HW]]) {
    const m = INS.montaje(tag), a = INS.giro(tag);
    assert.ok(Number.isFinite(a), `${tag} sin giro`);
    const normal = [m[0] - c.cx, m[2] - c.cz], mira = [Math.sin(a), Math.cos(a)];
    const cos = (normal[0] * mira[0] + normal[1] * mira[1]) / Math.hypot(normal[0], normal[1]);
    assert.ok(cos > 0.999, `${tag} no mira hacia fuera (${cos})`);
  }
  for (const tag of ['TT-101', 'FT-101', 'PT-101', 'ZS-101', 'PSL-501']) assert.equal(INS.giro(tag), null);
});

test('el termostato TSH-201 y los instrumentos del calentador no chocan entre sí', () => {
  const lista = ['TSH-201', 'LSL-201', 'LSH-201'].map(t => INS.montaje(t));
  for (let i = 0; i < lista.length; i++) for (let j = i + 1; j < lista.length; j++) {
    assert.ok(Math.hypot(lista[i][0] - lista[j][0], lista[i][1] - lista[j][1], lista[i][2] - lista[j][2]) > 12);
  }
});

test('cada instrumento tiene su ficha de ayuda con qué es, cómo funciona y cómo se cablea', () => {
  const fichas = textos.construirElementos();
  for (const tag of TODOS) {
    const f = fichas[tag];
    assert.ok(f && f.queEs && f.enSimulador, `${tag} sin ficha`);
    assert.ok(f.queEs.length > 100, `${tag}: «qué es» demasiado corto`);
    assert.ok(/DI\d|AI\d/.test(f.enSimulador), `${tag}: falta la entrada del PLC`);
  }
  for (const tag of ['TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-106', 'TT-201', 'FT-101', 'PT-101', 'PT-102', 'LT-101']) assert.match(fichas[tag].enSimulador + fichas[tag].queEs, /4-20 mA/, tag);
  assert.match(fichas['LSL-201'].enSimulador, /NC|cerrado/); assert.match(fichas['LSH-201'].queEs, /flotador/);
  assert.match(fichas['LSH-101'].queEs, /horquilla/); assert.match(fichas['LSL-101'].queEs, /capacitiva/);
  assert.match(fichas['TSH-201'].enSimulador, /NC/); assert.match(fichas['PSL-501'].queEs, /tornillo de ajuste/);
});

// Si el Three.js del simulador está a mano se construyen de verdad los instrumentos (sin navegador: sin texturas de canvas).
const RUTA_THREE = path.join(__dirname, '..', '..', 'simulador_pct23', 'js', 'vendor', 'three.js');
const hayThree = fs.existsSync(RUTA_THREE);
test('con Three.js: cada instrumento se construye, es seleccionable, es ligero y soporta los efectos de avería', { skip: !hayThree && 'sin three.js' }, () => {
  const ventana = {};
  new Function('window', fs.readFileSync(RUTA_THREE, 'utf8'))(ventana);
  const THREE = ventana.THREE;
  const inst = INS.crear(THREE);
  assert.deepEqual(Object.keys(inst.elementos).sort(), [...TODOS].sort());
  for (const tag of TODOS) {
    let ids = 0, triangulos = 0;
    inst.elementos[tag].grupo.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position.count;
      triangulos += n / 3;
      if (o.userData.id === tag) ids++;
    });
    assert.ok(ids >= 3, `${tag}: pocas mallas seleccionables`);
    assert.ok(triangulos < 3500, `${tag}: ${triangulos} triángulos`);
    assert.ok(Math.abs(inst.elementos[tag].grupo.position.y - INS.montaje(tag)[1]) < 1e-9);
  }
  // actualizar con el estado normal, con una avería de lazo abierto (cable cortado, LED rojo) y con otra de fuente (LED apagado)
  assert.doesNotThrow(() => inst.actualizar(estadoDemo({ modo: 'PRODUCCION' })));
  assert.doesNotThrow(() => inst.actualizar(estadoDemo({ modo: 'PRODUCCION', averias: [{ id: 'AV-LAZO-ABIERTO', instancia: 'a', tags: ['TT-103', 'PT-101', 'LSH-201'] }, { id: 'AV-FUENTE-24V', instancia: 'b', tags: ['LT-101'] }] })));
  assert.doesNotThrow(() => inst.actualizar(estadoDemo({ modo: 'PARADA', bajoNivelAgua: true })));
  inst.liberar();
});
