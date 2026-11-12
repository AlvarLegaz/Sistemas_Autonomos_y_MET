// Utilidades comunes de las pruebas de los diagramas (unifilar y cableado): estados de ejemplo con la forma del contrato y medición de cajas para detectar solapes.
const unifilar = require('../js/scada2d/diagrama_unifilar.js');

const clon = o => JSON.parse(JSON.stringify(o));
const base = () => unifilar.estadoEjemplo();
function conProt(tag, estado) { const e = base(); e.protecciones[tag] = { estado, causa: 'prueba' }; return e; }
function noche() {
  const e = base(); e.reloj.esDia = false; e.reloj.texto = '21 jun · 02:00';
  for (const k of ['A', 'B']) { const c = e.campos[k]; c.p = 0; c.v = 0; c.i = 0; for (const s of c.cadenas) { s.v = 0; s.i = 0; s.p = 0; s.voc = 0; s.vmpp = 0; s.impp = 0; for (const p of s.paneles) { p.p = 0; p.v = 0; } } }
  Object.assign(e.inversores['INV-101'], { estado: 'ESPERA', pvV: 0, pvI: 0, pvP: 0, bateriaP: -300, redP: 0, cargaP: 300 });
  Object.assign(e.inversores['INV-201'], { estado: 'APAGADO', acP: 0, vertidoP: 0, mppt: [{ v: 0, i: 0, p: 0, activo: false }, { v: 0, i: 0, p: 0, activo: false }] });
  e.red.p = 300; return e;
}
function redCaida() { const e = base(); e.red.disponible = false; e.red.v = 0; e.red.f = 0; e.inversores['INV-201'].estado = 'ESPERA_RED'; e.inversores['INV-201'].acP = 0; e.cargas['LOAD-301'].w = 0; return e; }
function cadenaAbierta(id) { const e = base(); for (const k of ['A', 'B']) for (const c of e.campos[k].cadenas) if (c.id === id) { c.abierta = true; c.i = 0; c.p = 0; c.v = c.voc; } return e; }
function extremos() {   // textos lo más largos posible
  const e = base();
  Object.assign(e.inversores['INV-101'], { estado: 'REDUCIDO', modo: 'BATERIA_PRIMERO', pvP: 2999, pvV: 144.9, bateriaP: -2999, redP: -2999, cargaP: 2999, temperaturaC: 99.9, alarma: 'Sobretemperatura interna', eficiencia: 0.99 });
  Object.assign(e.inversores['INV-201'], { estado: 'ESPERA_AISLAMIENTO', acP: 2999, acV: 253.4, acF: 50.05, vertidoP: -2999, temperaturaC: 99.9, aislamientoMohm: 99.9 });
  e.inversores['INV-201'].mppt = [{ v: 449.9, i: 12.9, p: 2999, activo: true }, { v: 449.9, i: 12.9, p: 2999, activo: true }];
  Object.assign(e.bateria, { soc01: 1, v: 29.2, i: -100, p: -2920, temperaturaC: 45, bms: 'CORTE_CORRIENTE' });
  e.red.v = 253.4; e.red.f = 50.05; e.red.p = -2999; e.cargas['LOAD-301'] = { w: 2999, manual: true }; e.cargas['LOAD-302'] = { w: 2999, manual: true, alimentada: true };
  for (const k of ['A', 'B']) for (const c of e.campos[k].cadenas) { c.v = 148.8; c.i = 13.5; c.p = 2009; c.abierta = true; }
  return e;
}
/** Estados REALES del modelo (js/modelo/simulacion.js) con cada avería activada, si el modelo está disponible; si no, lista vacía. */
function reales(horas = [9, 14, 23]) {
  let crear; try { crear = require('../js/modelo/simulacion.js').crearSimulacion; } catch (error) { return []; }
  if (!crear) return [];
  const layout = require('../js/layout.js'), salida = [];
  for (const id of [null, ...layout.AVERIAS.map(a => a.id)]) for (const h of horas) {
    const sim = crear({ semilla: 7, diaAnio: 172, horaSolar: h, nubosidad: 0.1 });
    if (id) sim.ordenes.averias.activar(id);
    for (let i = 0; i < 120; i++) sim.paso(5);
    salida.push({ id, hora: h, estado: clon(sim.estado) });
  }
  return salida;
}
const escenarios = () => [base(), noche(), redCaida(), cadenaAbierta('STR-101'), cadenaAbierta('STR-201'), extremos(),
  ...['CERRADO', 'ABIERTO', 'DISPARADO', 'FUNDIDO', 'AGOTADO'].flatMap(s => Object.keys(base().protecciones).map(t => conProt(t, s))), ...reales([12, 23]).map(r => r.estado)];

/* ---------- cajas de los textos y símbolos de un esquema (para detectar solapes y salidas del viewBox) ---------- */
const PX = { 'dg-t': 15, 'dg-f': 15, 'dg-v': 18, 'dg-z': 15, 'dg-g': 19 };
const ANCHO_CAR = { 'dg-t': 0.57, 'dg-f': 0.64, 'dg-v': 0.64, 'dg-z': 0.69, 'dg-g': 0.64 };
function cajas(esquema, calcular, estados) {
  const peor = {};
  for (const e of estados.concat([null])) for (const [id, v] of Object.entries(calcular(e))) if (v.t !== undefined && (!peor[id] || v.t.length > peor[id].length)) peor[id] = v.t;
  const salida = [];
  (function r(n, padre) {
    if (!Array.isArray(n)) return;
    const a = n[1] && typeof n[1] === 'object' && !Array.isArray(n[1]) ? n[1] : {}, clase = a.class || '';
    if (n[0] === 'text') {
      const original = a.id && peor[a.id] !== undefined ? peor[a.id] : n.slice(2).filter(x => typeof x === 'string').join('');
      const k = Object.keys(PX).find(c => clase.split(' ').includes(c)), px = PX[k], w = original.length * ANCHO_CAR[k] * px;
      const x0 = a['text-anchor'] === 'start' ? a.x : a['text-anchor'] === 'end' ? a.x - w : a.x - w / 2;
      salida.push({ tipo: 'texto', texto: original, x0, x1: x0 + w, y0: a.y - px * 0.78, y1: a.y + px * 0.22 });
    } else if (n[0] === 'rect' && /\bdg-sim\b/.test(clase)) salida.push({ tipo: 'simbolo', texto: `${clase} ${a.id || ''}`, x0: a.x, x1: a.x + a.width, y0: a.y, y1: a.y + a.height });
    else if (n[0] === 'circle' && /\bdg-sim\b/.test(clase)) salida.push({ tipo: 'simbolo', texto: clase, x0: a.cx - a.r, x1: a.cx + a.r, y0: a.cy - a.r, y1: a.cy + a.r });
    n.forEach(h => r(h, a['data-tag'] || padre));
  })(esquema, null);
  return salida;
}
const chocan = (p, q, m = 1) => p.x0 < q.x1 - m && q.x0 < p.x1 - m && p.y0 < q.y1 - m && q.y0 < p.y1 - m;
function solapes(esquema, calcular, estados) {
  const todo = cajas(esquema, calcular, estados), textos = todo.filter(c => c.tipo === 'texto'), simbolos = todo.filter(c => c.tipo === 'simbolo'), choques = [];
  for (let i = 0; i < textos.length; i++) {
    for (let j = i + 1; j < textos.length; j++) if (chocan(textos[i], textos[j])) choques.push(`«${textos[i].texto}» × «${textos[j].texto}»`);
    for (const s of simbolos) {
      const dentro = s.x0 <= textos[i].x0 + 1 && s.x1 >= textos[i].x1 - 1 && s.y0 <= textos[i].y0 + 2 && s.y1 >= textos[i].y1 - 2;
      if (!dentro && chocan(textos[i], s)) choques.push(`«${textos[i].texto}» × ${s.texto}`);
    }
  }
  return { choques, todo };
}
/** Lienzo falso: un nodo por cada id y por cada grupo con data-tag, con setAttribute/getAttribute. */
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

module.exports = { reales, clon, base, conProt, noche, redCaida, cadenaAbierta, extremos, escenarios, cajas, solapes, lienzoFalso };
