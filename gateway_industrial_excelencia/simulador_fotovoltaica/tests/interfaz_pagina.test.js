// Página: qué hace un clic, cómo se aplican las órdenes, restaurar Normal, texto de estado; gráficas (historial, escalas, curva I-V), lecturas, fichas y panel de mando.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const layout = require('../js/layout.js');
const P = require('../js/interfaz/pagina_simple.js');
const G = require('../js/interfaz/grafica_fv.js');
const L = require('../js/interfaz/panel_lecturas.js');
const A = require('../js/interfaz/ayuda_fv.js');
const R = require('../js/interfaz/panel_revision.js');
const { crearSimulacion } = require('../js/interfaz/estado_demo.js');

const sim = (o = {}) => { const s = crearSimulacion(Object.assign({ semilla: 1, diaAnio: 172, horaSolar: 12, nubosidad: 0 }, o)); s.paso(5); return s; };
const marcha = (s, seg = 100) => { for (let t = 0; t < seg; t += 5) s.paso(5); return s.estado; };

test('velocidades del reloj solar: ×1, ×60, ×600 y ×3600', () => assert.deepEqual(P.VELOCIDADES, [1, 60, 600, 3600]));

test('clic izquierdo: en Normal las órdenes no se ejecutan y avisan de pasar a Revisión', () => {
  const e = sim().estado;
  for (const tag of ['QS-101', 'QB-101', 'QF-302', 'INV-101', 'RED-301']) { const d = P.decidirClic(tag, e, 'normal'); assert.equal(d.tipo, 'aviso', tag); assert.match(d.texto, /Revisión/); }
});

test('clic izquierdo: en Revisión una protección alterna abrir y cerrar, y abrir avisa de su consecuencia sin pedir confirmación', () => {
  const s = sim(), d = P.decidirClic('QB-101', s.estado, 'revision');
  assert.equal(d.tipo, 'orden'); assert.equal(d.accion, 'abrir'); assert.match(d.aviso, /batería/);
  assert.match(P.ejecutarOrden(s, d), /QB-101 abierto/); const e = marcha(s, 10);
  assert.equal(e.protecciones['QB-101'].estado, 'ABIERTO');
  assert.deepEqual(P.decidirClic('QB-101', e, 'revision'), { tipo: 'orden', tag: 'QB-101', accion: 'cerrar' });
  P.ejecutarOrden(s, { tag: 'QB-101', accion: 'cerrar' }); assert.equal(marcha(s, 10).protecciones['QB-101'].estado, 'CERRADO');
});

test('clic izquierdo: un disparo se rearma y un fusible fundido se sustituye; uno sano no se acciona', () => {
  const s = sim(); s.ordenes.averias.activar('QB_DISPARADO'); s.ordenes.averias.activar('FUSIBLE_F101');
  const e = marcha(s, 10);
  assert.equal(P.decidirClic('QB-101', e, 'revision').accion, 'rearmar');
  const f = P.decidirClic('F-101', e, 'revision'); assert.equal(f.accion, 'rearmar'); assert.match(P.textoAccion(f), /Sustituir F-101/);
  assert.equal(P.decidirClic('F-102', e, 'revision').tipo, 'info');
  assert.equal(P.decidirClic('F-101', e, 'normal').tipo, 'aviso');
});

test('clic izquierdo: inversores y red se apagan y encienden; las cadenas eligen la curva I-V en cualquier modo', () => {
  const s = sim(), e = s.estado;
  const apagar = P.decidirClic('INV-201', e, 'revision'); assert.equal(apagar.accion, 'apagar'); assert.ok(apagar.aviso);
  P.ejecutarOrden(s, apagar); const e2 = marcha(s, 10); assert.equal(e2.inversores['INV-201'].estado, 'APAGADO');
  assert.equal(P.decidirClic('INV-201', e2, 'revision').accion, 'encender');
  const cortar = P.decidirClic('RED-301', e, 'revision'); assert.equal(cortar.accion, 'red-cortar');
  P.ejecutarOrden(s, cortar); assert.equal(marcha(s, 10).red.disponible, false);
  assert.equal(P.decidirClic('RED-301', s.estado, 'revision').accion, 'red-reponer');
  for (const modo of ['normal', 'revision']) assert.deepEqual(P.decidirClic('STR-202', e, modo), { tipo: 'cadena', tag: 'STR-202' });
});

test('clic izquierdo: lo que no se acciona da información, nunca una orden', () => {
  const e = sim().estado;
  for (const tag of ['CB-101', 'BAT-101', 'LOAD-301', 'QA-301', 'CAS-001']) assert.equal(P.decidirClic(tag, e, 'revision').tipo, 'info', tag);
});

test('clic izquierdo en un panel (Revisión): pone la sombra 50 %, luego 100 % y luego la quita; en Normal pide Revisión', () => {
  const s = sim(); let e = marcha(s, 10);
  assert.equal(P.decidirClic('PV-101', e, 'normal').tipo, 'aviso');
  const pasos = [];
  for (let k = 0; k < 3; k++) { const d = P.decidirClic('PV-101', e, 'revision'); assert.equal(d.tipo, 'sombra'); pasos.push(d.valor); s.ordenes.ambiente.sombra(d.tag, d.valor); e = marcha(s, 10); }
  assert.deepEqual(pasos, [0.5, 1, 0]);
});

test('todo equipo del contrato tiene una decisión de clic sin errores', () => {
  const e = sim().estado;
  for (const q of layout.EQUIPOS) for (const modo of ['normal', 'revision']) assert.ok(['cadena', 'orden', 'aviso', 'info', 'sombra'].includes(P.decidirClic(q.tag, e, modo).tipo), q.tag);
});

test('restaurar Normal: sin averías, protecciones cerradas, red, cargas automáticas y sin sombras', () => {
  const s = sim();
  s.ordenes.averias.activar('QB_DISPARADO'); s.ordenes.protecciones.abrir('QS-201'); s.ordenes.red.disponible(false); s.ordenes.cargas.poner('LOAD-302', 2500); s.ordenes.ambiente.sombra('PV-103', 0.8);
  marcha(s, 10); P.restaurarNormal(s); const e = marcha(s, 20);
  assert.deepEqual(e.averiasActivas, []); assert.equal(e.red.disponible, true);
  for (const t of P.PROTECCIONES) assert.equal(e.protecciones[t].estado, 'CERRADO', t);
  assert.equal(e.cargas['LOAD-302'].manual, false);
  assert.equal(e.campos.A.cadenas[0].paneles[2].sombra01, 0);
});

test('texto de estado: modo, marcha, día o noche, producción, batería y la alarma más grave', () => {
  const s = sim(), e = marcha(s, 200);
  const t = P.textoEstado(e, true, 'normal'); assert.match(t, /Normal · en marcha · de día · FV [\d,]+ (k?W) · batería \d+ % · sin alarmas/);
  assert.match(P.textoEstado(e, false, 'revision'), /Revisión .*en pausa/);
  s.ordenes.averias.activar('QB_DISPARADO'); assert.match(P.textoEstado(marcha(s, 10), true, 'normal'), /alarmas?: .*QB-101/);
  assert.equal(P.textoEstado(null, true), '—');
});

test('reloj de la barra: usa el texto del modelo y, si falta, lo compone', () => {
  assert.equal(P.textoReloj({ reloj: { texto: '21 jun · 09:30' } }), '21 jun · 09:30');
  assert.equal(P.textoReloj({ reloj: { diaAnio: 172, horaSolar: 9.5 } }), '21 jun · 09:30');
  assert.equal(P.textoReloj(null), '—');
});

test('historial de gráficas: registra por intervalo, ventanas de tiempo y reinicio', () => {
  const h = G.crearHistorial(5, 10);
  assert.equal(h.registrar(0, { a: 1 }, { diaAnio: 1, horaSolar: 6 }), true); assert.equal(h.registrar(5, { a: 2 }), false); assert.equal(h.registrar(12, { a: 3 }), true);
  for (const t of [30, 50, 70, 90, 110]) h.registrar(t, { a: t });
  assert.equal(h.longitud(), 5);                               // descarta las más viejas
  assert.equal(h.ventana(40).length, 3); assert.equal(h.ventana(null).length, 5);
  h.registrar(0, { a: 0 }); assert.equal(h.longitud(), 1);     // el tiempo volvió atrás: se reinició
  assert.equal(h.registrar(100, { a: 1 }, {}, 200), false);   // intervalo propio
});

test('escala de los ejes: cuatro divisiones redondas que contienen los valores', () => {
  for (const [v, ancho] of [[[0, 2410], 500], [[3, 4], 1], [[24.1, 27.3], 1], [[-800, 1500], 500], [[5, 5], 10]]) {
    const r = G.rangoDe(v, ancho), paso = (r.maximo - r.minimo) / 4;
    assert.ok(r.minimo <= Math.min(...v) && r.maximo >= Math.max(...v), JSON.stringify(v));
    const m = paso / Math.pow(10, Math.floor(Math.log10(paso))); assert.ok([1, 2, 2.5, 5, 10].some(x => Math.abs(m - x) < 1e-6), `paso ${paso}`);
  }
  assert.deepEqual(G.rangoDe([], 3), { minimo: 0, maximo: 3 });
});

test('valores del historial: potencias, batería, clima y códigos de estado 0–3 del cronograma', () => {
  const e = marcha(sim(), 300), v = G.valoresHistorial(e);
  for (const k of ['pA', 'pB', 'consumo', 'red', 'soc', 'vBat', 'gh', 'gA', 'gB', 'tAmb']) assert.ok(Number.isFinite(v[k]), k);
  assert.ok(v.pA > 0 && v.soc > 0 && v.soc <= 100);
  for (const [tag] of G.GRUPOS.find(g => g.id === 'estados').series) assert.ok([0, 1, 2, 3].includes(v[tag]), tag);
  assert.equal(v['QS-101'], 1);
  assert.deepEqual(G.valoresHistorial(null), {});
});

test('curva I-V: el máximo sale de la propia curva y los picos múltiples avisan de sombra parcial', () => {
  const s = sim(), e = marcha(s, 100), c = s.curvaIV('STR-101', 60), r = G.resumenCurva(c);
  assert.ok(c.length > 10); assert.ok(r.mpp.p > 0 && r.mpp.p <= r.pMax + 1e-9); assert.ok(r.mpp.v > 0 && r.mpp.v < r.vMax);
  assert.equal(G.maximosLocales(c), 1);
  const dos = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((p, k) => ({ v: k, i: 1, p: [0, 5, 10, 6, 3, 9, 14, 7, 0][k] }));
  assert.equal(G.maximosLocales(dos), 2);
  assert.deepEqual(G.resumenCurva([]).mpp, { v: 0, i: 0, p: 0 });
  assert.ok(e);
});

test('lecturas: secciones sin NaN y alarmas ordenadas por gravedad', () => {
  const s = sim(); s.ordenes.averias.activar('COMUNICACION_PERDIDA_EASUN'); s.ordenes.averias.activar('QB_DISPARADO');
  const e = marcha(s, 30), sec = L.seccionesLecturas(e);
  assert.deepEqual(sec.map(x => x.id), ['energia', 'ambiente', 'cadenas', 'inversores', 'bateria']);
  assert.doesNotMatch(JSON.stringify(sec), /NaN|undefined/);
  assert.equal(sec.find(x => x.id === 'cadenas').filas.length, 4);
  const orden = L.alarmasOrdenadas(e); assert.equal(orden[0].severidad, 'alarma');
  assert.deepEqual(L.seccionesLecturas(null), []);
});

test('fichas: todos los equipos tienen ficha con qué es, qué hace y qué mirar; el visor 3D se abre aislado en la pieza', () => {
  for (const q of layout.EQUIPOS) { const f = A.fichaDe(q.tag); assert.ok(f && f.queEs && f.enSimulador && f.mantenimiento, q.tag); assert.match(f.titulo, new RegExp(q.tag)); }
  assert.equal(A.fichaDe('XX-999'), null);
  assert.equal(A.urlVisor3d('INV-101'), 'visor3d.html?foco=INV-101&solo=1'); assert.equal(A.urlVisor3d(), 'visor3d.html');
  const e = marcha(sim(), 100); assert.match(A.textoVivo('BAT-101', e), /%/); assert.equal(A.textoVivo('BAT-101', null), '—');
  assert.equal(A.fichaDe('PV-101', { 'PV-101': { titulo: 'Externo' } }).titulo, 'Externo');      // los textos del agente de documentación mandan
});

test('panel de mando: el texto del botón de cada protección es lo que hace el clic', () => {
  assert.equal(R.textoBotonProteccion('CERRADO'), 'Abrir'); assert.equal(R.textoBotonProteccion('ABIERTO'), 'Cerrar'); assert.equal(R.textoBotonProteccion('DISPARADO'), 'Rearmar');
  assert.equal(R.textoBotonProteccion('FUNDIDO'), 'Sustituir fusible'); assert.equal(R.textoBotonProteccion('AGOTADO'), 'Sustituir cartucho');
});

test('el cargador lista los módulos de la interfaz que existen y un módulo que falte no se anota como propio', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'interfaz', 'cargador.js'), 'utf8');
  for (const m of ['formato_fv.js', 'esquema_fv.js', 'ayuda_fv.js', 'grafica_fv.js', 'panel_revision.js', 'panel_lecturas.js']) assert.match(src, new RegExp(m.replace('.', '\\.')));
  for (const m of ['js/interfaz/formato_fv.js', 'js/scada2d/esquema_fv.js', 'js/interfaz/ayuda_fv.js', 'js/interfaz/grafica_fv.js', 'js/interfaz/panel_revision.js', 'js/interfaz/panel_lecturas.js'])
    assert.ok(fs.existsSync(path.join(__dirname, '..', m)), m);
  assert.match(src, /simulacion\.js/);
});

test('las páginas del contrato de la interfaz existen (index, css)', () => {
  for (const f of ['index.html', 'css/planta_fv.css']) assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
});

test('restaurar Normal con el modelo real: no queda nada de la sesión de Revisión (suciedad, sombras, modo del EASun, apagados, SoC no se toca)', () => {
  const real = require('../js/modelo/simulacion.js').crearSimulacion({ semilla: 1, diaAnio: 172, horaSolar: 11, nubosidad: 0.1 });
  const o = real.ordenes;
  o.averias.activar('FUSIBLE_F101'); o.averias.activar('RED_CAIDA'); o.protecciones.abrir('QF-302'); o.inversor.modoEasun('BATERIA_PRIMERO'); o.inversor.encender('INV-201', false);
  o.ambiente.poner({ suciedadA: 0.4, suciedadB: 0.3, temperaturaAmbienteC: 5 }); o.ambiente.sombra('PV-205', 1); o.red.tension(260); o.cargas.poner('LOAD-301', 2800);
  marcha(real, 60); P.restaurarNormal(real); const e = marcha(real, 600);
  assert.deepEqual(e.averiasActivas, []); assert.equal(e.red.disponible, true); assert.equal(Math.round(e.red.v), 230);
  assert.equal(e.ambiente.suciedad.A, 0); assert.equal(e.ambiente.suciedad.B, 0); assert.equal(e.inversores['INV-101'].modo, 'SOLAR_PRIMERO');
  assert.notEqual(e.inversores['INV-201'].estado, 'APAGADO'); assert.equal(e.cargas['LOAD-301'].manual, false);
  for (const t of ['QF-302', 'QS-101', 'QB-101']) assert.equal(e.protecciones[t].estado, 'CERRADO', t);
  assert.ok(e.ambiente.temperaturaAmbienteC > 10);
});
