'use strict';
// Pruebas de los tres niveles de dificultad: qué ve cada uno (funciones puras de niveles.js), cómo queda marcado el esquema 2D, el 3D y las lecturas del nivel 2.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const niveles = require('../js/interfaz/niveles.js');
const layout = require('../js/layout.js');
const esquema = require('../js/scada2d/esquema_htst.js');
const visor = require('../js/interfaz/visor_htst.js');
const pagina = require('../js/interfaz/pagina.js');
const lecturas = require('../js/interfaz/panel_lecturas.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');

const produciendo = () => { const sim = crearSimulacion({ semilla: 1 }); sim.ordenes.modo('PRODUCCION'); sim.ordenes.arrancar(); for (let i = 0; i < 6000; i++) sim.paso(0.5); return sim; };

// Recorre la especificación del esquema y devuelve los atributos de todos los nodos
const nodosDelEsquema = () => { const lista = []; (function r(n) { if (!Array.isArray(n)) return; const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null; if (a) lista.push({ nodo: n[0], a }); n.forEach(r); })(esquema.ESQUEMA_HTST); return lista; };

test('el nivel válido es 1, 2 o 3; el inicial sale de la dirección, de lo guardado o del perfil', () => {
  assert.deepEqual(['1', 2, '3', 0, 4, 'x', '', null, undefined].map(niveles.nivelValido), [1, 2, 3, null, null, null, null, null, null]);
  assert.equal(niveles.nivelInicial({ search: '?nivel=2', guardado: '3', profesor: true }), 2);          // la dirección manda
  assert.equal(niveles.nivelInicial({ search: '', guardado: '2' }), 2);                                  // luego lo guardado
  assert.equal(niveles.nivelInicial({ search: '?nivel=9', guardado: 'x' }), 1);                          // un alumno nuevo empieza por el 1
  assert.equal(niveles.nivelInicial({ search: '', guardado: null, profesor: true }), 3);                 // el profesor ve todo
});

test('&bloquear=1 solo vale con un nivel válido en la dirección', () => {
  assert.equal(niveles.bloqueado('?nivel=1&bloquear=1'), true);
  assert.equal(niveles.bloqueado('?bloquear=1&nivel=2'), true);
  assert.equal(niveles.bloqueado('?nivel=1'), false);
  assert.equal(niveles.bloqueado('?bloquear=1'), false);
  assert.equal(niveles.bloqueado('?nivel=7&bloquear=1'), false);
});

test('nivel 1: como mucho 12 elementos con tag visibles, todos con nombre sencillo y sin siglas', () => {
  const visibles = nodosDelEsquema().filter(x => x.a['data-tag'] && !x.a['data-n']).map(x => x.a['data-tag']);
  assert.ok(visibles.length <= 12 && visibles.length >= 7, `${visibles.length} elementos`);
  assert.deepEqual([...visibles].sort(), [...niveles.EQUIPOS_NIVEL_1].sort());
  for (const tag of visibles) {
    const nombre = niveles.nombreSencillo(tag), f = niveles.fichaSencilla(tag);
    assert.ok(nombre && f && f.queEs && f.queHace, tag);
    assert.doesNotMatch(`${f.nombre} ${f.queEs} ${f.queHace}`, /\b[A-Z]{1,3}-\d{3}\b/, `siglas en la ficha de ${tag}`);        // «TK-101», «P-101»… no
  }
});

test('el resto de equipos del esquema (sensores, válvulas XV, armario, CIP) solo se ven desde el nivel 2', () => {
  const resto = nodosDelEsquema().filter(x => x.a['data-tag'] && !niveles.EQUIPOS_NIVEL_1.includes(x.a['data-tag']));
  assert.ok(resto.length >= 40);
  for (const x of resto) assert.equal(String(x.a['data-n']), '2', x.a['data-tag']);
  for (const tag of niveles.EQUIPOS_NIVEL_1) assert.ok(layout.equipo(tag), tag);
  for (const tag of ['TT-103', 'XV-101', 'KM-201', 'QE-001', 'FLT-101']) { assert.equal(niveles.visibleEnNivel(tag, 1), false, tag); assert.equal(niveles.visibleEnNivel(tag, 2), true, tag); }
  assert.deepEqual(niveles.tagsVisibles(['TK-101', 'TT-103', 'P-102', 'XV-301'], 1), ['TK-101', 'P-102']);
});

test('las tuberías de llenado, vaciado y limpieza y la leyenda con LEDs no se ven en el nivel 1', () => {
  const rutas = nodosDelEsquema().filter(x => x.a['data-ruta']);
  for (const x of rutas) assert.equal(!!x.a['data-n'], ['llenado', 'vaciado', 'llenadoHw', 'vaciadoHw', 'cip'].includes(x.a['data-ruta']), x.a['data-ruta']);
  assert.ok(nodosDelEsquema().some(x => x.a['data-solo-n1']), 'tarjetas de valores del nivel 1');
});

test('modos: el nivel 1 solo ofrece Parada y Automático; el 2 y el 3, los cinco; MANUAL y CIP pasan a PARADA al bajar al nivel 1', () => {
  assert.deepEqual(niveles.opcionesDeModo(1).map(o => o.valor), ['PARADA', 'AUTO']);
  assert.deepEqual(niveles.opcionesDeModo(2, layout.MODOS).map(o => o.valor), layout.MODOS);
  assert.deepEqual(niveles.opcionesDeModo(3, layout.MODOS, m => m.toLowerCase()).map(o => o.nombre), layout.MODOS.map(m => m.toLowerCase()));
  for (const modo of ['PARADA', 'RECIRCULACION_AGUA', 'PRODUCCION']) assert.equal(niveles.modoMasCercano(1, modo), modo);
  for (const modo of ['MANUAL', 'CIP']) assert.equal(niveles.modoMasCercano(1, modo), 'PARADA');
  for (const modo of layout.MODOS) { assert.equal(niveles.modoPermitido(2, modo), true); assert.equal(niveles.modoPermitido(3, modo), true); }
  assert.equal(niveles.valorDeSelector(1, 'PRODUCCION'), 'AUTO'); assert.equal(niveles.valorDeSelector(1, 'PARADA'), 'PARADA'); assert.equal(niveles.valorDeSelector(2, 'MANUAL'), 'MANUAL');
});

test('pestañas por nivel: gráficas; operar con instrumentos; todo con hojas y profesor', () => {
  assert.deepEqual(niveles.pestanasPermitidas(1), ['p-graficas']);
  assert.ok(niveles.pestanaPermitida(2, 'p-instrumentos') && niveles.pestanaPermitida(2, 'p-manual') && niveles.pestanaPermitida(2, 'p-alarmas'));
  assert.ok(!niveles.pestanaPermitida(2, 'p-hojas') && !niveles.pestanaPermitida(2, 'p-profesor'));
  for (const p of ['p-alarmas', 'p-manual', 'p-graficas', 'p-instrumentos', 'p-hojas', 'p-profesor']) assert.ok(niveles.pestanaPermitida(3, p), p);
});

test('capacidades: cada nivel incluye lo del anterior; las averías y el multímetro son solo del 3', () => {
  const c = [1, 2, 3].map(niveles.capacidades);
  for (const clave of Object.keys(c[0])) { assert.ok(!c[0][clave] || c[1][clave] || clave === 'lecturasInstrumentos', clave); assert.ok(!c[1][clave] || c[2][clave] || clave === 'lecturasInstrumentos', clave); }
  assert.equal(c[1].herramientasMedida, false); assert.equal(c[2].herramientasMedida, true); assert.equal(c[2].averias, true); assert.equal(c[0].modoManual, false); assert.equal(c[1].modoManual, true);
  assert.equal(c[1].lecturasInstrumentos, true); assert.equal(c[2].lecturasInstrumentos, false);     // las lecturas de solo lectura sustituyen al multímetro en el nivel 2
});

test('nivel 1: franja de estado en lenguaje claro (parada, preparando, todo bien y atención)', () => {
  const sim = crearSimulacion({ semilla: 1 });
  assert.equal(niveles.estadoSimple(sim.estado()).clase, 'reposo');
  assert.match(niveles.estadoSimple(sim.estado()).texto, /parada/);
  sim.ordenes.arrancar(); sim.paso(1);
  assert.match(niveles.estadoSimple(sim.estado()).texto, /Preparando/);
  assert.doesNotMatch(niveles.estadoSimple(sim.estado()).texto, /desvía/);               // preparando es lo normal: no se habla de desvío
  assert.equal(niveles.tarjetasNivel1(sim.estado())[0].clase === 'atencion', false);       // y la temperatura aún baja no es «atención»
  const prod = produciendo(), s = niveles.estadoSimple(prod.estado());
  assert.equal(s.clase, 'ok'); assert.match(s.texto, /^Todo bien: la leche llega a 7\d,\d °C y pasa a la salida\.$/);
  prod.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' }); prod.paso(2);
  assert.equal(niveles.estadoSimple(prod.estado()).clase, 'atencion');
  const desviando = { modo: 'PRODUCCION', instrumentos: { 'TT-103': { valorPLC: 70.1, calidad: 'OK' } }, equipos: { 'FDV-101': { posicion: 'DESVIO' } }, alarmas: [] };
  assert.equal(niveles.estadoSimple(desviando).texto, 'Atención: la leche no llega a 72 °C, se está desviando.');
  assert.equal(niveles.estadoSimple({ modo: 'PRODUCCION', plc: { paro: true }, alarmas: [] }).clase, 'atencion');
  for (const t of [s.texto, niveles.estadoSimple(desviando).texto]) assert.doesNotMatch(t, /\b[A-Z]{1,3}-\d{3}\b/);
});

test('nivel 1: tres tarjetas en palabras, con símbolo y texto de normal o atención', () => {
  const prod = produciendo(), tarjetas = niveles.tarjetasNivel1(prod.estado());
  assert.deepEqual(tarjetas.map(c => c.id), ['n1-temp', 'n1-caudal', 'n1-nivel']);
  assert.match(tarjetas[0].valor, /^7\d,\d °C$/); assert.equal(tarjetas[0].clase, 'ok'); assert.match(tarjetas[1].valor, /^\d+ litros por hora$/); assert.match(tarjetas[2].valor, /% lleno$/);
  for (const c of tarjetas) { assert.ok(['✔', '⚠', '●'].includes(c.simbolo)); assert.ok(c.estado.length > 3); }
  const parada = niveles.tarjetasNivel1(crearSimulacion({ semilla: 1 }).estado());
  assert.ok(parada.every(c => c.clase === 'reposo' || c.id === 'n1-nivel'));
  const caliente = niveles.tarjetasNivel1({ modo: 'PRODUCCION', instrumentos: { 'TT-103': { valorPLC: 60, calidad: 'OK' } }, proceso: { caudalLh: 0 }, tanque: { nivelPct: 8 } });
  assert.deepEqual(caliente.map(c => c.clase), ['atencion', 'atencion', 'atencion']);
  assert.match(caliente[0].estado, /aún no llega a 72/);
});

test('nivel 1: «Estado ahora» de cada ficha en una frase y la guía de 5 pasos', () => {
  const e = produciendo().estado();
  for (const tag of niveles.EQUIPOS_NIVEL_1) assert.ok(niveles.estadoVivoNivel1(tag, e).length > 3, tag);
  assert.equal(niveles.estadoVivoNivel1('P-101', e), 'Encendida.'); assert.equal(niveles.estadoVivoNivel1('FDV-101', e), 'Deja pasar la leche a la salida.');
  assert.equal(niveles.GUIA_NIVEL_1.length, 5);
  for (const [titulo, html] of niveles.GUIA_NIVEL_1) assert.ok(titulo && /<p>/.test(html));
});

test('etiquetas accesibles: en el nivel 1 con el nombre sencillo, en el resto con el tag', () => {
  const e = produciendo().estado();
  assert.equal(esquema.etiquetaAria(e, 'P-101', 1), 'Bomba de leche, Encendida.');
  assert.match(esquema.etiquetaAria(e, 'FDV-101', 1), /^Válvula de desvío, Deja pasar la leche/);
  assert.match(esquema.etiquetaAria(e, 'P-101', 2), /^P-101, en marcha$/);
  assert.match(esquema.etiquetaAria(e, 'TT-103'), /^TT-103, 7\d,\d °C, normal$/);
});

test('chips de la barra: sin siglas en el nivel 1 y como siempre en los demás', () => {
  const e = produciendo().estado();
  const c1 = pagina.datosChips(e, 1), c3 = pagina.datosChips(e, 3);
  assert.deepEqual(c1.map(c => c.titulo), ['Tiempo', 'Modo', 'Temperatura', 'Caudal', 'Válvula de desvío']);
  assert.equal(c1.find(c => c.id === 'fdv').valor, 'Deja pasar'); assert.equal(c1.find(c => c.id === 'modo').valor, 'Automático');
  assert.deepEqual(c3.map(c => c.titulo), ['Tiempo', 'Modo', 'TT-103', 'Caudal', 'FDV-101']);
  assert.match(pagina.descripcionModo('PRODUCCION', 1), /^Parada: todo apagado\. Automático:/);
  assert.match(pagina.descripcionModo('MANUAL', 3), /manda cada actuador/);
});

test('3D: el nivel 1 reduce etiquetas, lista de piezas y fichas; los niveles 2 y 3 no cambian nada', () => {
  try {
    niveles.fijarNivel(1);
    for (const tag of niveles.EQUIPOS_NIVEL_1) { assert.equal(visor.sinEtiqueta(tag), false, tag); assert.equal(visor.visibleEnLista(tag), true, tag); }
    for (const tag of ['TT-103', 'XV-101', 'QE-001', 'FT-101', 'SV-101']) { assert.equal(visor.sinEtiqueta(tag), true, tag); assert.equal(visor.visibleEnLista(tag), false, tag); }
    assert.equal(visor.nombreEtiqueta('P-101'), 'Bomba de leche'); assert.equal(visor.nombreEtiqueta('TT-103'), 'TT-103');
    const ayudas = visor.ayudasNivel1();
    assert.deepEqual(Object.keys(ayudas).sort(), [...niveles.EQUIPOS_NIVEL_1].sort());
    assert.equal(ayudas['TK-101'].titulo, 'Tanque de leche'); assert.ok(ayudas['TK-101'].queEs && ayudas['TK-101'].enSimulador);
    for (const nivel of [2, 3]) {
      niveles.fijarNivel(nivel);
      for (const tag of ['TT-103', 'FDV-101', 'P-101', 'HX-101', 'TK-101']) assert.equal(visor.sinEtiqueta(tag), false, `${tag} en el nivel ${nivel}`);
      assert.equal(visor.visibleEnLista('TT-103'), true); assert.equal(visor.nombreEtiqueta('P-101'), 'P-101');
    }
  } finally { niveles.fijarNivel(3); }
});

test('nivel 2: lecturas de los instrumentos en solo lectura (valor y estado de cada lazo y protección)', () => {
  const prod = produciendo(), filas = lecturas.filasLecturas(prod.estado());
  assert.equal(filas.filter(f => /^(TT|FT|PT|LT)-/.test(f.tag)).length, layout.SENALES.filter(s => s.tipo === 'AI').length);
  const tt = filas.find(f => f.tag === 'TT-103');
  assert.match(tt.valor, /^7\d,\d °C$/); assert.equal(tt.estado, 'Normal'); assert.equal(tt.alarma, false);
  for (const [tag] of lecturas.DIGITALES) assert.ok(filas.some(f => f.tag === tag), tag);
  for (const tag of ['TSH-101', 'LSL-101', 'LSH-101', 'LSL-301', 'PSL-201', 'ES-001']) assert.equal(filas.find(f => f.tag === tag).alarma, false, `${tag} normal en producción`);
  assert.match(filas.find(f => f.tag === 'LSH-101').valor, /^Nivel alto (no )?alcanzado$/);
  prod.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' }); prod.paso(2);
  const mal = lecturas.filasLecturas(prod.estado()).find(f => f.tag === 'TT-103');
  assert.equal(mal.estado, 'Fallo del lazo'); assert.equal(mal.alarma, true);
});
