'use strict';
// Prueba de contrato GENÉRICA (comun/CONTRATO.md §10, criterios C1–C37). Recibe una fábrica `crearSimulacion` y usa SOLO la API pública
// del contrato: los datos concretos (órdenes válidas, puntos de medida, averías) salen de ordenesDisponibles(), puntos() y averias.catalogo().
//
//   const { probarContrato } = require('../../comun/tests/contrato.js');
//   probarContrato('fotovoltaica', crearSimulacion);          // registra con node:test un test por criterio («C7 …»)
//
// También exporta `criterios` y `comprobar(codigo, fabrica)` para ejecutar un criterio suelto (lo usa contrato_juguete.test.js para
// comprobar que cada prueba se pone en rojo cuando el criterio no se cumple).
// La escribe el agente de PRUEBAS a partir del contrato, sin mirar la implementación de los modelos.
const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const T = require('../tipos.js');

// ------------------------------------------------------------------ utilidades ----

const J = x => JSON.stringify(x);
const esObjetoPlano = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const clonar = o => (o === undefined ? undefined : JSON.parse(J(o)));

function recorrer(x, fn, ruta = '', vistos = new Set()) {
  fn(x, ruta);
  if (x && typeof x === 'object') {
    if (vistos.has(x)) return;
    vistos.add(x);
    for (const k of Object.keys(x)) recorrer(x[k], fn, ruta + '.' + k, vistos);
  }
}
function primeroNoCongelado(x) {
  let r = null;
  recorrer(x, (v, ruta) => { if (r === null && v && typeof v === 'object' && !Object.isFrozen(v)) r = ruta || '(raíz)'; });
  return r;
}
function primerNaN(x) {
  let r = null;
  recorrer(x, (v, ruta) => { if (r === null && typeof v === 'number' && Number.isNaN(v)) r = ruta || '(raíz)'; });
  return r;
}
function numerosDe(x) {
  const a = [];
  recorrer(x, (v, ruta) => { if (typeof v === 'number') a.push([ruta, v]); });
  return a;
}
function congelarProfundo(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) congelarProfundo(v); }
  return o;
}

/** Instantánea comparable de todo lo observable: estado, tiempo, registro y averías activas. */
const foto = sim => J({ estado: sim.estado(), tiempo: sim.tiempo(), registro: sim.registro(), activas: sim.averias.activas() });

function oyente(sim) {
  const eventos = [];
  const cancelar = sim.suscribir(e => eventos.push(e));
  return { eventos, cancelar };
}

function rechazado(r, motivo, que) {
  const d = `${que}: ${J(r)}`;
  assert.ok(r && typeof r === 'object', `${que}: el Resultado no es un objeto`);
  assert.equal(r.ok, false, d);
  assert.equal(r.motivo, motivo, d);
  assert.ok(T.MOTIVOS.includes(r.motivo), `${que}: motivo fuera de MOTIVOS`);
  assert.ok(typeof r.texto === 'string' && r.texto.trim() !== '', `${que}: falta el texto para el alumno (§2.0)`);
}
function aceptado(r, que) {
  assert.ok(r && typeof r === 'object' && r.ok === true, `${que}: se esperaba ok:true y llegó ${J(r)}`);
}

function avanzarLargo(sim, s) {
  while (s > 1e-12) {
    const d = Math.min(s, T.DT_MAX_S);
    aceptado(sim.avanzar(d), `avanzar(${d})`);
    s -= d;
  }
}
function avanzarPasosLargo(sim, n) {
  assert.ok(Number.isInteger(n) && n >= 0, `número de pasos imposible: ${n}`);
  while (n > 0) {
    const k = Math.min(n, T.PASOS_MAX_POR_LLAMADA);
    aceptado(sim.avanzarPasos(k), `avanzarPasos(${k})`);
    n -= k;
  }
}

/** Repetición de un registro (§3.3), escrita solo con la API pública. `alCrear(s)` se llama nada más crear (para suscribirse). */
function repetir(r, crear, alCrear) {
  const s = crear({ semilla: r.semilla, escenario: r.escenario });
  if (alCrear) alCrear(s);
  if (s.pasoFijoS !== r.pasoFijoS || s.id !== r.simulador || s.versionContrato !== r.versionContrato) throw new Error('registro_incompatible');
  for (const { paso, orden } of r.ordenes) {
    avanzarPasosLargo(s, paso - s.tiempo().pasos);
    const res = s.ejecutar(orden);
    if (!res || !res.ok) throw new Error('registro_inconsistente: ' + J(orden) + ' → ' + J(res));
  }
  avanzarPasosLargo(s, r.pasos - s.tiempo().pasos);
  return s;
}

/** Campo de la petición que lleva el punto, según el instrumento (§5.1). */
const campoPunto = instrumento => (instrumento === 'pinza' ? 'conductor' : (instrumento === 'multimetro' || instrumento === 'osciloscopio') ? 'a' : 'elemento');

function peticionDe(p, magnitud, puntos) {
  const q = { instrumento: p.instrumento, magnitud, [campoPunto(p.instrumento)]: p.id };
  if (p.instrumento === 'multimetro') {           // punta negra: otro punto del mismo grupo si lo hay (la HTST la ignora)
    const otros = puntos.filter(o => o.instrumento === 'multimetro' && o.id !== p.id);
    const b = otros.find(o => p.grupo !== undefined && o.grupo === p.grupo) || otros[0];
    if (b) q.b = b.id;
  }
  return q;
}
function muestra(lista, n) {
  if (lista.length <= n) return lista.slice();
  const r = [];
  for (let i = 0; i < n; i++) r.push(lista[Math.floor(i * lista.length / n)]);
  return r;
}

function ordenActivar(av, origen = 'profesor') {
  const parametros = {};
  for (const [k, e] of Object.entries(av.parametros || {})) parametros[k] = e.defecto;
  return { tipo: 'averias.activar', valores: Object.keys(parametros).length ? { id: av.id, parametros } : { id: av.id }, origen };
}

function enRango(v, r) {
  if (typeof v !== 'number' || Number.isNaN(v)) return false;
  if (r.min !== null && r.min !== undefined && !(v >= r.min)) return false;
  if (r.max !== null && r.max !== undefined && !(v <= r.max)) return false;
  return true;
}

const ORDEN_EN_PASO = { orden: 0, averia: 1, disparo: 2, alarma: 3 };

// --------------------------------------------------------------- contexto ----

function crearContexto(fabrica, opciones = {}) {
  const ctx = {
    fabrica, opciones,
    fresca(semilla = 7, escenario) { return fabrica(escenario === undefined ? { semilla } : { semilla, escenario }); },
  };
  let cacheEjemplos = null;
  /** Para cada DescripcionOrden: su ejemplo y si da ok:true en una simulación fresca. */
  ctx.ejemplos = () => {
    if (!cacheEjemplos) {
      cacheEjemplos = ctx.fresca().ordenesDisponibles().map(d => {
        const r = ctx.fresca().ejecutar(clonar(d.ejemplo));
        return { desc: d, ejemplo: d.ejemplo, ok: !!(r && r.ok) };
      });
    }
    return cacheEjemplos;
  };
  /** Ejemplos con ok:true en una fresca que no son averias.* (para sesiones de prueba). */
  ctx.ejemplosValidos = () => ctx.ejemplos().filter(e => e.ok && !e.desc.tipo.startsWith('averias.')).map(e => e.ejemplo);
  ctx.algunEjemploValido = () => {
    const l = ctx.ejemplos().filter(e => e.ok).map(e => e.ejemplo);
    assert.ok(l.length > 0, 'ningún ejemplo de ordenesDisponibles() da ok:true en una simulación fresca');
    return l;
  };
  /** Primera avería del catálogo que se activa con ok:true en una fresca (con sus parámetros por defecto). */
  ctx.averiaActivable = () => {
    const s = ctx.fresca();
    const cat = s.averias.catalogo();
    const sinParametros = cat.filter(a => !a.parametros || Object.keys(a.parametros).length === 0);
    for (const av of [...sinParametros, ...cat]) {
      const r = ctx.fresca().ejecutar(ordenActivar(av));
      if (r && r.ok) return av;
    }
    assert.fail('ninguna avería del catálogo se puede activar en una simulación fresca');
  };
  ctx.peticionValida = sim => {
    const ps = sim.puntos();
    assert.ok(ps.length > 0, 'puntos() vacía');
    return peticionDe(ps[0], ps[0].magnitudes[0], ps);
  };
  return ctx;
}

// -------------------------------------------------------------- criterios ----

const criterios = [];
const criterio = (codigo, titulo, fn) => criterios.push({ codigo, titulo, fn });

// ---- Forma

criterio('C1', 'id, versionContrato, pasoFijoS y métodos de §2', ctx => {
  const s = ctx.fresca();
  assert.ok(T.SIMULADORES.includes(s.id), `id «${s.id}» fuera de SIMULADORES`);
  if (ctx.opciones.id) assert.equal(s.id, ctx.opciones.id, 'id distinto del esperado para esta fábrica');
  assert.equal(s.versionContrato, 1);
  assert.equal(typeof s.pasoFijoS, 'number');
  assert.ok(s.pasoFijoS > 0, 'pasoFijoS > 0');
  assert.equal(s.pasoFijoS, T.PASO_FIJO_S[s.id], `pasoFijoS debe ser PASO_FIJO_S[${s.id}]`);
  for (const m of ['avanzar', 'avanzarPasos', 'tiempo', 'estado', 'ejecutar', 'ordenesDisponibles', 'puntos', 'medir', 'suscribir',
    'instantanea', 'restaurar', 'registro', 'reiniciar']) assert.equal(typeof s[m], 'function', `falta el método ${m}()`);
  assert.ok(s.averias && typeof s.averias === 'object', 'falta averias');
  assert.equal(typeof s.averias.catalogo, 'function', 'falta averias.catalogo()');
  assert.equal(typeof s.averias.activas, 'function', 'falta averias.activas()');
});

criterio('C2', 'fresca: tiempo a cero, registro vacío con la semilla y sin averías', ctx => {
  const s = ctx.fresca();
  assert.deepStrictEqual({ ...s.tiempo() }, { pasos: 0, tS: 0, restoS: 0 });
  const r = s.registro();
  assert.deepStrictEqual(r.ordenes, []);
  assert.equal(r.semilla, 7);
  assert.equal(r.simulador, s.id);
  assert.equal(r.versionContrato, 1);
  assert.equal(r.pasoFijoS, s.pasoFijoS);
  assert.equal(r.pasos, 0);
  assert.deepStrictEqual(s.averias.activas(), [], '§2.1: sin averías salvo las que active el escenario');
});

function escenarioBase(id) {
  return { simulador: id, versionContrato: 1, id: 'prueba_contrato', titulo: 'Escenario de la prueba de contrato', condiciones: {}, ordenesIniciales: [] };
}
function lanzaCon(fn, codigo, que) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof Error, `${que}: crearSimulacion debía lanzar un Error`);
  assert.equal(err.codigo, codigo, `${que}: codigo del Error`);
}

criterio('C3', 'crearSimulacion lanza Error con codigo ante opciones imposibles', ctx => {
  const id = ctx.fresca().id;
  for (const semilla of [1.5, 0, 'x', -3, 2 ** 32, NaN, undefined]) lanzaCon(() => ctx.fabrica({ semilla }), 'opciones_invalidas', `semilla ${String(semilla)}`);
  lanzaCon(() => ctx.fabrica(), 'opciones_invalidas', 'sin opciones');
  const base = escenarioBase(id);
  assert.doesNotThrow(() => ctx.fabrica({ semilla: 7, escenario: clonar(base) }), 'un escenario mínimo válido debe aceptarse');
  const otro = id === 'fotovoltaica' ? 'planta_real' : 'fotovoltaica';
  lanzaCon(() => ctx.fabrica({ semilla: 7, escenario: { ...clonar(base), simulador: otro } }), 'simulador_incompatible', 'escenario de otro simulador');
  lanzaCon(() => ctx.fabrica({ semilla: 7, escenario: { ...clonar(base), versionContrato: 2 } }), 'version_incompatible', 'escenario versión 2');
  lanzaCon(() => ctx.fabrica({ semilla: 7, escenario: { ...clonar(base), condiciones: { claveQueNoExiste: 1 } } }), 'escenario_invalido', 'condición desconocida');
  lanzaCon(() => ctx.fabrica({ semilla: 7, escenario: { ...clonar(base), ordenesIniciales: [{ tipo: 'orden.que.no.existe', origen: 'guion' }] } }),
    'escenario_invalido', 'orden inicial rechazada (§2.1)');
});

// ---- Tiempo y paso fijo

criterio('C4', 'avanzar con dt inválido o excesivo: rechazo sin cambios ni eventos', ctx => {
  const s = ctx.fresca();
  aceptado(s.avanzar(1.05), 'avanzar(1.05)');
  const casos = [[-1, 'dt_invalido'], [NaN, 'dt_invalido'], [Infinity, 'dt_invalido'], [-Infinity, 'dt_invalido'], ['1', 'dt_invalido'],
    [null, 'dt_invalido'], [undefined, 'dt_invalido'], [{}, 'dt_invalido'], [3600.5, 'dt_excesivo']];
  for (const [x, motivo] of casos) {
    const antes = foto(s);
    const { eventos, cancelar } = oyente(s);
    rechazado(s.avanzar(x), motivo, `avanzar(${String(x)})`);
    cancelar();
    assert.equal(foto(s), antes, `avanzar(${String(x)}) ha cambiado algo`);
    assert.equal(eventos.length, 0, `avanzar(${String(x)}) ha emitido eventos`);
  }
  const antes = foto(s);
  rechazado(s.avanzar(), 'dt_invalido', 'avanzar() sin argumento');
  assert.equal(foto(s), antes);
});

criterio('C5', 'avanzar(0) es un no-op', ctx => {
  const s = ctx.fresca();
  aceptado(s.avanzar(1.05), 'avanzar(1.05)');
  const antes = J({ t: s.tiempo(), e: s.estado() });
  const { eventos, cancelar } = oyente(s);
  const r = s.avanzar(0);
  cancelar();
  aceptado(r, 'avanzar(0)');
  assert.equal(r.datos && r.datos.pasos, 0, 'avanzar(0) → datos.pasos 0');
  assert.equal(J({ t: s.tiempo(), e: s.estado() }), antes);
  assert.equal(eventos.length, 0);
});

criterio('C6', 'avanzar(1): pasos = floor((1+EPS)/pasoFijoS), restoS = 1 − pasos×pasoFijoS; avanzar(pasoFijoS) = 1 paso', ctx => {
  const s = ctx.fresca();
  const n = Math.floor((1 + T.EPS_PASO_S) / s.pasoFijoS);       // 10 en la HTST (0,1 s), 0 en la FV (2 s)
  const r = s.avanzar(1);
  aceptado(r, 'avanzar(1)');
  assert.equal(r.datos && r.datos.pasos, n, 'datos.pasos');
  const t = s.tiempo();
  assert.equal(t.pasos, n, 'tiempo().pasos');
  assert.equal(t.tS, t.pasos * s.pasoFijoS, 'tS es el producto, no una suma');
  assert.ok(Math.abs(t.restoS - (1 - n * s.pasoFijoS)) < 1e-12, `restoS debe ser 1 − pasos×pasoFijoS (${1 - n * s.pasoFijoS}) y es ${t.restoS}`);
  assert.ok(t.restoS >= 0 && t.restoS < s.pasoFijoS, `restoS fuera de [0, pasoFijoS): ${t.restoS}`);
  // un paso fijo exacto en otra fresca, sea cual sea el paso (cubre la FV aunque avanzar(1) no dé pasos)
  const u = ctx.fresca();
  const r1 = u.avanzar(u.pasoFijoS);
  aceptado(r1, 'avanzar(pasoFijoS)');
  assert.equal(r1.datos && r1.datos.pasos, 1, 'avanzar(pasoFijoS) debe dar exactamente 1 paso');
  assert.equal(u.tiempo().pasos, 1);
  assert.equal(u.tiempo().restoS, 0, 'avanzar(pasoFijoS) no debe dejar resto');
  assert.equal(u.tiempo().tS, u.pasoFijoS);
});

function comparaTroceos(ctx, a, b, que) {
  const s1 = ctx.fresca(), s2 = ctx.fresca();
  for (const d of a) aceptado(s1.avanzar(d), `avanzar(${d})`);
  for (const d of b) aceptado(s2.avanzar(d), `avanzar(${d})`);
  assert.equal(s1.tiempo().pasos, s2.tiempo().pasos, `${que}: pasos`);
  assert.equal(J(s1.estado()), J(s2.estado()), `${que}: estado distinto (el modelo depende del troceo del tiempo)`);
}

criterio('C7', 'avanzar(0.1)×10 ≡ avanzar(1) ≡ avanzarPasos(floor(1/pasoFijoS)); avanzar(0.25)×40 ≡ avanzar(10); avanzar(7)+avanzar(3) ≡ avanzar(10)', ctx => {
  comparaTroceos(ctx, Array(10).fill(0.1), [1], 'avanzar(0.1)×10 frente a avanzar(1)');
  {
    const a = ctx.fresca(), b = ctx.fresca();
    for (let i = 0; i < 10; i++) aceptado(a.avanzar(0.1), 'avanzar(0.1)');
    aceptado(b.avanzarPasos(Math.floor(1 / b.pasoFijoS)), 'avanzarPasos(floor(1/pasoFijoS))');
    assert.equal(a.tiempo().pasos, b.tiempo().pasos, 'avanzar(0.1)×10 frente a avanzarPasos(floor(1/pasoFijoS)): pasos');
    assert.equal(J(a.estado()), J(b.estado()), 'avanzar(0.1)×10 frente a avanzarPasos(floor(1/pasoFijoS)): estado');
  }
  comparaTroceos(ctx, Array(40).fill(0.25), [10], 'avanzar(0.25)×40 frente a avanzar(10)');
  comparaTroceos(ctx, [7, 3], [10], 'avanzar(7)+avanzar(3) frente a avanzar(10)');
});

criterio('C8', 'avanzarPasos(10/pasoFijoS) ≡ avanzar(10); n inválido → pasos_invalidos', ctx => {
  const s1 = ctx.fresca(), s2 = ctx.fresca();
  const n = Math.round(10 / s1.pasoFijoS);
  aceptado(s1.avanzarPasos(n), `avanzarPasos(${n})`);
  aceptado(s2.avanzar(10), 'avanzar(10)');
  assert.equal(s1.tiempo().pasos, n);
  assert.equal(J(s1.estado()), J(s2.estado()));
  assert.equal(s1.tiempo().restoS, 0, 'avanzarPasos no toca restoS');
  for (const x of [-1, 1.5, T.PASOS_MAX_POR_LLAMADA + 1, NaN, '5', null, undefined, Infinity]) {
    const antes = foto(s1);
    const { eventos, cancelar } = oyente(s1);
    rechazado(s1.avanzarPasos(x), 'pasos_invalidos', `avanzarPasos(${String(x)})`);
    cancelar();
    assert.equal(foto(s1), antes, `avanzarPasos(${String(x)}) ha cambiado algo`);
    assert.equal(eventos.length, 0);
  }
  const antes = J(s1.estado());
  aceptado(s1.avanzarPasos(0), 'avanzarPasos(0)');
  assert.equal(J(s1.estado()), antes);
});

criterio('C9', 'determinismo: misma semilla y órdenes → mismo estado tras cada operación y mismos eventos', ctx => {
  const a = ctx.fresca(), b = ctx.fresca();
  const oa = oyente(a), ob = oyente(b);
  const ejemplos = ctx.ejemplos().map(e => e.ejemplo);
  assert.ok(ejemplos.length > 0);
  for (const ej of ejemplos) {
    assert.equal(J(a.ejecutar(clonar(ej))), J(b.ejecutar(clonar(ej))), `resultado de ${ej.tipo}`);
    assert.equal(J(a.estado()), J(b.estado()), `estado tras ${ej.tipo}`);
    aceptado(a.avanzar(5), 'avanzar(5)'); aceptado(b.avanzar(5), 'avanzar(5)');
    assert.equal(J(a.estado()), J(b.estado()), `estado tras avanzar(5) después de ${ej.tipo}`);
  }
  assert.ok(oa.eventos.length > 0, 'no se ha emitido ningún evento');
  assert.equal(J(oa.eventos), J(ob.eventos), 'secuencia de eventos distinta');
});

criterio('C10', 'la semilla cuenta: semillas 7 y 8 dan estados distintos tras avanzar(600)', ctx => {
  const a = ctx.fresca(7), b = ctx.fresca(8);
  const ruido = a.averias.catalogo().find(x => x.id === 'AV-RUIDO-4-20');
  if (ruido) for (const s of [a, b]) aceptado(s.ejecutar(ordenActivar(ruido)), 'activar AV-RUIDO-4-20');
  else if (a.id === 'planta_real') return { skip: 'el catálogo no tiene AV-RUIDO-4-20: C10 se da por cumplido con la FV' };
  avanzarLargo(a, 600); avanzarLargo(b, 600);
  const na = numerosDe(a.estado()), nb = numerosDe(b.estado());
  assert.notEqual(J(na), J(nb), 'el estado no depende de la semilla');
});

// ---- Estado

criterio('C11', 'estado() congelado en profundidad; mutarlo lanza en modo estricto y no cambia nada', ctx => {
  const s = ctx.fresca();
  aceptado(s.avanzar(2), 'avanzar(2)');
  const e = s.estado();
  assert.ok(e && typeof e === 'object', 'estado() no es un objeto');
  const antes = J(e);
  const suelto = primeroNoCongelado(e);
  assert.equal(suelto, null, `objeto sin congelar en estado${suelto}`);
  const claves = Object.keys(e);
  assert.ok(claves.length > 0, 'estado() vacío');
  assert.throws(() => { e[claves[0]] = 'mutado'; }, TypeError, 'asignar a una propiedad debe lanzar en modo estricto');
  assert.throws(() => { e.__propiedadNueva = 1; }, TypeError, 'añadir una propiedad debe lanzar en modo estricto');
  const anidado = Object.values(e).find(v => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length);
  if (anidado) assert.throws(() => { anidado[Object.keys(anidado)[0]] = 'mutado'; }, TypeError, 'objeto anidado mutable');
  assert.equal(J(s.estado()), antes);
});

criterio('C12', 'ningún número de estado() es NaN (fresca y tras avanzar(3600))', ctx => {
  const s = ctx.fresca();
  let n = primerNaN(s.estado());
  assert.equal(n, null, `NaN en estado${n} (fresca)`);
  avanzarLargo(s, 3600);
  n = primerNaN(s.estado());
  assert.equal(n, null, `NaN en estado${n} tras avanzar(3600)`);
});

criterio('C13', 'estado() sobrevive a JSON (sin ciclos ni BigInt)', ctx => {
  const s = ctx.fresca();
  assert.doesNotThrow(() => JSON.parse(J(s.estado())));
  aceptado(s.avanzar(30), 'avanzar(30)');
  assert.doesNotThrow(() => JSON.parse(J(s.estado())));
});

// ---- Órdenes

criterio('C14', 'ordenesDisponibles(): tipos únicos, comunes presentes, del simulador, con texto y ejemplo', ctx => {
  const s = ctx.fresca();
  const ds = s.ordenesDisponibles();
  assert.ok(Array.isArray(ds) && ds.length > 0, 'ordenesDisponibles() vacía');
  const tipos = ds.map(d => d.tipo);
  assert.equal(new Set(tipos).size, tipos.length, 'tipos repetidos');
  for (const c of T.ORDENES_COMUNES) assert.ok(tipos.includes(c), `falta la orden común ${c}`);
  const permitidos = new Set([...T.ORDENES_COMUNES, ...(T.ORDENES_POR_SIMULADOR[s.id] || [])]);
  for (const d of ds) {
    assert.ok(permitidos.has(d.tipo), `tipo ${d.tipo} fuera de ORDENES_COMUNES ∪ ORDENES_POR_SIMULADOR[${s.id}]`);
    assert.ok(typeof d.texto === 'string' && d.texto.trim(), `${d.tipo}: falta texto`);
    assert.ok(esObjetoPlano(d.ejemplo), `${d.tipo}: falta ejemplo`);
    assert.equal(d.ejemplo.tipo, d.tipo, `${d.tipo}: ejemplo.tipo`);
    assert.equal(d.ejemplo.origen, 'guion', `${d.tipo}: el ejemplo lleva origen 'guion' (§2.5)`);
    if (d.destinos !== undefined) assert.ok(Array.isArray(d.destinos) && d.destinos.every(x => typeof x === 'string'), `${d.tipo}: destinos`);
    if (d.valores !== undefined) assert.ok(esObjetoPlano(d.valores), `${d.tipo}: valores`);
  }
  assert.equal(J(s.ordenesDisponibles()), J(ds), 'la lista debe ser estática');
  if (s.id === 'planta_real') {
    // §4.3 (v1.1): controlTemperatura y llenarDepositos son órdenes PÚBLICAS de la planta real, con ejemplo ejecutable sin preparación (ok:true).
    for (const t of ['controlTemperatura', 'llenarDepositos']) {
      assert.ok((T.ORDENES_POR_SIMULADOR.planta_real || []).includes(t), `${t} debe estar en ORDENES_POR_SIMULADOR.planta_real`);
      const d = ds.find(x => x.tipo === t);
      assert.ok(d, `falta la orden pública ${t} en ordenesDisponibles() (§4.3)`);
      const r = ctx.fresca().ejecutar(clonar(d.ejemplo));
      assert.ok(r && r.ok === true, `el ejemplo de ${t} debe dar ok:true en una fresca (nunca no_permitida, §4.3): ${J(r)}`);
    }
  }
});

criterio('C15', 'cada ejemplo en una fresca da ok:true o no_permitida', ctx => {
  for (const d of ctx.fresca().ordenesDisponibles()) {
    const r = ctx.fresca().ejecutar(clonar(d.ejemplo));
    // v1.1 (§4.1, C35): el ejemplo de averias.quitar es una instancia bien formada y no activa → no_permitida (ya no se admite instancia_desconocida).
    assert.ok(r && (r.ok === true || (r.ok === false && r.motivo === 'no_permitida')), `ejemplo de ${d.tipo}: ${J(r)}`);
  }
});

function ordenRechazada(s, orden, motivo, que) {
  const antes = foto(s);
  const { eventos, cancelar } = oyente(s);
  const r = s.ejecutar(orden);
  cancelar();
  rechazado(r, motivo, que);
  assert.equal(foto(s), antes, `${que}: ha cambiado estado, tiempo, registro o averías`);
  assert.equal(eventos.length, 1, `${que}: se esperaba un único evento orden_rechazada y llegaron ${J(eventos.map(e => e.tipo))}`);
  assert.equal(eventos[0].tipo, 'orden_rechazada', que);
  assert.equal(eventos[0].resultado && eventos[0].resultado.motivo, motivo, `${que}: resultado del evento`);
}

criterio('C16', 'órdenes rechazadas: motivo correcto, sin cambios y un único evento orden_rechazada', ctx => {
  const s = ctx.fresca();
  aceptado(s.avanzar(1.05), 'avanzar(1.05)');
  const ej0 = ctx.algunEjemploValido()[0];
  aceptado(s.ejecutar(clonar(ej0)), `ejecutar ${ej0.tipo}`);
  ordenRechazada(s, null, 'orden_invalida', 'ejecutar(null)');
  ordenRechazada(s, { tipo: 'x' }, 'orden_invalida', "{ tipo:'x' } sin origen");
  ordenRechazada(s, { tipo: 'x', origen: 'hacker' }, 'orden_invalida', "origen 'hacker'");
  ordenRechazada(s, { ...clonar(ej0), valores: 'no es un objeto' }, 'orden_invalida', 'valores que no son objeto plano');
  ordenRechazada(s, { tipo: 'orden.que.no.existe', origen: 'guion' }, 'orden_desconocida', 'tipo inexistente');
  const ds = s.ordenesDisponibles();
  const conDestino = ds.find(d => Array.isArray(d.destinos) && d.destinos.length && d.ejemplo.destino !== undefined);
  if (conDestino) ordenRechazada(s, { ...clonar(conDestino.ejemplo), destino: 'NO-EXISTE' }, 'destino_desconocido', `${conDestino.tipo} con destino NO-EXISTE`);
  const sinDestino = ds.find(d => d.destinos === undefined);
  if (sinDestino) ordenRechazada(s, { ...clonar(sinDestino.ejemplo), destino: 'NO-EXISTE' }, 'destino_desconocido', `${sinDestino.tipo} (sin destinos) con destino`);
  const conValor = (pred) => {
    for (const d of ds) for (const [k, e] of Object.entries(d.valores || {})) if (pred(e, d, k)) return { d, k, e };
    return null;
  };
  const conValores = (d, k, v) => ({ ...clonar(d.ejemplo), valores: { ...(clonar(d.ejemplo.valores) || {}), [k]: v } });
  const num = conValor(e => (e.tipo === 'numero' || e.tipo === 'entero') && typeof e.max === 'number');
  if (num) {
    ordenRechazada(s, conValores(num.d, num.k, 1e9), 'valores_invalidos', `${num.d.tipo}.${num.k} = 1e9 (no se recorta en silencio)`);
    if (typeof num.e.min === 'number') ordenRechazada(s, conValores(num.d, num.k, -1e9), 'valores_invalidos', `${num.d.tipo}.${num.k} = -1e9`);
    ordenRechazada(s, conValores(num.d, num.k, String(num.e.max)), 'valores_invalidos', `${num.d.tipo}.${num.k} como texto`);
  }
  const ent = conValor(e => e.tipo === 'entero');
  if (ent) ordenRechazada(s, conValores(ent.d, ent.k, (typeof ent.e.min === 'number' ? ent.e.min : 0) + 0.5), 'valores_invalidos', `${ent.d.tipo}.${ent.k} no entero`);
  const opc = conValor(e => e.tipo === 'opcion' && Array.isArray(e.opciones));
  if (opc) ordenRechazada(s, conValores(opc.d, opc.k, 'NO_ES_UNA_OPCION_XYZ'), 'valores_invalidos', `${opc.d.tipo}.${opc.k} fuera de opciones`);
  const obl = conValor((e, d, k) => !e.opcional && d.ejemplo.valores && k in d.ejemplo.valores);
  if (obl) {
    const o = clonar(obl.d.ejemplo);
    delete o.valores[obl.k];
    ordenRechazada(s, o, 'valores_invalidos', `${obl.d.tipo} sin el valor obligatorio ${obl.k}`);
  }
});

criterio('C17', 'ejecutar acepta una orden congelada y no modifica la recibida', ctx => {
  const ej = ctx.algunEjemploValido()[0];
  const congelada = congelarProfundo(clonar(ej));
  let r;
  assert.doesNotThrow(() => { r = ctx.fresca().ejecutar(congelada); }, 'ejecutar ha lanzado con una orden congelada');
  aceptado(r, `ejecutar(${ej.tipo} congelada)`);
  assert.equal(J(congelada), J(ej));
  const suelta = clonar(ej);
  aceptado(ctx.fresca().ejecutar(suelta), `ejecutar(${ej.tipo})`);
  assert.deepStrictEqual(suelta, clonar(ej), 'ejecutar ha modificado la orden recibida');
});

criterio('C18', 'la orden aceptada queda en el registro con su paso y se emite el evento orden', ctx => {
  const s = ctx.fresca();
  aceptado(s.avanzar(2), 'avanzar(2)');
  const { eventos, cancelar } = oyente(s);
  let enviada = null, r = null;
  for (const ej of ctx.algunEjemploValido()) {
    enviada = clonar(ej);
    r = s.ejecutar(enviada);
    if (r.ok) break;
  }
  cancelar();
  aceptado(r, 'alguna orden de ejemplo tras avanzar(2)');
  const copia = clonar(enviada);
  const paso = s.tiempo().pasos;
  const ordenes = s.registro().ordenes;
  assert.equal(J(ordenes[ordenes.length - 1]), J({ paso, orden: copia }), 'última entrada del registro');
  const ev = eventos.find(e => e.tipo === 'orden');
  assert.ok(ev, 'no se ha emitido el evento orden');
  assert.equal(ev.paso, paso);
  assert.equal(J(ev.orden), J(copia));
  assert.equal(ev.resultado && ev.resultado.ok, true);
  enviada.tipo = 'mutada_despues'; enviada.origen = 'profesor';          // el registro guarda una copia (§2.4)
  const tras = s.registro().ordenes;
  assert.equal(J(tras[tras.length - 1].orden), J(copia), 'el registro comparte la orden con quien la envió');
});

criterio('C19', 'registro() devuelve una copia nueva', ctx => {
  const s = ctx.fresca();
  aceptado(s.ejecutar(clonar(ctx.algunEjemploValido()[0])), 'orden de ejemplo');
  const antes = J(s.registro());
  const r = s.registro();
  try { r.ordenes[0].orden.tipo = 'mutado'; } catch { /* congelado también vale */ }
  try { r.ordenes.push({ paso: 99, orden: { tipo: 'x', origen: 'guion' } }); } catch { /* */ }
  try { r.semilla = 12345; r.pasos = 99; } catch { /* */ }
  assert.equal(J(s.registro()), antes);
});

// ---- Repetición, instantáneas y reinicio

const TIPOS_REPETIBLES = new Set(['orden', 'averia', 'disparo', 'alarma']);

criterio('C20', 'repetir(registro) da el mismo estado, registro y eventos orden/averia/disparo/alarma', ctx => {
  const s = ctx.fresca();
  const o = oyente(s);
  const ej = ctx.ejemplosValidos();
  assert.ok(ej.length > 0, 'no hay órdenes de ejemplo válidas (fuera de averias.*)');
  const e = i => clonar(ej[i % ej.length]);
  const av = ctx.averiaActivable();
  s.avanzar(0.07); s.avanzar(0.33); s.avanzar(1);
  s.ejecutar(e(0)); s.avanzar(2.5);
  s.ejecutar(e(1)); s.avanzar(13);
  s.ejecutar(e(2)); s.avanzar(1);
  s.ejecutar(e(3)); s.avanzar(1);
  aceptado(s.ejecutar(ordenActivar(av)), `activar ${av.id}`); s.avanzar(2.5);
  s.ejecutar(e(4)); s.avanzar(0.05);
  const r = s.registro();
  assert.ok(r.ordenes.length >= 2, 'el registro debería tener al menos la avería y una orden');
  const pasos = r.ordenes.map(x => x.paso);
  for (let i = 1; i < pasos.length; i++) assert.ok(pasos[i] >= pasos[i - 1], 'paso decreciente en el registro');
  let ev2 = null;
  const t = repetir(clonar(r), ctx.fabrica, x => { ev2 = oyente(x).eventos; });
  assert.equal(J(t.estado()), J(s.estado()), 'estado de la repetición');
  assert.equal(J(t.registro()), J(r), 'registro de la repetición');
  const filtra = l => J(l.filter(x => TIPOS_REPETIBLES.has(x.tipo)));
  assert.equal(filtra(ev2), filtra(o.eventos), 'eventos orden/averia/disparo/alarma de la repetición');
});

function sesionAntes(ctx, s) {
  s.avanzar(3.3);
  s.ejecutar(clonar(ctx.ejemplosValidos()[0] || ctx.algunEjemploValido()[0]));
  aceptado(s.ejecutar(ordenActivar(ctx.averiaActivable())), 'activar avería');
  s.avanzar(1.25);
}
function sesionDespues(ctx, s) {
  const ej = ctx.ejemplosValidos();
  s.avanzar(0.05);
  if (ej[1]) s.ejecutar(clonar(ej[1]));
  s.avanzar(4.4);
  if (ej[2]) s.ejecutar(clonar(ej[2]));
  s.avanzar(7);
  s.ejecutar({ tipo: 'averias.limpiar', origen: 'profesor' });
  s.avanzar(0.3);
}

criterio('C21', 'instantanea() sobrevive a JSON con igualdad profunda', ctx => {
  const f = ctx.fresca();
  let x = f.instantanea();
  assert.deepStrictEqual(JSON.parse(J(x)), x, 'instantánea de una fresca');
  const s = ctx.fresca();
  sesionAntes(ctx, s);
  x = s.instantanea();
  assert.deepStrictEqual(JSON.parse(J(x)), x, 'instantánea tras una sesión');
  assert.equal(x.simulador, s.id);
  assert.equal(x.versionContrato, 1);
  assert.equal(x.pasoFijoS, s.pasoFijoS);
  assert.equal(x.semilla, 7);
  assert.equal(x.pasos, s.tiempo().pasos);
  assert.equal(x.restoS, s.tiempo().restoS);
  assert.ok('escenario' in x && 'datos' in x, 'faltan escenario o datos');
});

criterio('C22', 'restaurar(JSON(instantanea)) vuelve a t1 y la misma secuencia da el mismo final', ctx => {
  const s = ctx.fresca();
  sesionAntes(ctx, s);
  const x = s.instantanea();
  const t1 = foto(s);
  const o1 = oyente(s);
  sesionDespues(ctx, s);
  o1.cancelar();
  const final1 = J({ e: s.estado(), t: s.tiempo(), r: s.registro(), a: s.averias.activas() });
  const ev1 = o1.eventos;
  const o2 = oyente(s);
  const r = s.restaurar(JSON.parse(J(x)));
  aceptado(r, 'restaurar');
  assert.equal(foto(s), t1, 'tras restaurar, estado/tiempo/registro/activas distintos de los de t1');
  const rest = o2.eventos.filter(e => e.tipo === 'restauracion');
  assert.equal(rest.length, 1, 'restaurar emite un evento restauracion (§2.9)');
  assert.equal(rest[0].pasos, x.pasos);
  o2.eventos.length = 0;
  sesionDespues(ctx, s);
  o2.cancelar();
  assert.equal(J({ e: s.estado(), t: s.tiempo(), r: s.registro(), a: s.averias.activas() }), final1, 'final distinto tras restaurar y repetir');
  assert.equal(J(o2.eventos), J(ev1), 'eventos distintos tras restaurar (§2.9)');
});

criterio('C23', 'restaurar instantáneas incompatibles o mal formadas: ok:false sin cambios', ctx => {
  const s = ctx.fresca();
  sesionAntes(ctx, s);
  const x = clonar(s.instantanea());
  const otro = s.id === 'fotovoltaica' ? 'planta_real' : 'fotovoltaica';
  aceptado(s.avanzar(2), 'avanzar(2)');
  const casos = [[{ ...x, simulador: otro }, 'simulador_incompatible'], [{ ...x, versionContrato: 2 }, 'version_incompatible'],
    [{ ...x, pasoFijoS: s.pasoFijoS * 2 }, 'paso_incompatible'], [{}, 'instantanea_invalida'], [null, 'instantanea_invalida'], ['x', 'instantanea_invalida']];
  for (const [i, motivo] of casos) {
    const antes = foto(s);
    const { eventos, cancelar } = oyente(s);
    rechazado(s.restaurar(i), motivo, `restaurar(${J(i) && J(i).slice(0, 40)})`);
    cancelar();
    assert.equal(foto(s), antes, `restaurar con ${motivo} ha cambiado algo`);
    assert.equal(eventos.length, 0, `restaurar con ${motivo} ha emitido eventos`);
  }
});

criterio('C24', 'reiniciar() ≡ fresca, conserva suscriptores; reiniciar({ semilla: 8 }) ≡ fresca(8)', ctx => {
  const s = ctx.fresca();
  const o = oyente(s);
  sesionAntes(ctx, s);
  aceptado(s.avanzar(5), 'avanzar(5)');
  assert.ok(s.averias.activas().length > 0);
  o.eventos.length = 0;
  aceptado(s.reiniciar(), 'reiniciar()');
  const f7 = ctx.fresca(7);
  assert.equal(J(s.estado()), J(f7.estado()), 'estado tras reiniciar()');
  assert.deepStrictEqual({ ...s.tiempo() }, { pasos: 0, tS: 0, restoS: 0 });
  assert.deepStrictEqual(s.averias.activas(), []);
  assert.deepStrictEqual(s.registro().ordenes, []);
  assert.equal(J(s.registro()), J(f7.registro()), 'registro tras reiniciar()');
  const rein = o.eventos.filter(e => e.tipo === 'reinicio');
  assert.equal(rein.length, 1, 'llega el evento reinicio');
  assert.equal(rein[0].semilla, 7);
  aceptado(s.avanzar(30), 'avanzar(30)'); aceptado(f7.avanzar(30), 'avanzar(30)');
  assert.equal(J(s.estado()), J(f7.estado()), 'tras reiniciar, la evolución no es la de una fresca (¿azar sin reiniciar?)');
  o.eventos.length = 0;
  aceptado(s.ejecutar(clonar(ctx.algunEjemploValido()[0])), 'orden tras reiniciar');
  assert.ok(o.eventos.some(e => e.tipo === 'orden'), 'el suscriptor ya no recibe eventos tras reiniciar');
  aceptado(s.reiniciar({ semilla: 8 }), 'reiniciar({ semilla: 8 })');
  const f8 = ctx.fresca(8);
  assert.equal(J(s.estado()), J(f8.estado()));
  assert.equal(J(s.registro()), J(f8.registro()));
  aceptado(s.avanzar(30), 'avanzar(30)'); aceptado(f8.avanzar(30), 'avanzar(30)');
  assert.equal(J(s.estado()), J(f8.estado()), 'reiniciar({ semilla: 8 }) no evoluciona como fresca(8)');
  const antes = foto(s);
  rechazado(s.reiniciar({ semilla: 1.5 }), 'opciones_invalidas', 'reiniciar({ semilla: 1.5 })');
  rechazado(s.reiniciar({ escenario: { ...escenarioBase(s.id), simulador: s.id === 'fotovoltaica' ? 'planta_real' : 'fotovoltaica' } }),
    'simulador_incompatible', 'reiniciar con escenario de otro simulador');
  assert.equal(foto(s), antes, 'un reiniciar rechazado ha cambiado algo');
});

// ---- Eventos

criterio('C25', 'suscribir devuelve cancelar(), idempotente; la misma función suscrita dos veces recibe dos veces', ctx => {
  const s = ctx.fresca();
  const ej = ctx.algunEjemploValido()[0];
  let n = 0;
  const f = e => { if (e.tipo === 'orden') n++; };
  const c1 = s.suscribir(f);
  assert.equal(typeof c1, 'function');
  const c2 = s.suscribir(f);
  s.ejecutar(clonar(ej));
  assert.equal(n, 2, 'la misma función suscrita dos veces debe llamarse dos veces');
  c1();
  assert.doesNotThrow(() => c1(), 'cancelar() dos veces no debe lanzar');
  s.ejecutar(clonar(ej));
  assert.equal(n, 3, 'cancelar() dos veces ha quitado también la otra suscripción (no es idempotente)');
  c2();
  const testigo = oyente(s);
  s.ejecutar(clonar(ej));
  assert.ok(testigo.eventos.some(e => e.tipo === 'orden'), 'sin eventos para comprobar');
  assert.equal(n, 3, 'llegan eventos después de cancelar');
});

criterio('C26', 'un suscriptor que lanza no impide a los demás ni cambia el Resultado', ctx => {
  const ej = ctx.algunEjemploValido()[0];
  const s = ctx.fresca(), gemela = ctx.fresca();
  s.suscribir(() => { throw new Error('suscriptor roto a propósito'); });
  const o = oyente(s);
  const errorConsola = console.error;
  console.error = () => {};
  let r;
  try { assert.doesNotThrow(() => { r = s.ejecutar(clonar(ej)); }); } finally { console.error = errorConsola; }
  assert.equal(J(r), J(gemela.ejecutar(clonar(ej))), 'el Resultado ha cambiado');
  assert.ok(o.eventos.some(e => e.tipo === 'orden'), 'el otro suscriptor no ha recibido el evento');
  assert.equal(J(s.estado()), J(gemela.estado()));
});

criterio('C27', 'reentrada: avanzar/avanzarPasos/ejecutar/restaurar/reiniciar desde un suscriptor → reentrada; estado() y medir funcionan', ctx => {
  const ej = ctx.algunEjemploValido()[0];
  const s = ctx.fresca();
  const x = s.instantanea();
  const pet = ctx.peticionValida(s);
  let dentro = null;
  s.suscribir(() => {
    if (dentro) return;
    dentro = {};
    dentro.avanzar = s.avanzar(1);
    dentro.avanzarPasos = s.avanzarPasos(1);
    dentro.ejecutar = s.ejecutar(clonar(ej));
    dentro.restaurar = s.restaurar(clonar(x));
    dentro.reiniciar = s.reiniciar();
    dentro.estado = J(s.estado());
    dentro.medida = s.medir(clonar(pet));
  });
  aceptado(s.ejecutar(clonar(ej)), 'orden que dispara el suscriptor');
  assert.ok(dentro, 'el suscriptor no se ha llamado');
  for (const k of ['avanzar', 'avanzarPasos', 'ejecutar', 'restaurar', 'reiniciar']) rechazado(dentro[k], 'reentrada', `${k} desde un suscriptor`);
  assert.equal(dentro.estado, J(s.estado()), 'estado() dentro del suscriptor no es el final de la llamada');
  assert.ok(dentro.medida && typeof dentro.medida.valida === 'boolean', 'medir no funciona dentro de un suscriptor');
  const gemela = ctx.fresca();
  gemela.ejecutar(clonar(ej));
  assert.equal(J(s.estado()), J(gemela.estado()), 'las llamadas rechazadas por reentrada han cambiado el estado');
  assert.equal(J(s.registro()), J(gemela.registro()), 'las llamadas rechazadas por reentrada han cambiado el registro');
});

function validarEvento(e, sim) {
  const d = J(e);
  assert.ok(T.TIPOS_EVENTO_SIM.includes(e.tipo), `tipo de evento desconocido: ${d}`);
  assert.ok(Number.isInteger(e.paso) && e.paso >= 0, `paso no entero: ${d}`);
  assert.equal(typeof e.tS, 'number', `tS: ${d}`);
  assert.equal(e.tS, e.paso * sim.pasoFijoS, `tS ≠ paso × pasoFijoS (§6): ${d}`);
  const suelto = primeroNoCongelado(e);
  assert.equal(suelto, null, `evento sin congelar en ${suelto}: ${d}`);
  switch (e.tipo) {
    case 'orden': case 'orden_rechazada':
      assert.ok('orden' in e && e.resultado && typeof e.resultado.ok === 'boolean', `campos de ${e.tipo}: ${d}`);
      assert.equal(e.resultado.ok, e.tipo === 'orden', d); break;
    case 'alarma':
      assert.ok(typeof e.codigo === 'string' && typeof e.tag === 'string' && T.NIVELES_ALARMA.includes(e.nivel) && typeof e.texto === 'string' &&
        typeof e.activa === 'boolean', `campos de alarma: ${d}`); break;
    case 'disparo':
      assert.ok(typeof e.tag === 'string' && 'causa' in e && typeof e.activo === 'boolean', `campos de disparo: ${d}`); break;
    case 'averia':
      assert.ok(T.ACCIONES_EVENTO_AVERIA.includes(e.accion) && typeof e.id === 'string' && typeof e.instancia === 'string' && Array.isArray(e.tags),
        `campos de averia: ${d}`); break;
    case 'medida':
      assert.ok(e.medida && typeof e.medida.valida === 'boolean' && 'peticion' in e, `campos de medida: ${d}`); break;
    case 'reinicio':
      assert.ok(Number.isInteger(e.semilla) && 'escenario' in e, `campos de reinicio: ${d}`); break;
    case 'restauracion':
      assert.ok(Number.isInteger(e.pasos), `campos de restauracion: ${d}`); break;
  }
}

criterio('C28', 'eventos: tipo, paso entero, tS, congelados, orden dentro de cada llamada y estado final dentro del suscriptor', ctx => {
  const s = ctx.fresca();
  let buf = [];
  s.suscribir(e => buf.push({ e, estado: J(s.estado()), pasos: s.tiempo().pasos }));
  const pet = ctx.peticionValida(s);
  const av = ctx.averiaActivable();
  let total = 0;
  const llamadas = [
    () => s.avanzar(1.05),
    ...ctx.ejemplos().map(x => () => s.ejecutar(clonar(x.ejemplo))),
    () => s.ejecutar({ tipo: 'averias.limpiar', origen: 'profesor' }),
    () => s.ejecutar(ordenActivar(av)),
    () => s.medir(clonar(pet)),
    () => s.medir(null),
    () => s.ejecutar(null),
    () => s.avanzar(600),
    () => s.avanzarPasos(Math.round(30 / s.pasoFijoS)),
    () => s.restaurar(clonar(s.instantanea())),
    () => s.reiniciar(),
  ];
  for (const llamada of llamadas) {
    buf = [];
    llamada();
    const final = J(s.estado()), pasos = s.tiempo().pasos;
    total += buf.length;
    for (let i = 0; i < buf.length; i++) {
      const { e, estado, pasos: p } = buf[i];
      validarEvento(e, s);
      assert.equal(estado, final, `dentro del suscriptor (evento ${e.tipo}) estado() no es el final de la llamada (§2.8)`);
      assert.equal(p, pasos, 'dentro del suscriptor tiempo() no es el final de la llamada');
      assert.ok(e.paso <= pasos, `evento con paso futuro: ${J(e)}`);
      if (i > 0) {
        const a = buf[i - 1].e;
        assert.ok(e.paso >= a.paso, `pasos decrecientes en una misma llamada: ${a.paso} → ${e.paso}`);
        if (e.paso === a.paso && a.tipo in ORDEN_EN_PASO && e.tipo in ORDEN_EN_PASO)
          assert.ok(ORDEN_EN_PASO[e.tipo] >= ORDEN_EN_PASO[a.tipo], `dentro de un paso el orden es orden → averia → disparo → alarma: ${a.tipo} antes que ${e.tipo}`);
      }
    }
  }
  assert.ok(total > 0, 'la sesión no ha producido eventos');
});

criterio('C29', "activar una avería emite averia 'activada'; quitarla, 'quitada'", ctx => {
  const s = ctx.fresca();
  aceptado(s.avanzar(1), 'avanzar(1)');
  const cat = s.averias.catalogo();
  const av = cat.find(a => !a.parametros || Object.keys(a.parametros).length === 0) || ctx.averiaActivable();
  const o = oyente(s);
  const r = s.ejecutar(ordenActivar(av));
  aceptado(r, `activar ${av.id}`);
  const inst = r.datos && r.datos.instancia;
  assert.equal(typeof inst, 'string', 'datos.instancia');
  const act = o.eventos.filter(e => e.tipo === 'averia');
  assert.equal(act.length, 1, 'un evento averia al activar');
  assert.equal(act[0].accion, 'activada');
  assert.equal(act[0].id, av.id);
  assert.equal(act[0].instancia, inst);
  const activa = s.averias.activas().find(a => a.instancia === inst);
  assert.ok(activa, 'no aparece en activas()');
  assert.equal(activa.id, av.id);
  assert.ok(Array.isArray(activa.tags));
  assert.equal(activa.desdePaso, s.tiempo().pasos, 'desdePaso');
  o.eventos.length = 0;
  aceptado(s.ejecutar({ tipo: 'averias.quitar', valores: { instancia: inst }, origen: 'profesor' }), 'quitar');
  const q = o.eventos.filter(e => e.tipo === 'averia');
  assert.equal(q.length, 1, 'un evento averia al quitar');
  assert.equal(q[0].accion, 'quitada');
  assert.equal(q[0].instancia, inst);
  assert.ok(!s.averias.activas().some(a => a.instancia === inst), 'sigue en activas()');
});

// ---- Medidas

criterio('C30', 'puntos(): no vacía, instrumentos y magnitudes del contrato, (instrumento, id) único', ctx => {
  const s = ctx.fresca();
  const ps = s.puntos();
  assert.ok(Array.isArray(ps) && ps.length > 0, 'puntos() vacía');
  const mags = T.MAGNITUDES_POR_SIMULADOR[s.id];
  assert.ok(mags, `MAGNITUDES_POR_SIMULADOR no tiene ${s.id}`);
  const claves = new Set();
  for (const p of ps) {
    const d = J(p);
    assert.ok(typeof p.id === 'string' && p.id, `id: ${d}`);
    assert.ok(T.INSTRUMENTOS.includes(p.instrumento), `instrumento: ${d}`);
    assert.ok(Array.isArray(p.magnitudes) && p.magnitudes.length > 0, `magnitudes: ${d}`);
    for (const m of p.magnitudes) assert.ok((mags[p.instrumento] || []).includes(m), `magnitud ${m} no vale para ${p.instrumento} en ${s.id}: ${d}`);
    assert.ok(typeof p.texto === 'string' && p.texto.trim(), `texto: ${d}`);
    assert.ok(typeof p.equipo === 'string' && p.equipo, `equipo: ${d}`);
    const k = p.instrumento + '|' + p.id;
    assert.ok(!claves.has(k), `(instrumento, id) repetido: ${k}`);
    claves.add(k);
  }
  assert.equal(J(s.puntos()), J(ps), 'puntos() debe ser estática');
});

function todasLasPeticiones(sim, n = 200) {
  const ps = sim.puntos();
  const r = [];
  for (const p of muestra(ps, n)) for (const m of p.magnitudes) r.push(peticionDe(p, m, ps));
  return r;
}
function validarMedida(m, q) {
  const d = `${J(q)} → ${J(m)}`;
  assert.ok(m && typeof m === 'object', d);
  assert.equal(typeof m.valida, 'boolean', `valida: ${d}`);
  assert.ok(typeof m.texto === 'string' && m.texto.trim(), `texto vacío: ${d}`);
  if (m.valida) {
    if (T.MAGNITUDES_COMPUESTAS.includes(q.magnitud)) {
      assert.equal(m.valor, undefined, `magnitud compuesta con valor: ${d}`);
      assert.ok(m.datos && typeof m.datos === 'object', `magnitud compuesta sin datos: ${d}`);
    } else {
      assert.equal(typeof m.valor, 'number', `valor: ${d}`);
      assert.ok(!Number.isNaN(m.valor), `valor NaN: ${d}`);
      if (m.valor === Infinity) assert.equal(m.datos && m.datos.ol, true, `OL sin datos.ol: ${d}`);
    }
    assert.ok(typeof m.unidad === 'string' && m.unidad, `sin unidad: ${d}`);
  } else {
    assert.ok(T.MOTIVOS.includes(m.motivo), `motivo: ${d}`);
    assert.equal(m.valor, undefined, `valida:false con valor: ${d}`);
  }
}

criterio('C31', 'medir cada punto y magnitud (muestra ≤ 200 puntos) da una Medida bien formada', ctx => {
  const s = ctx.fresca();
  aceptado(s.avanzar(5), 'avanzar(5)');
  const qs = todasLasPeticiones(s);
  assert.ok(qs.length > 0);
  for (const q of qs) validarMedida(s.medir(q), q);
});

criterio('C32', 'medir no cambia estado, tiempo ni registro (ni la evolución posterior)', ctx => {
  const a = ctx.fresca(), b = ctx.fresca();
  for (const s of [a, b]) { aceptado(s.avanzar(5), 'avanzar(5)'); s.ejecutar(clonar(ctx.algunEjemploValido()[0])); }
  const antes = foto(a);
  for (const q of todasLasPeticiones(a)) a.medir(q);
  for (const q of [null, { instrumento: 'nada', magnitud: 'x' }]) a.medir(q);
  assert.equal(foto(a), antes, 'medir ha cambiado estado, tiempo, registro o averías');
  aceptado(a.avanzar(30), 'avanzar(30)'); aceptado(b.avanzar(30), 'avanzar(30)');
  assert.equal(J(a.estado()), J(b.estado()), 'medir ha alterado la evolución posterior (¿consume azar?)');
});

criterio('C33', 'medir: instrumento, punto, magnitud y petición inválidos, con evento medida', ctx => {
  const s = ctx.fresca();
  const ps = s.puntos();
  const p = ps[0];
  const o = oyente(s);
  const casos = [];
  casos.push([{ instrumento: 'instrumento_que_no_existe', magnitud: p.magnitudes[0], [campoPunto(p.instrumento)]: p.id }, 'instrumento_desconocido']);
  const qDesc = peticionDe(p, p.magnitudes[0], ps);
  qDesc[campoPunto(p.instrumento)] = 'NO-EXISTE-99';
  casos.push([qDesc, 'punto_desconocido']);
  const mags = T.MAGNITUDES_POR_SIMULADOR[s.id] || {};
  const propias = mags[p.instrumento] || [];
  const ajenas = [...Object.values(mags).flat(), ...Object.values(T.MAGNITUDES_POR_SIMULADOR).flatMap(x => Object.values(x).flat())]
    .filter(m => !propias.includes(m));
  assert.ok(ajenas.length, 'no hay magnitud de otro instrumento para probar');
  casos.push([peticionDe(p, ajenas[0], ps), 'magnitud_invalida']);
  casos.push([null, 'peticion_invalida']);
  for (const [q, motivo] of casos) {
    const m = s.medir(q);
    const d = `${J(q)} → ${J(m)}`;
    assert.equal(m && m.valida, false, d);
    assert.equal(m.motivo, motivo, d);
    assert.ok(typeof m.texto === 'string' && m.texto.trim(), `sin texto: ${d}`);
  }
  const ev = o.eventos.filter(e => e.tipo === 'medida');
  assert.equal(ev.length, casos.length, 'cada medir (también las no válidas) emite un evento medida');
  for (let i = 0; i < ev.length; i++) assert.equal(ev[i].medida.motivo, casos[i][1]);
});

// ---- Averías

function comprobarPeticionFirma(s, q, que) {
  const ps = s.puntos();
  assert.ok(esObjetoPlano(q) && T.INSTRUMENTOS.includes(q.instrumento), `${que}: instrumento de ${J(q)}`);
  if (q.instrumento === 'termografia' && q.elemento !== undefined) {
    const m = s.medir(clonar(q));
    assert.ok(m.valida || !['punto_desconocido', 'magnitud_invalida', 'instrumento_desconocido', 'peticion_invalida'].includes(m.motivo),
      `${que}: ${J(q)} → ${J(m)}`);
    return;
  }
  const ids = [q[campoPunto(q.instrumento)]];
  if (q.instrumento === 'multimetro' && q.b !== undefined && s.id !== 'planta_real') ids.push(q.b);
  for (const id of ids) {
    const p = ps.find(x => x.instrumento === q.instrumento && x.id === id);
    assert.ok(p, `${que}: el punto (${q.instrumento}, ${id}) no está en puntos()`);
    assert.ok(p.magnitudes.includes(q.magnitud), `${que}: ${q.magnitud} no vale en (${q.instrumento}, ${id})`);
  }
}
function comprobarRango(r, que) {
  assert.ok(esObjetoPlano(r), `${que}: rango`);
  for (const k of ['min', 'max']) assert.ok(r[k] === null || (typeof r[k] === 'number' && Number.isFinite(r[k])), `${que}: ${k} = ${r[k]}`);
  assert.equal(typeof r.unidad, 'string', `${que}: unidad`);
}

criterio('C34', 'catálogo de averías bien formado (y firmas coherentes con puntos() y el catálogo)', ctx => {
  const s = ctx.fresca();
  const cat = s.averias.catalogo();
  assert.ok(Array.isArray(cat) && cat.length > 0, 'catálogo vacío');
  assert.equal(J(s.averias.catalogo()), J(cat), 'el catálogo cambia entre llamadas');
  const ids = cat.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'ids repetidos');
  const tipos = new Set(s.ordenesDisponibles().map(d => d.tipo));
  for (const a of cat) {
    const q = `avería ${a.id}`;
    assert.ok(typeof a.id === 'string' && a.id, q);
    assert.ok(typeof a.titulo === 'string' && a.titulo.trim(), `${q}: titulo`);
    assert.ok(Array.isArray(a.equipos) && a.equipos.length > 0, `${q}: equipos`);
    assert.ok([1, 2, 3].includes(a.dificultad), `${q}: dificultad`);
    assert.ok(Array.isArray(a.sintomas), `${q}: sintomas`);
    assert.ok(esObjetoPlano(a.parametros), `${q}: parametros`);
    for (const [k, e] of Object.entries(a.parametros)) assert.ok(esObjetoPlano(e) && 'defecto' in e, `${q}: parámetro ${k} sin defecto`);
    assert.ok(esObjetoPlano(a.solucion) && typeof a.solucion.texto === 'string', `${q}: solucion`);
    assert.ok(T.ACCIONES_REPARACION.includes(a.solucion.accion), `${q}: solucion.accion`);
    assert.ok(a.solucion.tag === null || typeof a.solucion.tag === 'string', `${q}: solucion.tag`);
    if (a.firma === undefined) continue;
    const f = a.firma;
    assert.deepStrictEqual(JSON.parse(J(f)), f, `${q}: la firma no sobrevive a JSON`);
    assert.ok(typeof f.sintoma === 'string' && f.sintoma, `${q}: sintoma`);
    assert.ok(esObjetoPlano(f.escenario) && f.escenario.simulador === s.id, `${q}: escenario.simulador`);
    assert.ok(typeof f.esperaS === 'number' && f.esperaS >= 0, `${q}: esperaS`);
    assert.ok(Array.isArray(f.pistas) && f.pistas.length === 3 && f.pistas.every(p => typeof p === 'string' && p.trim()), `${q}: 3 pistas`);
    assert.equal(typeof f.explicacion, 'string', `${q}: explicacion`);
    assert.ok(Array.isArray(f.distractores), `${q}: distractores`);
    for (const d of f.distractores) assert.ok(ids.includes(d), `${q}: distractor ${d} no está en el catálogo`);
    assert.ok(Array.isArray(f.medidasClave) && f.medidasClave.length > 0, `${q}: medidasClave vacía`);
    f.medidasClave.forEach((mc, i) => {
      const qi = `${q}, medida clave ${i + 1}`;
      comprobarPeticionFirma(s, mc.peticion, qi);
      if (mc.referencia !== undefined) comprobarPeticionFirma(s, mc.referencia, `${qi} (referencia)`);
      for (const o of mc.preparar || []) assert.ok(tipos.has(o.tipo) && T.ORIGENES.includes(o.origen), `${qi}: preparar ${J(o)}`);
      comprobarRango(mc.esperadoSano, `${qi} esperadoSano`);
      comprobarRango(mc.esperadoAveria, `${qi} esperadoAveria`);
      assert.equal(typeof mc.texto, 'string', `${qi}: texto`);
    });
  }
});

criterio('C35', 'averias.activar/quitar/limpiar: id inexistente, instancia mal formada (instancia_desconocida), bien formada no activa (no_permitida) y limpiar', ctx => {
  const s = ctx.fresca();
  rechazado(s.ejecutar({ tipo: 'averias.activar', valores: { id: 'AVERIA_QUE_NO_EXISTE_XYZ' }, origen: 'profesor' }), 'averia_desconocida', 'activar id inexistente');
  const cat = s.averias.catalogo();
  // Mal formada: ni id de catálogo (FV) ni I<n> (HTST). Es una cadena que no puede ser ninguna de las dos formas (§4.1, C35).
  const malFormadas = ['NO-EXISTE', 'xyz', 'I', 'I1x', 'i1'];
  for (const m of malFormadas) {
    assert.ok(!cat.some(a => a.id === m) && !new RegExp(T.FORMA_INSTANCIA_HTST).test(m), `(prueba) ${m} no es mala forma`);
    const antes = foto(s);
    rechazado(s.ejecutar({ tipo: 'averias.quitar', valores: { instancia: m }, origen: 'profesor' }), 'instancia_desconocida', `quitar «${m}» (mal formada)`);
    assert.equal(foto(s), antes, `quitar «${m}» ha cambiado algo`);
  }
  // Bien formada pero no activa: id del catálogo (FV) o I99 (HTST), que en una fresca no está activa.
  const bien = s.id === 'planta_real' ? ['I99', 'I1'] : [cat[0].id];
  for (const b of bien) {
    const antes = foto(s);
    rechazado(s.ejecutar({ tipo: 'averias.quitar', valores: { instancia: b }, origen: 'profesor' }), 'no_permitida', `quitar «${b}» (bien formada, no activa)`);
    assert.equal(foto(s), antes, `quitar «${b}» ha cambiado algo`);
  }
  const r = s.ejecutar(ordenActivar(ctx.averiaActivable()));
  aceptado(r, 'activar');
  const inst = r.datos.instancia;
  assert.ok(s.averias.activas().length > 0);
  // Ya quitada: bien formada y no activa → no_permitida (no instancia_desconocida).
  aceptado(s.ejecutar({ tipo: 'averias.quitar', valores: { instancia: inst }, origen: 'profesor' }), 'quitar la activa');
  rechazado(s.ejecutar({ tipo: 'averias.quitar', valores: { instancia: inst }, origen: 'profesor' }), 'no_permitida', `quitar «${inst}» otra vez (ya retirada)`);
  aceptado(s.ejecutar(ordenActivar(ctx.averiaActivable())), 'activar de nuevo');
  aceptado(s.ejecutar({ tipo: 'averias.limpiar', origen: 'profesor' }), 'limpiar');
  assert.deepStrictEqual(s.averias.activas(), []);
  // Compatibilidad con C15: el ejemplo de averias.quitar da no_permitida en una fresca.
  const dq = s.ordenesDisponibles().find(d => d.tipo === 'averias.quitar');
  assert.ok(dq, 'falta averias.quitar en ordenesDisponibles()');
  rechazado(ctx.fresca().ejecutar(clonar(dq.ejemplo)), 'no_permitida', 'ejemplo de averias.quitar en una fresca');
});

criterio('C36', 'averias.reparar: equivocada → correcta:false y sigue; la de la solución → correcta:true y se quita', ctx => {
  const s = ctx.fresca();
  const av = ctx.averiaActivable();
  const r0 = s.ejecutar(ordenActivar(av));
  aceptado(r0, `activar ${av.id}`);
  const inst = r0.datos.instancia;
  const activa = s.averias.activas().find(a => a.instancia === inst);
  const destinoBueno = av.solucion.tag !== null ? av.solucion.tag : activa.tags[0];
  const dRep = s.ordenesDisponibles().find(d => d.tipo === 'averias.reparar');
  if (dRep.destinos) assert.ok(dRep.destinos.includes(destinoBueno), `el tag de la solución ${destinoBueno} no está en los destinos de averias.reparar`);
  const sigue = () => s.averias.activas().some(a => a.instancia === inst);
  const accionMala = T.ACCIONES_REPARACION.find(a => a !== av.solucion.accion);
  let r = s.ejecutar({ tipo: 'averias.reparar', destino: destinoBueno, valores: { accion: accionMala }, origen: 'alumno' });
  aceptado(r, 'reparar con acción equivocada');
  assert.equal(r.datos && r.datos.correcta, false);
  assert.ok(sigue(), 'una reparación equivocada ha quitado la avería');
  const tagsBuenos = av.solucion.tag !== null ? [av.solucion.tag] : activa.tags;
  const destinoMalo = (dRep.destinos || []).find(t => !tagsBuenos.includes(t));
  if (destinoMalo) {
    r = s.ejecutar({ tipo: 'averias.reparar', destino: destinoMalo, valores: { accion: av.solucion.accion }, origen: 'alumno' });
    aceptado(r, 'reparar en el equipo equivocado');
    assert.equal(r.datos && r.datos.correcta, false);
    assert.ok(sigue(), 'reparar en otro equipo ha quitado la avería');
  }
  const o = oyente(s);
  r = s.ejecutar({ tipo: 'averias.reparar', destino: destinoBueno, valores: { accion: av.solucion.accion }, origen: 'alumno' });
  aceptado(r, 'reparar con la solución');
  assert.equal(r.datos && r.datos.correcta, true);
  assert.ok(Array.isArray(r.datos.ids) && r.datos.ids.includes(av.id), 'datos.ids');
  assert.ok(!sigue(), 'la avería sigue activa tras repararla');
  assert.ok(o.eventos.some(e => e.tipo === 'averia' && e.accion === 'reparada' && e.instancia === inst), "falta el evento averia 'reparada'");
});

function leerClave(ctx, av, mc, conAveria) {
  const s = ctx.fresca(7, clonar(av.firma.escenario));
  if (conAveria) aceptado(s.ejecutar(ordenActivar(av)), `activar ${av.id}`);
  avanzarLargo(s, av.firma.esperaS);
  // Con el acumulador de paso fijo (FV a 2 s) esperaS debe quedar consumido en pasos enteros: sin resto sin dar ni pasos de más.
  const t = s.tiempo(), esperados = Math.floor((av.firma.esperaS + T.EPS_PASO_S) / s.pasoFijoS);
  assert.equal(t.pasos, esperados, `${av.id}: tras esperaS=${av.firma.esperaS} s deben haberse dado ${esperados} pasos y hay ${t.pasos}`);
  assert.ok(t.restoS < s.pasoFijoS, `${av.id}: restoS fuera de [0, pasoFijoS) tras esperaS`);
  assert.ok(Math.abs(t.restoS - (av.firma.esperaS - esperados * s.pasoFijoS)) < 1e-6, `${av.id}: restoS inesperado (${t.restoS}) tras esperaS`);
  for (const o of mc.preparar || []) aceptado(s.ejecutar(clonar(o)), `preparar ${J(o)}`);
  const m = s.medir(clonar(mc.peticion));
  if (!m.valida) return { m };
  if (mc.referencia === undefined) return { m, v: m.valor };
  const ref = s.medir(clonar(mc.referencia));
  return { m, ref, v: ref.valida ? m.valor - ref.valor : NaN };
}

criterio('C37', 'cada firma: en su escenario sus medidas clave caen en esperadoAveria con la avería y en esperadoSano sin ella', ctx => {
  const cat = ctx.fresca().averias.catalogo();
  const sinFirma = cat.filter(a => !a.firma).map(a => a.id);
  assert.deepStrictEqual(sinFirma, [], `faltan firmas (${sinFirma.length}): ${sinFirma.join(', ')} (§10 C37: las 16 firmas HTST ya existen; ya no es «pendiente»)`);
  for (const av of cat) {
    // esperaS en segundos y múltiplo del paso (§R12): si no, sobraría un restoS sin consumir.
    const m = av.firma.esperaS / ctx.fresca().pasoFijoS;
    assert.ok(Math.abs(m - Math.round(m)) < 1e-6, `${av.id}: esperaS=${av.firma.esperaS} s no es múltiplo del paso fijo`);
    av.firma.medidasClave.forEach((mc, i) => {
      const q = `${av.id}, medida clave ${i + 1} (${J(mc.peticion)})`;
      const con = leerClave(ctx, av, mc, true), sin = leerClave(ctx, av, mc, false);
      assert.ok(enRango(con.v, mc.esperadoAveria), `${q}: con la avería se lee ${J(con.m)} y se espera ${J(mc.esperadoAveria)}`);
      assert.ok(enRango(sin.v, mc.esperadoSano), `${q}: sin la avería se lee ${J(sin.m)} y se espera ${J(mc.esperadoSano)}`);
      if (con.m.unidad && mc.esperadoAveria.unidad) assert.equal(con.m.unidad, mc.esperadoAveria.unidad, `${q}: unidad`);
    });
  }
});

// ---------------------------------------------------------------- registro ----

async function ejecutarCriterio(c, ctx, t) {
  const r = await c.fn(ctx);
  if (r && r.skip && t) t.skip(r.skip);
  if (r && r.todo && t) t.todo(r.todo);
  return r;
}

/** Registra con node:test un test por criterio (C1–C37) contra `fabrica`. opciones: { id?: id esperado, solo?: ['C7', …] }. */
function probarContrato(nombre, fabrica, opciones = {}) {
  describe(`contrato ${nombre}`, () => {
    const ctx = crearContexto(fabrica, opciones);
    for (const c of criterios) {
      if (opciones.solo && !opciones.solo.includes(c.codigo)) continue;
      test(`${c.codigo} ${c.titulo}`, t => ejecutarCriterio(c, ctx, t));
    }
  });
}

/** Ejecuta un criterio suelto (sin node:test). Rechaza la promesa si el criterio no se cumple. */
async function comprobar(codigo, fabrica, opciones = {}) {
  const c = criterios.find(x => x.codigo === codigo);
  if (!c) throw new Error('criterio desconocido: ' + codigo);
  return ejecutarCriterio(c, crearContexto(fabrica, opciones), null);
}

/**
 * Carga la fábrica real de un simulador (CONTRATO.md §1, ruta relativa a la raíz del repositorio) y le pasa la prueba de contrato.
 * Si el archivo aún no existe o no carga, registra un único test en rojo con un mensaje claro en vez de reventar el proceso.
 */
function probarFabricaReal(id, rutaRelativa) {
  const fs = require('node:fs');
  const path = require('node:path');
  const ruta = path.join(__dirname, '..', '..', rutaRelativa);
  const fallo = texto => test(`fábrica ${id}: ${rutaRelativa}`, () => { throw new Error(texto); });
  if (!fs.existsSync(ruta)) return fallo(`falta la fábrica ${rutaRelativa} (la escribe el programador)`);
  let mod;
  try { mod = require(ruta); } catch (e) { return fallo(`la fábrica ${rutaRelativa} no se carga en Node: ${e.message}`); }
  if (!mod || mod.id !== id || typeof mod.crearSimulacion !== 'function') return fallo(`${rutaRelativa} debe exportar { id: '${id}', crearSimulacion }`);
  probarContrato(id, mod.crearSimulacion, { id });
}

module.exports = { probarContrato, probarFabricaReal, comprobar, criterios, repetir, peticionDe };
