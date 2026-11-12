'use strict';
// Detector de choques del 3D de la planta (DISEÑADOR): construye la escena con el THREE real del proyecto (sin navegador), reparte toda la geometría entre sus
// «dueños» (cada equipo, cada instrumento, cada tubo TUBO_<ruta> y el armario con sus aparatos) y busca piezas de dueños distintos que se atraviesan.
// Método: cada triángulo del mundo se muestrea en una rejilla de voxeles de 0,5 cm y se anota qué dueño ocupa cada voxel; dos dueños que comparten más de
// UMBRAL_VOXELES voxeles se atraviesan (un simple roce o apoyo comparte pocos). Las uniones legítimas (instrumento sobre su tubo, tubo en la boca de un equipo,
// equipo sobre la bancada…) se declaran en EXCEPCIONES con su motivo. Con CHOQUES_INFORME=1 la prueba imprime el informe completo, también de las excepciones.
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
const TUB = require('../js/visor3d_htst/tuberias.js');
const INS = require('../js/visor3d_htst/instrumentos.js');
const ARM = require('../js/visor3d_htst/armario.js');
const EQ = require('../js/visor3d_htst/equipos_proceso.js');

const VOXEL_CM = 0.5;
const UMBRAL_VOXELES = Number(process.env.CHOQUES_UMBRAL) || 12;          // ≈ 3 cm² de superficie compartida: por debajo es un roce (CHOQUES_UMBRAL=1 para ver hasta los roces)
// Aparatos del armario: pertenecen al dueño QE-001 (van montados dentro o en su puerta).
const DEL_ARMARIO = new Set(['HMI-001', 'ES-001', 'PB-001', 'QF-201', 'PS-001', 'F-001', 'PLC-001', 'VFD-101', 'KM-203', 'KM-201', 'KM-202', 'HL-001']);

/**
 * Uniones legítimas, por parejas de dueños: [A, B, motivo]. Los dueños se comparan por nombre exacto o con prefijo terminado en «*». Sirve para parejas que
 * se tocan de verdad por diseño y no tienen un punto de unión que lo explique (para esas están las reglas de `uniones`, que sí miran dónde se tocan).
 */
const EXCEPCIONES = [];
const coincide = (patron, nombre) => patron.endsWith('*') ? nombre.startsWith(patron.slice(0, -1)) : patron === nombre;
const esExcepcion = (a, b) => EXCEPCIONES.some(([x, y]) => (coincide(x, a) && coincide(y, b)) || (coincide(x, b) && coincide(y, a)));

// Radio (cm) alrededor de una boca de tubo o de un punto de montaje dentro del cual el contacto es una unión (virola, brida, rosca, vaina) y no un choque.
const RADIO_BOCA_CM = 7, RADIO_MONTAJE_CM = 12;
// Equipos en cuya pared o cuerpo va atornillado cada instrumento que NO va sobre un tubo: es su sitio de montaje (la vaina o el flotador entran en el equipo).
const ANFITRION = { 'LT-101': 'TK-101', 'LSL-101': 'TK-101', 'LSH-101': 'TK-101', 'LSL-201': 'HW-201', 'LSH-201': 'HW-201', 'TSH-201': 'HW-201', 'TT-102': 'HX-101' };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/**
 * ¿Es legítimo que los dueños a y b ocupen a la vez el punto p (cm)? Tres uniones:
 *  1. un tubo toca a lo que sea en una de sus dos bocas (los extremos de su ruta son los puertos de los equipos);
 *  2. un instrumento toca su tubo (anclas) en su punto de montaje;
 *  3. un instrumento toca a su anfitrión (ANFITRION) cerca de su punto de montaje.
 */
function unionLegitima(a, b, p) {
  for (const [x, y] of [[a, b], [b, a]]) {
    if (x.startsWith('TUBO_')) {
      const r = TUB.RUTAS.find(q => 'TUBO_' + q.id === x);
      if (r && (dist(p, r.puntos[0]) <= RADIO_BOCA_CM || dist(p, r.puntos[r.puntos.length - 1]) <= RADIO_BOCA_CM)) return true;
      if (r && r.anclas === y) { const m = INS.montaje(y); if (m && dist(p, m) <= RADIO_MONTAJE_CM) return true; }
    } else if (ANFITRION[x] === y) { const m = INS.montaje(x); if (m && dist(p, m) <= RADIO_MONTAJE_CM) return true; }
  }
  return false;
}

/** Construye la escena (equipos, tuberías, instrumentos, armario) y devuelve [{ dueno, mesh }] con las mallas visibles. */
function mallasConDueno() {
  const raiz = new THREE.Group(), partes = [];
  for (const m of [EQ, TUB, INS, ARM]) { const r = m.crear(THREE); raiz.add(r.grupo); partes.push(r); }
  raiz.updateMatrixWorld(true);
  const grupoDe = new Map();                          // grupo de elemento → tag (para las mallas sin id: se heredan del ancestro)
  for (const r of partes) for (const [tag, e] of Object.entries(r.elementos)) if (e.grupo) grupoDe.set(e.grupo, tag);
  const lista = [];
  raiz.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry) return;
    for (let n = o; n; n = n.parent) if (n.visible === false) return;
    let dueno = o.userData.id;
    for (let n = o; !dueno && n; n = n.parent) if (grupoDe.has(n)) dueno = grupoDe.get(n);
    if (!dueno) return;                               // sin dueño: las flechas de flujo de las tuberías (conos instanciados que se colocan al animar)
    if (DEL_ARMARIO.has(dueno)) dueno = 'QE-001';
    lista.push({ dueno, mesh: o });
  });
  return { raiz, lista, partes };
}

/** Marca en una rejilla los voxeles ocupados por cada dueño. Devuelve Map clave de voxel → Set de dueños, y {dueño → voxeles} para localizar. */
function ocupacion(lista) {
  const celdas = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Matrix4(), mi = new THREE.Matrix4();
  const marca = (p, dueno) => {
    const ix = Math.floor(p.x / VOXEL_CM), iy = Math.floor(p.y / VOXEL_CM), iz = Math.floor(p.z / VOXEL_CM);
    const k = ((ix + 4096) * 8192 + (iy + 4096)) * 8192 + (iz + 4096);
    let s = celdas.get(k); if (!s) { s = new Set(); celdas.set(k, s); }
    s.add(dueno);
  };
  const triangulo = (dueno) => {
    const paso = VOXEL_CM * 0.8, la = a.distanceTo(b), lb = a.distanceTo(c);
    const na = Math.max(1, Math.ceil(la / paso)), nb = Math.max(1, Math.ceil(lb / paso));
    const p = new THREE.Vector3();
    for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
      const u = i / na, v = j / nb; if (u + v > 1) continue;
      p.set(a.x + (b.x - a.x) * u + (c.x - a.x) * v, a.y + (b.y - a.y) * u + (c.y - a.y) * v, a.z + (b.z - a.z) * u + (c.z - a.z) * v); marca(p, dueno);
    }
  };
  for (const { dueno, mesh } of lista) {
    const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
    const nTri = idx ? idx.count / 3 : pos.count / 3;
    const n = mesh.isInstancedMesh ? mesh.count : 1;
    for (let k = 0; k < n; k++) {
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(k, mi); m.multiplyMatrices(mesh.matrixWorld, mi); } else m.copy(mesh.matrixWorld);
      for (let t = 0; t < nTri; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(m); b.fromBufferAttribute(pos, i1).applyMatrix4(m); c.fromBufferAttribute(pos, i2).applyMatrix4(m);
        triangulo(dueno);
      }
    }
  }
  return celdas;
}

/** Choques: [{ a, b, voxeles, min, max, excepcion }] ordenados de mayor a menor. `min`/`max` = caja (cm) que encierra los voxeles compartidos. */
function detectarChoques(lista) {
  const celdas = ocupacion(lista), parejas = new Map();
  for (const [k, s] of celdas) {
    if (s.size < 2) continue;
    const duenos = [...s].sort();
    const iz = k % 8192 - 4096, iy = Math.floor(k / 8192) % 8192 - 4096, ix = Math.floor(k / 67108864) - 4096;
    const centro = [(ix + 0.5) * VOXEL_CM, (iy + 0.5) * VOXEL_CM, (iz + 0.5) * VOXEL_CM];
    for (let i = 0; i < duenos.length; i++) for (let j = i + 1; j < duenos.length; j++) {
      if (unionLegitima(duenos[i], duenos[j], centro)) continue;
      const clave = duenos[i] + '|' + duenos[j];
      let e = parejas.get(clave);
      if (!e) { e = { a: duenos[i], b: duenos[j], voxeles: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; parejas.set(clave, e); }
      e.voxeles++;
      [ix, iy, iz].forEach((v, d) => { e.min[d] = Math.min(e.min[d], v * VOXEL_CM); e.max[d] = Math.max(e.max[d], (v + 1) * VOXEL_CM); });
    }
  }
  return [...parejas.values()].map(e => Object.assign(e, { excepcion: esExcepcion(e.a, e.b) })).sort((p, q) => q.voxeles - p.voxeles);
}
const caja = e => `x ${e.min[0].toFixed(1)}..${e.max[0].toFixed(1)}, y ${e.min[1].toFixed(1)}..${e.max[1].toFixed(1)}, z ${e.min[2].toFixed(1)}..${e.max[2].toFixed(1)}`;

test('choques 3D: ninguna pieza de la planta atraviesa a otra salvo las uniones declaradas', () => {
  const { lista, partes } = mallasConDueno();
  assert.ok(lista.length > 300, 'la escena tiene que traer sus mallas');
  
  const choques = detectarChoques(lista).filter(e => e.voxeles >= UMBRAL_VOXELES);
  if (process.env.CHOQUES_INFORME) {
    console.log(`Mallas: ${lista.length}. Choques con más de ${UMBRAL_VOXELES} voxeles de ${VOXEL_CM} cm:`);
    for (const e of choques) console.log(`${e.excepcion ? '  (declarado)' : '  CHOQUE     '} ${e.a} x ${e.b}: ${e.voxeles} voxeles, ${caja(e)}`);
  }
  for (const r of partes) r.liberar();
  const malos = choques.filter(e => !e.excepcion);
  assert.deepEqual(malos.map(e => `${e.a} x ${e.b} (${e.voxeles} voxeles, ${caja(e)})`), [], 'piezas que se atraviesan');
});

// Cada pieza debe caber en el patín (320 × 150 cm): el armario va fuera, y los tubos de servicio llegan a su borde (puertos en x = 160 o z = ±75).
test('choques 3D: ningún equipo, instrumento ni tubo se sale de la bancada (salvo el armario y las bocas de servicio en su borde)', () => {
  const { lista, partes } = mallasConDueno();
  const cajas = new Map(), b = new THREE.Box3(), m = new THREE.Matrix4(), mi = new THREE.Matrix4();
  for (const { dueno, mesh } of lista) {
    if (dueno === 'QE-001') continue;
    mesh.updateMatrixWorld(true); mesh.geometry.computeBoundingBox();
    if (!cajas.has(dueno)) cajas.set(dueno, new THREE.Box3());
    for (let k = 0, n = mesh.isInstancedMesh ? mesh.count : 1; k < n; k++) {
      if (mesh.isInstancedMesh) { mesh.getMatrixAt(k, mi); m.multiplyMatrices(mesh.matrixWorld, mi); } else m.copy(mesh.matrixWorld);
      cajas.get(dueno).union(b.copy(mesh.geometry.boundingBox).applyMatrix4(m));
    }
  }
  const fuera = [], MARGEN = 7;               // 7 cm: la virola y la abrazadera del último tubo asoman un poco del puerto
  for (const [dueno, c] of cajas) {
    if (c.min.x < -layout.SKID.ancho / 2 - MARGEN || c.max.x > layout.SKID.ancho / 2 + MARGEN || c.min.z < -layout.SKID.fondo / 2 - MARGEN || c.max.z > layout.SKID.fondo / 2 + MARGEN)
      fuera.push(`${dueno}: x ${c.min.x.toFixed(1)}..${c.max.x.toFixed(1)}, z ${c.min.z.toFixed(1)}..${c.max.z.toFixed(1)}`);
    if (c.min.y < -0.5) fuera.push(`${dueno}: bajo el suelo del patín (y = ${c.min.y.toFixed(1)})`);
  }
  for (const r of partes) r.liberar();
  assert.deepEqual(fuera, [], 'piezas fuera de la bancada');
});

module.exports = { detectarChoques, mallasConDueno, EXCEPCIONES };
