// Prácticas guiadas de la planta real HTST: un «alumno» recorre cada práctica con el multímetro virtual (sim.medidas.medir) y anota en el registro como lo hace la página;
// el guion solo avanza con la medida pedida y su valor. También: pistas, nota, examen sin ayudas e informe descargable.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/interfaz/practicas_htst.js');
const H = require('../js/interfaz/hoja_registro.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');
const layout = require('../js/layout.js');
const Mot = require('../js/averias/motor.js');

function montar(id) {
  const pr = P.porId(id), sim = crearSimulacion({ semilla: 1 });
  P.preparar(sim, pr);
  const registro = H.crearRegistro(() => sim.estado().tiempoS), cuaderno = P.cuadernoDeRegistro(registro); cuaderno.marcar();
  const medir = (punto, modo) => { const r = sim.medidas.medir('multimetro', punto, null, modo); return r && r.ok !== false ? r : null; };
  const g = P.crearGuion(pr, { sim: () => sim, cuaderno, medir });
  return { pr, sim, registro, cuaderno, medir, g };
}
const anota = (m, modo, punto) => {
  const r = m.sim.medidas.medir('multimetro', punto, null, modo);
  m.registro.anotar('medida', `multimetro ${punto}: ${r.texto}`, { instrumento: 'multimetro', funcion: modo, punto, texto: r.texto, valor: typeof r.valor === 'number' ? r.valor : null });
  return r;
};
const correr = (m, s) => { for (let t = 0; t < s; t += 5) m.sim.paso(5); };
const respuestas = pr => { const r = {}; pr.pasos.forEach((s, k) => { if (s.tipo === 'respuesta') r[k] = s.correcta; }); return r; };

test('hay tres prácticas (H1, H2, H3) con orden de trabajo, pasos con por qué y tres pistas, y las averías existen en el catálogo', () => {
  assert.deepEqual(P.PRACTICAS.map(p => p.id), ['H1', 'H2', 'H3']);
  const ids = new Set(Mot.CATALOGO.map(a => a.id));
  for (const p of P.PRACTICAS) {
    assert.ok(p.titulo && p.orden && p.conclusion && p.pasos.length >= 5, p.id);
    if (p.averia) assert.ok(ids.has(p.averia), p.averia);
    for (const s of p.pasos) {
      assert.ok(s.titulo && s.porQue, `${p.id}: paso sin título o sin porqué`);
      assert.equal((s.pistas || []).length, 3, `${p.id}: ${s.titulo}`);
      if (s.tipo === 'respuesta') assert.ok(s.opciones.length >= 3 && s.correcta < s.opciones.length);
      if (s.tipo === 'medida') for (const [punto] of s.puntos) assert.ok(punto, s.titulo);
    }
  }
});

test('los puntos de medida que piden las prácticas existen en el modelo y en la lista del multímetro', () => {
  const sim = crearSimulacion({ semilla: 1 }), ids = new Set(sim.medidas.puntos.map(p => p.id));
  for (const p of P.PRACTICAS) for (const s of p.pasos) if (s.tipo === 'medida') for (const [punto] of s.puntos) assert.ok(ids.has(punto), `${p.id}: ${punto}`);
});

test('H1: el control todo o nada se estudia con la bobina y la potencia de KM-201 y KM-202; al llegar a la consigna la bobina baja a 0 V', () => {
  const m = montar('H1');
  assert.equal(m.pr.averia, null);
  anota(m, 'V', 'KM-201:BOBINA'); anota(m, 'V', 'KM-201:CARGA'); anota(m, 'V', 'KM-202:BOBINA'); m.g.evaluar();
  assert.equal(m.g.indice, 3, m.g.ultimoMensaje);
  assert.equal(m.g.pasoActual().tipo, 'medida'); m.g.evaluar(); assert.equal(m.g.indice, 3, 'aún está conectado: no vale la medida a 0 V');
  for (let t = 0; t < 1800 && m.sim.estado().equipos['KM-201'].cerrado !== false; t += 5) m.sim.paso(5);
  anota(m, 'V', 'KM-201:BOBINA'); m.g.evaluar(); assert.equal(m.g.indice, 4, m.g.ultimoMensaje);
  assert.equal(m.g.responder(1).ok, false); assert.ok(m.g.responder(0).ok); assert.ok(m.g.responder(0).ok); assert.ok(m.g.hecho);
});

test('H2: el colador obstruido se localiza con presión antes y después; el variador se descarta; y se para antes de intervenir', () => {
  const m = montar('H2');
  anota(m, 'presion', 'FLT-101:PRESION-ANTES'); anota(m, 'presion', 'FLT-101:PRESION-DESPUES'); anota(m, 'temperatura', 'VFD-101:DISIPADOR'); anota(m, 'V', 'VFD-101:VENTILADOR'); m.g.evaluar();
  assert.equal(m.g.indice, 4, m.g.ultimoMensaje); assert.equal(m.g.responder(1).ok, false); assert.ok(m.g.responder(0).ok);
  m.g.evaluar(); assert.equal(m.g.pasoActual().tipo, 'accion', 'sin parar la planta no avanza');
  m.sim.ordenes.modo('PARADA'); m.sim.paso(1); m.g.evaluar(); assert.ok(m.g.hecho); assert.equal(m.g.fallos, 1);
});

test('H3: la sonda Pt100 abierta se localiza comparando lazos y midiendo la sonda', () => {
  const m = montar('H3');
  anota(m, 'mA', 'TT-102:LAZO'); anota(m, 'mA', 'TT-103:LAZO'); anota(m, 'ohm', 'TT-103:PT100'); m.g.evaluar();
  assert.equal(m.g.indice, 3, m.g.ultimoMensaje);
  for (const k of [0, 0, 0]) assert.ok(m.g.responder(k).ok); assert.ok(m.g.hecho); assert.equal(m.g.nota(), 10);
});

test('una medida con la función equivocada no avanza y avisa', () => {
  const m = montar('H3');
  anota(m, 'mA', 'TT-102:LAZO'); anota(m, 'V', 'TT-103:LAZO'); m.g.evaluar(); assert.equal(m.g.indice, 1);
  anota(m, 'mA', 'TT-102:LAZO'); m.g.evaluar(); assert.equal(m.g.indice, 1);
  anota(m, 'mA', 'TT-103:LAZO'); m.g.evaluar(); assert.equal(m.g.indice, 2);
});

test('las pistas son de tres niveles y restan nota; los peligros restan 1,5', () => {
  const m = montar('H3'); const p = m.g.pasoActual();
  assert.equal(m.g.pista(), p.pistas[0]); assert.equal(m.g.pista(), p.pistas[1]); assert.equal(m.g.pista(), p.pistas[2]); assert.equal(m.g.pistasUsadas, 3);
  assert.equal(m.g.nota(), 8.8); m.g.anotarPeligro('x'); assert.equal(m.g.nota(), 7.3);
});

test('solo cuenta lo anotado desde que empezó la práctica (el registro anterior no vale)', () => {
  const sim = crearSimulacion({ semilla: 1 }), registro = H.crearRegistro(() => 0);
  registro.anotar('medida', 'antes', { instrumento: 'multimetro', funcion: 'mA', punto: 'TT-102:LAZO', texto: '14 mA', valor: 14 });
  const cuaderno = P.cuadernoDeRegistro(registro); cuaderno.marcar();
  assert.equal(cuaderno.lista().length, 0);
  registro.anotar('medida', 'despues', { instrumento: 'multimetro', funcion: 'mA', punto: 'TT-102:LAZO', texto: '14 mA', valor: 14 });
  registro.anotar('accion', 'otra cosa', {}); assert.equal(cuaderno.lista().length, 1); void sim;
});

/* ---------- examen ---------- */
const examenDe = (m, resp = {}, peligros = 0, intento = 1) => P.evaluarExamen(m.pr, { sim: () => m.sim, cuaderno: m.cuaderno, medir: m.medir, respuestas: resp, peligros, intento });

test('examen H3: con todas las medidas y respuestas la nota es 10; sin nada, 0; solo respuestas, 5; los peligros restan', () => {
  const m = montar('H3');
  assert.equal(examenDe(m).nota, 0); assert.equal(examenDe(m, respuestas(m.pr)).nota, 5); assert.equal(examenDe(m, respuestas(m.pr), 2).nota, 2);
  anota(m, 'ohm', 'TT-103:PT100'); anota(m, 'mA', 'TT-103:LAZO'); anota(m, 'mA', 'TT-102:LAZO');
  const e = examenDe(m, respuestas(m.pr)); assert.equal(e.nota, 10); assert.deepEqual(e.medidas, { hechas: 3, total: 3 });
  assert.ok(JSON.stringify(e.detalle).length < 12000);
});

test('examen H2: la maniobra de seguridad cuenta con el estado real de la planta', () => {
  const m = montar('H2'); assert.equal(examenDe(m).medidas.hechas, 0);
  m.sim.ordenes.modo('PARADA'); m.sim.paso(1); assert.equal(examenDe(m).medidas.hechas, 1);
});

test('informe: el detalle lleva respuestas, pasos y registro; con intentos pendientes no enseña las correctas; cerrado, sí; y escapa el HTML', () => {
  const m = montar('H3'); anota(m, 'mA', 'TT-103:LAZO');
  const r = respuestas(m.pr); r[3] = 1;
  const d = examenDe(m, r, 0, 2).detalle;
  assert.equal(d.intento, 2); assert.equal(d.respuestas.length, 3); assert.equal(d.respuestas[0].ok, false); assert.equal(d.cuaderno.length, 1);
  d.respuestas[0].elegida = '<script>alert(1)</script>';
  const abierto = P.informeHtml({ tipo: 'Examen', alumno: 'Ana <b>P</b>', fecha: '24 nov', intento: 2, intentosMax: 3, cerrado: false, detalle: d });
  assert.match(abierto, /Planta real HTST/); assert.match(abierto, /Nota: \d+,\d/); assert.doesNotMatch(abierto, /<script>alert/); assert.doesNotMatch(abierto, /Respuesta correcta/); assert.doesNotMatch(abierto, /Pasos pedidos/);
  const cerrado = P.informeHtml({ tipo: 'Examen', fecha: '24 nov', cerrado: true, detalle: Object.assign({}, d, { conclusion: m.pr.conclusion }) });
  assert.match(cerrado, /Respuesta correcta/); assert.match(cerrado, /Pasos pedidos/); assert.match(cerrado, /Parte de mantenimiento/);
  assert.equal(P.nombreInforme('Examen', 'H3', '2026-11-24'), 'informe_examen_H3_2026-11-24.html');
});

test('los iconos de la operación cubren los tipos de paso', () => {
  for (const p of P.PRACTICAS) for (const s of p.pasos) { const i = P.icono(s); assert.ok(i.glifo && i.etiqueta && i.clase, s.titulo); }
  assert.equal(P.icono(P.PRACTICAS[2].pasos[0]).glifo, 'mA'); assert.equal(P.icono(P.PRACTICAS[1].pasos[5]).glifo, '⏻');
  void layout;
});

test('preparar quita la avería de la práctica anterior (reiniciar() no la quita) y restaurar deja la planta sana', () => {
  const sim = crearSimulacion({ semilla: 1 });
  P.preparar(sim, P.porId('H3')); assert.equal(sim.averias.activas().length, 1);
  P.preparar(sim, P.porId('H1')); assert.equal(sim.averias.activas().length, 0, 'H1 no tiene avería');
  P.preparar(sim, P.porId('H2')); assert.equal(sim.averias.activas().length, 1);
  P.restaurar(sim); assert.equal(sim.averias.activas().length, 0); assert.equal(sim.estado().modo, 'PARADA');
});
