// Pruebas del entorno de la planta en 3D (DISEÑADOR): bandeja de cables y sus bajadas, etiquetas de tubería, atlas de carteles, presupuesto de triángulos,
// construcción y liberación con el THREE real, que nada invade los equipos ni la franja de trabajo y que el cargador y la escena lo incluyen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const layout = require('../js/layout.js');
const ENT = require('../js/visor3d_htst/entorno_planta.js');
const TUB = require('../js/visor3d_htst/tuberias.js');
const INS = require('../js/visor3d_htst/instrumentos.js');
const EQ = require('../js/visor3d_htst/equipos_proceso.js');
const ESC = require('../js/visor3d_htst/escena_planta.js');

function cargarThree() {
  const ventana = {};
  new Function('window', fs.readFileSync(path.join(__dirname, '../../simulador_pct23/js/vendor/three.js'), 'utf8'))(ventana);
  return ventana.THREE;
}
const THREE = cargarThree();
const PRESUPUESTO_TRIANGULOS = 15000;
function triangulos(obj) {
  let t = 0;
  obj.traverse(o => { if (o.geometry && o.visible !== false) { const g = o.geometry; t += (g.index ? g.index.count / 3 : g.attributes.position.count / 3) * (o.isInstancedMesh ? o.count : 1); } });
  return t;
}
// DOM falso mínimo (como el de las pruebas de luz y materiales): los canvas aceptan cualquier llamada de dibujo
function contexto2d() { return new Proxy({}, { get: (o, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true }); }
function conDocumento(fn) {
  const antes = global.document;
  global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => contexto2d() }) };
  try { return fn(); } finally { if (antes === undefined) delete global.document; else global.document = antes; }
}

// Cajas [x0,x1,y0,y1,z0,z1] medidas en el 3D real de los equipos y de los instrumentos (lo que hace escena_planta.js antes de crear el entorno)
function cajasReales() {
  const partes = [TUB, INS, EQ].map(m => m.crear(THREE));
  const els = {};
  for (const p of partes) Object.assign(els, p.elementos);
  const cajas = {};
  for (const q of layout.EQUIPOS) {
    const p = layout.posicion(q.tag);
    if (!els[q.tag] || !(INS.TAGS.includes(q.tag) || (p && p.ancho && !p.fueraDelPatin))) continue;
    els[q.tag].grupo.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(els[q.tag].grupo);
    cajas[q.tag] = [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z];
  }
  for (const p of partes) p.liberar();
  return cajas;
}
const CAJAS = cajasReales();
const PORTICOS = ESC.porticosTuberia().map(p => p.x);
const entorno = conDocumento(() => ENT.crear(THREE, { cajas: CAJAS, porticos: PORTICOS }));
const sinDocumento = ENT.crear(THREE, { cajas: CAJAS, porticos: PORTICOS });

// Cuerpo del armario QE-001 (envolvente, base y el brazo y la seta del lateral): las cajas medidas del módulo del armario incluyen la puerta y los adornos
const ARMARIO = [[185, 245, 0, 142, -70, -40], [177, 253, -21, 1, -78, -32], [242, 256, 64, 79, -32, -18], [246, 256, 90, 121, -27, 3]];

/* ---------- presupuesto, construcción y liberación ---------- */
test('el entorno se construye con y sin DOM y respeta el presupuesto de triángulos', () => {
  assert.ok(triangulos(entorno.grupo) > 2000, 'tiene que haber detalle');
  assert.ok(triangulos(entorno.grupo) <= PRESUPUESTO_TRIANGULOS, `${triangulos(entorno.grupo)} triángulos`);
  assert.ok(triangulos(sinDocumento.grupo) <= PRESUPUESTO_TRIANGULOS);
  assert.ok(entorno.grupo.children.length <= 45, 'pocas mallas: fusionadas por material');
  assert.equal(typeof entorno.actualizar, 'function'); entorno.actualizar({}, {});
  assert.deepEqual(Object.keys(entorno.elementos), [], 'es decorativo: no registra equipos');
});

test('nada del entorno se puede seleccionar: raycast desactivado y sin id', () => {
  let mallas = 0;
  for (const g of [entorno.grupo, sinDocumento.grupo]) g.traverse(o => {
    if (!o.isMesh) return;
    mallas++;
    assert.equal(o.userData.id, undefined, 'una malla del entorno lleva id');
    const golpes = []; o.raycast(new THREE.Raycaster(), golpes); assert.equal(golpes.length, 0);
  });
  assert.ok(mallas > 10);
});

test('liberar() libera todas las geometrías, materiales y texturas', () => {
  const m = conDocumento(() => ENT.crear(THREE, { cajas: CAJAS, porticos: PORTICOS }));
  const geos = new Set(), mats = new Set(), texs = new Set();
  m.grupo.traverse(o => { if (o.geometry) geos.add(o.geometry); if (o.material) { mats.add(o.material); if (o.material.map) texs.add(o.material.map); } });
  let liberados = 0;
  for (const r of [...geos, ...mats, ...texs]) r.addEventListener('dispose', () => liberados++);
  m.liberar();
  assert.equal(liberados, geos.size + mats.size + texs.size, 'algo quedó sin liberar');
  assert.ok(texs.size >= 2, 'el atlas de carteles y la textura de peligro');
});

/* ---------- atlas y etiquetas ---------- */
test('atlas: todas las celdas caben en 1024 × 1024 sin pisarse', () => {
  const celdas = ENT.celdasDe(ENT.etiquetasTuberia()), { pos, alto } = ENT.empaquetar(celdas);
  assert.ok(alto <= 1024, `alto ${alto}`);
  const l = Object.values(pos);
  assert.equal(l.length, new Set(celdas.map(c => c.id)).size);
  for (const p of l) assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= 1024 && p.y + p.h <= 1024);
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const a = l[i], b = l[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'dos celdas se pisan');
  }
});

test('etiquetas de tubería: sobre un tubo de la planta, con su fluido, sentido y sin tapar uniones ni instrumentos', () => {
  const et = ENT.etiquetasTuberia();
  assert.ok(et.length >= 6, `${et.length} etiquetas`);
  for (const t of et) {
    const r = TUB.rutaPorId(t.ruta);
    assert.ok(r && r.fluido !== 'aire' && !r.pendiente);
    assert.equal(t.fluido, r.fluido);
    assert.ok(t.dir === 1 || t.dir === -1);
    // el cartel está a ras del tubo (radio + 0,12 cm) de algún tramo recto de su ruta
    let cerca = Infinity;
    for (let i = 1; i < r.puntos.length; i++) cerca = Math.min(cerca, ENT.distSeg3([t.x, t.y, t.z], r.puntos[i - 1], r.puntos[i]));
    assert.ok(Math.abs(cerca - (TUB.RADIO_TUBO_CM + 0.12)) < 0.01, `${t.ruta}: a ${cerca} cm del eje`);
  }
  const textos = new Set(et.map(t => t.texto));
  assert.ok(textos.has('LECHE PAST.') && textos.has('AGUA CALIENTE') && textos.has('AGUA FRÍA') && textos.has('SOLUCIÓN CIP'));
  // el sentido coincide con el del tubo: en un tubo a lo largo de x, flecha a la derecha si el flujo va hacia +x
  const salida = et.find(t => t.ruta === 'LECHE_SALIDA');
  assert.equal(salida.eje, 'x'); assert.equal(salida.dir, 1, 'LECHE_SALIDA va hacia +x');
});

/* ---------- bandeja y bajadas ---------- */
test('bandeja: está por encima de todo lo del patín y de los pórticos', () => {
  const plan = ENT.planificar({ cajas: CAJAS, porticos: PORTICOS });
  const techo = Math.max(...Object.entries(CAJAS).map(([, c]) => c[3]));
  assert.ok(plan.y - ENT.BANDEJA.alto / 2 > techo + 3, `bandeja a ${plan.y} y equipos hasta ${techo}`);
  assert.ok(plan.y - ENT.BANDEJA.alto / 2 > ESC.ALTO_PORTICO + 6);
  for (const r of TUB.RUTAS) for (const p of r.puntos) assert.ok(p[1] < plan.y - 10, 'un tubo sube hasta la bandeja');
});

test('bajadas: columna libre hasta cada instrumento y cada motor (no atraviesa equipos ni tubos) y llegan al menos a 12 destinos', () => {
  const plan = ENT.planificar({ cajas: CAJAS, porticos: PORTICOS });
  assert.ok(plan.bajadas.length >= 12, `${plan.bajadas.length} bajadas, sin ellas: ${plan.omitidas}`);
  assert.equal(new Set(plan.bajadas.map(b => b.tag)).size, plan.bajadas.length);
  for (const b of plan.bajadas) {
    const col = [b.x - 0.9, b.x + 0.9, b.yAbajo, plan.y - 3, b.z - 0.9, b.z + 0.9];
    for (const [tag, c] of Object.entries(CAJAS)) if (tag !== b.tag) assert.ok(!ENT.solapan(col, c, 1), `${b.tag}: la columna atraviesa ${tag}`);
    for (const px of PORTICOS) assert.ok(Math.abs(b.x - px) >= 4, `${b.tag}: choca con un pórtico`);
    for (let y = b.yAbajo; y <= plan.y - 3; y += 2) for (const r of TUB.RUTAS) for (let i = 1; i < r.puntos.length; i++)
      assert.ok(ENT.distSeg3([b.x, y, b.z], r.puntos[i - 1], r.puntos[i]) > (r.radio || TUB.RADIO_TUBO_CM) + 0.9, `${b.tag}: roza el tubo ${r.id}`);
    assert.ok(b.yAbajo > 0 && b.yAbajo < plan.y);
  }
});

test('postes de la bandeja: en el borde del patín, sin pisar equipos, tubos ni postes de pórtico', () => {
  const plan = ENT.planificar({ cajas: CAJAS, porticos: PORTICOS });
  assert.ok(plan.postesTras.length >= 3 && plan.postesFrente.length >= 3);
  for (const [lista, z] of [[plan.postesTras, ENT.BANDEJA.zPosteTras], [plan.postesFrente, ENT.BANDEJA.zPosteFrente]]) for (const x of lista) {
    const placa = [x - 4, x + 4, 0, 2, z - 4, z + 4];
    for (const [tag, c] of Object.entries(CAJAS)) assert.ok(!ENT.solapan(placa, c, 1), `poste (${x}, ${z}) pisa ${tag}`);
    for (const px of PORTICOS) assert.ok(Math.abs(x - px) >= 10);
    for (const r of TUB.RUTAS) for (let i = 1; i < r.puntos.length; i++) {
      const a = r.puntos[i - 1], b = r.puntos[i], dx = b[0] - a[0], dz = b[2] - a[2], l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l2)) : 0;
      assert.ok(Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) > 4, `poste (${x}, ${z}) sobre el tubo ${r.id}`);
    }
  }
});

/* ---------- choques con equipos, con el armario y con la franja de trabajo ---------- */
const sol = entorno.solidos;
test('el patín: ninguna pieza sólida del entorno sobre el patín entra en un equipo ni en un tubo', () => {
  const sobrePatin = sol.filter(s => s.zona === 'patin');
  assert.ok(sobrePatin.length > 20);
  for (const s of sobrePatin) {
    for (const [tag, c] of Object.entries(CAJAS)) {
      if (s.id === 'cip_tubo' && tag === 'XV-401') continue;                 // la impulsión empalma con la boca de entrada de XV-401
      if (s.id === 'bajada_' + tag) continue;
      assert.ok(!ENT.solapan(s.caja, c, 0), `${s.id} entra en ${tag}`);
    }
    if (s.id === 'cip_tubo') continue;
    for (const r of TUB.RUTAS) for (let i = 1; i < r.puntos.length; i++) {
      const a = r.puntos[i - 1], b = r.puntos[i], n = 12;
      for (let k = 0; k <= n; k++) {
        const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, a[2] + (b[2] - a[2]) * k / n], c = s.caja, rr = r.radio || TUB.RADIO_TUBO_CM;
        const dentro = p[0] > c[0] - rr && p[0] < c[1] + rr && p[1] > c[2] - rr && p[1] < c[3] + rr && p[2] > c[4] - rr && p[2] < c[5] + rr;
        assert.ok(!dentro || s.id === 'bandeja_goteo', `${s.id} corta el tubo ${r.id}`);
      }
    }
  }
});

test('la impulsión de CIP termina exactamente en la boca de entrada de XV-401 y no roza ningún otro tubo', () => {
  const ent = require('../js/visor3d_htst/puertos.js').puerto('XV-401', 'ent');
  const tubos = sol.filter(s => s.id === 'cip_tubo');
  assert.ok(tubos.some(s => Math.abs((s.caja[0] + s.caja[1]) / 2 - ent[0]) < 3 && Math.abs(s.caja[3] - 2.2 - ent[1]) < 1.5 && s.caja[4] <= ent[2] + 2.3 && s.caja[5] >= ent[2] - 2.3), 'ningún tramo llega al puerto');
  for (const s of tubos) for (const r of TUB.RUTAS) for (let i = 1; i < r.puntos.length; i++) {
    const a = r.puntos[i - 1], b = r.puntos[i], n = 20;
    for (let k = 0; k <= n; k++) {
      const p = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, a[2] + (b[2] - a[2]) * k / n], c = s.caja;
      assert.ok(!(p[0] > c[0] && p[0] < c[1] && p[1] > c[2] && p[1] < c[3] && p[2] > c[4] && p[2] < c[5]), `la impulsión de CIP atraviesa el tubo ${r.id}`);
    }
  }
});

test('la franja de trabajo delante del patín queda libre de piezas sólidas', () => {
  const P = ENT.PASILLO;
  for (const s of sol.filter(q => q.zona === 'nave')) {
    const c = s.caja;
    const invade = c[0] < P.x1 && c[1] > P.x0 && c[4] < P.z1 && c[5] > P.z0 && c[2] < 200;       // las vigas del techo (y alta) no cuentan
    assert.ok(!invade, `${s.id} invade la franja de trabajo`);
  }
  assert.equal(P.z0, layout.SKID.fondo / 2 + 3);
});

test('lo sólido de la nave no entra en el armario ni en los equipos ni se pisa entre sí', () => {
  const nave = sol.filter(s => s.zona === 'nave');
  for (const s of nave) {
    for (const c of ARMARIO) assert.ok(!ENT.solapan(s.caja, c, 0), `${s.id} toca el armario`);
    for (const [tag, c] of Object.entries(CAJAS)) assert.ok(!ENT.solapan(s.caja, c, 0), `${s.id} entra en ${tag}`);
  }
  // pares que se tocan a propósito (la barandilla con su propio rodapié, bolardos de uno en uno…) no existen: ninguno se pisa
  for (let i = 0; i < nave.length; i++) for (let j = i + 1; j < nave.length; j++) {
    const a = nave[i], b = nave[j];
    if (/^barandilla/.test(a.id) && /^barandilla/.test(b.id)) continue;       // los dos tramos se encuentran en la esquina
    assert.ok(!ENT.solapan(a.caja, b.caja, 0), `${a.id} pisa a ${b.id}`);
  }
});

test('el depósito de CIP conecta con el puerto de XV-401 por el lado donde el esquema dibuja «SOLUCIÓN CIP»', () => {
  const T = ENT.CIP;
  const xv = layout.posicion('XV-401');
  assert.ok(T.x - T.r > layout.SKID.ancho / 2, 'el depósito está fuera del patín');
  assert.ok(T.z + T.r < ENT.PASILLO.z0, 'y fuera de la franja de trabajo');
  assert.equal(TUB.RUTAS.find(r => r.id === 'CIP').fluido, 'cip');
  assert.ok(Math.abs(xv.x - 100) < 1e-9);
  assert.ok(sol.some(s => s.id === 'cip_tanque') && sol.some(s => s.id === 'cip_bomba'));
});

/* ---------- constantes, cargador y escena ---------- */
test('las medidas de la nave coinciden con las de escena_planta.js', () => {
  assert.deepEqual(ENT.NAVE, { ancho: ESC.NAVE.ancho, fondo: ESC.NAVE.fondo, zPared: ESC.NAVE.zPared, altoPared: ESC.NAVE.altoPared });
  assert.equal(ENT.FY, -layout.SKID.alto);
});

test('el cargador incluye el entorno antes de la escena de la planta', () => {
  const texto = fs.readFileSync(path.join(__dirname, '../js/interfaz/cargador.js'), 'utf8');
  const a = texto.indexOf('js/visor3d_htst/entorno_planta.js'), b = texto.indexOf('js/visor3d_htst/escena_planta.js');
  assert.ok(a > 0 && b > a, 'entorno_planta.js debe cargarse antes que escena_planta.js');
  assert.ok(fs.existsSync(path.join(__dirname, '../js/visor3d_htst/entorno_planta.js')));
  assert.ok(texto.indexOf('js/visor3d_htst/kit.js') < a, 'el kit va antes');
});

test('la escena de la planta incluye el entorno, no cambia el encuadre inicial y el aislado de un equipo lo oculta', () => {
  conDocumento(() => {
    const escena = ESC.crearEscena(THREE, 'HTST', { porSoftware: true });
    const miGrupo = escena.raiz.children.find(o => o.userData && o.userData.entorno);
    assert.ok(miGrupo, 'el entorno cuelga de la raíz de la escena');
    assert.equal(escena.vistaInicial.azimut, 0.4); assert.equal(escena.vistaInicial.elevacion, 0.5); assert.equal(escena.vistaInicial.distancia, 470);
    assert.deepEqual(escena.vistaInicial.objetivo, { x: 35, y: 35, z: 0 });
    assert.ok(!escena.mallasSeleccionables().some(m => miGrupo.children.includes(m)), 'el entorno no se puede seleccionar');
    assert.ok(escena.aislar('HX-101'));
    assert.equal(miGrupo.visible, false, 'aislado: el entorno se oculta');
    escena.restaurar();
    assert.equal(miGrupo.visible, true);
    escena.liberar();
  });
});
