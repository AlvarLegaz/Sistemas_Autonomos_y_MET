'use strict';
// Funciones puras del 3D de la instalación fotovoltaica (DISEÑADOR): sol y cielo, colores, textos de las pantallas, efectos de las averías, lecturas de las etiquetas,
// estado de ejemplo con la forma del contrato y colocación de la bandeja. No usan THREE.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const K = require('../js/visor3d_fv/kit.js');
const E = require('../js/visor3d_fv/efectos_averias.js');
const D = require('../js/visor3d_fv/disposicion.js');
const CAB = require('../js/visor3d_fv/cableado_fv.js');
const ENT = require('../js/visor3d_fv/entorno_cubierta.js');
const REG = require('../js/visor3d_fv/registro_visor.js');
const ESC = require('../js/visor3d_fv/escena_fv.js');
const { estadoDemo, posicionSol } = require('../js/visor3d_fv/estado_demo.js');

const cerca = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('direccionSol: vector unitario, sur = +z, oeste = −x, arriba = +y', () => {
  const d = K.direccionSol({ alturaGrados: 30, azimutGrados: 0 });
  assert.ok(cerca(Math.hypot(d.x, d.y, d.z), 1) && cerca(d.y, 0.5) && d.z > 0 && cerca(d.x, 0));
  assert.ok(K.direccionSol({ alturaGrados: 20, azimutGrados: 90 }).x < -0.9 * Math.cos(20 * Math.PI / 180) + 1e-9, 'azimut +90° = oeste');
  assert.ok(K.direccionSol({ alturaGrados: 20, azimutGrados: -90 }).x > 0, 'azimut −90° = este');
  assert.ok(cerca(K.direccionSol(undefined).y, Math.sin(Math.PI / 4)), 'sin dato: sol a 45°');
});

test('luzSolar: de noche no hay sol, a pleno día sí, la nubosidad lo atenúa y al amanecer es anaranjado', () => {
  const l = (alt, nub = 0) => K.luzSolar({ sol: { alturaGrados: alt, azimutGrados: 0 }, ambiente: { nubosidad: nub } });
  assert.equal(l(-20).intensidad, 0); assert.ok(l(-20).estrellas > 0.9 && l(60).estrellas < 0.01);
  assert.ok(l(60).intensidad > 2); assert.ok(l(60, 1).intensidad < l(60).intensidad * 0.2);
  assert.ok(l(60).hemiIntensidad > l(-20).hemiIntensidad && l(-20).hemiIntensidad > 0.1, 'de noche queda una luz de relleno');
  const rojo = c => (c >> 16) & 255, azul = c => c & 255;
  assert.ok(rojo(l(3).color) - azul(l(3).color) > rojo(l(60).color) - azul(l(60).color), 'más anaranjado con el sol bajo');
  assert.ok(l(10, 0.5).hemiIntensidad > l(10, 0).hemiIntensidad, 'con nubes la luz es más difusa');
  assert.doesNotThrow(() => K.luzSolar(undefined)); assert.doesNotThrow(() => K.luzSolar({ sol: { alturaGrados: NaN } }));
});

test('coloresCielo: azul de día, oscuro de noche y rojizo en el horizonte al ponerse el sol', () => {
  const r = c => (c >> 16) & 255, b = c => c & 255, brillo = c => r(c) + ((c >> 8) & 255) + b(c);
  const dia = K.coloresCielo(60, 0), noche = K.coloresCielo(-30, 0), ocaso = K.coloresCielo(1, 0);
  assert.ok(b(dia.cenit) > r(dia.cenit), 'cielo azul de día');
  assert.ok(brillo(noche.cenit) < brillo(dia.cenit) * 0.25 && brillo(noche.horizonte) < brillo(dia.horizonte) * 0.4);
  assert.ok(r(ocaso.horizonte) > b(ocaso.horizonte), 'horizonte anaranjado en el ocaso');
  assert.ok(brillo(K.coloresCielo(60, 1).cenit) !== brillo(dia.cenit), 'las nubes cambian el cielo');
});

test('factorSombra y mezclarHex', () => {
  assert.equal(K.factorSombra(0), 1); assert.ok(cerca(K.factorSombra(1), 0.28)); assert.equal(K.factorSombra(5), K.factorSombra(1)); assert.equal(K.factorSombra(undefined), 1);
  assert.equal(K.mezclarHex(0, 0xffffff, 0.5) & 255, 128); assert.equal(K.mezclarHex(0x102030, 0x405060, 7), 0x405060);
});

test('lectura tolerante del estado: nunca lanza y da valores por defecto', () => {
  assert.deepEqual(Object.keys(K.inversorDe(undefined, 'INV-101')), []); assert.deepEqual(Object.keys(K.proteccionDe({}, 'QS-101')), []);
  assert.equal(K.averiaActiva({ averiasActivas: ['A', { id: 'B' }] }, 'B'), true); assert.equal(K.averiaActiva(null, 'B'), false);
  assert.deepEqual(Object.keys(K.panelDe(null, 'PV-101')), []);
  const p = K.panelDe(estadoDemo({ horaSolar: 12 }), 'PV-205'); assert.equal(p.tag, 'PV-205'); assert.equal(p.cadena.id, 'STR-202');
});

test('textos de las pantallas: apagado vacío, EASun y ZCS con sus valores', () => {
  assert.equal(K.textoEasun({ estado: 'APAGADO' }, {}).apagado, true);
  const t = K.textoEasun({ estado: 'OPERANDO', pvP: 1234.4, cargaP: 600, leds: { red: true }, etapaCarga: 'CC' }, { v: 26.7 });
  assert.equal(t.pv, '1234'); assert.equal(t.bat, '26,7'); assert.equal(t.carga, '600');
  const z = K.textoZcs({ estado: 'OPERANDO', acP: 2000.2, acV: 231.4, acF: 50.01, mppt: [{ v: 250, i: 6.2 }, { v: 240, i: 6 }] });
  assert.equal(z.estado, 'Conectado a red'); assert.equal(z.pac, '2000 W'); assert.equal(z.vac, '231 V'); assert.equal(z.fac, '50,01 Hz'); assert.ok(z.pv1.includes('250') && z.pv2.includes('240'));
  assert.equal(K.textoZcs({ estado: 'ESPERA_RED', segundosParaConexion: 42 }).espera, 42);
});

test('efectos de las averías: todas las del layout están contempladas, con efectos conocidos y sobre tags que existen', () => {
  const tags = new Set(layout.EQUIPOS.map(q => q.tag));
  for (const a of layout.AVERIAS) assert.ok(E.EFECTO_POR_ID[a.id] !== undefined, 'avería sin efecto 3D: ' + a.id);
  for (const [id, tabla] of Object.entries(E.EFECTO_POR_ID)) {
    assert.ok(layout.AVERIAS.some(a => a.id === id), 'efecto de una avería que no existe: ' + id);
    for (const [tag, lista] of Object.entries(tabla)) { assert.ok(tags.has(tag), `${id}: tag ${tag}`); for (const ef of lista) assert.ok(E.EFECTOS_CONOCIDOS.has(ef), `${id}: efecto ${ef}`); }
  }
  const m = E.efectosPorTag(['CADENA_ABIERTA_A1', { id: 'SPD_DISPARADO_A' }]);
  assert.ok(m.get('STR-101').has('conector_suelto') && m.get('PV-101').has('panel_aviso') && m.get('SPD-101').has('testigo_rojo'));
  assert.equal(E.firmaAverias([]), E.firmaAverias(undefined)); assert.notEqual(E.firmaAverias(['A']), E.firmaAverias([]));
  assert.equal(E.efectosPorTag(undefined).size, 0);
});

test('el estado de ejemplo tiene la forma del contrato (las mismas claves que el modelo real, si existe) y cubre todos los tags', () => {
  const e = estadoDemo({});
  for (const k of ['t', 'reloj', 'sol', 'ambiente', 'campos', 'inversores', 'bateria', 'red', 'cargas', 'protecciones', 'energia', 'alarmas', 'averiasActivas']) assert.ok(k in e, k);
  for (const campo of Object.values(layout.CAMPOS)) for (const c of campo.cadenas) { const cd = e.campos[campo.id].cadenas.find(x => x.id === c.id); assert.ok(cd && cd.paneles.length === c.paneles.length, c.id); for (const p of cd.paneles) assert.ok('sombra01' in p && Array.isArray(p.bypass) && p.bypass.length === 3); }
  assert.ok(e.inversores['INV-101'].leds && e.inversores['INV-201'].leds && 'onGrid' in e.inversores['INV-201'].leds);
  let real;
  try { real = require('../js/modelo/simulacion.js').crearSimulacion({ semilla: 1, horaSolar: 12 }).estado; } catch (error) { return; }
  for (const k of Object.keys(real)) assert.ok(k in e, 'el modelo real tiene «' + k + '» y el estado de ejemplo no');
  for (const k of ['sol', 'reloj']) for (const q of Object.keys(real[k])) assert.ok(q in e[k], `${k}.${q}`);
  for (const q of ['ghWm2', 'nubosidad', 'temperaturaAmbienteC', 'suciedad']) assert.ok(q in real.ambiente && q in e.ambiente, `ambiente.${q}`);
  for (const t of ['INV-101', 'INV-201']) for (const q of Object.keys(real.inversores[t].leds)) assert.ok(q in e.inversores[t].leds, `leds.${q}`);
  assert.ok(Object.keys(real.protecciones).every(t => t in e.protecciones || /^(QS|QB|QF|ID|F|FB|SPD)/.test(t)));
});

test('posicionSol del estado de ejemplo: sale por el este, al sur a mediodía y se pone por el oeste', () => {
  assert.ok(posicionSol(172, 6).azimutGrados < -60 && posicionSol(172, 18).azimutGrados > 60);
  assert.ok(Math.abs(posicionSol(172, 12).azimutGrados) < 2 && posicionSol(172, 12).alturaGrados > 70);
  assert.ok(posicionSol(355, 12).alturaGrados < 35 && posicionSol(172, 2).alturaGrados < 0);
});

test('la bandeja acaba en la pared este de la caseta y recorre todo el trayecto desde el campo B por delante del campo A', () => {
  const P = D.BANDEJA.puntos, C = D.CASETA;
  const fin = P[P.length - 1];
  assert.ok(Math.abs(fin[0] - (C.x + C.ancho / 2)) <= 2, 'llega a la pared este');
  assert.ok(fin[1] > C.z - C.fondo / 2 && fin[1] < C.z + C.fondo / 2, 'por la pared, no por una esquina');
  for (let i = 1; i < P.length; i++) assert.ok(P[i][0] === P[i - 1][0] || P[i][1] === P[i - 1][1], 'tramos ortogonales');
  const cB = D.cajaCampo('B'), cA = D.cajaCampo('A');
  assert.ok(P[0][0] >= cB.x1 - 60 && P[0][1] > cB.z1, 'empieza al sur del campo B'); assert.ok(P[2][1] > cA.z1, 'pasa por delante (sur) del campo A');
  for (const p of P) assert.ok(p[0] > D.CUBIERTA.x0 && p[0] < D.CUBIERTA.x1 && p[1] > D.CUBIERTA.z0 && p[1] < D.CUBIERTA.z1, 'la bandeja está dentro de la cubierta');
});

test('desplazarPoligonal mantiene el paralelismo en las esquinas', () => {
  const r = CAB.desplazarPoligonal([[0, 0], [10, 0], [10, 10]], 2);
  assert.deepEqual(r.map(p => p.map(v => Math.round(v * 1000) / 1000 + 0)), [[0, 2], [8, 2], [8, 10]], 'a la izquierda del sentido de la marcha, con la esquina a inglete');
  const lados = CAB.desplazarPoligonal([[0, 0], [10, 0]], 3); assert.ok(cerca(Math.abs(lados[0][1]), 3) && cerca(lados[0][1], lados[1][1]));
  const cables = CAB.planificarCables();
  assert.equal(cables.length, 8, 'ocho cables: dos por cadena'); assert.equal(new Set(cables.map(c => c.lane)).size, 8, 'cada cable en su carril');
  for (const c of cables) assert.ok(Math.abs(c.lane) < D.BANDEJA.ancho / 2, 'el carril cabe en la bandeja');
});

test('el entorno: edificios del fondo lejos de la cubierta y repetibles; cielo y monte definidos', () => {
  const a = ENT.edificiosDeFondo(), b = ENT.edificiosDeFondo();
  assert.deepEqual(a, b); assert.ok(a.length >= 30);
  for (const e of a) { assert.ok(Math.hypot(e.x - 25, e.z + 125) > 1500, 'edificio demasiado cerca'); assert.ok(e.alto > ENT.Y_CALLE && e.alto < 400, 'altura razonable'); }
});

test('registro del visor: las lecturas de las etiquetas salen del estado y las fichas cubren todos los equipos', () => {
  const l = REG.lecturasFv(estadoDemo({ horaSolar: 12, nubosidad: 0, averias: ['BMS_CORTE_BATERIA', 'RED_CAIDA'] }));
  assert.ok(l.sensores['INV-101'].texto.endsWith('W') && l.sensores['BAT-101'].alarma && l.sensores['RED-301'].texto === 'sin red');
  assert.equal(l.sensores['PV-101'].texto.endsWith('W'), true);
  assert.equal(REG.lecturasFv(null).sensores['INV-101'], undefined);
  const abierta = REG.lecturasFv(estadoDemo({ averias: ['CADENA_ABIERTA_A1'] })); assert.equal(abierta.sensores['PV-101'].texto, 'abierta');
  const ay = REG.ayudas(); for (const q of layout.EQUIPOS) assert.ok(ay[q.tag] && ay[q.tag].titulo && ay[q.tag].queEs, q.tag);
  assert.ok(REG.CON_ETIQUETA.has('INV-101') && !REG.CON_ETIQUETA.has('F-101') && REG.sinEtiqueta('F-101') && REG.nombreEtiqueta('INV-201') === 'ZCS');
  assert.equal(REG.registrar(), false, 'sin el visor compartido cargado no registra y no lanza');
});

test('la luz de las dos calidades: alta con sombras y tone mapping; baja sin ellos', () => {
  const alta = ESC.lucesDeCalidad('alta'), baja = ESC.lucesDeCalidad('baja'), rara = ESC.lucesDeCalidad('xyz');
  assert.equal(alta.render.sombras, true); assert.equal(baja.render.sombras, false); assert.equal(baja.render.toneMapping, 'ninguno'); assert.deepEqual(rara, baja);
  assert.ok(baja.escalaSol < alta.escalaSol && alta.interior && !baja.interior);
});
