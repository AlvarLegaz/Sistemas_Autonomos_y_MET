'use strict';
// Pruebas del pulido del 3D de la instalación fotovoltaica (DISEÑADOR): texturas pintadas (módulos DIN, LCD, células), UV de las cajas, estructura blanca sobre la caseta,
// tapa ahumada del cuadro de alterna, MC4 con cuerpo y lazos de cable. Sin navegador: contexto 2D falso y el THREE real del proyecto.
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
const K = require('../js/visor3d_fv/kit.js');
const D = require('../js/visor3d_fv/disposicion.js');
const ESC = require('../js/visor3d_fv/escena_fv.js');
const EQ = require('../js/visor3d_fv/equipos_fv.js');
const PAN = require('../js/visor3d_fv/paneles.js');
const PRESUPUESTO_TRIANGULOS = 120000;
const crear = calidad => ESC.crearEscena(THREE, 'FV', { calidad });
const triangulos = objeto => { let n = 0; objeto.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry; n += g.index ? g.index.count / 3 : g.attributes.position.count / 3; } }); return Math.round(n); };

/** Contexto 2D falso: acepta cualquier llamada, mide el texto a 6 px por carácter y apunta lo que se escribe con fillText. */
function ctxFalso() {
  const textos = [], degradado = { addColorStop() {} }, guardado = {};
  return new Proxy(guardado, {
    get(objeto, nombre) {
      if (nombre === 'textos') return textos;
      if (nombre === 'measureText') return t => ({ width: String(t).length * 6 });
      if (nombre === 'fillText') return t => { textos.push(String(t)); };
      if (nombre === 'createLinearGradient' || nombre === 'createRadialGradient') return () => degradado;
      if (nombre in objeto) return objeto[nombre];
      return () => {};
    },
    set(objeto, nombre, valor) { objeto[nombre] = valor; return true; },
  });
}

test('los módulos DIN se pintan con su calibre, su curva y el botón de test del diferencial', () => {
  const c1 = ctxFalso(); EQ.pintarModulo(c1, 144, 272, { tipo: 'int', texto: 'C16', cuerpo: 0xe4e6e8, polos: 1 });
  assert.ok(c1.textos.includes('C16') && c1.textos.includes('AEG'), c1.textos.join('|'));
  const c2 = ctxFalso(); EQ.pintarModulo(c2, 288, 272, { tipo: 'dif', texto: '40A 30mA', cuerpo: 0xe8e5d2, polos: 2 });
  assert.ok(c2.textos.includes('40A 30mA') && c2.textos.includes('T'), 'el diferencial lleva el rótulo de sensibilidad y la T del botón de test');
  for (const tipo of ['spd', 'fus', 'toma', 'relleno']) assert.doesNotThrow(() => EQ.pintarModulo(ctxFalso(), 100, 300, { tipo, cuerpo: 0xdddddd }), tipo);
});

test('las pantallas LCD escriben todos sus valores con rótulos legibles', () => {
  const c = ctxFalso(); EQ.pintarLcdEasun(c, 384, 256, { ac: '230', bat: '26,7', pv: '938', carga: '600', etapa: 'CC' });
  for (const t of ['230', '26,7', '938', '600', 'AC', 'BAT', 'PV', 'LOAD', 'CHG']) assert.ok(c.textos.includes(t), 'LCD EASun sin ' + t);
  const z = ctxFalso(); EQ.pintarLcdZcs(z, 512, 288, { estado: 'Comprobando aislamiento', pac: '0 W', vac: '230 V', fac: '50,00 Hz', pv1: '0 V  0,0 A', pv2: '0 V  0,0 A', alarma: '', espera: 0 });
  assert.ok(z.textos.includes('Comprobando aislamiento') && z.textos.some(t => t.startsWith('PV1')));
  assert.doesNotThrow(() => EQ.pintarLcdEasun(ctxFalso(), 384, 256, { apagado: true }));
});

test('las células de los paneles y los reflejos de la tapa se pintan sin errores', () => {
  assert.doesNotThrow(() => PAN.pintarPoli(ctxFalso(), 1024, 620));
  assert.doesNotThrow(() => PAN.pintarMono(ctxFalso(), 1536, 990));
  assert.doesNotThrow(() => K.pintarReflejoTapa(ctxFalso(), 256, 512));
});

test('las cajas del kit llevan UV proporcionales al mundo (una repetición cada 100 cm) y los planos con UV a escala', () => {
  const kit = K.crearKit(THREE), uv = kit.caja(200, 100, 50).attributes.uv;
  let maxU = 0, maxV = 0;
  for (let i = 0; i < uv.count; i++) { maxU = Math.max(maxU, uv.getX(i)); maxV = Math.max(maxV, uv.getY(i)); }
  assert.ok(Math.abs(maxU - 2) < 1e-6 && Math.abs(maxV - 1) < 1e-6, `uv máximas ${maxU}, ${maxV}`);
  const up = kit.planoUV(300, 100, 50).attributes.uv;
  let m = 0; for (let i = 0; i < up.count; i++) m = Math.max(m, up.getX(i));
  assert.ok(Math.abs(m - 6) < 1e-6);
  kit.liberar();
});

test('las mallas fusionadas conservan las UV (para las texturas de hormigón y de chapa)', () => {
  const kit = K.crearKit(THREE), e = kit.ensamble(), padre = new THREE.Group();
  e.caja(10, 10, 10, 'hormigon', [0, 0, 0]).caja(5, 5, 5, 'hormigon', [20, 0, 0]);
  const [m] = e.construir(padre, 'x');
  assert.ok(m.geometry.attributes.uv && m.geometry.attributes.uv.count === m.geometry.attributes.position.count);
  kit.liberar();
});

test('la estructura blanca sobre la caseta desaparece al quitar la «Tapa» y con «Corte»', () => {
  const e = crear('baja'), est = e.partes[2].estructura;
  assert.ok(est && est.children.length > 0, 'hay estructura');
  assert.equal(est.visible, true);
  e.ponerTapa(false); assert.equal(est.visible, false); e.ponerTapa(true); assert.equal(est.visible, true);
  e.ponerCorte(true); assert.equal(est.visible, false); e.ponerCorte(false); assert.equal(est.visible, true);
  e.liberar();
});

test('la estructura cubre la caseta por encima de la cumbrera y no pisa los campos de paneles', () => {
  const e = crear('baja'), est = e.partes[2].estructura, C = D.CASETA;
  e.raiz.updateMatrixWorld(true);
  const caja = new THREE.Box3().setFromObject(est);
  assert.ok(caja.min.x < C.x - C.ancho / 2 && caja.max.x > C.x + C.ancho / 2 && caja.min.z < C.z - C.fondo / 2 && caja.max.z > C.z + C.fondo / 2, 'cubre la caseta');
  const una = new THREE.Box3(); let bajoMin = Infinity;
  est.traverse(o => { if (o.isMesh) { una.setFromObject(o); if (una.min.y > 100) bajoMin = Math.min(bajoMin, una.min.y); } });   // solo las piezas altas (cerchas, correas), no los pilares ni sus placas
  assert.ok(bajoMin > C.altoCumbrera + 20, 'las cerchas quedan por encima de la cumbrera: ' + bajoMin);
  for (const lado of ['A', 'B']) { const c = D.cajaCampo(lado); assert.ok(!(c.x0 < caja.max.x && caja.min.x < c.x1 && c.z0 < caja.max.z && caja.min.z < c.z1), 'la estructura no pisa el campo ' + lado); }
  e.liberar();
});

test('el cuadro de alterna tiene tapa ahumada con reflejos y todos sus módulos se pueden seleccionar', () => {
  const e = crear('baja'), q = e.elementos['QA-301'].grupo;
  const tapas = []; q.traverse(o => { if (o.userData.tapa) tapas.push(o); });
  assert.ok(tapas.length >= 1 && tapas.every(t => t.material.transparent), 'tapa transparente');
  e.ponerTapa(false); assert.ok(tapas.every(t => !t.visible)); e.ponerTapa(true); assert.ok(tapas.every(t => t.visible));
  for (const tag of ['QF-301', 'ID-301', 'QF-302', 'QF-303', 'SPD-301', 'TC-301']) {
    let ok = false; e.elementos[tag].grupo.traverse(o => { if (o.isMesh && o.userData.id === tag) ok = true; });
    assert.ok(ok, tag + ' no se puede seleccionar');
  }
  const tam = new THREE.Box3().setFromObject(q).getSize(new THREE.Vector3());
  assert.ok(Math.min(tam.x, tam.z) < D.INTERIOR['QA-301'].fondo + 1.5, 'el cuadro no sobresale de lo previsto: ' + Math.min(tam.x, tam.z).toFixed(1));   // está en la pared oeste: su fondo cae en x
  e.liberar();
});

test('el cableado lleva MC4 con tuerca, funda y pestaña (hijos del conector móvil), abrazaderas y lazos', () => {
  const e = crear('baja'), cab = e.partes[4];
  let mallas = 0, tri = 0; cab.grupo.traverse(o => { if (o.isMesh) { mallas++; tri += o.geometry.attributes.position.count / 3; } });
  assert.ok(mallas > 8 && tri > 8000, `cableado: ${mallas} mallas, ${Math.round(tri)} triángulos`);
  const mc4 = []; e.elementos['STR-101'].grupo.traverse(o => { if (o.isMesh && o.children.length >= 3) mc4.push(o); });
  assert.ok(mc4.length >= 1, 'el conector hembra móvil lleva tres piezas hijas');
  e.liberar();
});

test('la escena pulida sigue dentro del presupuesto en calidad alta y baja', () => {
  for (const c of ['baja', 'alta']) { const e = crear(c), t = triangulos(e.raiz); assert.ok(t < PRESUPUESTO_TRIANGULOS && t > 40000, `${c}: ${t}`); e.liberar(); }
});
