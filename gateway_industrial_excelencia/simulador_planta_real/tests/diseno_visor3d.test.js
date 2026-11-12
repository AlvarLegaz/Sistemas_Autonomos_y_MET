'use strict';
// Pruebas de las funciones puras del diseño 3D de la planta HTST (kit, efectos de avería, puertos, tuberías, cobertura de equipos y montaje).
// No usan THREE: lo que se dibuja se comprueba en el navegador (ver INFORME_DISENO o el banco de pruebas).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const K = require('../js/visor3d_htst/kit.js');
const E = require('../js/visor3d_htst/efectos_averias.js');
const P = require('../js/visor3d_htst/puertos.js');
const T = require('../js/visor3d_htst/tuberias.js');
const EQ = require('../js/visor3d_htst/equipos_proceso.js');
const INS = require('../js/visor3d_htst/instrumentos.js');
const ARM = require('../js/visor3d_htst/armario.js');
const { estadoDemo } = require('../js/visor3d_htst/estado_demo.js');

const cerca = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('mezclarHex interpola por canales y se limita a [0, 1]', () => {
  assert.equal(K.mezclarHex(0x000000, 0xffffff, 0), 0x000000);
  assert.equal(K.mezclarHex(0x000000, 0xffffff, 1), 0xffffff);
  assert.equal(K.mezclarHex(0x000000, 0xfefefe, 0.5), 0x7f7f7f);
  assert.equal(K.mezclarHex(0x102030, 0x405060, 5), 0x405060);
  assert.equal(K.mezclarHex(0x102030, 0x405060, -2), 0x102030);
});

test('la leche cambia de color con la temperatura y el agua caliente va del azul al naranja', () => {
  assert.notEqual(K.colorLeche(4), K.colorLeche(74));
  assert.equal(K.colorLeche(4), 0xf6f3ea);
  assert.equal(K.colorAguaCaliente(20), 0x3a8fd0);
  assert.equal(K.colorAguaCaliente(90), 0xe2572a);
});

test('la lectura del estado es tolerante: sin estado o sin campos devuelve valores por defecto y nunca lanza', () => {
  assert.equal(K.caudalLh(undefined), 0);
  assert.equal(K.temperaturaDe(null, 'salidaTubo', 21), 21);
  assert.deepEqual(Object.keys(K.equipoDe({}, 'P-101')), []);
  assert.equal(K.nivelTanquePct({}), 60);
  assert.equal(K.aperturaFDV({}), 0);                                                // sin datos: desvío (seguridad positiva)
  assert.equal(K.nivelTanquePct({ tanque: { nivelPct: 250 } }), 100);
});

test('aperturaFDV usa apertura01 y, si falta, la posición; sin energía va a desvío', () => {
  const con = (campos) => ({ equipos: { 'FDV-101': campos } });
  assert.equal(K.aperturaFDV(con({ apertura01: 1 })), 1);
  assert.equal(K.aperturaFDV(con({ apertura01: 0.3 })), 0.3);
  assert.equal(K.aperturaFDV(con({ posicion: 'AVANCE' })), 1);
  assert.equal(K.aperturaFDV(con({ posicion: 'DESVIO' })), 0);
  assert.equal(K.aperturaFDV(con({ posicion: 'MOVIENDO' })), 0.5);
});

test('el giro visual de las bombas depende de la marcha y de la velocidad', () => {
  assert.equal(K.velocidadAngularVisual(false, 100), 0);
  assert.ok(K.velocidadAngularVisual(true, 100) > K.velocidadAngularVisual(true, 50));
  assert.ok(cerca(K.velocidadAngularVisual(true, 100), Math.PI * 3));
  assert.ok(K.velocidadAngularVisual(true, undefined) > 0);
});

test('el LED de un lazo: verde OK, ámbar con ruido o deriva, rojo abierto o en corto', () => {
  assert.equal(K.colorLedCalidad('OK'), 0x35e06b);
  assert.equal(K.colorLedCalidad('RUIDO'), 0xffb020);
  assert.equal(K.colorLedCalidad('DERIVA'), 0xffb020);
  assert.equal(K.colorLedCalidad('ABIERTO'), 0xff3b30);
  assert.equal(K.colorLedCalidad('CORTO'), 0xff3b30);
});

test('efectos de averías: tabla por id, sintomas3d prevalece y las firmas cambian con las averías', () => {
  assert.deepEqual(E.efectosDeAveria({ id: 'AV-PLACA-FUGA', tags: ['HX-101'] }).map(x => x.efecto).sort(), ['goteo', 'resaltar_rojo']);
  assert.deepEqual(E.efectosDeAveria({ id: 'AV-DERIVA-TT103', tags: ['TT-103'] }), []);               // la deriva no se ve
  const propio = E.efectosDeAveria({ id: 'AV-PLACA-FUGA', tags: ['HX-101'], sintomas3d: [{ tag: 'TT-101', efecto: 'cable_cortado' }, { tag: 'X', efecto: 'inventado' }] });
  assert.deepEqual(propio, [{ tag: 'TT-101', efecto: 'cable_cortado' }]);
  const mapa = E.efectosPorTag([{ instancia: 'a', id: 'AV-LAZO-ABIERTO', tags: ['TT-103', 'FT-101'] }, { instancia: 'b', id: 'AV-KM-PEGADO', tags: ['KM-201'] }]);
  assert.ok(mapa.get('TT-103').has('cable_cortado') && mapa.get('FT-101').has('resaltar_rojo') && mapa.get('KM-201').has('contactos_cerrados'));
  assert.equal(E.firmaAverias([]), E.firmaAverias(undefined));
  assert.notEqual(E.firmaAverias([{ instancia: 'a', id: 'AV-LAZO-ABIERTO' }]), E.firmaAverias([]));
  for (const id of Object.keys(E.EFECTO_POR_ID)) for (const ef of E.EFECTO_POR_ID[id]) assert.ok(E.EFECTOS_CONOCIDOS.has(ef), `${id}: efecto ${ef}`);
});

test('todo equipo del layout tiene su modelo 3D y no hay modelos de más', () => {
  const modelados = new Set([...EQ.TAGS, ...INS.TAGS, ...ARM.TAGS]);
  const esperados = new Set(layout.EQUIPOS.map(e => e.tag));
  const sobran = [...modelados].filter(t => !esperados.has(t)), faltan = [...esperados].filter(t => !modelados.has(t));
  assert.deepEqual(sobran, [], 'modelos de equipos que no existen: ' + sobran.join(','));
  assert.deepEqual(faltan, [], 'equipos sin modelo 3D: ' + faltan.join(','));
  const todos = [...EQ.TAGS, ...INS.TAGS, ...ARM.TAGS];
  assert.equal(new Set(todos).size, todos.length, 'un tag modelado dos veces');
});

test('los puertos existen y están en el volumen del patín (o del armario)', () => {
  for (const [tag, puertos] of Object.entries(P.PUERTOS)) for (const [n, [x, y, z]] of Object.entries(puertos)) {
    assert.ok(Math.abs(x) <= 180 && z >= -80 && z <= 80 && y >= 0 && y <= 120, `${tag}.${n} fuera de rango: ${x},${y},${z}`);
  }
  assert.throws(() => P.puerto('P-101', 'inexistente'));
  assert.deepEqual(P.puerto('HX-101', 'raw_in'), [-40, 80, -18]);
});

test('autoruta: parte y acaba en los puertos, es ortogonal y no repite puntos ni deja tramos colineales', () => {
  for (const r of T.RUTAS) {
    assert.deepEqual(r.puntos[0], r.de, r.id); assert.deepEqual(r.puntos.at(-1), r.a, r.id);
    for (let i = 1; i < r.puntos.length; i++) {
      const d = [0, 1, 2].map(k => Math.abs(r.puntos[i][k] - r.puntos[i - 1][k]));
      assert.ok(d.filter(v => v > 1e-6).length === 1, `${r.id}: tramo ${i} no es ortogonal o es nulo`);
    }
  }
  const recta = T.autoruta([0, 10, 0], [0, 10, 50], 10);
  assert.deepEqual(recta, [[0, 10, 0], [0, 10, 50]]);
});

test('esquinas: segmentos continuos, con el radio recortado en tramos cortos', () => {
  const ruta = T.RUTAS.find(r => r.id === 'LECHE_AVANCE').puntos;
  const s = T.esquinas(ruta, 4.5);
  assert.deepEqual(s[0].a, ruta[0]); assert.deepEqual(s.at(-1).b, ruta.at(-1));
  for (let i = 1; i < s.length; i++) assert.deepEqual(s[i].a, s[i - 1].b, `corte en ${i}`);
  const corta = T.esquinas([[0, 0, 0], [0, 0, 2], [0, 5, 2]], 10);                      // tramos de 2 y 5: el radio se limita a 1
  const curva = corta.find(x => x.tipo === 'Q');
  assert.ok(curva);
  assert.ok(cerca(Math.hypot(...[0, 1, 2].map(k => curva.a[k] - curva.c[k])), 1));
});

test('estadoRutas: producción en avance, desvío, parada y servicios', () => {
  const prod = T.estadoRutas(estadoDemo({ modo: 'PRODUCCION' }));
  assert.ok(prod.LECHE_CRUDA_1.activo && prod.LECHE_CALIENTE.activo && prod.LECHE_TRAS_TUBO.activo);
  assert.ok(prod.LECHE_AVANCE.activo && prod.LECHE_SALIDA.activo && !prod.LECHE_DESVIO.activo);
  assert.ok(prod.AGUA_CALIENTE_2.activo && prod.AGUA_FRIA_2.activo && !prod.CIP.activo);
  const desv = T.estadoRutas(estadoDemo({ modo: 'PRODUCCION', desvio: true }));
  assert.ok(desv.LECHE_DESVIO.activo && !desv.LECHE_AVANCE.activo && !desv.LECHE_SALIDA.activo && desv.LECHE_TRAS_TUBO.activo);
  const parada = T.estadoRutas(estadoDemo({ modo: 'PARADA' }));
  assert.ok(Object.values(parada).every(r => !r.activo));
  const cip = T.estadoRutas(estadoDemo({ modo: 'CIP', caudalLh: 1500, desvio: false }));
  assert.ok(cip.CIP.activo);
  assert.ok(Object.values(T.estadoRutas(undefined)).every(r => !r.activo));                // sin estado nada fluye
});

test('la velocidad de las partículas es la misma en todos los tubos con el mismo fluido, sea cual sea su longitud', () => {
  const r = T.estadoRutas(estadoDemo({ modo: 'PRODUCCION', caudalLh: 2500 }));
  const vl = [...new Set(T.RUTAS.filter(t => t.fluido === 'leche' && r[t.id].activo).map(t => r[t.id].velocidadCmS))];
  assert.equal(vl.length, 1);
  assert.ok(T.velocidadLeche(2500) > T.velocidadLeche(500) && T.velocidadLeche(0) > 0);
  const longitudes = T.RUTAS.map(t => T.longitudRuta(t.puntos));
  assert.ok(Math.max(...longitudes) > 3 * Math.min(...longitudes), 'las rutas tienen longitudes muy distintas, así que el chequeo vale');
});

test('indiceParticula da siempre un índice válido, también hacia atrás y con avances grandes', () => {
  for (const avance of [0, 1.5, 1e5, -33.3, -1e6]) for (let i = 0; i < 12; i++) {
    const k = T.indiceParticula(i, 9, avance, 137);
    assert.ok(Number.isInteger(k) && k >= 0 && k < 137, `${i} ${avance} → ${k}`);
  }
});

test('los instrumentos tienen sitio de montaje y los de ruta quedan sobre su tubo', () => {
  for (const tag of INS.TAGS) {
    const m = INS.montaje(tag);
    assert.ok(Array.isArray(m) && m.length === 3 && m.every(Number.isFinite), `${tag} sin montaje`);
  }
  const tt103 = INS.montaje('TT-103'), ruta = T.rutaPorId('LECHE_TRAS_TUBO');
  assert.ok(ruta.puntos.some((p, i) => i && Math.abs(p[1] - tt103[1]) < 1e-9), 'TT-103 a la altura del carril de su tubo');
  assert.ok(INS.montaje('LSH-101')[1] > INS.montaje('LSL-101')[1], 'el flotador de nivel alto va más arriba que el bajo');
});

test('TT-106 va en el puente regeneración → enfriamiento y LSH-301 encima de LSL-301 en el calentador', () => {
  const puente = T.rutaPorId('LECHE_REG_ENF'), p = EQ.posicionesPlacas();
  assert.ok(puente && puente.fluido === 'leche' && puente.anclas === 'TT-106');
  assert.ok(Math.abs(puente.de[0] - p.separadores[0]) < 0.5 && Math.abs(puente.a[0] - p.separadores[1]) < 0.5, 'las bocas están en las placas intermedias');
  const tt106 = INS.montaje('TT-106');
  assert.ok(puente.puntos.some((q, i) => i && q[1] === tt106[1]) && tt106[0] > puente.de[0] && tt106[0] < puente.a[0], 'TT-106 sobre el puente');
  const lsh = INS.montaje('LSH-301'), lsl = INS.montaje('LSL-301');
  assert.ok(lsh[1] > lsl[1] + 30 && lsh[0] === lsl[0] && lsh[2] === lsl[2]);
  const prod = T.estadoRutas(estadoDemo({ modo: 'PRODUCCION' })), desv = T.estadoRutas(estadoDemo({ modo: 'PRODUCCION', desvio: true }));
  assert.equal(prod.LECHE_REG_ENF.activo, true); assert.equal(desv.LECHE_REG_ENF.activo, false);
  assert.equal(estadoDemo({ nivelAguaPct: 95 }).instrumentos['LSH-301'].nivel, 1);
  assert.equal(estadoDemo({ nivelAguaPct: 50 }).instrumentos['LSH-301'].nivel, 0);
});

test('soportes de tubería: hay varios, en la bancada, sin atravesar equipos ni otros tubos', () => {
  const ESC = require('../js/visor3d_htst/escena_planta.js');
  const s = ESC.soportesTuberia();
  assert.ok(s.length >= 4, `solo ${s.length} soportes`);
  for (const q of s) {
    assert.ok(Math.abs(q.x) <= layout.SKID.ancho / 2 && Math.abs(q.z) <= layout.SKID.fondo / 2, `${q.ruta} fuera del patín`);
    assert.ok(q.y >= 60);
    for (const e of layout.EQUIPOS) {
      const p = layout.posicion(e.tag); if (!p || !p.ancho || p.fueraDelPatin) continue;
      assert.ok(!(Math.abs(q.x - p.x) < p.ancho / 2 && Math.abs(q.z - p.z) < p.fondo / 2), `soporte de ${q.ruta} dentro de ${e.tag}`);
    }
  }
  const porticos = ESC.porticosTuberia();
  assert.ok(porticos.length >= 1 && porticos.every(p => p.colgantes.length >= 1));
  for (const p of porticos) for (const c of p.colgantes) {
    assert.ok(c.y < ESC.ALTO_PORTICO - 4, 'el tubo cuelga por debajo de la viga');
    assert.ok(!p.colgantes.some(o => o !== c && Math.abs(o.z - c.z) < 5 && o.y > c.y), 'ninguna varilla atraviesa otro tubo');
  }
});

test('las placas del intercambiador caben en el bastidor y están ordenadas', () => {
  const p = EQ.posicionesPlacas();
  const total = p.regeneracion.length + p.calentamiento.length + p.enfriamiento.length;
  assert.equal(total, EQ.PLACAS.regeneracion + EQ.PLACAS.calentamiento + EQ.PLACAS.enfriamiento);
  const todas = [...p.regeneracion, ...p.calentamiento, ...p.enfriamiento];
  for (let i = 1; i < todas.length; i++) assert.ok(todas[i] > todas[i - 1]);
  assert.ok(todas[0] > -48 && todas.at(-1) < p.x1 + 1.5, 'las placas quedan entre la placa fija y la móvil');
  assert.ok(p.separadores.length === 2 && p.separadores[0] > p.regeneracion.at(-1) && p.separadores[0] < p.calentamiento[0]);
  assert.ok(p.x1 < 50, 'el paquete cabe en el ancho del equipo (100 cm)');
});

test('puntoPuerta del armario: los mandos de la puerta abierta quedan delante del armario', () => {
  const pos = layout.posicion('QE-001');
  const [x, y, z] = ARM.puntoPuerta(pos.x, pos.z, -29, 100);
  assert.ok(cerca(y, 100));
  assert.ok(z > pos.z + ARM.CUERPO.fondo / 2, 'el centro de la puerta abierta sobresale por delante');
  assert.ok(x > pos.x, 'y a la derecha, donde está la bisagra');
});

test('los dispositivos del armario no se solapan entre sí', () => {
  const d = Object.entries(ARM.DISPOSITIVOS);
  for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) {
    const [ta, a] = d[i], [tb, b] = d[j];
    const solapaX = Math.abs(a.x - b.x) < (a.w + b.w) / 2, solapaY = a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!(solapaX && solapaY), `${ta} y ${tb} se solapan`);
  }
  for (const [tag, v] of d) assert.ok(Math.abs(v.x) + v.w / 2 <= ARM.CUERPO.ancho / 2 - 2 && v.y >= 26 && v.y + v.h <= ARM.CUERPO.alto, `${tag} fuera de la placa`);
});

test('el estado de demostración cubre todos los tags y las averías que se le pasan', () => {
  const e = estadoDemo({ averias: [{ instancia: 'x', id: 'AV-FUSIBLE-F201', tags: ['F-201'] }] });
  for (const q of layout.EQUIPOS) assert.ok(e.equipos[q.tag], q.tag);
  assert.equal(e.averiasActivas.length, 1);
  assert.equal(e.version, 1);
});

// ---------- Llenados, calentador con nivel y LSL-301 (modo manual) ----------
test('las funciones de lectura del agua caliente son tolerantes y respetan el orden de preferencia', () => {
  assert.equal(K.nivelAguaCalientePct(undefined), 70);                                           // sin dato: nivel por defecto
  assert.equal(K.nivelAguaCalientePct({ aguaCaliente: { nivelPct: 150 } }), 100);
  assert.equal(K.nivelAguaCalientePct({ aguaCaliente: { nivelPct: -5 } }), 0);
  assert.equal(K.nivelAguaCalientePct({ equipos: { 'HW-101': { nivelPct: 42 } } }), 42);          // sin aguaCaliente, usa el equipo
  assert.equal(K.nivelAguaCalientePct({ aguaCaliente: { nivelPct: 30 }, equipos: { 'HW-101': { nivelPct: 42 } } }), 30);
  assert.equal(K.temperaturaAguaCaliente({ aguaCaliente: { temperaturaC: 61 } }), 61);
  assert.equal(K.temperaturaAguaCaliente({ equipos: { 'HW-101': { temperaturaC: 55 } } }), 55);
  assert.equal(K.temperaturaAguaCaliente({ proceso: { temperaturas: { aguaCaliente: 48 } } }), 48);
  assert.equal(K.temperaturaAguaCaliente(null), 20);
});

test('bancoEncendido: manda el contactor KM-201/KM-202 y, sin dato, banco1/banco2 del calentador', () => {
  assert.equal(K.bancoEncendido({ equipos: { 'KM-201': { cerrado: true } } }, 1), true);
  assert.equal(K.bancoEncendido({ equipos: { 'KM-201': { cerrado: false }, 'HW-101': { banco1: true } } }, 1), false);   // el contactor abierto manda
  assert.equal(K.bancoEncendido({ equipos: { 'HW-101': { banco2: true } } }, 2), true);
  assert.equal(K.bancoEncendido({ equipos: { 'KM-202': { cerrado: true }, 'KM-201': { cerrado: false } } }, 2), true);
  assert.equal(K.bancoEncendido(undefined, 1), false);
});

test('contactoLSL: cerrado con agua, abierto con nivel bajo o hilo roto, desconocido sin dato', () => {
  assert.equal(K.contactoLSL({ equipos: { 'LSL-301': { contactoCerrado: true } } }), 'cerrado');
  assert.equal(K.contactoLSL({ equipos: { 'LSL-301': { contactoCerrado: false } } }), 'abierto');
  assert.equal(K.contactoLSL({ instrumentos: { 'LSL-301': { nivel: 0 } } }), 'abierto');
  assert.equal(K.contactoLSL({ instrumentos: { 'LSL-301': { nivel: 1 } } }), 'cerrado');
  assert.equal(K.contactoLSL({}), 'desconocido');
  assert.equal(K.contactoLSL(undefined), 'desconocido');
});

test('valvulaAbierta y tanqueDesbordando leen los campos nuevos del estado', () => {
  assert.equal(K.valvulaAbierta({ equipos: { 'XV-101': { abierta: true } } }, 'XV-101'), true);
  assert.equal(K.valvulaAbierta({ equipos: { 'XV-101': { abierta: true } } }, 'XV-102'), false);
  assert.equal(K.valvulaAbierta(undefined, 'XV-101'), false);
  assert.equal(K.tanqueDesbordando({ tanque: { desbordando: true } }), true);
  assert.equal(K.tanqueDesbordando({ equipos: { 'TK-101': { desbordando: true } } }), true);
  assert.equal(K.tanqueDesbordando({ tanque: { nivelPct: 100 } }), false);
  assert.equal(K.tanqueDesbordando(null), false);
});

test('colores del producto: verde de la convención, algo más claro con el calor', () => {
  assert.equal(K.VERDE_PRODUCTO, 0x2f9e44);
  assert.equal(K.colorProducto(4), 0x2f9e44);
  assert.notEqual(K.colorProducto(74), K.colorProducto(4));
  const verdeDominante = hex => ((hex >> 8) & 255) >= ((hex >> 16) & 255) && ((hex >> 8) & 255) >= (hex & 255);
  for (const t of [4, 40, 74, 90]) assert.ok(verdeDominante(K.colorProducto(t)), `a ${t} °C el producto sigue siendo verde`);
  assert.ok(verdeDominante(K.colorTuboCaliente(20)) && verdeDominante(0x8fd1a0));
});

test('las válvulas de llenado y vaciado tienen modelo, puertos y tubos con su regla de flujo', () => {
  for (const tag of ['XV-101', 'XV-102', 'XV-302', 'XV-303']) {
    assert.ok(EQ.TAGS.includes(tag), tag + ' sin modelo 3D');
    assert.ok(P.puerto(tag, 'ent') && P.puerto(tag, 'sal'));
  }
  assert.ok(INS.TAGS.includes('LSL-301') && INS.montaje('LSL-301').every(Number.isFinite));
  const cerradas = T.estadoRutas(estadoDemo({ modo: 'PARADA' }));
  const abiertas = T.estadoRutas(estadoDemo({ modo: 'PARADA', llenandoTK: true, vaciandoTK: true, llenandoHW: true, vaciandoHW: true }));
  const familias = { 'XV-101': ['LECHE_LLENADO_1', 'LECHE_LLENADO_2'], 'XV-102': ['LECHE_VACIADO_1', 'LECHE_VACIADO_2'],
    'XV-302': ['AGUA_LLENADO_1', 'AGUA_LLENADO_2'], 'XV-303': ['AGUA_VACIADO_1', 'AGUA_VACIADO_2'] };
  for (const [tag, ids] of Object.entries(familias)) for (const id of ids) {
    assert.ok(T.rutaPorId(id), id + ' no existe');
    assert.equal(T.rutaPorId(id).ayuda, tag);
    assert.equal(cerradas[id].activo, false, id + ' lleva fluido con la válvula cerrada');
    assert.equal(abiertas[id].activo, true, id + ' sin fluido con la válvula abierta');
    assert.ok(abiertas[id].velocidadCmS > 0);
  }
  // cada válvula abre solo lo suyo
  const solo = T.estadoRutas(estadoDemo({ modo: 'PARADA', llenandoTK: true }));
  assert.deepEqual(Object.entries(solo).filter(([, r]) => r.activo).map(([id]) => id).sort(), ['LECHE_LLENADO_1', 'LECHE_LLENADO_2']);
});

test('los tubos de llenado y vaciado empalman con los puertos y los fluidos siguen la convención de colores', () => {
  const colores = { leche: 'LECHE', agua_fria: 'AGUA_LLENADO', agua_caliente: 'AGUA_VACIADO' };
  for (const r of T.RUTAS.filter(t => /LLENADO|VACIADO/.test(t.id))) {
    assert.deepEqual(r.puntos[0], r.de, r.id); assert.deepEqual(r.puntos.at(-1), r.a, r.id);
    assert.ok(r.id.startsWith(colores[r.fluido]) || r.fluido === 'leche', r.id + ' con fluido ' + r.fluido);
  }
  assert.equal(T.rutaPorId('LECHE_LLENADO_2').fluido, 'leche');                                   // producto = verde
  assert.equal(T.rutaPorId('AGUA_LLENADO_2').fluido, 'agua_fria');                                // agua de red = azul
  assert.equal(T.rutaPorId('AGUA_VACIADO_1').fluido, 'agua_caliente');                            // agua caliente = naranja
});

test('estado de demostración: llenados, nivel de agua caliente, LSL-301 y rebosadero', () => {
  const base = estadoDemo({ modo: 'MANUAL' });
  assert.equal(base.modo, 'MANUAL');
  for (const tag of ['XV-101', 'XV-102', 'XV-302', 'XV-303']) assert.equal(base.equipos[tag].abierta, false);
  assert.equal(base.equipos['LSL-301'].contactoCerrado, true);
  assert.equal(base.aguaCaliente.nivelPct, 80);
  const e = estadoDemo({ modo: 'MANUAL', llenandoTK: true, vaciandoHW: true, bajoNivelAgua: true, desbordando: true });
  assert.equal(e.equipos['XV-101'].abierta, true); assert.equal(e.equipos['XV-303'].abierta, true); assert.equal(e.equipos['XV-102'].abierta, false);
  assert.equal(K.contactoLSL(e), 'abierto'); assert.ok(K.nivelAguaCalientePct(e) < 15);
  assert.equal(K.tanqueDesbordando(e), true);
  assert.equal(K.nivelAguaCalientePct(estadoDemo({ nivelAguaPct: 33 })), 33);
});

test('los puertos nuevos caben en el patín y las válvulas de llenado no se solapan con otros equipos', () => {
  const { SKID } = layout;
  for (const tag of ['XV-101', 'XV-102', 'XV-302', 'XV-303']) for (const n of ['ent', 'sal']) {
    const [x, , z] = P.puerto(tag, n);
    assert.ok(Math.abs(x) <= SKID.ancho / 2 && Math.abs(z) <= SKID.fondo / 2, `${tag}.${n} fuera del patín: ${x},${z}`);
  }
  for (const [tag, n] of [['TK-101', 'llen'], ['TK-101', 'vac'], ['HW-101', 'llen'], ['HW-101', 'vac'], ['SUMINISTRO_LECHE', 'sal'], ['DESAGUE_LECHE', 'ent'], ['DESAGUE_AGUA', 'ent']]) assert.ok(P.puerto(tag, n), `${tag}.${n}`);
  // la distancia entre los centros de las válvulas de llenado y vaciado y el resto de equipos del patín supera su tamaño (12 cm)
  const nuevas = ['XV-101', 'XV-102', 'XV-302', 'XV-303'];
  for (const a of nuevas) for (const q of layout.EQUIPOS) {
    if (a === q.tag || ['control', 'servicios'].includes(q.zona) || ['TK-101', 'HW-101'].includes(q.tag)) continue;
    const pa = layout.posicion(a), pq = layout.posicion(q.tag);
    if (!pa || !pq) continue;
    assert.ok(Math.hypot(pa.x - pq.x, pa.z - pq.z) > 7, `${a} pisa a ${q.tag}`);
  }
});

test('la pared del fondo de la nave queda lejos del patín y el suelo llega hasta delante de la canaleta', () => {
  const { NAVE } = require('../js/visor3d_htst/escena_planta.js');
  const { SKID } = require('../js/layout.js');
  assert.ok(-SKID.fondo / 2 - NAVE.zPared >= 300, 'al menos 3 m de la pared al borde trasero del patín');
  assert.ok(NAVE.zPared + NAVE.fondo >= NAVE.canaleta.z + NAVE.canaleta.ancho / 2 + 100, 'el suelo cubre la canaleta y el pasillo de delante');
});
