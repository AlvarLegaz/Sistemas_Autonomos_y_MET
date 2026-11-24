// Prácticas guiadas de mantenimiento: cada práctica se recorre con un «alumno» que usa los instrumentos reales sobre el modelo (como lo hace el maletín)
// y apunta en el cuaderno; el guion solo avanza con la medida pedida y su valor. También: pistas, fallos, nota, seguridad y datos de las prácticas.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');
const I = require('../js/interfaz/instrumentos_fv.js');
const K = require('../js/interfaz/cuaderno_fv.js');
const P = require('../js/interfaz/practicas_fv.js');
const C = require('../js/averias/catalogo.js');
const L = require('../../comun/js/diagnostico/logica_diagnostico.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');

function montar(id) {
  const pr = P.porId(id), sim = crearSimulacion({ semilla: 1, diaAnio: 172, horaSolar: 12, nubosidad: 0 }); sim.paso(0.2);
  C.prepararEscenario(sim, P.firmaDe(pr));
  if (pr.averia) sim.ordenes.averias.activar(pr.averia);
  for (let k = 0; k < 24; k++) sim.paso(5);
  const cuaderno = K.crearCuaderno(), g = P.crearGuion(pr, { sim: () => sim, cuaderno, I });
  return { pr, sim, cuaderno, g };
}
const anota = (m, datos, l) => m.cuaderno.anadir(Object.assign({ t: m.sim.estado.t, hora: m.sim.estado.reloj.texto, valor: l.valor, unidad: l.unidad, texto: l.texto, peligro: !!l.peligro, valida: l.ok && l.valida !== false }, datos));
const pinza = (m, id, modo = 'DC') => anota(m, { instrumento: 'pinza', modo, puntos: [id] }, I.lecturaPinza(m.sim, id, modo));
const voltios = (m, a, b, modo = 'VDC') => anota(m, { instrumento: 'multimetro', modo, puntos: [a, b] }, I.lecturaMultimetro(m.sim, modo, a, b));
const trazar = (m, c) => anota(m, { instrumento: 'trazadorIV', puntos: [c] }, I.lecturaTrazador(m.sim, c));
const camara = (m, z) => anota(m, { instrumento: 'termografia', puntos: [z] }, I.lecturaTermografia(m.sim, z));
const maniobra = (m, f) => { f(m.sim.ordenes); for (let k = 0; k < 6; k++) m.sim.paso(5); };
const apagar = (m, t) => maniobra(m, o => o.inversor.encender(t, false));
const abrir = (m, t) => maniobra(m, o => o.protecciones.abrir(t));

test('hay cuatro prácticas con orden de trabajo, pasos con por qué y tres pistas, y las averías existen en el catálogo', () => {
  assert.deepEqual(P.PRACTICAS.map(p => p.id), ['P1', 'P2', 'P3', 'P4']);
  const ids = new Set(layout.AVERIAS.map(a => a.id));
  for (const p of P.PRACTICAS) {
    assert.ok(p.titulo && p.orden && p.conclusion && p.pasos.length >= 5, p.id);
    if (p.averia) assert.ok(ids.has(p.averia), p.averia);
    for (const s of p.pasos) {
      assert.ok(s.titulo && s.porQue, `${p.id}: paso sin título o sin porqué`);
      assert.equal((s.pistas || []).length, 3, `${p.id}: ${s.titulo}`);
      if (s.tipo === 'respuesta') assert.ok(s.opciones.length >= 3 && s.correcta < s.opciones.length);
    }
  }
});

test('P1: la revisión sin avería se completa midiendo y contestando; nota 10 sin pistas ni fallos', () => {
  const m = montar('P1');
  assert.equal(m.pr.averia, null);
  pinza(m, 'STR-101.+'); pinza(m, 'STR-102.+'); voltios(m, 'STR-101.+', 'STR-101.-'); trazar(m, 'STR-101');
  m.g.evaluar(); assert.equal(m.g.indice, 4); assert.equal(m.g.pasoActual().tipo, 'respuesta');
  m.g.responder(0); camara(m, 'STR-101.mc4.0'); m.g.evaluar(); assert.equal(m.g.pasoActual().tipo, 'respuesta');
  m.g.responder(0); assert.ok(m.g.hecho); assert.equal(m.g.nota(), 10);
});

test('P2: el fusible F-101 fundido se localiza con pinza y multímetro; hay que apagar el inversor ANTES de abrir QS-101', () => {
  const m = montar('P2');
  pinza(m, 'STR-102.+'); pinza(m, 'STR-101.+'); voltios(m, 'STR-101.+', 'STR-101.-'); voltios(m, 'F-101.1', 'F-101.2'); m.g.evaluar();
  assert.equal(m.g.pasoActual().tipo, 'respuesta'); assert.equal(m.g.responder(1).ok, false); assert.equal(m.g.responder(0).ok, true);
  assert.equal(m.g.pasoActual().tipo, 'accion');
  m.g.evaluar(); assert.equal(m.g.pasoActual().tipo, 'accion', 'sin la maniobra no avanza');
  const abre = { tipo: 'orden', accion: 'abrir', tag: 'QS-101' };
  assert.match(L.peligroManiobra(abre, m.sim.estado), /MANIOBRA PELIGROSA/, 'abrir con carga es peligroso');
  apagar(m, 'INV-101'); assert.equal(L.peligroManiobra(abre, m.sim.estado), '', 'con el inversor apagado ya no');
  abrir(m, 'QS-101'); m.g.evaluar();
  assert.equal(m.g.pasoActual().modo, 'OHM'); voltios(m, 'F-101.1', 'F-101.2', 'OHM'); m.g.evaluar();
  assert.ok(m.g.hecho); assert.equal(m.g.fallos, 1); assert.equal(m.g.nota(), 9.8);
});

test('P3: el diodo de paso de PV-104 se localiza comparando cadenas, paneles y termografía', () => {
  const m = montar('P3');
  pinza(m, 'STR-101.+'); pinza(m, 'STR-102.+'); trazar(m, 'STR-102'); m.g.evaluar();
  assert.equal(m.g.pasoActual().tipo, 'respuesta'); assert.ok(m.g.responder(0).ok);
  voltios(m, 'PV-104.+', 'PV-104.-'); voltios(m, 'PV-105.+', 'PV-105.-'); camara(m, 'PV-104.s1'); m.g.evaluar();
  assert.equal(m.g.pasoActual().tipo, 'respuesta'); assert.ok(m.g.responder(0).ok); assert.ok(m.g.hecho);
});

test('P4: el conector MC4 caliente se localiza con las entradas MPPT, la curva y la cámara; y se asegura antes de tocar', () => {
  const m = montar('P4');
  voltios(m, 'INV-201.mppt1+', 'INV-201.mppt1-'); voltios(m, 'INV-201.mppt2+', 'INV-201.mppt2-'); trazar(m, 'STR-202'); m.g.evaluar();
  assert.ok(m.g.responder(0).ok);
  camara(m, 'STR-202.mc4.0'); m.g.evaluar(); assert.equal(m.g.pasoActual().tipo, 'medida', 'un conector frío no vale');
  assert.match(m.g.ultimoMensaje, /temperatura normal|sigue buscando/i);
  camara(m, 'STR-202.mc4.2'); m.g.evaluar(); assert.ok(m.g.responder(0).ok);
  apagar(m, 'INV-201'); abrir(m, 'QS-201'); m.g.evaluar(); assert.ok(m.g.hecho);
});

test('una medida de otra cadena no avanza; con las puntas al revés vale (misma magnitud)', () => {
  const m = montar('P2');
  pinza(m, 'STR-102.+'); pinza(m, 'STR-101.+'); m.g.evaluar(); assert.equal(m.g.indice, 2);
  voltios(m, 'STR-102.+', 'STR-102.-'); m.g.evaluar(); assert.equal(m.g.indice, 2, 'STR-102 no es la cadena pedida');
  voltios(m, 'STR-101.-', 'STR-101.+'); m.g.evaluar(); assert.equal(m.g.indice, 3);
});

test('las pistas son de tres niveles y restan nota; la 4.ª repite la última', () => {
  const m = montar('P1'); const p = m.g.pasoActual();
  assert.equal(m.g.pista(), p.pistas[0]); assert.equal(m.g.pista(), p.pistas[1]); assert.equal(m.g.pista(), p.pistas[2]);
  assert.equal(m.g.pista(), p.pistas[2]); assert.equal(m.g.pistasUsadas, 3); assert.equal(m.g.nota(), 8.8);
});

test('las maniobras peligrosas restan 1,5 y la nota no baja de 0', () => {
  const m = montar('P1'); m.g.anotarPeligro('x'); assert.equal(m.g.nota(), 8.5);
  for (let k = 0; k < 10; k++) m.g.anotarPeligro('x'); assert.equal(m.g.nota(), 0);
});

test('el resumen recoge título, nota y conclusión; el escenario es el del reto (mediodía de junio, sin nubes)', () => {
  const m = montar('P3'), r = m.g.resumen();
  assert.equal(r.id, 'P3'); assert.match(r.conclusion, /PV-104/);
  assert.deepEqual(P.firmaDe(m.pr).escenario, P.ESCENARIO);
});

/* ---------- examen: corrección sin ayudas ---------- */
const examenDe = (m, respuestas = {}, peligros = 0) => P.evaluarExamen(m.pr, { sim: () => m.sim, cuaderno: m.cuaderno, I, respuestas, peligros });
const indicesRespuesta = pr => pr.pasos.map((s, k) => (s.tipo === 'respuesta' ? k : -1)).filter(k => k >= 0);

test('examen P3: con todas las medidas y respuestas la nota es 10, en cualquier orden y sin guion', () => {
  const m = montar('P3');
  camara(m, 'PV-104.s1'); voltios(m, 'PV-105.+', 'PV-105.-'); voltios(m, 'PV-104.+', 'PV-104.-'); trazar(m, 'STR-102'); pinza(m, 'STR-102.+'); pinza(m, 'STR-101.+');
  const r = {}; for (const k of indicesRespuesta(m.pr)) r[k] = m.pr.pasos[k].correcta;
  const e = examenDe(m, r);
  assert.equal(e.nota, 10); assert.deepEqual(e.medidas, { hechas: 6, total: 6 }); assert.deepEqual(e.respuestas, { acertadas: 2, total: 2 });
  assert.equal(e.detalle.practica, 'P3'); assert.ok(JSON.stringify(e.detalle).length < 4000);
});

test('examen: sin hacer nada la nota es 0; solo las respuestas valen la mitad; las maniobras peligrosas restan', () => {
  const m = montar('P3');
  assert.equal(examenDe(m).nota, 0);
  const r = {}; for (const k of indicesRespuesta(m.pr)) r[k] = m.pr.pasos[k].correcta;
  assert.equal(examenDe(m, r).nota, 5);
  assert.equal(examenDe(m, r, 2).nota, 2);
  const mal = {}; for (const k of indicesRespuesta(m.pr)) mal[k] = (m.pr.pasos[k].correcta + 1) % m.pr.pasos[k].opciones.length;
  assert.equal(examenDe(m, mal).respuestas.acertadas, 0);
});

test('examen P2: la maniobra de seguridad cuenta con el estado real de la instalación, no con un clic', () => {
  const m = montar('P2');
  let e = examenDe(m); assert.equal(e.medidas.hechas, 0);
  apagar(m, 'INV-101'); abrir(m, 'QS-101');
  e = examenDe(m); assert.equal(e.medidas.hechas, 1, 'solo la maniobra');
  voltios(m, 'F-101.1', 'F-101.2', 'OHM'); e = examenDe(m); assert.equal(e.medidas.hechas, 2);
});

test('examen: una medida con el valor equivocado no cuenta', () => {
  const m = montar('P3');
  pinza(m, 'STR-101.+', 'AC'); voltios(m, 'PV-104.-', 'PV-104.+', 'VDC');
  const e = examenDe(m); assert.equal(e.medidas.hechas, 1, 'la pinza en AC marca 0 y no vale; las puntas al revés sí');
});

test('las medidas valen a otra hora: tras dos horas de sol cambiado, P3 y P4 se completan igual (comparan con el gemelo en vivo)', () => {
  const m3 = montar('P3'); for (let k = 0; k < 1440; k++) m3.sim.paso(5);      // dos horas simuladas
  pinza(m3, 'STR-101.+'); pinza(m3, 'STR-102.+'); trazar(m3, 'STR-102'); m3.g.evaluar(); assert.equal(m3.g.indice, 3, m3.g.ultimoMensaje);
  m3.g.responder(0); voltios(m3, 'PV-104.+', 'PV-104.-'); voltios(m3, 'PV-105.+', 'PV-105.-'); camara(m3, 'PV-104.s1'); m3.g.evaluar();
  assert.ok(m3.g.responder(0).ok); assert.ok(m3.g.hecho);
  const m4 = montar('P4'); for (let k = 0; k < 1440; k++) m4.sim.paso(5);
  voltios(m4, 'INV-201.mppt1+', 'INV-201.mppt1-'); voltios(m4, 'INV-201.mppt2+', 'INV-201.mppt2-'); m4.g.evaluar(); assert.equal(m4.g.indice, 2, m4.g.ultimoMensaje);
});

/* ---------- informe descargable ---------- */
test('el detalle del examen lleva las respuestas dadas, los pasos pedidos y el cuaderno, y cabe en el límite del aula (12 000)', () => {
  const m = montar('P3'); pinza(m, 'STR-101.+'); voltios(m, 'PV-104.+', 'PV-104.-');
  const r = {}; for (const k of indicesRespuesta(m.pr)) r[k] = 0;
  const d = P.evaluarExamen(m.pr, { sim: () => m.sim, cuaderno: m.cuaderno, I, respuestas: r, intento: 2 }).detalle;
  assert.equal(d.intento, 2); assert.equal(d.respuestas.length, 2); assert.equal(d.respuestas[0].ok, true); assert.ok(d.respuestas[0].elegida && d.respuestas[0].correcta);
  assert.equal(d.pasos.length, m.pr.pasos.length); assert.ok(d.pasos.every(x => x.titulo)); assert.equal(d.cuaderno.length, 2);
  assert.ok(JSON.stringify(d).length < 12000, String(JSON.stringify(d).length));
});

test('informe: con intentos pendientes NO enseña las respuestas correctas ni los pasos; cerrado, sí; y escapa el HTML', () => {
  const m = montar('P3'); camara(m, 'PV-104.s1');
  const r = {}; for (const k of indicesRespuesta(m.pr)) r[k] = 1;
  const detalle = P.evaluarExamen(m.pr, { sim: () => m.sim, cuaderno: m.cuaderno, I, respuestas: r, intento: 1 }).detalle;
  detalle.respuestas[0].elegida = '<script>alert(1)</script>';
  const abierto = P.informeHtml({ tipo: 'Examen', alumno: 'Ana <b>Pérez</b>', fecha: '24 nov', intento: 1, intentosMax: 2, cerrado: false, detalle });
  assert.match(abierto, /Nota: \d+,\d \/ 10/); assert.match(abierto, /Ana &lt;b&gt;Pérez&lt;\/b&gt;/); assert.doesNotMatch(abierto, /<script>alert/);
  assert.doesNotMatch(abierto, /Respuesta correcta/); assert.doesNotMatch(abierto, /Pasos pedidos/); assert.match(abierto, /Las respuestas correctas se mostrarán/);
  assert.match(abierto, /Cámara térmica/);
  const cerrado = P.informeHtml({ tipo: 'Examen', fecha: '24 nov', intento: 2, intentosMax: 2, cerrado: true, detalle: Object.assign({}, detalle, { conclusion: m.pr.conclusion }) });
  assert.match(cerrado, /Respuesta correcta/); assert.match(cerrado, /Pasos pedidos/); assert.match(cerrado, /Parte de mantenimiento/);
  assert.equal(P.nombreInforme('Examen', 'P3', '2026-11-24'), 'informe_examen_P3_2026-11-24.html');
});

test('informe de una práctica guiada: nota, pistas y pasos', () => {
  const html = P.informeHtml({ tipo: 'Práctica', fecha: 'hoy', cerrado: true, detalle: { practica: 'P2', titulo: 'El campo A produce la mitad', nota: 9.2, pistas: 2, fallos: 0, peligros: 0, conclusion: 'Fusible F-101.', pasos: [{ paso: 1, titulo: 'Mide STR-102', ok: true }], cuaderno: [] } });
  assert.match(html, /Informe de práctica/); assert.match(html, /9,2 \/ 10/); assert.match(html, /Pistas usadas: <b>2<\/b>/); assert.match(html, /Mide STR-102/);
});
