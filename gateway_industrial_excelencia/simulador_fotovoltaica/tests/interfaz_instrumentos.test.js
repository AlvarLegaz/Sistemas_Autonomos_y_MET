// Instrumentos de medida virtuales (lógica pura): multímetro, pinza, megóhmetro, trazador I-V, cámara termográfica, cuaderno de medidas y puntos sobre el sinóptico.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SIMBOLOS_PERMITIDOS } = require('../../comun/tipos.js');
const layout = require('../js/layout.js');
const I = require('../js/interfaz/instrumentos_fv.js');
const K = require('../js/interfaz/cuaderno_fv.js');
const E = require('../js/scada2d/esquema_fv.js');
const PI = require('../js/interfaz/panel_instrumentos.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');

const sim = (o = {}) => { const s = crearSimulacion(Object.assign({ semilla: 1, diaAnio: 172, horaSolar: 12, nubosidad: 0 }, o)); for (let k = 0; k < 40; k++) s.paso(5); return s; };
const marcha = (s, seg = 60) => { for (let t = 0; t < seg; t += 5) s.paso(5); return s; };

test('maletín: cinco instrumentos con nombre y ayuda; los ids coinciden con los de las medidas clave del catálogo', () => {
  assert.deepEqual(I.INSTRUMENTOS.map(x => x.id), ['multimetro', 'pinza', 'megohmetro', 'trazadorIV', 'termografia']);
  for (const x of I.INSTRUMENTOS) { assert.ok(x.nombre && x.ayuda && x.icono); assert.ok(K.INSTRUMENTOS[x.id], x.id); }
});

test('multímetro V⎓: tensión de la cadena con su signo; con las puntas al revés sale negativa y avisa de la polaridad', () => {
  const s = sim(), a = I.lecturaMultimetro(s, 'VDC', 'STR-101.+', 'STR-101.-'), b = I.lecturaMultimetro(s, 'VDC', 'STR-101.-', 'STR-101.+');
  assert.ok(a.ok && a.valor > 50 && a.valor < 120); assert.equal(a.unidad, 'V⎓'); assert.match(a.pantalla, /^\d+,\d$/);
  assert.ok(Math.abs(a.valor + b.valor) < 1e-6); assert.match(b.pantalla, /^-/); assert.ok(b.avisos.some(x => /polaridad invertida/i.test(x.texto)));
});

test('multímetro: sin las dos puntas pide colocarlas; con un punto desconocido no revienta', () => {
  const s = sim();
  assert.equal(I.lecturaMultimetro(s, 'VDC', null, null).ok, false); assert.match(I.lecturaMultimetro(s, 'VDC', null, null).avisos[0].texto, /ROJA/);
  assert.match(I.lecturaMultimetro(s, 'VDC', 'STR-101.+', null).avisos[0].texto, /NEGRA/);
  assert.equal(I.lecturaMultimetro(s, 'VDC', 'NO-EXISTE', 'N').ok, false);
});

test('multímetro V∿: 230 V en la acometida con aviso de tensión peligrosa; el selector equivocado marca 0 y lo dice', () => {
  const s = sim(), ac = I.lecturaMultimetro(s, 'VAC', 'RED-301.L', 'N');
  assert.ok(Math.abs(ac.valor - 230) < 5); assert.equal(ac.unidad, 'V∿'); assert.ok(ac.avisos.some(x => x.nivel === 'peligro'));
  const mal = I.lecturaMultimetro(s, 'VDC', 'RED-301.L', 'N'); assert.equal(mal.valor, 0); assert.ok(mal.avisos.some(x => /ALTERNA/.test(x.texto)));
  const mal2 = I.lecturaMultimetro(s, 'VAC', 'STR-201.+', 'STR-201.-'); assert.equal(mal2.valor, 0); assert.ok(mal2.avisos.some(x => /CONTINUA/.test(x.texto)));
});

test('multímetro V⎓: por encima de 120 V avisa de tensión peligrosa en continua (cadenas del campo B)', () => {
  const s = sim(); s.ordenes.protecciones.abrir('QS-201'); marcha(s, 10);      // en vacío: Voc de cuatro paneles
  const l = I.lecturaMultimetro(s, 'VDC', 'STR-201.+', 'STR-201.-');
  assert.ok(l.valor > 120); assert.ok(l.avisos.some(x => x.nivel === 'peligro' && /arco/.test(x.texto)));
});

test('multímetro Ω: con tensión entre las puntas es PELIGRO (no hay lectura y cuenta como medida peligrosa); sin tensión pita o marca OL', () => {
  const s = sim();
  const con = I.lecturaMultimetro(s, 'OHM', 'STR-101.+', 'STR-101.-');
  assert.equal(con.pantalla, 'PELIGRO'); assert.equal(con.peligro, true); assert.equal(con.valida, false); assert.equal(con.avisos[0].nivel, 'peligro');
  s.ordenes.averias.activar('FUSIBLE_F101'); s.ordenes.protecciones.abrir('QS-101'); marcha(s, 20);
  const roto = I.lecturaMultimetro(s, 'OHM', 'F-101.1', 'F-101.2'), sano = I.lecturaMultimetro(s, 'OHM', 'F-102.1', 'F-102.2');
  assert.equal(roto.pantalla, 'OL'); assert.equal(roto.valor, Infinity); assert.ok(!roto.peligro);
  assert.ok(sano.valor < 50); assert.match(sano.texto, /continuidad/);
  // La unidad distingue «continuidad con pitido» de una resistencia cualquiera, sin atarse a un carácter: ♪ está prohibido (C45); vale un texto
  // («cont.») o un símbolo de SIMBOLOS_PERMITIDOS.
  assert.ok(!/♪/.test(sano.unidad), 'el símbolo ♪ está prohibido en la interfaz (C45)');
  assert.notEqual(String(sano.unidad).trim(), 'Ω', 'la unidad de continuidad debe distinguirse de la de una resistencia');
  assert.ok(/cont/i.test(sano.unidad) || SIMBOLOS_PERMITIDOS.some(c => sano.unidad.includes(c)), `la unidad de continuidad debe llevar un texto («cont.») o un símbolo permitido: «${sano.unidad}»`);
});

test('un modelo sin las funciones nuevas no rompe los instrumentos: responden «no disponible»', () => {
  const viejo = { estado: sim().estado, puntos: [] };
  for (const l of [I.lecturaMultimetro(viejo, 'VDC', 'a', 'b'), I.lecturaPinza(viejo, 'STR-101.+'), I.lecturaMegohmetro(viejo, 'STR-101', '+'), I.lecturaTrazador(viejo, 'STR-101')]) {
    assert.equal(l.ok, false); assert.equal(l.noDisponible, true); assert.match(l.avisos[0].texto, /no disponible/);
  }
  assert.deepEqual(I.conductores(viejo), []);
  assert.ok(I.mapaTermico(viejo).length > 10, 'la cámara se compone con las temperaturas que ya publica el estado');
  assert.equal(I.lecturaTermografia({}, 'INV-101').noDisponible, true);
});

test('pinza: corriente de la cadena con signo en A⎓; en el retorno sale negativa; con el selector equivocado marca 0', () => {
  const s = sim(), mas = I.lecturaPinza(s, 'STR-201.+', 'DC'), menos = I.lecturaPinza(s, 'STR-201.-', 'DC');
  assert.ok(mas.ok && mas.valor > 3); assert.match(mas.pantalla, /^\+/); assert.ok(menos.valor < -3);
  const mal = I.lecturaPinza(s, 'STR-201.+', 'AC'); assert.equal(mal.valor, 0); assert.ok(mal.avisos.some(x => /CONTINUA/.test(x.texto)));
  const red = I.lecturaPinza(s, 'RED-301.L', 'AC'); assert.ok(red.ok && red.valor >= 0); assert.equal(red.unidad, 'A∿');
  assert.equal(I.lecturaPinza(s, null).ok, false);
  assert.equal(I.lecturaPinza(s, 'NO-EXISTE').ok, false);
});

test('pinza: las fugas a tierra se leen en miliamperios y con el fallo de aislamiento avisa de la fuga', () => {
  const s = sim(); assert.match(I.lecturaPinza(s, 'PE.QS-201', 'DC').avisos[0].texto, /Sin corriente de fuga/);
  s.ordenes.averias.activar('FALLO_AISLAMIENTO_B'); marcha(s, 60);
  const l = I.lecturaPinza(s, 'PE.QS-201', 'DC'); assert.equal(l.unidad, 'mA⎓'); assert.ok(Math.abs(l.valor) >= 0.0003 && Math.abs(l.valor) < 0.05); assert.ok(l.avisos.some(x => x.nivel === 'peligro' && /FUGA/.test(x.texto)));
  assert.doesNotMatch(l.pantalla, /^\+?0,0$/);
});

test('pinza: con la cadena abierta no circula corriente y lo explica', () => {
  const s = sim(); s.ordenes.averias.activar('CADENA_ABIERTA_B1'); marcha(s, 30);
  const l = I.lecturaPinza(s, 'STR-201.+', 'DC'); assert.ok(Math.abs(l.valor) < 0.05); assert.ok(l.avisos.some(x => /No circula corriente/.test(x.texto)));
});

test('megóhmetro: exige el seccionador abierto (y lo dice); abierto, la cadena sana da MΩ de sobra y la del fallo de aislamiento, FALLO', () => {
  const s = sim(), cerrado = I.lecturaMegohmetro(s, 'STR-201', '+');
  assert.equal(cerrado.ok, false); assert.equal(cerrado.bloqueado, true); assert.match(cerrado.pantalla, /QS-201/); assert.equal(cerrado.avisos[0].nivel, 'peligro'); assert.match(cerrado.avisos[0].texto, /QS-201/);
  s.ordenes.protecciones.abrir('QS-201'); marcha(s, 10);
  const sano = I.lecturaMegohmetro(s, 'STR-202', '-'); assert.ok(sano.ok && sano.correcto && sano.valor > 1); assert.equal(sano.unidad, 'MΩ');
  s.ordenes.averias.activar('FALLO_AISLAMIENTO_B'); marcha(s, 10);
  const malo = I.lecturaMegohmetro(s, 'STR-201', '+'); assert.ok(malo.ok && !malo.correcto && malo.valor < 1); assert.match(malo.texto, /FALLO/); assert.equal(malo.avisos[0].nivel, 'peligro');
  assert.equal(I.lecturaMegohmetro(s, null).ok, false);
});

test('trazador I-V: cadena sana ≈ referencia (± 5 %), con Voc, Isc, Pmpp y factor de forma coherentes', () => {
  const l = I.lecturaTrazador(sim(), 'STR-202');
  assert.ok(l.ok && l.valida); assert.ok(l.curva.length >= 40 && l.referencia.length >= 40);
  const r = l.resumen; assert.ok(r.voc > 100 && r.isc > 5 && r.pmpp > 500); assert.ok(r.ff > 0.6 && r.ff < 0.9); assert.ok(Math.abs(r.pmpp - r.voc * r.isc * r.ff) < 0.05 * r.pmpp);
  assert.ok(Math.abs(l.desviacionPct) <= 5); assert.equal(r.escalones, 0); assert.match(l.texto, /Voc .* Isc .* Pmpp .* FF/);
});

test('trazador I-V: por debajo de 400 W/m² avisa de que la norma IEC 62446-1 no lo da por bueno', () => {
  const s = crearSimulacion({ semilla: 1, diaAnio: 172, horaSolar: 6.5, nubosidad: 0 }); marcha(s, 60);
  const l = I.lecturaTrazador(s, 'STR-101');
  assert.equal(l.valida, false); assert.ok(l.avisos.some(x => /IEC 62446-1/.test(x.texto) && /400/.test(x.texto))); assert.match(l.texto, /NO CONCLUYENTE/);
});

test('trazador I-V: una sombra parcial deja escalones (diodos de paso) y la suciedad baja la Isc; una cadena abierta no da corriente', () => {
  const s = sim(); s.ordenes.ambiente.sombra('PV-202', 0.6); marcha(s, 30);
  const sombra = I.lecturaTrazador(s, 'STR-201'); assert.ok(sombra.resumen.escalones >= 1); assert.ok(sombra.avisos.some(x => /escal/.test(x.texto))); assert.ok(sombra.desviacionPct < -5);
  const s2 = sim(); s2.ordenes.averias.activar('SUCIEDAD_ALTA_A'); marcha(s2, 30);
  const sucia = I.lecturaTrazador(s2, 'STR-101'); assert.ok(sucia.resumen.isc < 0.9 * sucia.resumenRef.isc); assert.ok(sucia.avisos.some(x => /Isc/.test(x.texto)));
  const s3 = sim(); s3.ordenes.averias.activar('CADENA_ABIERTA_A1'); marcha(s3, 30);
  const abierta = I.lecturaTrazador(s3, 'STR-101'); assert.ok(abierta.resumen.isc < 0.05); assert.ok(abierta.avisos.some(x => /ABIERTA/.test(x.texto)));
});

test('resumen de una curva: Voc, Isc, Pmpp, factor de forma y número de picos (escalones) sin ayuda del modelo', () => {
  const ideal = Array.from({ length: 50 }, (_, k) => { const v = k * 2, i = v < 80 ? 10 : Math.max(0, 10 * (98 - v) / 18); return { v, i }; });
  const r = I.resumenCurva(ideal); assert.equal(r.isc, 10); assert.ok(r.voc >= 96 && r.voc <= 100); assert.ok(Math.abs(r.pmpp - 800) < 20); assert.equal(r.escalones, 0);
  const escalon = Array.from({ length: 60 }, (_, k) => { const v = k * 2, i = v < 40 ? 10 : v < 100 ? 4 : Math.max(0, 4 * (118 - v) / 18); return { v, i }; });
  assert.equal(I.resumenCurva(escalon).escalones, 1);
  assert.deepEqual(I.resumenCurva([]), { voc: 0, isc: 0, pmpp: 0, vmpp: 0, impp: 0, ff: 0, maximos: 0, escalones: 0 });
});

test('cámara termográfica: paneles, subcadenas, conectores, aparatos, batería e inversores; todos con sitio en el sinóptico', () => {
  const z = I.mapaTermico(sim());
  for (const id of ['PV-101.s1', 'PV-208.s3', 'STR-202.mc4.0', 'F-101', 'CB-101', 'QS-201', 'BAT-101', 'INV-101', 'INV-201', 'QF-301', 'ID-301', 'CAS-001']) assert.ok(z.some(x => x.id === id), id);
  for (const x of z) { assert.ok(Number.isFinite(x.tempC), x.id); assert.ok(x.nombre, x.id); assert.ok(E.zonaTermica(x.id, x.tipo, x.tag), `sin sitio en el dibujo: ${x.id}`); }
});

test('cámara termográfica: el conector resistivo de STR-202 es un PUNTO CALIENTE y los demás no', () => {
  const s = sim(); s.ordenes.averias.activar('CONECTOR_RESISTIVO_B2'); marcha(s, 300);
  const z = I.mapaTermico(s), calientes = I.puntosCalientes(z);
  assert.ok(calientes.some(id => /^STR-202\.mc4\./.test(id)), calientes.join());
  assert.ok(!calientes.some(id => /^STR-201|^STR-10/.test(id)));
  const l = I.lecturaTermografia(s, calientes.find(id => /^STR-202\.mc4\./.test(id)));
  assert.ok(l.caliente && l.valor > 60); assert.match(l.texto, /PUNTO CALIENTE/); assert.equal(l.avisos[0].nivel, 'peligro');
  assert.equal(I.puntosCalientes(I.mapaTermico(sim())).filter(id => /mc4/.test(id)).length, 0);
});

test('paleta térmica: frío oscuro, caliente claro, y la escala deja al menos 20 °C para que un punto caliente destaque', () => {
  const e = I.escalaTermica([{ tempC: 31 }, { tempC: 38 }]); assert.deepEqual(e, { min: 30, max: 50 });
  assert.equal(I.colorTermico(30, e), '#000000'); assert.equal(I.colorTermico(50, e), '#ffffeb'); assert.equal(I.colorTermico(999, e), '#ffffeb');
  const brillo = c => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
  assert.ok(brillo(I.colorTermico(35, e)) < brillo(I.colorTermico(42, e)) && brillo(I.colorTermico(42, e)) < brillo(I.colorTermico(49, e)));
  assert.deepEqual(I.escalaTermica([]), { min: 0, max: 50 });
});

test('puntos de medida: todos los nodos del modelo tienen sitio en el sinóptico, dentro del dibujo, y ninguno se pinta en el mismo sitio que otro', () => {
  const s = sim(), ids = s.puntos.map(p => p.id);
  assert.ok(ids.length >= 90);
  for (const id of ids) { const q = E.PUNTOS_XY[id]; assert.ok(q, `sin sitio: ${id}`); assert.ok(q[0] > 5 && q[0] < 1735 && q[1] > 5 && q[1] < 855, id); assert.ok(q[2].length >= 1 && q[2].length <= 2, id); }
  const vistos = new Map(); for (const id of ids) { const k = E.PUNTOS_XY[id].slice(0, 2).join(); assert.ok(!vistos.has(k), `${id} encima de ${vistos.get(k)}`); vistos.set(k, id); }
});

test('conductores de la pinza: todos los del modelo tienen marca en el sinóptico', () => {
  const s = sim(), L = I.conductores(s);
  assert.ok(L.length >= 25);
  for (const c of L) { assert.ok(E.PINZA_XY[c.id], `sin marca: ${c.id}`); assert.ok(c.descripcion); assert.ok(['DC', 'AC'].includes(c.tipo), c.id); }
});

test('puntos de un equipo: tocar un equipo da sus bornes; un panel da los suyos; la batería, bornes y tomas de celda', () => {
  const s = sim();
  assert.deepEqual(E.puntosDeEquipo('F-101', s.puntos), ['F-101.1', 'F-101.2']);
  assert.deepEqual(E.puntosDeEquipo('PV-104', s.puntos).sort(), ['PV-104.+', 'PV-104.-']);
  assert.equal(E.puntosDeEquipo('BAT-101', s.puntos).length, 11);
  assert.ok(E.puntosDeEquipo('QA-301', s.puntos).includes('TIERRA'));
  assert.deepEqual(E.puntosDeEquipo('CAS-001', s.puntos), []);
  assert.equal(E.equipoDePunto('QS-201.3'), 'QS-201'); assert.equal(E.equipoDePunto('N'), 'QA-301'); assert.equal(E.equipoDePunto('PE.CB-101'), 'CB-101');
});

test('toque con el dedo: uno solo o uno claramente más cerca se elige; varios parecidos se preguntan; ninguno, nada', () => {
  assert.deepEqual(PI.resolverToque([]), {});
  assert.deepEqual(PI.resolverToque([{ id: 'a', px: 20 }]), { elegido: 'a' });
  assert.deepEqual(PI.resolverToque([{ id: 'a', px: 3 }, { id: 'b', px: 15 }]), { elegido: 'a' });
  assert.deepEqual(PI.resolverToque([{ id: 'a', px: 8 }, { id: 'b', px: 11 }, { id: 'c', px: 20 }]), { dudas: ['a', 'b', 'c'] });
  assert.equal(PI.resolverToque(Array.from({ length: 9 }, (_, k) => ({ id: 'p' + k, px: 10 + k }))).dudas.length, 6);
  assert.ok(PI.RADIO_TOQUE_PX >= 22, 'el dedo necesita un objetivo de 44 px');
  assert.deepEqual(E.cercanos([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 100, y: 0 }], 8, 0, 20), ['b', 'a']);
});

test('una lectura que cambia mucho sin mover el instrumento se vuelve a apuntar (peligro que desaparece, OL, más de un 15 %)', () => {
  const c = PI.cambioNotable;
  assert.equal(c(null, { ok: true, valor: 1 }), false);
  assert.equal(c({ peligro: true, valor: null }, { ok: true, valor: Infinity }), true);
  assert.equal(c({ valor: 0.2 }, { ok: true, valor: Infinity }), true);
  assert.equal(c({ valor: 80 }, { ok: true, valor: 82 }), false); assert.equal(c({ valor: 80 }, { ok: true, valor: 100 }), true);
  assert.equal(c({ valor: 0.1 }, { ok: true, valor: 0.5 }, 1), false);
});

test('trazados de los cables y muestreo: sirven para situar marcas sobre los cables', () => {
  const T = E.trazadosDelEsquema(); assert.ok(T['STR-101'] && T.RED && T.BAT);
  const pts = E.muestrearTrazado('M0 0 H100 V50', 10); assert.equal(pts.length, 16); assert.deepEqual(pts[pts.length - 1], { x: 100, y: 50 });
  for (const [id, q] of Object.entries(E.PINZA_XY)) assert.ok(q[0] > 5 && q[0] < 1735 && q[1] > 5 && q[1] < 855, id);
});

test('cuaderno: cada medida se apunta con hora, instrumento, puntos y valor; se anota, se marca, se borra y se vacía', () => {
  const c = K.crearCuaderno(); let cambios = 0; c.alCambiar(() => cambios++);
  const a = c.anadir({ t: 10, hora: '21 jun · 12:03', instrumento: 'multimetro', modo: 'VDC', modoTexto: 'V⎓', puntos: ['F-101.1', 'F-101.2'], valor: 21.6, unidad: 'V⎓', texto: '21,6 V⎓' });
  assert.equal(a.id, 1); assert.equal(K.textoEntrada(a), '12:03 · Multímetro V⎓ · F-101.1 ↔ F-101.2 · 21,6 V⎓');
  assert.equal(c.anadir({ t: 12, hora: '21 jun · 12:04', instrumento: 'multimetro', modo: 'VDC', puntos: ['F-101.2', 'F-101.1'], texto: '21,6 V⎓' }).id, 1, 'la misma medida repetida (puntas al revés, mismo texto) no llena el cuaderno');
  const b = c.anadir({ t: 20, hora: '21 jun · 12:05', instrumento: 'pinza', modo: 'DC', puntos: ['STR-101.+'], valor: 0, texto: '0,00 A⎓' });
  const p = c.anadir({ instrumento: 'multimetro', modo: 'OHM', puntos: ['a', 'b'], texto: '¡con tensión!', peligro: true });
  assert.equal(p.valida, false); assert.equal(c.lista().length, 3); assert.equal(c.total, 3);
  assert.ok(c.anotar(b.id, 'x'.repeat(500))); assert.equal(c.lista()[1].nota.length, K.MAX_NOTA);
  assert.ok(c.marcar(a.id, true)); assert.deepEqual(c.evidencias().map(e => e.id), [1]);
  assert.ok(c.borrar(b.id)); assert.equal(c.borrar(99), false); assert.equal(c.lista().length, 2); assert.equal(c.total, 3, 'el total cuenta las medidas hechas, también las borradas');
  assert.equal(c.anadir(null), null); assert.ok(cambios >= 6);
  c.limpiar(); assert.equal(c.lista().length, 0); assert.equal(c.total, 0);
});

test('cuaderno: la firma no depende del orden de las puntas pero sí del instrumento y del modo', () => {
  assert.equal(K.firma({ instrumento: 'multimetro', modo: 'VDC', puntos: ['b', 'a'] }), K.firma({ instrumento: 'multimetro', modo: 'VDC', puntos: ['a', 'b'] }));
  assert.notEqual(K.firma({ instrumento: 'multimetro', modo: 'VDC', puntos: ['a', 'b'] }), K.firma({ instrumento: 'multimetro', modo: 'OHM', puntos: ['a', 'b'] }));
});

test('el cargador y la página incluyen los instrumentos, y la ayuda explica cómo diagnosticar y los riesgos', () => {
  const base = path.join(__dirname, '..');
  const car = fs.readFileSync(path.join(base, 'js/interfaz/cargador.js'), 'utf8');
  for (const m of ['cuaderno_fv.js', 'instrumentos_fv.js', 'reto_fv.js', 'panel_instrumentos.js', 'panel_diagnostico.js']) { assert.match(car, new RegExp(m.replace('.', '\\.'))); assert.ok(fs.existsSync(path.join(base, 'js/interfaz', m)), m); }
  assert.match(fs.readFileSync(path.join(base, 'index.html'), 'utf8'), /css\/instrumentos_fv\.css/); assert.ok(fs.existsSync(path.join(base, 'css/instrumentos_fv.css')));
  const pag = fs.readFileSync(path.join(base, 'js/interfaz/pagina_simple.js'), 'utf8');
  for (const t of ['Cómo diagnosticar', 'IEC 62446-1', 'Inspección visual', 'Continuidad de tierras', 'Polaridad', 'Voc', 'Aislamiento', 'Curva I-V', 'Termografía', 'Riesgos de cada medida', 'id="v-instrumentos"', 'id="modo-diagnostico"']) assert.ok(pag.includes(t), t);
  assert.ok(layout.EQUIPOS.length > 30);
});
