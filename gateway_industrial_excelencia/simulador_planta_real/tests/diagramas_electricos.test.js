// Diagramas eléctricos Fuerza y Mando: tags reales, sin solapes ni elementos fuera del viewBox, y estado en vivo coherente con la simulación.
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../js/layout.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');
const fuerza = require('../js/scada2d/diagrama_fuerza.js');
const mando = require('../js/scada2d/diagrama_mando.js');

const DIAGRAMAS = { fuerza, mando };
const modelo = { fuerza: fuerza.calcularFuerza, mando: mando.calcularMando };

/* ---------- estados de ejemplo ---------- */
function produciendo() { const s = crearSimulacion(); s.ordenes.arrancar(); s.paso(20); return s; }
function conSeta() { const s = produciendo(); s.ordenes.paroEmergencia(true); s.paso(2); return s; }
function conFusible() { const s = produciendo(); s.averias.inyectar('AV-FUSIBLE-F201'); s.paso(2); return s; }
function conMagneto() { const s = produciendo(); s.estado().equipos['QF-102'].armado = false; s.paso(1); return s; }
function conVariadorEnFallo() { const s = produciendo(); s.estado().equipos['P-101'].temperaturaDisipadorC = 200; s.paso(1); return s; }
const todos = () => [crearSimulacion(), produciendo(), conSeta(), conFusible(), conMagneto(), conVariadorEnFallo()].map(s => s.estado());

/* ---------- tags e ids ---------- */
for (const [nombre, d] of Object.entries(DIAGRAMAS)) {
  test(`${nombre}: cada tag dibujado existe en layout.js y hay equipos dibujados`, () => {
    const tags = [...d.tagsDelEsquema()];
    assert.ok(tags.length >= 10, `solo ${tags.length} equipos`);
    for (const t of tags) assert.ok(layout.equipo(t), `${t} no está en layout.js`);
  });
  test(`${nombre}: VIEWBOX, ESQUEMA y crearObjetos exportados`, () => {
    assert.match(d.VIEWBOX, /^0 0 \d+ \d+$/);
    assert.equal(d.ESQUEMA[0], 'svg');
    assert.equal(typeof d.crearObjetos, 'function');
    assert.equal(d.ESQUEMA[1].viewBox, d.VIEWBOX);
  });
  test(`${nombre}: cada elemento del modelo tiene su id en el dibujo y al revés`, () => {
    const ids = fuerza.comun.idsDe(d.ESQUEMA), claves = new Set();
    for (const e of todos().concat([null])) Object.keys(modelo[nombre](e)).forEach(k => claves.add(k));
    for (const k of claves) assert.ok(ids.has(k), `el modelo da «${k}» y el dibujo no lo tiene`);
    const vivos = new Set();
    (function r(n) { if (!Array.isArray(n)) return; const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null; if (a && a['data-e'] && a.id) vivos.add(a.id); n.forEach(r); })(d.ESQUEMA);
    for (const id of vivos) assert.ok(claves.has(id), `el dibujo tiene «${id}» con estado y el modelo no lo calcula`);
  });
  test(`${nombre}: ids únicos y cada equipo es un grupo accesible`, () => {
    const vistos = new Set();
    (function r(n) {
      if (!Array.isArray(n)) return;
      const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : null;
      n.slice(a ? 2 : 1).forEach(h => assert.ok(typeof h === 'string' || Array.isArray(h), `hijo inválido en <${n[0]}>`));
      if (a && a.id) { assert.ok(!vistos.has(a.id), `id repetido ${a.id}`); vistos.add(a.id); }
      if (a && a['data-tag']) { assert.equal(n[0], 'g'); assert.equal(a.tabindex, 0); assert.equal(a.role, 'button'); assert.ok(a['aria-label']); }
      n.forEach(r);
    })(d.ESQUEMA);
  });
}
test('Mando: las direcciones DI/DO/AO dibujadas son las de layout.js', () => {
  const textos = [];
  (function r(n) { if (!Array.isArray(n)) return; if (n[0] === 'text') textos.push(n[2]); n.forEach(r); })(mando.ESQUEMA);
  for (const [tag] of mando.FILAS_DI) { const s = layout.senal(tag).find(x => x.tipo === 'DI'); assert.ok(s, tag); assert.ok(textos.includes(s.canal), `falta ${s.canal}`); }
  for (const f of mando.FILAS_DO) { const s = layout.senal(f.clave).find(x => x.tipo === f.tipo); assert.ok(s, f.clave); assert.ok(textos.includes(s.canal), `falta ${s.canal}`); }
  // no falta ninguna entrada ni salida del PLC (salvo las analógicas de instrumentos, que no son de mando)
  for (const s of layout.SENALES.filter(x => x.tipo === 'DI' || x.tipo === 'DO' || x.tipo === 'AO')) assert.ok(textos.includes(s.canal), `sin dibujar ${s.canal} (${s.tag})`);
});

/* ---------- geometría: sin solapes ni salidas del viewBox ---------- */
const PX = { 'dg-t': 15, 'dg-f': 15, 'dg-v': 16, 'dg-z': 15, 'dg-g': 19 };
const ANCHO_CAR = { 'dg-t': 0.57, 'dg-f': 0.64, 'dg-v': 0.64, 'dg-z': 0.64 + 0.05, 'dg-g': 0.64 };
function cajas(esquema, nombre) {
  const peor = {};   // texto más largo que toma cada texto dinámico en los estados de ejemplo
  for (const e of todos().concat([null])) for (const [id, v] of Object.entries(modelo[nombre](e))) if (v.t !== undefined && (!peor[id] || v.t.length > peor[id].length)) peor[id] = v.t;
  const salida = [], num = d => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  (function r(n, padre) {
    if (!Array.isArray(n)) return;
    const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : {};
    const clase = a.class || '';
    if (n[0] === 'text') {
      const original = (a.id && peor[a.id] !== undefined ? peor[a.id] : n.slice(2).filter(x => typeof x === 'string').join(''));
      const k = Object.keys(PX).find(c => clase.split(' ').includes(c)), px = PX[k], w = original.length * ANCHO_CAR[k] * px;
      const x0 = a['text-anchor'] === 'start' ? a.x : a['text-anchor'] === 'end' ? a.x - w : a.x - w / 2;
      salida.push({ tipo: 'texto', texto: original, x0, x1: x0 + w, y0: a.y - px * 0.78, y1: a.y + px * 0.22, grupo: padre });
    } else if (n[0] === 'rect' && /\bdg-sim\b/.test(clase)) salida.push({ tipo: 'simbolo', texto: clase + ' ' + (a.id || ''), x0: a.x, x1: a.x + a.width, y0: a.y, y1: a.y + a.height, grupo: padre });
    else if (n[0] === 'circle' && /\bdg-sim\b/.test(clase)) salida.push({ tipo: 'simbolo', texto: clase, x0: a.cx - a.r, x1: a.cx + a.r, y0: a.cy - a.r, y1: a.cy + a.r, grupo: padre });
    else if (n[0] === 'path' && a.d && /^M/.test(a.d)) { const v = num(a.d.split(/[lLhHvVzZ]/)[0]); if (v.length >= 2) salida.push({ tipo: 'punto', texto: a.d.slice(0, 20), x0: v[0], x1: v[0], y0: v[1], y1: v[1] }); }
    n.forEach(h => r(h, a['data-tag'] || padre));
  })(esquema, null);
  return salida;
}
const chocan = (p, q, m = 1) => p.x0 < q.x1 - m && q.x0 < p.x1 - m && p.y0 < q.y1 - m && q.y0 < p.y1 - m;

for (const [nombre, d] of Object.entries(DIAGRAMAS)) {
  test(`${nombre}: ningún texto se solapa con otro texto ni con un símbolo (con los textos más largos posibles)`, () => {
    const todo = cajas(d.ESQUEMA, nombre), textos = todo.filter(c => c.tipo === 'texto'), simbolos = todo.filter(c => c.tipo === 'simbolo'), choques = [];
    assert.ok(textos.length > 20 && simbolos.length > 7);
    for (let i = 0; i < textos.length; i++) {
      for (let j = i + 1; j < textos.length; j++) if (chocan(textos[i], textos[j])) choques.push(`«${textos[i].texto}» × «${textos[j].texto}»`);
      for (const s of simbolos) {
        const dentro = s.x0 <= textos[i].x0 + 1 && s.x1 >= textos[i].x1 - 1 && s.y0 <= textos[i].y0 + 2 && s.y1 >= textos[i].y1 - 2;   // texto entero dentro de su aparato
        if (!dentro && chocan(textos[i], s)) choques.push(`«${textos[i].texto}» × ${s.texto}`);
      }
    }
    assert.deepEqual(choques, []);
  });
  test(`${nombre}: todo cabe en el viewBox`, () => {
    const [, , W, H] = d.VIEWBOX.split(' ').map(Number), fuera = [];
    for (const c of cajas(d.ESQUEMA, nombre)) if (c.x0 < 0 || c.y0 < 0 || c.x1 > W || c.y1 > H) fuera.push(`${c.tipo} ${c.texto}`);
    assert.deepEqual(fuera, []);
  });
}

/* ---------- estado en vivo ---------- */
test('Fuerza con la planta arrancada: contactor cerrado, bomba en marcha, banco conectado y 24 V a mando', () => {
  const s = produciendo(), m = fuerza.calcularFuerza(s.estado());
  assert.equal(m['f-qf102'].e, 'cerrado'); assert.equal(m['f-qf102-t'].t, 'ARMADO');
  assert.equal(m['f-km102'].e, 'cerrado'); assert.equal(m['w-km102-out'].e, 'vivo'); assert.equal(m['f-p102'].e, 'marcha'); assert.match(m['f-p102-t'].t, /^EN MARCHA/);
  assert.equal(m['f-vfd'].e, 'marcha'); assert.equal(m['f-p101'].e, 'marcha'); assert.equal(m['w-vfd-out'].e, 'vivo');
  assert.ok(m['f-b1'].e === 'on' || m['f-b2'].e === 'on', 'algún banco del calentador conectado');
  const kw = (m['f-b1'].e === 'on' ? 30 : 0) + (m['f-b2'].e === 'on' ? 30 : 0);
  assert.match(m['f-hw-t'].t, new RegExp(`POTENCIA ${kw} kW`));
  assert.equal(m['f-f201'].e, 'ok'); assert.equal(m['f-24v'].e, 'vivo'); assert.match(m['f-24v-t'].t, /CON TENSIÓN/); assert.equal(m['f-ps'].e, 'ok');
});
test('Fuerza con la planta parada: contactores abiertos, motores parados, resistencias desconectadas y cables sin tensión aguas abajo', () => {
  const m = fuerza.calcularFuerza(crearSimulacion().estado());
  for (const k of ['km102', 'km201', 'km202']) { assert.equal(m[`f-${k}`].e, 'abierto'); assert.equal(m[`w-${k}-out`].e, 'muerto'); assert.equal(m[`f-${k}-t`].t, 'ABIERTO'); }
  assert.equal(m['f-p102'].e, 'parado'); assert.equal(m['f-p101'].e, 'parado'); assert.equal(m['f-b1'].e, 'off'); assert.equal(m['f-b1-t'].t, 'DESCONECTADO');
  assert.equal(m['w-bus'].e, 'vivo'); assert.equal(m['w-km102-in'].e, 'vivo');   // la barra y la derivación de QF-102 siguen con tensión
});
test('Fuerza con la seta pulsada: se abren los contactores (el relé abre las bobinas) pero la fuente de 24 V sigue', () => {
  const m = fuerza.calcularFuerza(conSeta().estado());
  assert.equal(m['f-km102'].e, 'abierto'); assert.equal(m['f-p102'].e, 'parado'); assert.equal(m['f-b1'].e, 'off'); assert.equal(m['f-b2'].e, 'off'); assert.equal(m['f-24v'].e, 'vivo');
});
test('Fuerza con el fusible F-201 fundido: fusible fundido y sin 24 V hacia el mando, con la potencia sin tocar', () => {
  const m = fuerza.calcularFuerza(conFusible().estado());
  assert.equal(m['f-f201'].e, 'fundido'); assert.equal(m['f-f201-t'].t, 'FUNDIDO'); assert.equal(m['w-24v'].e, 'muerto'); assert.match(m['f-24v-t'].t, /SIN TENSIÓN/);
  assert.equal(m['f-ps'].e, 'ok'); assert.equal(m['w-ps-out'].e, 'vivo'); assert.equal(m['w-bus'].e, 'vivo');   // la fuente da 24 V; se pierden después del fusible
});
test('Fuerza con QF-102 disparado: sin tensión aguas abajo de la protección', () => {
  const m = fuerza.calcularFuerza(conMagneto().estado());
  assert.equal(m['f-qf102'].e, 'disparado'); assert.equal(m['f-qf102-t'].t, 'DISPARADO'); assert.equal(m['w-sub'].e, 'muerto'); assert.equal(m['w-km201-in'].e, 'muerto');
  assert.equal(m['f-p102'].e, 'parado'); assert.equal(m['f-b1'].e, 'off');
});
test('Fuerza con el variador en fallo: VFD-101 en fallo y P-101 parada', () => {
  const m = fuerza.calcularFuerza(conVariadorEnFallo().estado());
  assert.equal(m['f-vfd'].e, 'fallo'); assert.match(m['f-vfd-t'].t, /FALLO/); assert.equal(m['f-p101'].e, 'parado'); assert.equal(m['w-vfd-out'].e, 'muerto');
});

test('Mando con la planta arrancada: bobinas con tensión, entradas a 1 y salidas activas', () => {
  const s = produciendo(), e = s.estado(), m = mando.calcularMando(e);
  assert.equal(m['m-bus'].e, 'vivo'); assert.equal(m['m-ps'].e, 'ok'); assert.equal(m['m-f201'].e, 'ok'); assert.equal(m['m-ks'].e, 'cerrado'); assert.match(m['m-ks-t'].t, /HABILITADAS/);
  assert.equal(m['m-c-ES-001'].e, 'cerrado'); assert.equal(m['m-v-ES-001'].e, 'uno'); assert.equal(m['m-vt-ES-001'].t, '1'); assert.equal(m['w-b-ES-001'].e, 'vivo');
  assert.equal(e.salidasPLC.DO['P-102'], 1);
  assert.equal(m['m-l-P-102'].e, 'energizada'); assert.equal(m['m-lt-P-102'].t, 'ENERGIZADA'); assert.equal(m['w-o-P-102'].e, 'vivo'); assert.equal(m['m-ovt-P-102'].t, '1');
  assert.equal(m['m-c-KM-102'].e, 'cerrado'); assert.equal(m['m-vt-KM-102'].t, '1');                       // contacto auxiliar de KM-102
  assert.equal(m['m-vfd'].e, 'marcha'); assert.equal(m['m-ov-P-101'].e, 'uno'); assert.match(m['m-ovt-VFD-101'].t, /^\d+ %$/); assert.notEqual(m['m-ovt-VFD-101'].t, '0 %');
  assert.equal(m['m-hmi'].e === 'alarma' || m['m-hmi'].e === 'normal', true); assert.match(m['m-plc-t'].t, /^PLC-001 · /);
});
test('Mando con la planta parada: bobinas de mando sin tensión y entradas de seguridad a 1', () => {
  const p = crearSimulacion(); p.paso(1); const m = mando.calcularMando(p.estado());
  assert.equal(m['m-l-P-102'].e, 'apagada'); assert.equal(m['m-lt-P-102'].t, 'SIN TENSIÓN'); assert.equal(m['m-l-KM-201'].e, 'apagada'); assert.equal(m['m-ov-P-102'].e, 'cero');
  assert.equal(m['m-vt-ES-001'].t, '1'); assert.equal(m['m-vt-PB-001'].t, '0'); assert.equal(m['m-c-PB-001'].e, 'abierto'); assert.equal(m['m-vfd'].e, 'parado');
});
test('Mando con la seta pulsada: contacto de la seta abierto, entrada a 0, relé KS abierto y bobinas sin tensión; la baliza sigue encendida', () => {
  const s = conSeta(), e = s.estado(), m = mando.calcularMando(e);
  assert.equal(m['m-c-ES-001'].e, 'disparado'); assert.equal(m['m-v-ES-001'].e, 'cero'); assert.equal(m['m-vt-ES-001'].t, '0'); assert.equal(m['w-b-ES-001'].e, 'muerto');
  assert.equal(m['m-ks'].e, 'disparado'); assert.match(m['m-ks-t'].t, /CORTADAS/); assert.equal(m['w-ks-out'].e, 'muerto');
  assert.equal(m['m-l-P-102'].e, 'apagada'); assert.equal(m['m-l-SV-101'].e, 'apagada'); assert.equal(m['m-vfd'].e, 'parado');
  assert.equal(m['m-bus'].e, 'vivo'); assert.equal(m['m-l-HL-001'].e, 'encendida'); assert.equal(m['m-lt-HL-001'].t, 'ENCENDIDA');
  assert.match(m['m-plc-t'].t, /PARO/); assert.match(m['m-plc-sub'].t, /ES-001/);
  assert.equal(m['m-c-KM-102'].e, 'abierto'); assert.equal(m['m-vt-KM-102'].t, '0');
});
test('Mando con el fusible F-201 fundido: sin 24 V, fusible fundido, todas las entradas a 0 aunque los contactos de campo sigan como estaban', () => {
  const e = conFusible().estado(), m = mando.calcularMando(e);
  assert.equal(m['m-f201'].e, 'fundido'); assert.equal(m['m-f201-t'].t, 'FUNDIDO'); assert.equal(m['m-bus'].e, 'muerto'); assert.equal(m['m-rail'].e, 'muerto'); assert.match(m['m-bus-t'].t, /SIN TENSIÓN/);
  for (const [tag] of mando.FILAS_DI) { assert.equal(m[`m-vt-${tag}`].t, '0', tag); assert.equal(m[`w-b-${tag}`].e, 'muerto', tag); }
  assert.equal(m['m-c-ES-001'].e, 'cerrado');                      // la seta no está pulsada: el contacto sigue cerrado, pero no llega tensión al PLC
  for (const f of mando.FILAS_DO) assert.equal(m[`w-o-${f.clave}`].e, 'muerto', f.clave);
  assert.equal(m['m-l-HL-001'].e, 'apagada'); assert.equal(m['m-ks'].e, 'disparado');
});
test('Mando: la fuente degradada (18 V) se ve ámbar con su tensión y el bus sigue con tensión baja', () => {
  const s = produciendo(); s.averias.inyectar('AV-FUENTE-24V'); s.paso(1);
  const m = mando.calcularMando(s.estado());
  assert.equal(m['m-ps'].e, 'degradada'); assert.match(m['m-ps-t'].t, /^18,0 V · BAJA/); assert.match(m['m-bus-t'].t, /BAJA/);
});
test('sin estado (null) o con campos que faltan no se rompe y todo queda «sin datos»', () => {
  for (const e of [null, undefined, {}, { equipos: {} }]) {
    assert.doesNotThrow(() => { fuerza.calcularFuerza(e); mando.calcularMando(e); fuerza.ariaFuerza(e); mando.ariaMando(e); });
  }
  const m = fuerza.calcularFuerza(null), n = mando.calcularMando(null);
  assert.equal(m['w-24v'].e, 'sd'); assert.equal(m['f-km102'].e, 'sd'); assert.equal(n['m-bus'].e, 'sd'); assert.equal(n['m-vt-ES-001'].t, '—');
});

/* ---------- objetos sobre un lienzo falso ---------- */
function lienzoFalso(esquema) {
  const nodos = {}, grupos = [];
  (function r(n) {
    if (!Array.isArray(n)) return;
    const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : {};
    const el = { attrs: Object.assign({}, a), textContent: '', setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; } };
    if (a.id) nodos[a.id] = el;
    if (a['data-tag']) grupos.push(el);
    n.forEach(r);
  })(esquema);
  return { nodos, grupos, buscar: id => nodos[id] || null, buscarTodos: sel => (sel === 'g[data-tag]' ? grupos : []) };
}
for (const [nombre, d] of Object.entries(DIAGRAMAS)) {
  test(`${nombre}: crearObjetos escribe el estado en los elementos y el aria-label de cada equipo`, () => {
    const lienzo = lienzoFalso(d.ESQUEMA), objetos = d.crearObjetos(lienzo);
    assert.ok(objetos.length >= 1 && typeof objetos[0].actualizar === 'function');
    const s = produciendo(); objetos.forEach(o => o.actualizar(s.estado()));
    const m = modelo[nombre](s.estado());
    for (const [id, v] of Object.entries(m)) { assert.equal(lienzo.nodos[id].getAttribute('data-e'), v.e, id); if (v.t !== undefined) assert.equal(lienzo.nodos[id].textContent, v.t, id); }
    for (const g of lienzo.grupos) assert.match(g.getAttribute('aria-label'), new RegExp(`^${g.getAttribute('data-tag')}`));
    // cambia al pasar a la seta pulsada
    const antes = JSON.stringify(Object.values(lienzo.nodos).map(n => n.attrs['data-e']));
    const p = conSeta(); objetos.forEach(o => o.actualizar(p.estado()));
    assert.notEqual(JSON.stringify(Object.values(lienzo.nodos).map(n => n.attrs['data-e'])), antes);
  });
}
test('Fuerza: las etiquetas accesibles dicen el estado', () => {
  const a = fuerza.ariaFuerza(conFusible().estado());
  assert.match(a['F-201'], /^F-201, fundido$/); assert.match(a['KM-102'], /^KM-102, contactor (abierto|cerrado)$/);
  assert.match(fuerza.ariaFuerza(produciendo().estado())['P-102'], /^P-102, en marcha/);
});
test('Mando: las etiquetas accesibles incluyen la dirección y el valor', () => {
  const a = mando.ariaMando(conSeta().estado());
  assert.match(a['ES-001'], /DI1\.01 = 0/); assert.match(a['ES-001'], /cortadas/); assert.match(a['KM-102'], /DI1\.09 = 0/); assert.match(a['KM-102'], /DO1\.02/);
});
