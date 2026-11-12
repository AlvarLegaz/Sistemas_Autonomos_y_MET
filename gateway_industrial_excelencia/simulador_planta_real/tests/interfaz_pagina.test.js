'use strict';
// Pruebas de la interfaz de la planta real: esquema 2D, textos de ayuda, gráficas, página y lecturas del visor 3D (lógica pura).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const esquema = require('../js/scada2d/esquema_htst.js');
const textos = require('../js/interfaz/textos_ayuda.js');
const grafica = require('../js/interfaz/grafica_htst.js');
const leyenda = require('../js/scada2d/leyenda.js');
const visor = require('../js/interfaz/visor_htst.js');
const ayuda = require('../js/interfaz/ayuda_htst.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');
const pagina = require('../js/interfaz/pagina.js');

const produciendo = () => { const sim = crearSimulacion({ semilla: 1 }); sim.ordenes.modo('PRODUCCION'); sim.ordenes.arrancar(); for (let i = 0; i < 6000; i++) sim.paso(0.5); return sim; };

test('el esquema 2D tiene todos los equipos del contrato (data-tag) y ningún tag inventado', () => {
  const tags = esquema.tagsDelEsquema();
  for (const e of layout.EQUIPOS) assert.ok(tags.has(e.tag), `falta ${e.tag} en el esquema`);
  for (const t of tags) assert.ok(layout.equipo(t), `${t} no existe en el contrato`);
});

test('los ids del esquema no se repiten', () => {
  const ids = [];
  (function r(n) { if (!Array.isArray(n)) return; const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null; if (a && a.id) ids.push(a.id); n.forEach(r); })(esquema.ESQUEMA_HTST);
  assert.equal(new Set(ids).size, ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
});

test('tubos activos según el estado real: parada, producción con avance y desvío por fallo de TT-103', () => {
  const sim = crearSimulacion({ semilla: 1 });
  assert.deepEqual(esquema.estadoTubos(sim.estado()), { crudo: false, avance: false, desvio: false, caliente: false, fria: false, llenado: false, vaciado: false, llenadoHw: false, vaciadoHw: false, cip: false });
  const prod = produciendo(), t = esquema.estadoTubos(prod.estado());
  assert.equal(t.crudo, true); assert.equal(t.avance, true); assert.equal(t.desvio, false); assert.equal(t.caliente, true); assert.equal(t.fria, true);
  prod.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' });
  for (let i = 0; i < 40; i++) prod.paso(0.5);
  const d = esquema.estadoTubos(prod.estado());
  assert.equal(d.avance, false); assert.equal(d.desvio, true);                           // la FDV desvía y la leche vuelve al tanque
});

test('lectura de instrumentos en el esquema: valor con unidad o fallo del lazo, y alarma', () => {
  const prod = produciendo();
  assert.match(esquema.textoInstrumento(prod.estado(), 'TT-103'), /^7\d,\d °C$/);
  assert.match(esquema.textoInstrumento(prod.estado(), 'FT-101'), /L\/h$/);
  assert.equal(esquema.alarmaInstrumento(prod.estado(), 'TT-103'), false);
  prod.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-102' });
  prod.paso(1);
  assert.match(esquema.textoInstrumento(prod.estado(), 'TT-102'), /ABIERTO/);
  assert.equal(esquema.lecturasEsquema(prod.estado())['TT-102'], true);
});

test('los LEDs del armario: la seta pulsada y el fusible fundido se ven en rojo, y la baliza con una alarma', () => {
  const led = tag => esquema.LEDS.find(l => l[0] === tag);
  const prod = produciendo();
  assert.equal(led('PS-001')[2](prod.estado()), true);
  assert.equal(led('F-201')[3](prod.estado()), false);
  prod.averias.inyectar('AV-FUSIBLE-F201');
  for (let i = 0; i < 20; i++) prod.paso(0.5);
  assert.equal(led('F-201')[3](prod.estado()), true);
  assert.equal(led('HL-001')[3](prod.estado()), true);
});

test('hay ficha de ayuda para cada equipo y el estado vivo se calcula con el modelo real', () => {
  const el = textos.construirElementos();
  for (const e of layout.EQUIPOS) { assert.ok(el[e.tag], e.tag); assert.ok(el[e.tag].queEs.length > 15, `${e.tag}: texto muy corto`); assert.ok(el[e.tag].etiqueta); }
  assert.match(el['FDV-101'].enSimulador, /DESVÍO/);
  const prod = produciendo();
  assert.match(textos.estadoVivo('TT-103', prod.estado()), /°C · \d+,\d+ mA · calidad OK/);
  assert.match(textos.estadoVivo('FDV-101', prod.estado()), /posicion: AVANCE/);
  assert.equal(textos.estadoVivo('TT-103', null), '');
  assert.ok(textos.GUIA.length >= 4);
});

test('el historial de gráficas guarda cada intervalo, se reinicia con el tiempo atrás y limita su tamaño', () => {
  const h = grafica.crearHistorial(5, 2);
  assert.equal(h.registrar(0, { a: 1 }), true); assert.equal(h.registrar(1, { a: 2 }), false); assert.equal(h.registrar(2, { a: 3 }), true);
  for (let t = 4; t <= 20; t += 2) h.registrar(t, { a: t });
  assert.equal(h.longitud(), 5);
  assert.equal(h.ventana(null).length, 5); assert.equal(h.ventana(4).length, 3);
  h.registrar(0, { a: 9 });                                                               // la simulación se reinició
  assert.equal(h.longitud(), 1);
});

test('rango del eje y puntos de la serie: margen, mínimo de alto, recorte y huecos si falta el valor', () => {
  const r = grafica.rangoDe([72, 74], 10);
  assert.ok(r.maximo - r.minimo >= 10); assert.ok(r.minimo <= 68 && r.maximo >= 78);
  assert.deepEqual(grafica.rangoDe([], 1), { minimo: 0, maximo: 1 });
  const filas = [{ t: 0, v: { x: 0 } }, { t: 5, v: {} }, { t: 10, v: { x: 10 } }];
  const p = grafica.puntosDeSerie(filas, 'x', 100, 50, { minimo: 0, maximo: 10 }, 0, 10);
  assert.deepEqual(p[0], [0, 50]); assert.equal(p[1], null); assert.deepEqual(p[2], [100, 0]);
});

test('la leyenda cubre producto, agua caliente, agua fría, bombas, válvulas y los tres estados del LED', () => {
  const claves = leyenda.ELEMENTOS.map(e => e.clave);
  for (const k of ['producto', 'caliente', 'frio', 'parado', 'bomba_marcha', 'valvula_abierta', 'led_apagado', 'led_activo', 'led_fallo']) assert.ok(claves.includes(k), k);
  assert.ok(leyenda.ELEMENTOS.filter(e => e.tipo === 'simbolo').length >= 6);      // formas, no solo colores
});

test('página: elegir la simulación real, resumen del estado y lista de alarmas', () => {
  const real = { crearSimulacion };
  assert.equal(pagina.localizarSimulacion({ htst: { simulacion: real } }), real);
  assert.equal(pagina.localizarSimulacion({ htstSimulacion: real }), real);
  assert.equal(pagina.localizarSimulacion({}), null);
  assert.equal(pagina.localizarSimulacion({ htst: {} }), null);
  const prod = produciendo();
  assert.match(pagina.resumenEstado(prod.estado()), /^Producción · TT-103 7\d,\d °C · caudal \d{4} L\/h · FDV AVANCE$/);
  assert.equal(pagina.resumenEstado(null), '—');
  assert.equal(pagina.formatoReloj(3725), '01:02:05');
  prod.averias.inyectar('AV-FUSIBLE-F201');
  for (let i = 0; i < 20; i++) prod.paso(0.5);
  const alarmas = pagina.listaAlarmas(prod.estado());
  assert.ok(alarmas.some(a => /A140/.test(a.texto)));
  assert.ok(alarmas.every(a => a.clave && typeof a.desdeS === 'number'));
});

test('visor 3D: las lecturas de las etiquetas salen del estado (valor, fallo de lazo, FDV, fusible)', () => {
  const prod = produciendo();
  let l = visor.lecturasHtst(prod.estado()).sensores;
  assert.match(l['TT-103'].texto, /°C/); assert.equal(l['TT-103'].alarma, false);
  assert.equal(l['FDV-101'].texto, 'AVANCE'); assert.equal(l['P-101'].activo, true);
  assert.equal(l['F-201'].texto, 'OK');
  prod.averias.inyectar('AV-FUSIBLE-F201');
  for (let i = 0; i < 20; i++) prod.paso(0.5);
  l = visor.lecturasHtst(prod.estado()).sensores;
  assert.equal(l['F-201'].texto, 'FUNDIDO'); assert.equal(l['F-201'].alarma, true);
  assert.match(l['TT-101'].texto, /ABIERTO/);                                           // sin los 24 V todos los lazos caen
  assert.deepEqual(visor.lecturasHtst(null).sensores, {});
});

test('visor 3D: solo llevan etiqueta los equipos principales (los tubos y el resto, no)', () => {
  assert.equal(visor.sinEtiqueta('TUBO_CRUDO'), true);
  assert.equal(visor.sinEtiqueta('KM-102'), true);
  for (const tag of ['TT-103', 'FDV-101', 'P-101', 'HX-101', 'TK-101']) assert.equal(visor.sinEtiqueta(tag), false, tag);
  for (const tag of visor.CON_ETIQUETA) assert.ok(layout.equipo(tag), tag);
});

test('adaptar la escena: si el diseñador ya ofrece crearEscena se usa tal cual', () => {
  const modulo = { crearEscena() {} };
  assert.equal(visor.adaptarEscena(modulo), modulo);
  assert.equal(typeof visor.adaptarEscena({ crear() {} }).crearEscena, 'function');
});

test('ayuda: el tag del equipo se saca del elemento pulsado o de sus padres', () => {
  const raiz = { dataset: {}, parentNode: null };
  const g = { dataset: { tag: 'P-101' }, parentNode: raiz }, hijo = { dataset: {}, parentNode: g };
  assert.equal(ayuda.tagDelElemento(hijo, raiz), 'P-101');
  assert.equal(ayuda.tagDelElemento({ dataset: {}, parentNode: raiz }, raiz), null);
});

test('esquema: los 5 equipos nuevos están, y el svg ya no es role=img (los equipos se pueden tabular)', () => {
  const tags = esquema.tagsDelEsquema();
  for (const tag of ['XV-101', 'XV-102', 'XV-302', 'XV-303', 'LSL-301']) assert.ok(tags.has(tag), tag);
  assert.equal(esquema.ESQUEMA_HTST[1].role, 'group');
  assert.match(esquema.ESQUEMA_HTST[1].viewBox, /^0 0 1600 800$/);
  const grupos = [];
  (function r(nodo) { if (!Array.isArray(nodo)) return; const a = nodo[1] && typeof nodo[1] === 'object' && !Array.isArray(nodo[1]) ? nodo[1] : null; if (a && a['data-tag']) grupos.push(a); nodo.forEach(r); })(esquema.ESQUEMA_HTST);
  assert.ok(grupos.length >= 47);
  assert.ok(grupos.every(a => a.tabindex === 0 && a.role === 'button' && a['aria-label']));
});

test('HW-101: bancos, potencia, nivel y bloqueo por nivel bajo salen del estado', () => {
  const sim = crearSimulacion({ semilla: 1 });
  let h = esquema.estadoCalentador(sim.estado());
  assert.equal(h.bancos, 0); assert.equal(h.potenciaKW, 0); assert.equal(h.sinNivel, false); assert.equal(h.textoNivel, 'NIVEL NORMAL');       // el depósito de agua solo tiene dos interruptores de nivel: bajo, normal o alto, sin porcentaje
  sim.ordenes.modo('MANUAL'); sim.ordenes.manual('P-102', 1); sim.ordenes.manual('KM-201', 1); sim.ordenes.manual('KM-202', 1);
  sim.paso(5);
  h = esquema.estadoCalentador(sim.estado());
  assert.equal(h.bancos, 2); assert.equal(h.potenciaKW, 60); assert.equal(h.textoBancos, '2/2 bancos · 60 kW');
  sim.ordenes.manual('XV-303', 1); sim.paso(600);                                         // se vacía el depósito: LSL-301 abre y los bancos se cortan
  h = esquema.estadoCalentador(sim.estado());
  assert.equal(h.sinNivel, true); assert.equal(h.bancos, 0);
});

test('LEDs del armario: tres estados (apagado, activo, fallo) y agrupados por función', () => {
  const sim = crearSimulacion({ semilla: 1 }); sim.paso(1);
  assert.equal(esquema.estadoLed(sim.estado(), 'PS-001'), 'activo');
  assert.equal(esquema.estadoLed(sim.estado(), 'KM-201'), 'apagado');
  sim.averias.inyectar('AV-FUSIBLE-F201'); sim.paso(5);
  assert.equal(esquema.estadoLed(sim.estado(), 'F-201'), 'fallo');
  const enGrupos = esquema.GRUPOS_LEDS.flatMap(g => g.tags);
  assert.deepEqual([...enGrupos].sort(), esquema.LEDS.map(l => l[0]).sort());
});

test('etiqueta accesible de cada equipo: «TAG, valor, estado»', () => {
  const prod = produciendo();
  assert.match(esquema.etiquetaAria(prod.estado(), 'TT-103'), /^TT-103, 7\d,\d °C, normal$/);
  assert.match(esquema.etiquetaAria(prod.estado(), 'FDV-101'), /^FDV-101, en avance$/);
  assert.match(esquema.etiquetaAria(prod.estado(), 'P-101'), /^P-101, en marcha$/);
  assert.match(esquema.etiquetaAria(prod.estado(), 'HW-101'), /bancos conectados/);
  prod.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-102' }); prod.paso(1);
  assert.match(esquema.etiquetaAria(prod.estado(), 'TT-102'), /^TT-102, fallo ABIERTO/);
});

/* --- criterio de aceptación 1: ningún texto se solapa con otro texto ni con un símbolo (estimación sobre la especificación del esquema) --- */
// nivel 1: solo lo que se ve en ese nivel (sin data-n) y los textos con su nombre sencillo (data-t1, varias líneas separadas por «|»); en los demás, sin lo marcado data-solo-n1.
function cajasDelEsquema(peorCaso = {}, nivel = 3) {
  const cajas = [];
  const numeros = d => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  (function recorrer(nodo, padre) {
    if (!Array.isArray(nodo)) return;
    const a = nodo[1] && typeof nodo[1] === 'object' && !Array.isArray(nodo[1]) ? nodo[1] : {};
    const tag = nodo[0], clase = a.class || '';
    if (nivel === 1 && a['data-n']) return;                 // oculto en el nivel 1 (también todo lo que contiene)
    if (nivel !== 1 && a['data-solo-n1']) return;           // solo del nivel 1
    if (tag === 'text') {
      const original = (a.id && peorCaso[a.id]) || nodo.slice(2).filter(x => typeof x === 'string').join('');
      const lineas = (nivel === 1 && a['data-t1'] ? a['data-t1'] : original).split('|');
      const ancho = /ht-valor/.test(clase) ? 8.0 : /ht-fuerte/.test(clase) ? 7.4 : 6.9, px = /ht-valor/.test(clase) ? 14 : 12;
      const estilo = a.style || '', xBase = nivel === 1 && a['data-x1'] !== undefined ? a['data-x1'] : a.x, yBase = nivel === 1 && a['data-y1'] !== undefined ? a['data-y1'] : a.y;
      lineas.forEach((texto, i) => {
        const w = texto.length * ancho * (px / 12) * 0.95, y = yBase + i * 13;
        const x0 = /text-anchor:start/.test(estilo) ? xBase : /text-anchor:end/.test(estilo) ? xBase - w : xBase - w / 2;
        cajas.push({ tipo: 'texto', texto, x0, x1: x0 + w, y0: y - px * 0.78, y1: y + px * 0.22, id: a.id, grupo: padre });
      });
    } else if (tag === 'circle' && /instr/.test(clase)) cajas.push({ tipo: 'simbolo', texto: clase, x0: a.cx - a.r, x1: a.cx + a.r, y0: a.cy - a.r, y1: a.cy + a.r, grupo: padre });
    else if (tag === 'rect' && /manual/.test(clase)) cajas.push({ tipo: 'simbolo', texto: clase, x0: a.x, x1: a.x + a.width, y0: a.y, y1: a.y + a.height, grupo: padre });
    else if (tag === 'path' && /valvula|resis/.test(clase) && a.d) { const n = numeros(a.d), xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1); cajas.push({ tipo: 'simbolo', texto: clase, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), grupo: padre }); }
    const g = a['data-tag'] || padre;
    nodo.forEach(h => recorrer(h, g));
  })(esquema.ESQUEMA_HTST, null);
  return cajas;
}
const chocan = (p, q, margen = 1) => p.x0 < q.x1 - margen && q.x0 < p.x1 - margen && p.y0 < q.y1 - margen && q.y0 < p.y1 - margen;

test('esquema: ningún texto se solapa con otro texto ni con un símbolo (instrumento, válvula, filtro, resistencia)', () => {
  const cajas = cajasDelEsquema(), textos = cajas.filter(c => c.tipo === 'texto'), simbolos = cajas.filter(c => c.tipo === 'simbolo');
  const choques = [];
  for (let i = 0; i < textos.length; i++) {
    for (let j = i + 1; j < textos.length; j++) {
      const alternos = ['v-HW-bancos', 't-banner-HW'];                                            // ocupan el mismo sitio a propósito: solo se ve uno
      if (alternos.includes(textos[i].id) && alternos.includes(textos[j].id)) continue;
      if (chocan(textos[i], textos[j])) choques.push(`«${textos[i].texto}» × «${textos[j].texto}»`);
    }
    for (const s of simbolos) {
      // un texto dentro de su propio símbolo (letras de la burbuja) no cuenta como solape; los demás, sí
      const dentro = s.grupo && textos[i].grupo === s.grupo && s.x0 <= textos[i].x0 + 1 && s.x1 >= textos[i].x1 - 1 && s.y0 <= textos[i].y0 + 2 && s.y1 >= textos[i].y1 - 2;
      if (!dentro && chocan(textos[i], s)) choques.push(`«${textos[i].texto}» × símbolo ${s.texto}`);
    }
  }
  assert.deepEqual(choques, []);
});

test('esquema: textos de al menos 12 px y valores de 14 px (clases ht-*), sin las clases pequeñas antiguas', () => {
  const clases = new Set();
  (function r(n) { if (!Array.isArray(n)) return; const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : {}; if (n[0] === 'text') clases.add(a.class || ''); if (a.style && /font-size/.test(a.style)) clases.add('FUENTE-EN-LINEA'); n.forEach(r); })(esquema.ESQUEMA_HTST);
  for (const c of clases) assert.ok(/ht-(tag|valor|zona)/.test(c), `clase de texto inesperada: «${c}»`);
});

test('página: chips de la barra (FDV en desvío es el estado seguro) y descripción de cada modo', () => {
  const sim = crearSimulacion({ semilla: 1 });
  const chips = pagina.datosChips(sim.estado()), por = id => chips.find(c => c.id === id);
  assert.deepEqual(chips.map(c => c.id), ['reloj', 'modo', 'tt103', 'caudal', 'fdv']);
  assert.equal(por('modo').valor, 'Parada'); assert.equal(por('fdv').valor, 'DESVÍO'); assert.equal(por('fdv').clase, 'chip-seguro');
  for (const modo of layout.MODOS) assert.match(pagina.descripcionModo(modo), /El PLC automatiza:/);
  assert.match(pagina.descripcionModo('MANUAL'), /manda cada actuador/);
  assert.deepEqual(Object.keys(pagina.nombresModo()), layout.MODOS);
});

test('esquema: tampoco se solapa nada con las lecturas más largas posibles (2000 L/h, 100,0 °C o «⚠ FALLO»)', () => {
  const peor = {};
  for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) peor[`v-${s.tag}`] = s.unidad === 'L/h' ? '2000 L/h' : '99,9 ' + s.unidad;
  const sinFallo = cajasDelEsquema(peor), conFallo = cajasDelEsquema(Object.fromEntries(Object.keys(peor).map(k => [k, '⚠ FALLO'])));
  for (const cajas of [sinFallo, conFallo]) {
    const textos = cajas.filter(c => c.tipo === 'texto'), simbolos = cajas.filter(c => c.tipo === 'simbolo'), choques = [];
    for (let i = 0; i < textos.length; i++) {
      for (let j = i + 1; j < textos.length; j++) { const alt = ['v-HW-bancos', 't-banner-HW']; if (alt.includes(textos[i].id) && alt.includes(textos[j].id)) continue; if (chocan(textos[i], textos[j])) choques.push(`«${textos[i].texto}» × «${textos[j].texto}»`); }
      for (const s of simbolos) { const dentro = s.grupo && textos[i].grupo === s.grupo && s.x0 <= textos[i].x0 + 1 && s.x1 >= textos[i].x1 - 1 && s.y0 <= textos[i].y0 + 2 && s.y1 >= textos[i].y1 - 2; if (!dentro && chocan(textos[i], s)) choques.push(`«${textos[i].texto}» × ${s.texto}`); }
    }
    assert.deepEqual(choques, []);
  }
});

test('rebosadero: el aviso derivado aparece con TK-101 desbordando, conserva su hora y se retira al cerrar XV-101', () => {
  const memoria = new Map();
  const estado = tiempoS => ({ tiempoS, alarmas: [], equipos: { 'TK-101': { desbordando: true } } });
  const a = pagina.alarmasDerivadas(estado(100), memoria);
  assert.equal(a.length, 1);
  assert.equal(a[0].codigo, 'R010'); assert.equal(a[0].nivel, 'aviso'); assert.equal(a[0].desdeS, 100);
  assert.equal(pagina.alarmasDerivadas(estado(130), memoria)[0].desdeS, 100);              // la hora de inicio no cambia en cada refresco
  assert.equal(pagina.alarmasDerivadas({ tiempoS: 140, alarmas: [], equipos: { 'TK-101': { desbordando: false } } }, memoria).length, 0);
  assert.equal(memoria.size, 0);
  assert.equal(pagina.listaAlarmas(estado(100), new Map())[0].codigo, 'R010');            // y entra en la lista y en la franja como cualquier otra
});

/* --- niveles: el nivel 1 no solapa nada con sus nombres sencillos y las tarjetas de valores (también con los valores más largos posibles) --- */
test('esquema nivel 1: nombres sencillos y tarjetas de valores sin solapes, incluso con los textos más largos', () => {
  const peor = { 'n1-temp-linea': 'Temperatura al salir del tubo: 100,0 °C', 'n1-caudal-linea': 'Caudal de leche: 2000 litros por hora', 'n1-nivel-linea': 'Tanque de leche: 100 % lleno',
    'n1-temp-estado': '⚠ Atención: aún no llega a 72 °C', 'n1-caudal-estado': '⚠ Atención: no circula leche', 'n1-nivel-estado': '⚠ Atención: casi vacío',
    't-FDV-estado': 'Deja pasar la leche', 'v-HW-nivel': 'Nivel 100 %', 'v-HW-bancos': '2 de 2 resistencias', 'v-LT-101': '100,0 %' };
  const cajas = cajasDelEsquema(peor, 1), textos = cajas.filter(c => c.tipo === 'texto'), simbolos = cajas.filter(c => c.tipo === 'simbolo'), choques = [];
  assert.ok(textos.some(x => x.texto === 'Tanque') && textos.some(x => x.texto === 'Tubo de residencia') && textos.some(x => x.texto === 'Válvula de desvío'), 'nombres sencillos');
  for (let i = 0; i < textos.length; i++) {
    for (let j = i + 1; j < textos.length; j++) {
      const alt = ['v-HW-bancos', 't-banner-HW']; if (alt.includes(textos[i].id) && alt.includes(textos[j].id)) continue;
      if (chocan(textos[i], textos[j])) choques.push(`«${textos[i].texto}» × «${textos[j].texto}»`);
    }
    for (const s of simbolos) {
      const dentro = s.grupo && textos[i].grupo === s.grupo && s.x0 <= textos[i].x0 + 1 && s.x1 >= textos[i].x1 - 1 && s.y0 <= textos[i].y0 + 2 && s.y1 >= textos[i].y1 - 2;
      if (!dentro && chocan(textos[i], s)) choques.push(`«${textos[i].texto}» × símbolo ${s.texto}`);
    }
  }
  assert.deepEqual(choques, []);
});
