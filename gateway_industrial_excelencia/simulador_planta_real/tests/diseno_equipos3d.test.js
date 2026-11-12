'use strict';
// Pruebas del diseño realista de los equipos de proceso en 3D. Se construyen con el THREE real del proyecto (sin navegador ni WebGL: solo geometrías y mallas)
// para comprobar que cada tag sigue siendo seleccionable, que los equipos caben en su sitio y que se respeta el presupuesto de triángulos.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const EQ = require('../js/visor3d_htst/equipos_proceso.js');
const CF = require('../js/visor3d_htst/como_funciona.js');
const I = require('../js/visor3d_htst/interiores.js');
const P = require('../js/visor3d_htst/puertos.js');
const layout = require('../js/layout.js');

// El THREE del proyecto es un script global (window.THREE): se evalúa con un window de mentira.
function cargarTHREE() {
  const ventana = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '..', '..', 'simulador_pct23', 'js', 'vendor', 'three.js'), 'utf8'))(ventana);
  return ventana.THREE;
}
const THREE = cargarTHREE();
const triangulos = (grupo, soloVisibles = true) => {
  let t = 0;
  grupo.traverse(o => {
    if (!(o.isMesh || o.isInstancedMesh) || !o.geometry || (soloVisibles && !o.visible)) return;
    const g = o.geometry, n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    t += (o.isInstancedMesh ? o.count : 1) * n;
  });
  return t;
};

test('todos los equipos de proceso se construyen y cada uno tiene su elemento con grupo y ancla', () => {
  const r = EQ.crear(THREE);
  for (const tag of EQ.TAGS) { assert.ok(r.elementos[tag] && r.elementos[tag].grupo, tag); assert.equal(r.elementos[tag].id, tag); assert.ok(r.elementos[tag].ancla, tag); }
  assert.equal(typeof r.actualizar, 'function'); assert.equal(typeof r.liberar, 'function');
  r.actualizar({ equipos: {}, proceso: {} }); r.actualizar(undefined);
  r.liberar();
});

test('las mallas de cada equipo llevan su tag para poder seleccionarlas', () => {
  const r = EQ.crear(THREE);
  for (const tag of EQ.TAGS) {
    let con = 0; r.elementos[tag].grupo.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.id === tag) con++; });
    assert.ok(con >= 1, `${tag} sin mallas seleccionables`);
  }
  r.liberar();
});

test('presupuesto de triángulos: pocos miles por equipo (el intercambiador, con placas instanciadas, algo más) y menos de 60 000 entre todos', () => {
  const r = EQ.crear(THREE);
  let total = 0;
  for (const tag of EQ.TAGS) {
    const t = triangulos(r.elementos[tag].grupo); total += t;
    assert.ok(t > 20, `${tag} casi vacío`);
    assert.ok(t <= (tag === 'HX-101' ? 14000 : 9000), `${tag}: ${t} triángulos`);
  }
  assert.ok(total < 60000, `${total} triángulos en total`);
  r.liberar();
});

test('cada equipo fusiona sus piezas estáticas: pocas llamadas de dibujo por equipo', () => {
  const r = EQ.crear(THREE);
  for (const tag of EQ.TAGS) {
    let mallas = 0; r.elementos[tag].grupo.traverse(o => { if (o.isMesh || o.isInstancedMesh) mallas++; });
    assert.ok(mallas <= 60, `${tag}: ${mallas} mallas`);
  }
  r.liberar();
});

test('las piezas de cada equipo quedan dentro de un volumen razonable alrededor de su sitio del layout', () => {
  const r = EQ.crear(THREE);
  r.grupo.updateMatrixWorld(true);
  for (const tag of EQ.TAGS) {
    const caja = new THREE.Box3(); let hay = false;
    r.elementos[tag].grupo.traverse(o => {
      if (!(o.isMesh || o.isInstancedMesh) || o.userData.id !== tag || o.geometry.type === 'BoxGeometry' && o.material.transparent) return;
      if (o.isInstancedMesh) return;                                           // las placas instanciadas se comprueban aparte
      o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); caja.union(b); hay = true;
    });
    if (!hay) continue;
    const p = layout.posicion(tag), c = caja.getCenter(new THREE.Vector3()), s = caja.getSize(new THREE.Vector3());
    assert.ok(Math.abs(c.x - p.x) < 40 && Math.abs(c.z - p.z) < 40, `${tag} desplazado de su sitio: ${c.x.toFixed(0)},${c.z.toFixed(0)}`);
    assert.ok(s.y < 125, `${tag}: ${s.y.toFixed(0)} cm de alto`);
  }
  r.liberar();
});

test('el tanque y el calentador conservan sus radios y alturas exteriores (los instrumentos se montan sobre su pared)', () => {
  const r = EQ.crear(THREE); r.grupo.updateMatrixWorld(true);
  const radio = (tag, yMin, yMax, R) => {
    let cuantos = 0;
    r.elementos[tag].grupo.traverse(o => {
      if (!o.isMesh || o.userData.id !== tag || o.userData.clave !== 'inox' && o.userData.clave !== 'gris') return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < yMin || y > yMax) continue; if (Math.abs(Math.hypot(pos.getX(i), pos.getZ(i)) - R) < 0.5) cuantos++; }
    });
    return cuantos;
  };
  assert.ok(radio('TK-101', 30, 70, 33) >= 100, 'virola del tanque de 33 cm de radio');
  assert.ok(radio('HW-201', 20, 60, 17) >= 50, 'camisa del calentador de 17 cm de radio');
  r.liberar();
});

test('las bombas: aspiración axial por el lado -z de la voluta y el motor dentro del patín', () => {
  assert.deepEqual(EQ.BOMBA, { x: -10, y: 13, z: -3 });
  for (const tag of ['P-101', 'P-201']) {
    const ent = P.puerto(tag, 'ent'), sal = P.puerto(tag, 'sal'), pos = layout.posicion(tag);
    assert.ok(ent[2] - pos.z < EQ.BOMBA.z - 5, `${tag}: la aspiración llega por -z`);
    assert.ok(Math.abs(sal[0] - pos.x - EQ.BOMBA.x) < 1, `${tag}: la descarga sale sobre la voluta`);
    assert.ok(pos.z + 18.5 < layout.SKID.fondo / 2, `${tag}: el ventilador queda dentro del patín`);
  }
});

test('el interior de las bombas se construye sobre el centro de la voluta y todos los interiores abren sin error', () => {
  const r = EQ.crear(THREE), it = I.crear(THREE, r.elementos);
  for (const tag of I.TAGS_CON_INTERIOR) {
    it.abrir(tag); assert.equal(it.abierto(), tag);
    it.actualizar({ equipos: { 'P-101': { marcha: true, velocidadPct: 80 }, 'P-201': { marcha: true }, 'SV-101': { energizada: true } }, proceso: { caudalLh: 1500, temperaturas: {} } }, 0.05);
  }
  it.cerrar(); assert.equal(it.abierto(), null);
  // al abrir el intercambiador las juntas (solo visibles con el equipo cerrado) se ocultan y al cerrar vuelven
  let juntas = null; r.elementos['HX-101'].grupo.traverse(o => { if (o.userData.soloCerrado) juntas = o; });
  assert.ok(juntas, 'hay una malla de juntas');
  it.abrir('HX-101'); assert.equal(juntas.visible, false);
  it.cerrar(); assert.equal(juntas.visible, true);
  it.liberar(); r.liberar();
});

test('placas grabadas: las válvulas, bombas, filtro, FDV y tubo de residencia tienen nombre grabado', () => {
  for (const tag of ['P-101', 'P-201', 'FDV-101', 'HT-101', 'FLT-101', 'XV-101', 'XV-102', 'XV-201', 'XV-202', 'XV-301', 'XV-401']) assert.ok(EQ.nombrePlaca(tag).length > 3, tag);
  assert.equal(EQ.nombrePlaca('TK-101'), '');
});

test('el intercambiador conserva sus tres secciones y los interiores abren los mismos equipos que tienen texto', () => {
  assert.equal(EQ.PLACAS.regeneracion + EQ.PLACAS.calentamiento + EQ.PLACAS.enfriamiento, 52);
  assert.equal(EQ.posicionesPlacas().separadores.length, 2);
  assert.deepEqual([...I.TAGS_CON_INTERIOR].sort(), [...CF.TAGS_CON_INTERIOR].sort());
});

test('textos «Cómo funciona»: explican el principio físico y siguen siendo breves (2 a 5 frases)', () => {
  const clave = { 'TK-101': /agitador|presión/i, 'HW-201': /Joule/i, 'P-101': /centr[ií]fuga/i, 'P-201': /voluta/i, 'HX-101': /contracorriente/i,
    'FDV-101': /muelle/i, 'SV-101': /n[uú]cleo/i, 'FLT-101': /cesta/i };
  for (const tag of CF.TAGS_CON_INTERIOR) {
    const t = CF.textoComoFunciona(tag), frases = t.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    assert.ok(frases >= 2 && frases <= 5, `${tag}: ${frases} frases`);
    assert.match(t, clave[tag], tag);
  }
  assert.match(CF.textoComoFunciona('HW-201'), /LSL-201/);               // el nivel del calentador es por dos interruptores, no un porcentaje
  assert.match(CF.textoComoFunciona('HW-201'), /LSH-201/);
  assert.doesNotMatch(CF.textoComoFunciona('HW-201'), /\d\s?%/);
});
