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
