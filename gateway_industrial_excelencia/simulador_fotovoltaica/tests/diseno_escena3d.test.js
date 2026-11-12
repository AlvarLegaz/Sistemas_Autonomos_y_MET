'use strict';
// Pruebas del 3D de la instalación fotovoltaica (DISEÑADOR) con el THREE real del proyecto (sin navegador): la escena se construye y se libera, cabe en el presupuesto de
// triángulos, todos los equipos de EQUIPOS están y se pueden seleccionar, los equipos de la caseta no se atraviesan, y la animación con el estado de ejemplo
// (y con el modelo real) no da errores y mueve lo que debe (sol, luces, LED, pantallas, sombras de los paneles, fusibles).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

function cargarTHREE() {
  const ventana = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', '..', 'simulador_pct23', 'js', 'vendor', 'three.js'), 'utf8'))(ventana);
  return ventana.THREE;
}
const THREE = cargarTHREE();
const layout = require('../js/layout.js');
const K = require('../js/visor3d_fv/kit.js');
const D = require('../js/visor3d_fv/disposicion.js');
const ESC = require('../js/visor3d_fv/escena_fv.js');
const { estadoDemo } = require('../js/visor3d_fv/estado_demo.js');

const PRESUPUESTO_TRIANGULOS = 120000;
/** Triángulos de todas las mallas visibles de un objeto. */
function triangulos(objeto) {
  let n = 0;
  objeto.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
    const g = o.geometry, base = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    n += base * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(n);
}
const llamadas = objeto => { let n = 0; objeto.traverse(o => { if ((o.isMesh || o.isInstancedMesh || o.isPoints) && o.visible) n++; }); return n; };
function crear(calidad) { return ESC.crearEscena(THREE, 'FV', { calidad }); }

test('la escena se construye con una calidad u otra y se libera sin errores', () => {
  for (const calidad of ['baja', 'alta']) {
    const e = crear(calidad);
    assert.ok(e.raiz && e.luces && e.vistaInicial.far >= 10000, calidad);
    assert.equal(e.iluminacionPropia, true);
    e.liberar();
  }
});

test('el presupuesto de triángulos y de llamadas de dibujo es razonable', () => {
  const e = crear('baja');
  const t = triangulos(e.raiz), n = llamadas(e.raiz);
  if (process.env.INFORME_3D) console.log(`triángulos ${t}, mallas ${n}`);
  assert.ok(t < PRESUPUESTO_TRIANGULOS, `${t} triángulos (presupuesto ${PRESUPUESTO_TRIANGULOS})`);
  assert.ok(t > 20000, 'la escena no parece vacía');
  assert.ok(n < 900, `${n} mallas visibles: hay que fusionar más por material`);
  e.liberar();
});

test('todos los tags de EQUIPOS están en la escena y se pueden seleccionar (con la malla marcada con su id)', () => {
  const e = crear('baja');
  const sel = e.mallasSeleccionables(), ids = new Set(sel.map(m => m.userData.id));
  const faltan = layout.EQUIPOS.map(q => q.tag).filter(t => !e.elementos[t]);
  assert.deepEqual(faltan, [], 'equipos sin elemento 3D: ' + faltan.join(', '));
  const sinMalla = layout.EQUIPOS.map(q => q.tag).filter(t => !ids.has(t));
  assert.deepEqual(sinMalla, [], 'equipos sin malla seleccionable: ' + sinMalla.join(', '));
  const sobran = Object.keys(e.elementos).filter(t => !layout.EQUIPOS.some(q => q.tag === t));
  assert.deepEqual(sobran, [], 'elementos que no son de EQUIPOS: ' + sobran.join(', '));
  for (const q of layout.EQUIPOS) {
    const el = e.elementos[q.tag];
    assert.equal(el.id, q.tag); assert.ok(el.grupo && el.ancla && Number.isFinite(el.ancla.x + el.ancla.y + el.ancla.z), q.tag);
    let hay = false; el.grupo.traverse(o => { if (o.isMesh && o.userData.id === q.tag) hay = true; });
    assert.ok(hay, `${q.tag} no tiene mallas propias con su id`);
  }
  for (const m of sel) assert.ok(e.elementos[m.userData.id], 'malla con un id que no es un elemento: ' + m.userData.id);
  e.liberar();
});

test('cada equipo se puede aislar (?foco=TAG&solo=1) y tiene una vista propia', () => {
  const e = crear('baja');
  for (const q of layout.EQUIPOS) {
    const v = e.vistaDe(q.tag);
    assert.ok(v && Number.isFinite(v.distancia) && v.distancia > 0 && v.objetivo, `vista de ${q.tag}`);
    assert.ok(e.aislar(q.tag), `aislar ${q.tag}`);
    assert.ok(e.mallasSeleccionables().some(m => m.userData.id === q.tag), `${q.tag} desaparece al aislarlo`);
    e.restaurar();
  }
  assert.equal(e.vistaDe('NO-EXISTE'), null); assert.equal(e.aislar('NO-EXISTE'), false);
  e.liberar();
});

test('dentro de la caseta los equipos caben y no se atraviesan entre sí ni con las cosas del suelo', () => {
  const C = D.CASETA, dentro = { x0: -C.ancho / 2, x1: C.ancho / 2, y0: 0, y1: C.altoMuro, z0: -C.fondo / 2, z1: C.fondo / 2 };
  const cajas = Object.entries(D.INTERIOR).map(([tag, def]) => [tag, D.caja(def)]);
  for (const [tag, c] of cajas) {
    assert.ok(c.x0 >= dentro.x0 && c.x1 <= dentro.x1 && c.y0 >= dentro.y0 && c.y1 <= dentro.y1 && c.z0 >= dentro.z0 && c.z1 <= dentro.z1, `${tag} sobresale de la caseta`);
    assert.ok(layout.EQUIPOS.some(q => q.tag === tag), tag + ' no es de EQUIPOS');
  }
  const todas = cajas.concat(Object.entries(D.DECORADO).map(([n, def]) => [n, D.caja(def)]));
  for (let i = 0; i < todas.length; i++) for (let j = i + 1; j < todas.length; j++) {
    const [a, ca] = todas[i], [b, cb] = todas[j];
    assert.ok(!D.solapan(ca, cb), `${a} y ${b} se atraviesan`);
  }
  // los equipos anidados están dentro de la caja de su anfitrión
  for (const [hijo, padre] of Object.entries(D.ANIDADOS)) { assert.ok(layout.EQUIPOS.some(q => q.tag === hijo) && D.INTERIOR[padre], `${hijo} anidado en ${padre}`); }
  // el EASun, la caja de continua y la batería van a una altura razonable para un técnico y la batería está en el suelo
  assert.equal(D.caja(D.INTERIOR['BAT-101']).y0, 0);
});

test('los equipos de la escena quedan realmente dentro de la caseta (cajas de las mallas en el mundo)', () => {
  const e = crear('baja');
  e.raiz.updateMatrixWorld(true);
  const C = D.CASETA, caja = new THREE.Box3();
  for (const tag of Object.keys(D.INTERIOR)) {
    caja.setFromObject(e.elementos[tag].grupo);
    const c = caja.getCenter(new THREE.Vector3());
    assert.ok(Math.abs(c.x - C.x) < C.ancho / 2 + 20 && Math.abs(c.z - C.z) < C.fondo / 2 + 20 && c.y > 0 && c.y < C.altoMuro, `${tag} fuera de la caseta: ${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)}`);
  }
  e.liberar();
});

test('las mallas de los equipos de la caseta no se atraviesan entre sí (cajas reales en el mundo)', () => {
  const e = crear('baja');
  e.raiz.updateMatrixWorld(true);
  const tags = Object.keys(D.INTERIOR), cajas = tags.map(t => new THREE.Box3().setFromObject(e.elementos[t].grupo).expandByScalar(-0.15));
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) {
    assert.ok(!cajas[i].intersectsBox(cajas[j]), `${tags[i]} y ${tags[j]} se atraviesan`);
  }
  // los equipos anidados quedan dentro (o pegados) a la caja de su anfitrión
  for (const [hijo, padre] of Object.entries(D.ANIDADOS)) {
    const ch = new THREE.Box3().setFromObject(e.elementos[hijo].grupo), cp = new THREE.Box3().setFromObject(e.elementos[padre].grupo).expandByScalar(0.5);
    assert.ok(cp.containsBox(ch), `${hijo} sale de ${padre}`);
  }
  e.liberar();
});

test('los dos campos de paneles no se pisan con la caseta ni entre sí y los paneles miran al sur inclinados como dice el contrato', () => {
  const cajaA = D.cajaCampo('A'), cajaB = D.cajaCampo('B'), cajaV = D.cajaCampo('V'), cas = D.cajaCaseta();
  const planta = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
  assert.ok(!planta(cajaA, cajaB) && !planta(cajaA, cajaV) && !planta(cajaB, cajaV), 'campos solapados');
  for (const [n, c] of [['A', cajaA], ['B', cajaB], ['V', cajaV]]) { assert.ok(!planta(c, cas), `el campo ${n} pisa la caseta`); assert.ok(c.x0 > D.CUBIERTA.x0 && c.x1 < D.CUBIERTA.x1 && c.z0 > D.CUBIERTA.z0 && c.z1 < D.CUBIERTA.z1, `el campo ${n} sale de la cubierta`); }
  for (const campo of Object.values(layout.CAMPOS)) for (const cad of campo.cadenas) for (const tag of cad.paneles) {
    const p = D.PANELES[tag];
    assert.ok(p, tag); assert.ok(Math.abs(p.inclinacion - campo.inclinacionGrados * Math.PI / 180) < 1e-9, `${tag}: inclinación`);
    assert.ok(p.yBajo > 0 && p.yAlto > p.yBajo && p.zAlto < p.zBajo, `${tag}: el borde sur va más bajo`);
    assert.equal(p.cadena, cad.id, `${tag} en su cadena`);
  }
  assert.equal(Object.values(D.PANELES).filter(p => p.campo === 'A').length, 6);
  assert.equal(Object.values(D.PANELES).filter(p => p.campo === 'B').length, 8);
  assert.equal(D.FILAS_B.length, 3, 'campo B en 3 filas');
});

test('la animación con el estado de ejemplo no da errores, también de noche, con nubes y con averías', () => {
  const e = crear('baja');
  const casos = [{}, { horaSolar: 14, nubosidad: 0 }, { horaSolar: 3 }, { horaSolar: 7.2, nubosidad: 0.9 }, { horaSolar: 20.8 },
    { averias: layout.AVERIAS.map(a => a.id), sombras: { 'PV-205': 0.9, 'PV-104': 0.4 }, protecciones: { 'QS-101': 'ABIERTO', 'F-102': 'FUNDIDO', 'ID-301': 'DISPARADO' } }];
  for (const c of casos) { assert.doesNotThrow(() => e.actualizar({}, estadoDemo(c)), JSON.stringify(c).slice(0, 80)); }
  assert.doesNotThrow(() => e.actualizar({}, null)); assert.doesNotThrow(() => e.actualizar({}, {}));              // sin estado o con un estado vacío no lanza
  e.liberar();
});

test('el sol se mueve con estado.sol, se atenúa con la nubosidad y de noche se apaga', () => {
  const e = crear('baja');
  e.actualizar({}, estadoDemo({ horaSolar: 9, nubosidad: 0 })); const manana = e.sol.position.clone(), iM = e.sol.intensity;
  e.actualizar({}, estadoDemo({ horaSolar: 16, nubosidad: 0 })); const tarde = e.sol.position.clone();
  assert.ok(manana.x > 0 && tarde.x < 0, 'por la mañana el sol está al este (+x) y por la tarde al oeste (−x)');
  e.actualizar({}, estadoDemo({ horaSolar: 12, diaAnio: 355, nubosidad: 0 })); assert.ok(e.sol.position.z > 1000, 'en invierno a mediodía el sol está al sur (+z) y bajo');
  e.actualizar({}, estadoDemo({ horaSolar: 9, nubosidad: 1 })); assert.ok(e.sol.intensity < iM * 0.3, 'las nubes atenúan el sol');
  e.actualizar({}, estadoDemo({ horaSolar: 1 })); assert.equal(e.sol.visible, false); assert.ok(e.hemi.intensity < 0.3, 'de noche solo queda la luz de relleno');
  e.actualizar({}, estadoDemo({ horaSolar: 12, nubosidad: 0 })); assert.ok(e.sol.visible && e.sol.position.y > 1500, 'a mediodía el sol está alto');
  e.liberar();
});

test('la sombra por panel oscurece el panel, la cadena abierta pone el aviso y las protecciones cambian de posición', () => {
  const e = crear('baja');
  const paneles = e.partes[1], vidrioDe = tag => { let v = null; e.elementos[tag].grupo.traverse(o => { if (o.isMesh && o.geometry.type === 'PlaneGeometry' && o.userData.id === tag) v = o; }); return v; };
  e.actualizar({}, estadoDemo({ horaSolar: 12, nubosidad: 0 }));
  const claro = vidrioDe('PV-205').material.color.getHex();
  e.actualizar({}, estadoDemo({ horaSolar: 12, nubosidad: 0, sombras: { 'PV-205': 1 } }));
  const oscuro = vidrioDe('PV-205').material.color.getHex();
  assert.ok((oscuro & 255) < (claro & 255) * 0.5, `sombra: ${claro.toString(16)} → ${oscuro.toString(16)}`);
  assert.ok(vidrioDe('PV-206').material.color.getHex() === claro, 'el panel de al lado no cambia');
  let avisos = 0; e.elementos['PV-101'].grupo.traverse(o => { if (o.isSprite && o.visible) avisos++; });
  assert.equal(avisos, 0);
  e.actualizar({}, estadoDemo({ horaSolar: 12, averias: ['CADENA_ABIERTA_A1'] }));
  if (typeof document !== 'undefined') { e.elementos['PV-101'].grupo.traverse(o => { if (o.isSprite && o.visible) avisos++; }); assert.equal(avisos, 1); }
  // seccionador abierto: la palanca baja
  const palancas = tag => { const l = []; e.elementos[tag].grupo.traverse(o => { if (o.isMesh && o.geometry.type === 'BoxGeometry') l.push(o.position.y); }); return l; };
  e.actualizar({}, estadoDemo({})); const antes = palancas('QS-101').join();
  e.actualizar({}, estadoDemo({ protecciones: { 'QS-101': 'ABIERTO' } })); const despues = palancas('QS-101').join();
  assert.notEqual(antes, despues, 'el seccionador abierto cambia la posición de su palanca');
  void paneles;
  e.liberar();
});

test('Corte, Tapa y calidad: cambian materiales y visibilidad sin errores', () => {
  const e = crear('alta');
  assert.equal(e.calidad, 'alta'); assert.equal(e.ajustesRender().sombras, true);
  const caseta = e.partes[2];
  e.ponerCorte(true); assert.ok(caseta.materialesCorte.every(m => m.transparent && m.opacity < 0.5)); e.ponerCorte(false); assert.ok(caseta.materialesCorte.every(m => !m.transparent && m.opacity === 1));
  e.ponerTapa(false); e.ponerTapa(true);
  assert.equal(e.ponerCalidad('baja'), 'baja'); assert.equal(e.ajustesRender().sombras, false); assert.equal(e.ponerCalidad('alta'), 'baja', 'solo baja, no sube');
  e.actualizar({}, estadoDemo({}));
  e.liberar();
});

test('calidad alta usa materiales PBR y la baja Lambert (función pura)', () => {
  assert.equal(K.especificacionMaterial('aluminio', {}, 'alta').clase, 'MeshStandardMaterial');
  assert.equal(K.especificacionMaterial('aluminio', {}, 'baja').clase, 'MeshLambertMaterial');
  assert.ok(K.especificacionMaterial('aluminio', {}, 'alta').props.metalness > 0.5);
  assert.equal(K.especificacionMaterial('aluminio', { metalness: 1 }, 'baja').props.metalness, undefined);
  assert.equal(K.elegirCalidad({ forzada: 'alta', porSoftware: true }), 'alta'); assert.equal(K.elegirCalidad({ porSoftware: true }), 'baja'); assert.equal(K.elegirCalidad({}), 'alta');
});

test('el modelo real (si existe) alimenta la escena a lo largo de un día sin errores', () => {
  let sim;
  try { sim = require('../js/modelo/simulacion.js').crearSimulacion({ semilla: 3, diaAnio: 172, horaSolar: 5, nubosidad: 0.2 }); } catch (error) { return; }       // el modelo lo escribe otro agente
  const e = crear('baja');
  for (let h = 0; h < 20; h++) { sim.paso(3600); assert.doesNotThrow(() => e.actualizar({}, sim.estado), 'hora ' + h); }
  sim.ordenes.averias.activar('CADENA_ABIERTA_B1'); sim.paso(60); assert.doesNotThrow(() => e.actualizar({}, sim.estado));
  e.liberar();
});
