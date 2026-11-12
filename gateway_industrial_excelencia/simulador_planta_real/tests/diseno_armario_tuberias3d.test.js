// Pruebas del armario QE-001 y de las tuberías en 3D (DISEÑADOR): funciones puras (LED del PLC, bornas, puerta, pilotos, HMI, pendiente de desagües, uniones tri-clamp)
// y construcción con el THREE real del simulador (sin DOM: sin rótulos ni pantallas, pero con toda la geometría).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const layout = require('../js/layout.js');
const ARM = require('../js/visor3d_htst/armario.js');
const T = require('../js/visor3d_htst/tuberias.js');
const { estadoDemo } = require('../js/visor3d_htst/estado_demo.js');

function cargarThree() {
  const ventana = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '../../simulador_pct23/js/vendor/three.js'), 'utf8'))(ventana);
  return ventana.THREE;
}
const THREE = cargarThree();
function triangulos(obj) {
  let t = 0;
  obj.traverse(o => { if (o.geometry && o.visible !== false) { const g = o.geometry; t += (g.index ? g.index.count / 3 : g.attributes.position.count / 3) * (o.isInstancedMesh ? o.count : 1); } });
  return t;
}

/* ---------- armario: funciones puras ---------- */
test('PLC: cada señal del mapa tiene su módulo y su LED, sin salirse de la tarjeta', () => {
  const canales = ARM.canalesPLC();
  const conCanal = layout.SENALES.filter(s => /^[A-Z]{2}\d\.\d+$/.test(s.canal));
  assert.equal(canales.length, conCanal.length, 'todas las señales con dirección tienen LED');
  for (const c of canales) {
    const m = ARM.MODULOS_PLC[c.modulo];
    assert.ok(m && c.led >= 0 && c.led < m.leds, `${c.direccion} fuera de ${m && m.nombre}`);
    assert.equal(m.nombre.replace('-', ''), c.direccion.split('.')[0], `${c.tag}: tarjeta ${m.nombre} y dirección ${c.direccion}`);
  }
  const claves = canales.map(c => `${c.modulo}:${c.led}`);
  assert.equal(new Set(claves).size, claves.length, 'dos señales en el mismo LED');
});

test('PLC: el LED de un canal sigue al estado real (entradas, salidas, lazos y salida analógica)', () => {
  const canal = (tag, tipo) => ARM.canalesPLC().find(c => c.tag === tag && c.tipo === tipo);
  const V = ARM.COLOR_LED.verde, R = ARM.COLOR_LED.reposo;
  const e = { instrumentos: { 'LSH-101': { nivel: 1 }, 'LSL-101': { nivel: 0 }, 'TT-103': { calidad: 'OK', mA: 12 }, 'TT-102': { calidad: 'ABIERTO', mA: 0 }, 'VFD-101': { nivel: 1 } },
    salidasPLC: { DO: { 'P-101': 1, 'P-201': 0 }, AO: { 'VFD-101': 55 } } };
  assert.equal(ARM.colorCanal(e, canal('LSH-101', 'DI')), V); assert.equal(ARM.colorCanal(e, canal('LSL-101', 'DI')), R);
  assert.equal(ARM.colorCanal(e, canal('VFD-101', 'DI')), ARM.COLOR_LED.rojo, 'el fallo del variador se ve en rojo');
  assert.equal(ARM.colorCanal(e, canal('P-101', 'DO')), V); assert.equal(ARM.colorCanal(e, canal('P-201', 'DO')), R);
  assert.equal(ARM.colorCanal(e, canal('TT-103', 'AI')), V); assert.equal(ARM.colorCanal(e, canal('TT-102', 'AI')), ARM.COLOR_LED.rojo);
  assert.equal(ARM.colorCanal(e, canal('VFD-101', 'AO')), V);
  assert.equal(ARM.colorCanal(undefined, canal('P-101', 'DO')), R, 'sin estado, todo en reposo');
  assert.equal(ARM.colorLedsCentrales({ equipos: { 'PS-001': { v24: 0 } } }).err, ARM.COLOR_LED.rojo, 'sin 24 V la CPU da error');
  assert.equal(ARM.colorLedsCentrales({}).run, ARM.COLOR_LED.verde);
});

test('bornas: numeración X0-X4 sin repetir, X1.1 = 230 V y X1.3 = +24 V (como los puntos de medida) y todas dentro de la placa', () => {
  const b = ARM.listaBornas();
  assert.equal(new Set(b.map(x => x.etiqueta)).size, b.length);
  assert.equal(b.find(x => x.etiqueta === 'X1.1').funcion, '230 V'); assert.equal(b.find(x => x.etiqueta === 'X1.3').funcion, '+24V');
  assert.deepEqual(b.filter(x => x.grupo === 'X0').map(x => x.funcion), ['L1', 'L2', 'L3', 'N', 'PE']);
  for (let i = 1; i < b.length; i++) assert.ok(b[i].x > b[i - 1].x + 0.7, `${b[i].etiqueta} pisa a ${b[i - 1].etiqueta}`);
  assert.ok(b[0].x > -ARM.CUERPO.ancho / 2 && b.at(-1).x < ARM.CUERPO.ancho / 2 - 2, 'caben en el carril');
  assert.equal(b.filter(x => x.grupo === 'X3').length, 20, 'diez lazos de 4-20 mA a dos hilos');
});

test('puerta: abierta por defecto, cerrada y translúcida en «Corte» y quitada sin «Tapa»', () => {
  assert.deepEqual(ARM.estadoPuerta(false, true), { visible: true, giro: ARM.PUERTA.giroRad, opacidad: 1 });
  const corte = ARM.estadoPuerta(true, true);
  assert.ok(corte.visible && corte.giro === 0 && corte.opacidad < 0.5);
  assert.equal(ARM.estadoPuerta(false, false).visible, false); assert.equal(ARM.estadoPuerta(true, false).visible, false);
  const pos = layout.posicion('QE-001'), [, , zCerrada] = ARM.puntoPuerta(pos.x, pos.z, -29, 100, 0);
  assert.ok(Math.abs(zCerrada - (pos.z + ARM.CUERPO.fondo / 2)) < 1e-9, 'cerrada, la puerta está en el plano del frente');
});

test('pilotos, relé de seguridad, HMI y pantalla del variador reflejan el estado', () => {
  const sano = estadoDemo({ modo: 'PRODUCCION' });
  const p = ARM.estadoPilotos(sano);
  assert.ok(p.mando && p.marcha && !p.fallo && !p.manual);
  assert.ok(ARM.ksCerrado(sano));
  const seta = estadoDemo({ modo: 'PRODUCCION' }); seta.equipos['ES-001'].pulsado = true;
  assert.equal(ARM.ksCerrado(seta), false, 'con la seta pulsada KS abre');
  const fusible = estadoDemo({ modo: 'PRODUCCION' }); fusible.equipos['F-001'].fundido = true;
  assert.equal(ARM.estadoPilotos(fusible).mando, false); assert.equal(ARM.ksCerrado(fusible), false);
  const alarma = estadoDemo({ modo: 'MANUAL' }); alarma.alarmas = [{ codigo: 'A140' }];
  assert.ok(ARM.estadoPilotos(alarma).fallo && ARM.estadoPilotos(alarma).manual);
  const h = ARM.textoHMI(alarma);
  assert.match(h.titulo, /MANUAL|REVISIÓN/i); assert.ok(h.hayAlarma && /ALARMA/.test(h.alarma)); assert.equal(ARM.textoHMI(sano).alarma, 'SIN ALARMAS');
  assert.match(ARM.textoHMI(sano).lineas[0], /^TT-103 +\d+,\d °C$/);
  assert.equal(ARM.textoVFD(estadoDemo({ modo: 'PARADA' })), 'STOP'); assert.match(ARM.textoVFD(sano), /^\d+,\d Hz$/);
  const f = estadoDemo({ modo: 'PRODUCCION' }); f.equipos['VFD-101'].fallo = true;
  assert.equal(ARM.textoVFD(f), 'FALLO');
  assert.doesNotThrow(() => { ARM.textoHMI(undefined); ARM.estadoPilotos(undefined); ARM.textoVFD(undefined); });
});

test('los dispositivos nuevos (QS-001, QR-001, KS) caben en la placa sin pisar las canaletas horizontales', () => {
  for (const tag of ['QS-001', 'QR-001', 'KS']) assert.ok(ARM.DISPOSITIVOS[tag], tag);
  const canaletas = [[106, 112], [75.5, 84.5], [25, 35]];                           // D1, D2 y D3 (y mín, y máx)
  for (const [tag, d] of Object.entries(ARM.DISPOSITIVOS)) for (const [a, b] of canaletas) assert.ok(d.y + d.h <= a || d.y >= b, `${tag} pisa una canaleta (${a}-${b})`);
});

/* ---------- armario: construcción con THREE ---------- */
test('armario en 3D: todos los tags, cuelga todo de QE-001 (para el aislado), LED instanciados y presupuesto de triángulos', () => {
  const arm = ARM.crear(THREE);
  for (const tag of ARM.TAGS) assert.ok(arm.elementos[tag], tag);
  const qe = arm.elementos['QE-001'].grupo;
  for (const tag of ARM.TAGS.filter(t => t !== 'QE-001')) {
    let n = arm.elementos[tag].grupo; while (n && n !== qe) n = n.parent;
    assert.equal(n, qe, `${tag} no cuelga del grupo de QE-001: «Ver en 3D» lo dejaría fuera`);
  }
  const tri = triangulos(arm.grupo);
  assert.ok(tri > 3000 && tri < 20000, `triángulos del armario: ${tri}`);
  const leds = arm.elementos['PLC-001'].grupo.children.find(o => o.isInstancedMesh);
  assert.equal(leds.count, ARM.MODULOS_PLC.reduce((a, m) => a + m.leds, 0));
  arm.liberar();
});

test('armario en 3D: los LED del PLC cambian con las órdenes del PLC y la puerta responde a «Corte» y «Tapa»', () => {
  const arm = ARM.crear(THREE);
  const estado = estadoDemo({ modo: 'PRODUCCION' }); estado.salidasPLC = { DO: { 'P-101': 1 }, AO: {} };
  arm.actualizar(estado, {}); arm.actualizar(estado, {});
  const leds = arm.elementos['PLC-001'].grupo.children.find(o => o.isInstancedMesh);
  const c = ARM.canalesPLC().find(x => x.tag === 'P-101' && x.tipo === 'DO');
  let primero = 0; for (let i = 0; i < c.modulo; i++) primero += ARM.MODULOS_PLC[i].leds;
  const color = new THREE.Color(); leds.getColorAt(primero + c.led, color);
  assert.equal(color.getHex(), ARM.COLOR_LED.verde);
  const pivote = arm.elementos['HMI-001'].grupo.parent;
  assert.ok(pivote.visible && Math.abs(pivote.rotation.y - ARM.PUERTA.giroRad) < 1e-9);
  arm.ponerCorte(true); assert.ok(pivote.visible && pivote.rotation.y === 0);
  arm.ponerTapa(false); assert.equal(pivote.visible, false);
  arm.ponerTapa(true); arm.ponerCorte(false); assert.ok(pivote.visible && Math.abs(pivote.rotation.y - ARM.PUERTA.giroRad) < 1e-9);
  const ancla = arm.elementos['ES-001'].ancla.clone(); arm.ponerCorte(true);
  assert.ok(arm.elementos['ES-001'].ancla.distanceTo(ancla) > 10, 'la etiqueta de la seta sigue a la puerta al cerrarla');
  arm.liberar();
});

/* ---------- tuberías ---------- */
test('tuberías: siguen todas las rutas con sus nombres y sus puertos', () => {
  const ids = T.RUTAS.map(r => r.id);
  assert.equal(ids.length, 27);
  for (const id of ['LECHE_CRUDA_1', 'LECHE_REG_ENF', 'LECHE_DESVIO', 'AGUA_CALIENTE_2', 'AGUA_FRIA_DESAGUE', 'CIP', 'AIRE_2', 'AGUA_VACIADO_2']) assert.ok(ids.includes(id), id);
  assert.ok(T.puntoSobreRuta('LECHE_TRAS_TUBO').every(Number.isFinite));
});

test('pendiente de los desagües: el tramo horizontal baja hacia el sumidero sin mover los puertos', () => {
  for (const id of ['AGUA_FRIA_DESAGUE', 'LECHE_VACIADO_2', 'AGUA_VACIADO_2']) {
    const r = T.rutaPorId(id);
    assert.ok(r.pendiente > 0, `${id} sin pendiente`);
    const v = T.aplicarPendiente(r.puntos, r.pendiente);
    assert.deepEqual(v[0], r.puntos[0]); assert.deepEqual(v.at(-1), r.puntos.at(-1));
    assert.equal(v.length, r.puntos.length);
    const bajadas = v.map((p, i) => r.puntos[i][1] - p[1]).filter(d => d > 1e-9);
    assert.ok(bajadas.length >= 1 && Math.max(...bajadas) > 0.5, `${id}: la caída no se nota`);
    assert.ok(v.every((p, i) => p[1] >= r.puntos.at(-1)[1] - 1e-9 && p[1] <= r.puntos[i][1] + 1e-9), `${id}: la pendiente sale de rango`);
  }
  assert.deepEqual(T.aplicarPendiente([[0, 10, 0], [0, 10, 100], [0, 0, 100]], 0.05), [[0, 10, 0], [0, 5, 100], [0, 0, 100]]);
  assert.deepEqual(T.aplicarPendiente([[0, 10, 0], [0, 10, 100]], 0.05), [[0, 10, 0], [0, 10, 100]], 'un tramo recto sin descenso no se inclina');
});

test('uniones tri-clamp y cintas de color: junto a las bocas, cada ~150 cm y sin mezclarse', () => {
  assert.deepEqual(T.posicionesUniones(10, true, true), [], 'un tramo muy corto no lleva unión');
  assert.deepEqual(T.posicionesUniones(60, true, true), [7, 53]);
  assert.deepEqual(T.posicionesUniones(60, false, false), []);
  const larga = T.posicionesUniones(320, true, false);
  assert.equal(larga[0], 7); assert.equal(larga.length, 1 + 2); assert.ok(larga.every((x, i) => !i || x > larga[i - 1]));
  assert.deepEqual(T.posicionesBandas(30), []); assert.equal(T.posicionesBandas(60).length, 1); assert.equal(T.posicionesBandas(200).length, 2);
  assert.ok(T.posicionesBandas(200, [60]).every(x => Math.abs(x - 60) > 5), 'una cinta no se pone encima de una unión');
  assert.equal(new Set(Object.values(T.COLOR_BANDA)).size, 5, 'cada fluido tiene su color');
});

test('base de cada tubo: ortonormal con la tangente en y y «arriba» en z', () => {
  for (const t of [[1, 0, 0], [0, 1, 0], [0, 0, -3], [1, 1, 1], [0, -1, 0]]) {
    const b = T.baseDe(t), dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
    assert.ok(Math.abs(dot(b.x, b.y)) < 1e-9 && Math.abs(dot(b.y, b.z)) < 1e-9 && Math.abs(dot(b.x, b.z)) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...b.x) - 1) < 1e-9 && Math.abs(Math.hypot(...b.z) - 1) < 1e-9);
  }
  assert.ok(T.baseDe([1, 0, 0]).z[1] > 0.99, 'en un tubo horizontal el «arriba» es el del mundo');
});

test('tuberías en 3D: un elemento seleccionable por ruta, todas las mallas con su id y «Corte» enseña el líquido', () => {
  const tub = T.crear(THREE);
  assert.equal(Object.keys(tub.elementos).length, T.RUTAS.length);
  tub.grupo.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.userData.id) assert.match(o.userData.id, /^TUBO_/); });
  const tri = triangulos(tub.grupo);
  assert.ok(tri > 15000 && tri < 80000, `triángulos de las tuberías: ${tri}`);
  const estado = estadoDemo({ modo: 'PRODUCCION' });
  tub.actualizar(estado); tub.actualizar(estado);
  const mallasTubo = id => { const m = []; tub.elementos[id].grupo.traverse(o => { if (o.isMesh) m.push(o); }); return m; };
  const antes = mallasTubo('TUBO_LECHE_CALIENTE').length;
  tub.ponerCorte(true); tub.actualizar(estado);
  const despues = mallasTubo('TUBO_LECHE_CALIENTE');
  assert.ok(despues.length > antes, 'aparece el líquido dentro del tubo');
  const acero = despues.find(o => o.userData.clave === 'dinamico' && o.material.transparent);
  assert.ok(acero && acero.material.opacity < 0.5, 'el acero se hace translúcido');
  tub.ponerCorte(false); assert.equal(acero.material.opacity, 1);
  tub.liberar();
});
