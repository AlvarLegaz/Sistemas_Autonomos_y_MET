'use strict';
// Simulación de JUGUETE que cumple el contrato común (comun/CONTRATO.md) al 100 %, solo para demostrar que la prueba genérica
// (contrato.js) funciona. No es un simulador del aula.
//
// Un depósito TK-101 de 1000 L que se vacía por un grifo XV-101 movido por la bomba P-101 (órdenes de la planta real: arrancar, parar,
// consignaCaudalLh, nivelDeposito y las comunes averias.*). Paso fijo 0,1 s (id 'planta_real'). El transmisor de nivel LT-101 lleva un
// ruido con semilla. Alarmas de nivel bajo/alto y disparo de la bomba por marcha en seco.
//
//   const { crearFabrica } = require('./sim_juguete.js');
//   const crearSimulacion = crearFabrica();                          // la buena
//   const rota = crearFabrica({ fallo: 'paso_variable' });          // incumple el contrato a propósito
//
// Fallos a propósito (para comprobar que la prueba de contrato los detecta):
//   'paso_variable'    integra de golpe todo lo que cabe en una llamada (depende del troceo)        → C7
//   'estado_mutable'   estado() devuelve un objeto sin congelar                                     → C11
//   'medir_cambia'     medir consume el generador de azar                                           → C32
//   'recorta_valores'  los valores fuera de rango se recortan en silencio en vez de rechazarse      → C16
//   'paso_doble'       avanzar(≥1 s) da pasos de doble duración (el paso fijo no es fijo)           → C6 y C7
//   'quitar_codigo_malo'  averias.quitar de una instancia bien formada pero no activa da instancia_desconocida en vez de no_permitida → C35
const T = require('../tipos.js');

const ID = 'planta_real';
const PASO = T.PASO_FIJO_S[ID];
const CAPACIDAD_L = 1000;
const CAUDAL_MAX_LH = 2500;
const NIVEL_INICIAL_PCT = 50;
const MAGNITUDES = T.MAGNITUDES_POR_SIMULADOR[ID];

const J = x => JSON.stringify(x);
const esObjetoPlano = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const clonar = o => (o === undefined ? undefined : JSON.parse(J(o)));
const congelar = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) congelar(v); } return o; };
const semillaValida = s => Number.isInteger(s) && s >= 1 && s <= 2 ** 32 - 1;
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
function errorCodigo(codigo) { const e = new Error(codigo); e.codigo = codigo; return e; }

function rngDe(semilla) {                                      // mulberry32
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------------------------------------------------- datos fijos ----

const DESCRIPCIONES = congelar([
  { tipo: 'arrancar', texto: 'Arranca la bomba P-101 y abre el grifo XV-101.', ejemplo: { tipo: 'arrancar', origen: 'guion' } },
  { tipo: 'parar', texto: 'Para la bomba y cierra el grifo.', ejemplo: { tipo: 'parar', origen: 'guion' } },
  { tipo: 'consignaCaudalLh', texto: 'Caudal de vaciado del depósito.', valores: { caudalLh: { tipo: 'numero', min: 0, max: CAUDAL_MAX_LH, unidad: 'L/h' } },
    ejemplo: { tipo: 'consignaCaudalLh', valores: { caudalLh: 1200 }, origen: 'guion' } },
  { tipo: 'nivelDeposito', texto: 'Pone el nivel del depósito. Solo con la bomba parada.', destinos: ['TK-101'],
    valores: { pct: { tipo: 'numero', min: 0, max: 100, unidad: '%' } }, ejemplo: { tipo: 'nivelDeposito', destino: 'TK-101', valores: { pct: 80 }, origen: 'guion' } },
  { tipo: 'controlTemperatura', texto: 'Control de temperatura del agua (apagado, histéresis o PID).',
    valores: { modo: { tipo: 'opcion', opciones: [...T.MODOS_CONTROL_TEMPERATURA] }, consignaC: { tipo: 'numero', min: 20, max: 85, unidad: '°C', opcional: true } },
    ejemplo: { tipo: 'controlTemperatura', valores: { modo: 'pid', consignaC: 70 }, origen: 'guion' } },
  { tipo: 'llenarDepositos', texto: 'Llena los depósitos o cancela el llenado.', valores: { activo: { tipo: 'booleano' } },
    ejemplo: { tipo: 'llenarDepositos', valores: { activo: true }, origen: 'guion' } },
  { tipo: 'averias.activar', texto: 'Activa una avería del catálogo.', valores: { id: { tipo: 'texto' } },
    ejemplo: { tipo: 'averias.activar', valores: { id: 'AV-GRIFO-ATASCADO' }, origen: 'guion' } },
  { tipo: 'averias.quitar', texto: 'Quita una avería activa.', valores: { instancia: { tipo: 'texto' } },
    ejemplo: { tipo: 'averias.quitar', valores: { instancia: 'I1' }, origen: 'guion' } },
  { tipo: 'averias.limpiar', texto: 'Quita todas las averías.', ejemplo: { tipo: 'averias.limpiar', origen: 'guion' } },
  { tipo: 'averias.reparar', texto: 'Repara un equipo.', destinos: ['XV-101', 'LT-101', 'TK-101'],
    valores: { accion: { tipo: 'opcion', opciones: [...T.ACCIONES_REPARACION] } },
    ejemplo: { tipo: 'averias.reparar', destino: 'XV-101', valores: { accion: 'reparar' }, origen: 'guion' } },
]);
const POR_TIPO = Object.fromEntries(DESCRIPCIONES.map(d => [d.tipo, d]));

const PUNTOS = congelar([
  { id: 'LT-101:SALIDA', instrumento: 'multimetro', magnitudes: ['tension'], texto: 'Salida 0-10 V del transmisor de nivel LT-101', equipo: 'LT-101' },
  { id: 'FT-101:LAZO', instrumento: 'multimetro', magnitudes: ['corriente'], texto: 'Lazo 4-20 mA del caudalímetro FT-101', equipo: 'FT-101' },
  { id: 'XV-101:BOBINA', instrumento: 'multimetro', magnitudes: ['resistencia', 'continuidad'], texto: 'Bobina de la electroválvula XV-101', equipo: 'XV-101' },
  { id: 'FT-101:LAZO', instrumento: 'osciloscopio', magnitudes: ['formaOnda'], texto: 'Lazo 4-20 mA del caudalímetro FT-101', equipo: 'FT-101' },
  { id: 'PT-101', instrumento: 'manometro', magnitudes: ['presion'], texto: 'Presión en el fondo del depósito', equipo: 'PT-101' },
  { id: 'TT-101', instrumento: 'termometro', magnitudes: ['temperatura'], texto: 'Temperatura del agua del depósito', equipo: 'TT-101' },
]);

const escenarioDe = (id, titulo, ordenesIniciales, esperaS) => ({ simulador: ID, versionContrato: 1, id, titulo, condiciones: {}, ordenesIniciales, esperaS });
const CATALOGO = congelar([
  { id: 'AV-GRIFO-ATASCADO', titulo: 'Grifo XV-101 atascado', equipos: ['XV-101'], dificultad: 1, sintomas: ['La bomba está en marcha pero el depósito no baja'],
    parametros: {}, solucion: { texto: 'Desmonta y limpia el grifo XV-101.', accion: 'reparar', tag: 'XV-101' },
    firma: { sintoma: 'La bomba marcha y no sale agua', esperaS: 30,
      escenario: escenarioDe('grifo_abierto', 'Vaciado a 1200 L/h', [
        { tipo: 'nivelDeposito', destino: 'TK-101', valores: { pct: 80 }, origen: 'guion' },
        { tipo: 'consignaCaudalLh', valores: { caudalLh: 1200 }, origen: 'guion' },
        { tipo: 'arrancar', origen: 'guion' }], 30),
      medidasClave: [
        { peticion: { instrumento: 'multimetro', magnitud: 'corriente', a: 'FT-101:LAZO' },
          esperadoSano: { min: 11, max: 12.5, unidad: 'mA' }, esperadoAveria: { min: 3.9, max: 4.1, unidad: 'mA' }, texto: 'El caudalímetro marca 4 mA: no pasa agua.' },
        { peticion: { instrumento: 'multimetro', magnitud: 'resistencia', a: 'XV-101:BOBINA' }, preparar: [{ tipo: 'parar', origen: 'guion' }],
          esperadoSano: { min: 115, max: 125, unidad: 'Ω' }, esperadoAveria: { min: 115, max: 125, unidad: 'Ω' }, texto: 'La bobina está bien: el fallo es mecánico.' },
      ],
      pistas: ['Mira si sale agua.', 'Mide el lazo del caudalímetro.', 'La bobina mide bien: piensa en la parte mecánica.'],
      explicacion: 'El grifo no abre aunque la bobina recibe tensión.', distractores: ['AV-RUIDO-4-20'] } },
  { id: 'AV-RUIDO-4-20', titulo: 'Interferencia en la salida del LT-101', equipos: ['LT-101'], dificultad: 2, sintomas: ['El nivel marca de más y baila'],
    parametros: { amplitudV: { tipo: 'numero', min: 0, max: 5, unidad: 'V', defecto: 1 } },
    solucion: { texto: 'Cambia el transmisor LT-101.', accion: 'sustituir', tag: 'LT-101' },
    firma: { sintoma: 'El nivel marca de más', esperaS: 10,
      escenario: escenarioDe('deposito_quieto', 'Depósito al 80 % sin vaciar', [{ tipo: 'nivelDeposito', destino: 'TK-101', valores: { pct: 80 }, origen: 'guion' }], 10),
      medidasClave: [{ peticion: { instrumento: 'multimetro', magnitud: 'tension', a: 'LT-101:SALIDA' },
        esperadoSano: { min: 7.9, max: 8.1, unidad: 'V' }, esperadoAveria: { min: 8.6, max: 9.4, unidad: 'V' }, texto: 'Con el 80 % deberían salir 8 V.' }],
      pistas: ['Compara el nivel con la mirilla.', 'Mide la salida del transmisor.', 'Sobra casi un voltio.'],
      explicacion: 'La salida del transmisor lleva un desvío y ruido.', distractores: ['AV-GRIFO-ATASCADO'] } },
]);
const AVERIA_POR_ID = Object.fromEntries(CATALOGO.map(a => [a.id, a]));

// ------------------------------------------------------------------ validación ----

function validarValores(esquema, valores, extra = []) {
  const v0 = valores === undefined ? {} : valores;
  for (const k of Object.keys(v0)) if (!(k in esquema) && !extra.includes(k)) return `«${k}» no es un valor de esta orden.`;
  for (const [k, e] of Object.entries(esquema)) {
    const v = v0[k];
    if (v === undefined) { if (!e.opcional) return `Falta «${k}».`; continue; }
    if (v === null) { if (e.nulo) continue; return `«${k}» no puede quedar vacío.`; }
    if ((e.tipo === 'numero' && (typeof v !== 'number' || !Number.isFinite(v))) || (e.tipo === 'entero' && !Number.isInteger(v)) ||
      (e.tipo === 'booleano' && typeof v !== 'boolean') || (e.tipo === 'texto' && typeof v !== 'string') ||
      (e.tipo === 'opcion' && !e.opciones.includes(v))) return `«${k}» no tiene un valor válido.`;
    if (typeof v === 'number' && ((e.min !== undefined && v < e.min) || (e.max !== undefined && v > e.max)) && !validarValores.recortar)
      return `«${k}» está fuera de rango (${e.min} a ${e.max}).`;
  }
  return null;
}

function validarOrden(o, recortar) {
  if (!esObjetoPlano(o) || typeof o.tipo !== 'string' || !T.ORIGENES.includes(o.origen) || (o.valores !== undefined && !esObjetoPlano(o.valores)))
    return { motivo: 'orden_invalida', texto: 'La orden no tiene la forma correcta.' };
  const d = POR_TIPO[o.tipo];
  if (!d) return { motivo: 'orden_desconocida', texto: `No existe la orden ${o.tipo}.` };
  if (d.destinos ? !d.destinos.includes(o.destino) : o.destino !== undefined) return { motivo: 'destino_desconocido', texto: `${o.tipo} no se puede hacer sobre ${o.destino}.` };
  validarValores.recortar = recortar;
  const t = validarValores(d.valores || {}, o.valores, o.tipo === 'averias.activar' ? ['parametros'] : []);
  validarValores.recortar = false;
  if (t) return { motivo: 'valores_invalidos', texto: t };
  if (o.tipo === 'averias.activar' && o.valores.parametros !== undefined && !esObjetoPlano(o.valores.parametros))
    return { motivo: 'valores_invalidos', texto: 'Los parámetros de la avería no son válidos.' };
  return null;
}

function validarEscenario(e) {
  if (e === undefined || e === null) return;
  if (!esObjetoPlano(e)) throw errorCodigo('escenario_invalido');
  if (e.simulador !== ID) throw errorCodigo(T.SIMULADORES.includes(e.simulador) ? 'simulador_incompatible' : 'escenario_invalido');
  if (e.versionContrato !== 1) throw errorCodigo(typeof e.versionContrato === 'number' ? 'version_incompatible' : 'escenario_invalido');
  if (typeof e.id !== 'string' || !/^[a-z0-9_]{3,40}$/.test(e.id) || typeof e.titulo !== 'string' || !esObjetoPlano(e.condiciones) ||
    !Array.isArray(e.ordenesIniciales)) throw errorCodigo('escenario_invalido');
  for (const [k, v] of Object.entries(e.condiciones)) {
    if (!T.CONDICIONES_POR_SIMULADOR[ID].includes(k) || typeof v !== 'boolean') throw errorCodigo('escenario_invalido');
  }
  if (e.esperaS !== undefined && !(typeof e.esperaS === 'number' && e.esperaS >= 0)) throw errorCodigo('escenario_invalido');
}

// ------------------------------------------------------------------ núcleo ----

const ev = (tipo, paso, campos) => congelar({ tipo, paso, tS: paso * PASO, ...campos });

class Nucleo {
  constructor(semilla, valvulasManuales) {
    this.rng = rngDe(semilla);
    this.tiempoS = 0; this.marcha = false; this.consigna = 0; this.caudal = 0; this.nivel = NIVEL_INICIAL_PCT;
    this.lectura = NIVEL_INICIAL_PCT / 10; this.disparo = false; this.valvulasManuales = !!valvulasManuales;
    this.averias = []; this.contador = 0; this.alarmasPrevias = [];
  }
  tiene(id) { return this.averias.find(a => a.id === id); }
  alarmas() {
    const l = [];
    if (this.nivel < 10) l.push({ codigo: 'NIVEL_BAJO', tag: 'LSL-101', nivel: 'aviso', texto: 'Nivel bajo en TK-101' });
    if (this.nivel > 95) l.push({ codigo: 'NIVEL_ALTO', tag: 'LSH-101', nivel: 'aviso', texto: 'Nivel alto en TK-101' });
    if (this.disparo) l.push({ codigo: 'DISPARO_BOMBA', tag: 'P-101', nivel: 'alarma', texto: 'Bomba P-101 disparada por marcha en seco' });
    return l;
  }
  revisarAlarmas(paso, evs) {
    const ahora = this.alarmas(), clave = a => a.codigo + '|' + a.tag;
    const antes = new Set(this.alarmasPrevias.map(clave)), hoy = new Set(ahora.map(clave));
    for (const a of this.alarmasPrevias) if (!hoy.has(clave(a))) evs.push(ev('alarma', paso, { ...a, activa: false }));
    for (const a of ahora) if (!antes.has(clave(a))) evs.push(ev('alarma', paso, { ...a, activa: true }));
    this.alarmasPrevias = ahora;
  }
  paso(dt, paso, evs) {
    const r1 = this.rng(), r2 = this.rng();
    this.caudal = this.marcha && !this.disparo && !this.tiene('AV-GRIFO-ATASCADO') ? this.consigna : 0;
    this.nivel = Math.max(0, this.nivel - this.caudal / 3600 * dt / CAPACIDAD_L * 100);
    if (this.marcha && !this.disparo && this.caudal > 0 && this.nivel < 2) {
      this.disparo = true; this.caudal = 0;
      evs.push(ev('disparo', paso, { tag: 'P-101', causa: 'marcha_en_seco', activo: true }));
    }
    const ruido = this.tiene('AV-RUIDO-4-20');
    this.lectura = this.nivel / 10 + 0.01 * (2 * r1 - 1) + (ruido ? ruido.parametros.amplitudV * (1 + 0.25 * (2 * r2 - 1)) : 0);
    this.tiempoS += dt;
    this.revisarAlarmas(paso, evs);
  }
  estado() {
    return {
      tiempoS: this.tiempoS, modo: this.marcha ? 'MARCHA' : 'PARADA', valvulasManuales: this.valvulasManuales, consignaCaudalLh: this.consigna,
      caudalLh: this.caudal, nivelPct: this.nivel, lecturaLTV: this.lectura, presionBar: this.presion(),
      autonomiaS: this.caudal > 0 ? this.nivel / 100 * CAPACIDAD_L / this.caudal * 3600 : Infinity, disparoP101: this.disparo,
      alarmas: this.alarmas(), averias: this.averias.map(a => a.id),
    };
  }
  presion() { return 0.0981 * 2 * this.nivel / 100; }
  /** Aplica una orden ya validada en forma. Con ok:false no cambia nada. */
  aplicar(o, paso, evs) {
    const v = o.valores || {};
    const no = (motivo, texto) => ({ ok: false, motivo, texto });
    switch (o.tipo) {
      case 'arrancar':
        if (this.disparo && this.nivel < 2) return no('no_permitida', 'El depósito está vacío: la bomba volvería a disparar.');
        if (this.disparo) { this.disparo = false; evs.push(ev('disparo', paso, { tag: 'P-101', causa: 'rearme', activo: false })); }
        this.marcha = true; return { ok: true };
      case 'parar': this.marcha = false; return { ok: true };
      case 'controlTemperatura': case 'llenarDepositos': return { ok: true };   // sin efecto en el juguete: solo hay que aceptarlas y registrarlas
      case 'consignaCaudalLh': this.consigna = limitar(v.caudalLh, 0, CAUDAL_MAX_LH); return { ok: true };
      case 'nivelDeposito':
        if (this.marcha) return no('no_permitida', 'Para la bomba antes de cambiar el nivel.');
        this.nivel = limitar(v.pct, 0, 100); return { ok: true };
      case 'averias.activar': {
        const av = AVERIA_POR_ID[v.id];
        if (!av) return no('averia_desconocida', `No existe la avería ${v.id}.`);
        const p = v.parametros || {};
        const t = validarValores(av.parametros, Object.fromEntries(Object.keys(av.parametros).map(k => [k, k in p ? p[k] : av.parametros[k].defecto])));
        if (t || Object.keys(p).some(k => !(k in av.parametros))) return no('valores_invalidos', t || 'Parámetro desconocido.');
        if (this.tiene(av.id)) return no('averia_incompatible', `${av.titulo} ya está activa.`);
        const instancia = 'I' + (++this.contador);
        const parametros = Object.fromEntries(Object.keys(av.parametros).map(k => [k, k in p ? p[k] : av.parametros[k].defecto]));
        this.averias.push({ instancia, id: av.id, tags: [...av.equipos], parametros, desdePaso: paso });
        evs.push(ev('averia', paso, { accion: 'activada', id: av.id, instancia, tags: [...av.equipos] }));
        return { ok: true, datos: { instancia } };
      }
      case 'averias.quitar': {
        const a = this.averias.find(x => x.instancia === v.instancia);
        if (!new RegExp(T.FORMA_INSTANCIA_HTST).test(v.instancia)) return no('instancia_desconocida', `«${v.instancia}» no es una instancia de avería.`);
        if (!a) return no(this.codigoQuitarMalo ? 'instancia_desconocida' : 'no_permitida', `No hay ninguna avería activa ${v.instancia}.`);
        this.averias = this.averias.filter(x => x !== a);
        evs.push(ev('averia', paso, { accion: 'quitada', id: a.id, instancia: a.instancia, tags: a.tags }));
        return { ok: true };
      }
      case 'averias.limpiar':
        for (const a of this.averias) evs.push(ev('averia', paso, { accion: 'quitada', id: a.id, instancia: a.instancia, tags: a.tags }));
        this.averias = []; return { ok: true };
      case 'averias.reparar': {
        const buenas = this.averias.filter(a => {
          const s = AVERIA_POR_ID[a.id].solucion;
          return s.accion === v.accion && (s.tag !== null ? s.tag === o.destino : a.tags.includes(o.destino));
        });
        if (!buenas.length) return { ok: true, datos: { correcta: false } };
        this.averias = this.averias.filter(a => !buenas.includes(a));
        for (const a of buenas) evs.push(ev('averia', paso, { accion: 'reparada', id: a.id, instancia: a.instancia, tags: a.tags }));
        return { ok: true, datos: { correcta: true, ids: buenas.map(a => a.id) } };
      }
    }
    return no('orden_desconocida', 'Orden desconocida.');
  }
  medir(q) {
    const no = (motivo, texto, datos) => (datos ? { valida: false, texto, motivo, datos } : { valida: false, texto, motivo });
    if (!esObjetoPlano(q) || typeof q.instrumento !== 'string' || typeof q.magnitud !== 'string') return no('peticion_invalida', 'Petición de medida mal formada.');
    const mags = MAGNITUDES[q.instrumento];
    if (!mags) return no('instrumento_desconocido', `No hay ${q.instrumento} en esta planta.`);
    if (!mags.includes(q.magnitud)) return no('magnitud_invalida', `El ${q.instrumento} no mide ${q.magnitud}.`);
    const campo = q.instrumento === 'multimetro' || q.instrumento === 'osciloscopio' ? 'a' : 'elemento';
    if (typeof q[campo] !== 'string') return no('peticion_invalida', `Falta el punto (${campo}).`);
    const p = PUNTOS.find(x => x.instrumento === q.instrumento && x.id === q[campo]);
    if (!p) return no('punto_desconocido', `Punto de medida desconocido: ${q[campo]}.`);
    if (!p.magnitudes.includes(q.magnitud)) return no('magnitud_invalida', `En ${p.id} no se mide ${q.magnitud}.`);
    const ma = 4 + 16 * this.caudal / CAUDAL_MAX_LH;
    const si = (valor, unidad, texto, datos) => (datos ? { valida: true, valor, unidad, texto, datos } : { valida: true, valor, unidad, texto });
    switch (q.magnitud) {
      case 'tension': return si(this.lectura, 'V', `${this.lectura.toFixed(2)} V`);
      case 'corriente': return si(ma, 'mA', `${ma.toFixed(2)} mA`);
      case 'resistencia': case 'continuidad':
        if (this.marcha && !this.disparo) return no('con_tension', 'La bobina tiene tensión: para la bomba antes de medir.', { voltios: 24 });
        return si(120, 'Ω', '120 Ω', { continuidad: true, abierto: false });
      case 'formaOnda': return { valida: true, unidad: 'mA', texto: 'Lazo estable', datos: { muestras: Array(8).fill(ma), unidad: 'mA', dtMs: 1 } };
      case 'presion': return si(this.presion(), 'bar', `${this.presion().toFixed(3)} bar`);
      case 'temperatura': return si(18, '°C', '18 °C');
    }
    return no('magnitud_invalida', 'Magnitud no válida.');
  }
}

// ----------------------------------------------------------------- fábrica ----

function crearFabrica(opcionesJuguete = {}) {
  const fallo = opcionesJuguete.fallo || null;

  /** Núcleo recién creado con las condiciones y órdenes iniciales del escenario. Lanza escenario_invalido si una orden inicial falla. */
  function construir(semilla, escenario) {
    const n = new Nucleo(semilla, escenario && escenario.condiciones.valvulasManuales);
    n.codigoQuitarMalo = fallo === 'quitar_codigo_malo';
    for (const o of escenario ? escenario.ordenesIniciales : []) {
      if (validarOrden(o) || !n.aplicar(o, 0, []).ok) throw errorCodigo('escenario_invalido');
    }
    n.alarmasPrevias = n.alarmas();
    return n;
  }

  function crearSimulacion(opciones) {
    if (!esObjetoPlano(opciones) || !semillaValida(opciones.semilla)) throw errorCodigo('opciones_invalidas');
    validarEscenario(opciones.escenario);
    let semilla = opciones.semilla;
    let escenario = opciones.escenario ? congelar(clonar(opciones.escenario)) : null;
    let nucleo = construir(semilla, escenario);
    let pasos = 0, restoS = 0, ordenes = [], ocupado = false, cache = null;
    const subs = [];

    const fallar = (motivo, texto) => ({ ok: false, motivo, texto });
    const reentrada = () => fallar('reentrada', 'La simulación está ocupada: inténtalo después.');
    const copiaSegura = o => { try { return o === undefined ? null : congelar(clonar(o)); } catch { return null; } };
    function emitir(evs) {
      for (const e of evs) for (const s of subs.slice()) { try { s.fn(e); } catch { /* el error del suscriptor se descarta (§2.0) */ } }
    }
    function darPasos(k, evs) {
      if (fallo === 'paso_variable') { if (k) { pasos += k; nucleo.paso(k * PASO, pasos, evs); } return; }
      for (let i = 0; i < k; i++) { pasos++; nucleo.paso(PASO, pasos, evs); }
    }

    const sim = {
      id: ID, versionContrato: T.VERSION_CONTRATO, pasoFijoS: PASO,
      avanzar(dtS) {
        if (ocupado) return reentrada();
        if (typeof dtS !== 'number' || !Number.isFinite(dtS) || dtS < 0) return fallar('dt_invalido', 'El intervalo de tiempo no es válido.');
        if (dtS > T.DT_MAX_S) return fallar('dt_excesivo', `Como mucho ${T.DT_MAX_S} s de una vez.`);
        if (dtS === 0) return { ok: true, datos: { pasos: 0 } };
        ocupado = true;
        try {
          restoS += dtS;
          let k = 0;
          const P = fallo === 'paso_doble' && dtS >= 1 ? 2 * PASO : PASO;
          while (restoS >= P - T.EPS_PASO_S) { restoS -= P; k++; }
          if (restoS < 0) restoS = 0;
          const evs = [];
          darPasos(k, evs);
          if (k) cache = null;
          emitir(evs);
          return { ok: true, datos: { pasos: k } };
        } finally { ocupado = false; }
      },
      avanzarPasos(n) {
        if (ocupado) return reentrada();
        if (!Number.isInteger(n) || n < 0 || n > T.PASOS_MAX_POR_LLAMADA) return fallar('pasos_invalidos', 'Número de pasos no válido.');
        ocupado = true;
        try {
          const evs = [];
          darPasos(n, evs);
          if (n) cache = null;
          emitir(evs);
          return { ok: true, datos: { pasos: n } };
        } finally { ocupado = false; }
      },
      tiempo() { return { pasos, tS: pasos * PASO, restoS }; },
      estado() {
        if (fallo === 'estado_mutable') return nucleo.estado();
        if (!cache) cache = congelar(nucleo.estado());
        return cache;
      },
      ejecutar(orden) {
        if (ocupado) return reentrada();
        ocupado = true;
        try {
          const err = validarOrden(orden, fallo === 'recorta_valores');
          const evs = [];
          const r = err ? fallar(err.motivo, err.texto) : nucleo.aplicar(orden, pasos, evs);
          if (!r.ok) { emitir([ev('orden_rechazada', pasos, { orden: copiaSegura(orden), resultado: congelar(clonar(r)) })]); return r; }
          ordenes.push(congelar({ paso: pasos, orden: clonar(orden) }));
          nucleo.revisarAlarmas(pasos, evs);
          cache = null;
          emitir([ev('orden', pasos, { orden: copiaSegura(orden), resultado: congelar(clonar(r)) }), ...evs]);
          return r;
        } finally { ocupado = false; }
      },
      ordenesDisponibles() { return DESCRIPCIONES; },
      puntos() { return PUNTOS; },
      medir(peticion) {
        const m = nucleo.medir(peticion);
        if (fallo === 'medir_cambia') nucleo.rng();
        emitir([ev('medida', pasos, { peticion: copiaSegura(peticion), medida: congelar({ ...m, datos: m.datos && clonar(m.datos) }) })]);
        return m;
      },
      averias: {
        catalogo() { return CATALOGO; },
        activas() {
          return clonar(nucleo.averias).sort((a, b) => a.desdePaso - b.desdePaso || (a.instancia < b.instancia ? -1 : a.instancia > b.instancia ? 1 : 0));
        },
      },
      suscribir(fn) {
        const entrada = { fn };
        subs.push(entrada);
        return () => { const i = subs.indexOf(entrada); if (i >= 0) subs.splice(i, 1); };
      },
      instantanea() {
        return { simulador: ID, versionContrato: T.VERSION_CONTRATO, pasoFijoS: PASO, semilla, escenario: escenario ? clonar(escenario) : null,
          pasos, restoS, datos: { ordenes: clonar(ordenes) } };
      },
      restaurar(x) {
        if (ocupado) return reentrada();
        const invalida = () => fallar('instantanea_invalida', 'La instantánea no es válida.');
        if (!esObjetoPlano(x) || typeof x.simulador !== 'string' || typeof x.versionContrato !== 'number' || typeof x.pasoFijoS !== 'number' ||
          !semillaValida(x.semilla) || !Number.isInteger(x.pasos) || x.pasos < 0 || typeof x.restoS !== 'number' || !(x.restoS >= 0 && x.restoS < PASO) ||
          !esObjetoPlano(x.datos) || !Array.isArray(x.datos.ordenes)) return invalida();
        if (x.simulador !== ID) return fallar('simulador_incompatible', 'La instantánea es de otro simulador.');
        if (x.versionContrato !== T.VERSION_CONTRATO) return fallar('version_incompatible', 'La instantánea es de otra versión del contrato.');
        if (x.pasoFijoS !== PASO) return fallar('paso_incompatible', 'La instantánea usa otro paso fijo.');
        let n, esc;
        try {                                                                                  // restauración por repetición del registro
          validarEscenario(x.escenario);
          esc = x.escenario ? congelar(clonar(x.escenario)) : null;
          n = construir(x.semilla, esc);
          let p = 0;
          for (const { paso, orden } of x.datos.ordenes) {
            if (!Number.isInteger(paso) || paso < p || paso > x.pasos) throw new Error('paso');
            while (p < paso) n.paso(PASO, ++p, []);
            if (validarOrden(orden) || !n.aplicar(orden, p, []).ok) throw new Error('orden');
            n.revisarAlarmas(p, []);
          }
          while (p < x.pasos) n.paso(PASO, ++p, []);
        } catch { return invalida(); }
        ocupado = true;
        try {
          nucleo = n; escenario = esc; semilla = x.semilla; pasos = x.pasos; restoS = x.restoS; cache = null;
          ordenes = x.datos.ordenes.map(o => congelar(clonar(o)));
          emitir([ev('restauracion', pasos, { pasos })]);
          return { ok: true };
        } finally { ocupado = false; }
      },
      registro() {
        return { simulador: ID, versionContrato: T.VERSION_CONTRATO, semilla, escenario: escenario ? clonar(escenario) : null, pasoFijoS: PASO, pasos,
          ordenes: clonar(ordenes) };
      },
      reiniciar(op) {
        if (ocupado) return reentrada();
        if (op !== undefined && !esObjetoPlano(op)) return fallar('opciones_invalidas', 'Opciones de reinicio no válidas.');
        const s = op && 'semilla' in op ? op.semilla : semilla;
        if (!semillaValida(s)) return fallar('opciones_invalidas', 'La semilla debe ser un entero entre 1 y 2³²−1.');
        const e = op && 'escenario' in op ? op.escenario : escenario;
        let n;
        try { validarEscenario(e); n = construir(s, e ? congelar(clonar(e)) : null); } catch (err) { return fallar(err.codigo || 'escenario_invalido', 'El escenario no es válido.'); }
        ocupado = true;
        try {
          nucleo = n; semilla = s; escenario = e ? congelar(clonar(e)) : null; pasos = 0; restoS = 0; ordenes = []; cache = null;
          emitir([ev('reinicio', 0, { semilla, escenario: escenario ? clonar(escenario) : null })]);
          return { ok: true };
        } finally { ocupado = false; }
      },
    };
    return sim;
  }
  return crearSimulacion;
}

module.exports = { id: ID, crearSimulacion: crearFabrica(), crearFabrica };
