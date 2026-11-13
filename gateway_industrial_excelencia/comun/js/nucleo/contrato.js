// Núcleo común · adaptador del contrato de simulación (comun/CONTRATO.md §2–§7) y registro de fábricas.
//   PCT.contrato.registrar(id, fabrica) · PCT.contrato.fabrica(id) · PCT.contrato.repetir(registro, crear) (en registro.js)
//   crearSimulacionContrato(def, opciones) → Simulacion: todo lo que es igual en los simuladores (paso fijo, validación de órdenes y peticiones, registro, eventos,
//     instantáneas por repetición del registro, reinicio, reentrada) vive aquí; cada simulador solo aporta un «motor» con su física:
//
//   def = { id, pasoFijoS, esquemaCondiciones: { nombre: EsquemaValor }, ordenes: DescripcionOrden[], ordenesOcultas?: DescripcionOrden[],
//           validarOrden?(orden, descripcion) → { motivo, texto } | null      (comprobaciones de valores que el esquema no expresa),
//           crearMotor({ semilla, condiciones }) → motor, puntos() → PuntoMedida[], catalogo() → Averia[], antigua?(sim, motorActual) }
//   motor = { paso(), publicar(), estadoVivo(), ejecutar(orden) → Resultado, medir(peticion) → Medida, activas() → [{ instancia, id, tags, parametros }],
//             alarmas() → [{ codigo, tag, nivel, texto }], disparos() → [{ tag, activo, causa }] (siempre la misma lista y en el mismo orden) }
//   El motor recibe órdenes ya validadas en forma, tipo, destino y valores; él responde 'no_permitida' y los motivos de averías, y NO cambia nada si falla.
//   envolver(sim, traductores) construye la API antigua (antigua()) haciendo pasar cada función por ejecutar() con origen 'alumno'.
(function () {
  'use strict';
  const enNode = typeof require !== 'undefined';
  const T = enNode ? require('../../tipos.js') : window.PCT.contratoTipos;
  const N = enNode ? Object.assign({}, require('./congelar.js'), require('./paso_fijo.js'), require('./eventos.js'), require('./registro.js'), require('./azar.js')) : window.PCT.nucleo;
  const { esObjetoPlano, clonar, clonarCongelado, crearAcumulador, crearEmisor, crearRegistro, semillaValida } = N;

  // ---------------------------------------------------------------- registro de fábricas ----
  const fabricas = new Map();
  function registrar(id, fab) {
    if (fabricas.has(id) && fabricas.get(id) !== fab) throw Object.assign(new Error('fabrica_duplicada'), { codigo: 'fabrica_duplicada' });
    fabricas.set(id, fab);
  }
  const fabrica = id => fabricas.get(id) || null;

  // ---------------------------------------------------------------- textos para el alumno ----
  const TEXTOS = {
    dt_invalido: 'El tiempo debe ser un número de segundos, 0 o más.', dt_excesivo: 'Como mucho una hora por llamada: trocea las esperas largas.',
    pasos_invalidos: 'El número de pasos debe ser un entero entre 0 y 36 000.', reentrada: 'Espera: la simulación está terminando otra operación.',
    orden_invalida: 'Orden mal formada.', orden_desconocida: 'Esa orden no existe en este simulador.', destino_desconocido: 'Ese equipo no admite esta orden.',
    valores_invalidos: 'Valor no válido.', no_permitida: 'No se puede hacer en el estado actual.',
    averia_desconocida: 'Esa avería no existe.', averia_incompatible: 'Esa avería no puede convivir con las que ya hay.', instancia_desconocida: 'Esa avería no está activa.',
    codigo_invalido: 'Código no válido.', peticion_invalida: 'Medida mal pedida.', instrumento_desconocido: 'Ese instrumento no existe aquí.',
    magnitud_invalida: 'Ese instrumento no mide eso en este punto.', punto_desconocido: 'Ese punto de medida no existe.', con_tension: 'Hay tensión: no se puede medir resistencia.',
    requiere_maniobra: 'Antes hay que hacer una maniobra.', sin_referencia: 'Las dos puntas no tienen referencia común.',
    instantanea_invalida: 'Instantánea mal formada.', simulador_incompatible: 'Es de otro simulador.', version_incompatible: 'Es de otra versión del contrato.',
    paso_incompatible: 'Es de otro paso de simulación.', opciones_invalidas: 'Opciones no válidas.', escenario_invalido: 'Escenario no válido.',
  };
  const rechazo = (motivo, texto) => ({ ok: false, motivo, texto: texto || TEXTOS[motivo] || motivo });
  const errorCodigo = (codigo, texto) => Object.assign(new Error(texto || codigo), { codigo });

  // ---------------------------------------------------------------- validación de valores ----
  /** null si v cumple el esquema; si no, el texto del problema. */
  function problemaValor(v, e) {
    if (v === null) return e.nulo ? null : 'no admite vacío';
    switch (e.tipo) {
      case 'numero': if (typeof v !== 'number' || !Number.isFinite(v)) return 'debe ser un número'; break;
      case 'entero': if (!Number.isInteger(v)) return 'debe ser un número entero'; break;
      case 'booleano': return typeof v === 'boolean' ? null : 'debe ser sí o no (booleano)';
      case 'texto': return typeof v === 'string' ? null : 'debe ser un texto';
      case 'opcion': return Array.isArray(e.opciones) && e.opciones.includes(v) ? null : `debe ser una de: ${(e.opciones || []).join(', ')}`;
      default: return 'tipo de valor desconocido';
    }
    if (typeof e.min === 'number' && v < e.min) return `el mínimo es ${e.min}${e.unidad ? ' ' + e.unidad : ''}`;
    if (typeof e.max === 'number' && v > e.max) return `el máximo es ${e.max}${e.unidad ? ' ' + e.unidad : ''}`;
    return null;
  }
  /** null si `valores` cumple `esquema` (sin claves desconocidas salvo `extras`); si no, el texto del problema. */
  function problemaValores(valores, esquema, extras) {
    const v = valores === undefined ? {} : valores, E = esquema || {};
    if (!esObjetoPlano(v)) return 'los valores deben ir en un objeto';
    for (const k of Object.keys(v)) if (!Object.prototype.hasOwnProperty.call(E, k) && !(extras || []).includes(k)) return `valor desconocido: ${k}`;
    for (const [k, e] of Object.entries(E)) {
      if (!Object.prototype.hasOwnProperty.call(v, k) || v[k] === undefined) { if (!e.opcional) return `falta el valor ${k}`; continue; }
      const p = problemaValor(v[k], e);
      if (p) return `${k}: ${p}`;
    }
    return null;
  }

  /** Comprueba los parámetros de una avería contra su esquema del catálogo (formato del contrato). null o texto. */
  function problemaParametrosAveria(averia, parametros) {
    if (parametros === undefined || parametros === null) return null;
    if (!esObjetoPlano(parametros)) return 'los parámetros deben ir en un objeto';
    const E = {};
    for (const [k, e] of Object.entries(averia.parametros || {})) E[k] = Object.assign({}, e, { opcional: true });
    return problemaValores(parametros, E);
  }

  // ---------------------------------------------------------------- escenarios ----
  function problemaEscenario(esc, id, esquemaCondiciones) {
    if (!esObjetoPlano(esc)) return ['escenario_invalido', 'El escenario debe ser un objeto.'];
    if (esc.simulador !== id) return ['simulador_incompatible', `El escenario es de otro simulador (${esc.simulador}).`];
    if (esc.versionContrato !== T.VERSION_CONTRATO) return ['version_incompatible', `El escenario es de la versión ${esc.versionContrato} del contrato.`];
    if (esc.id !== undefined && (typeof esc.id !== 'string' || !/^[a-z0-9_]{3,40}$/.test(esc.id))) return ['escenario_invalido', 'id del escenario no válido.'];
    if (esc.titulo !== undefined && typeof esc.titulo !== 'string') return ['escenario_invalido', 'título no válido.'];
    if (esc.esperaS !== undefined && !(typeof esc.esperaS === 'number' && Number.isFinite(esc.esperaS) && esc.esperaS >= 0)) return ['escenario_invalido', 'esperaS no válido.'];
    const c = esc.condiciones === undefined ? {} : esc.condiciones;
    if (!esObjetoPlano(c)) return ['escenario_invalido', 'condiciones debe ser un objeto.'];
    const E = {};
    for (const [k, e] of Object.entries(esquemaCondiciones || {})) E[k] = Object.assign({}, e, { opcional: true });
    const p = problemaValores(c, E);
    if (p) return ['escenario_invalido', `Condiciones: ${p}.`];
    if (esc.ordenesIniciales !== undefined && !Array.isArray(esc.ordenesIniciales)) return ['escenario_invalido', 'ordenesIniciales debe ser una lista.'];
    if (esc.objetivos !== undefined && !Array.isArray(esc.objetivos)) return ['escenario_invalido', 'objetivos debe ser una lista.'];
    return null;
  }

  // ---------------------------------------------------------------- envolver API antiguas ----
  /**
   * envolver(sim, traductores, { origen }) → objeto con la misma forma que `traductores`. Cada hoja es una función que recibe los argumentos de la API antigua y
   * devuelve una Orden sin origen (o null: no se hace nada), o un objeto { orden, devolver(resultado) } para dar lo que devolvía la función antigua.
   */
  function envolver(sim, traductores, opciones) {
    const origen = (opciones && opciones.origen) || 'alumno';
    const hacer = t => {
      const o = {};
      for (const [k, v] of Object.entries(t)) {
        if (typeof v !== 'function') { o[k] = hacer(v); continue; }
        o[k] = (...args) => {
          const r = v(...args);
          if (!r) return undefined;
          const orden = r.orden ? r.orden : r, devolver = r.orden ? r.devolver : null;
          if (!orden || !orden.tipo) return devolver ? devolver(null) : undefined;
          const res = sim.ejecutar(Object.assign({}, orden, { origen }));
          return devolver ? devolver(res) : res;
        };
      }
      return o;
    };
    return hacer(traductores);
  }

  // ---------------------------------------------------------------- la Simulacion ----
  function crearSimulacionContrato(def, opciones) {
    const id = def.id, PASO = def.pasoFijoS;
    const ORDENES = def.ordenes, OCULTAS = def.ordenesOcultas || [];
    const DESC = new Map(ORDENES.concat(OCULTAS).map(d => [d.tipo, d]));
    const MAGNITUDES = T.MAGNITUDES_POR_SIMULADOR[id] || {};
    const ordenesPublicas = clonarCongelado(ORDENES);
    let catalogoCache = null, puntosCache = null;

    function leerOpciones(op, previas) {
      if (op === undefined && previas) op = {};
      if (!esObjetoPlano(op)) throw errorCodigo('opciones_invalidas', 'Las opciones deben ser un objeto con la semilla.');
      const semilla = Object.prototype.hasOwnProperty.call(op, 'semilla') || !previas ? op.semilla : previas.semilla;
      if (!semillaValida(semilla)) throw errorCodigo('opciones_invalidas', 'La semilla debe ser un entero entre 1 y 4 294 967 295.');
      let escenario = previas && !Object.prototype.hasOwnProperty.call(op, 'escenario') ? previas.escenario : op.escenario;
      if (escenario === undefined) escenario = null;
      if (escenario !== null) { const p = problemaEscenario(escenario, id, def.esquemaCondiciones); if (p) throw errorCodigo(p[0], p[1]); }
      return { semilla, escenario: escenario === null ? null : clonarCongelado(escenario) };
    }

    // «Mundo»: todo lo que cambia con la simulación. restaurar y reiniciar construyen uno nuevo aparte y lo cambian de golpe (si fallan, no cambia nada).
    function construir(semilla, escenario) {
      const condiciones = escenario ? clonar(escenario.condiciones || {}) : {};
      const W = { semilla, escenario, motor: def.crearMotor({ semilla, condiciones }), acum: crearAcumulador(PASO, { DT_MAX_S: T.DT_MAX_S, EPS_PASO_S: T.EPS_PASO_S, PASOS_MAX_POR_LLAMADA: T.PASOS_MAX_POR_LLAMADA }),
        reg: crearRegistro({ simulador: id, versionContrato: T.VERSION_CONTRATO, semilla, escenario, pasoFijoS: PASO }), desde: new Map(), activas: new Map(),
        alarmas: new Map(), claveAlarmas: '', disparos: [], claveDisparos: '' };
      for (const orden of (escenario && escenario.ordenesIniciales) || []) {
        const r = ejecutarEn(W, orden, null, false);
        if (!r.ok) throw errorCodigo('escenario_invalido', `Orden inicial ${orden && orden.tipo}: ${r.texto}`);
      }
      W.motor.publicar();
      tomarBase(W);
      return W;
    }
    function tomarBase(W) {
      W.alarmas = new Map(); W.claveAlarmas = '';
      for (const a of W.motor.alarmas()) { const k = a.codigo + '|' + a.tag; W.alarmas.set(k, a); W.claveAlarmas += k + ';'; }
      W.disparos = W.motor.disparos().map(d => ({ tag: d.tag, activo: !!d.activo, causa: d.causa || '' }));
      W.claveDisparos = W.disparos.map(d => (d.activo ? '1' : '0')).join('');
      W.activas = new Map(W.motor.activas().map(a => [a.instancia, a]));
    }

    const evento = (W, tipo, campos) => Object.assign({ tipo, paso: W.acum.pasos(), tS: W.acum.pasos() * PASO }, campos);

    /** Diferencias de alarmas y disparos tras un paso u orden → eventos (disparo antes que alarma, como pide §6). */
    function detectar(W, ev) {
      const dis = W.motor.disparos();
      let cd = '';
      for (const d of dis) cd += d.activo ? '1' : '0';
      if (cd !== W.claveDisparos) {
        const nuevos = dis.map(d => ({ tag: d.tag, activo: !!d.activo, causa: d.causa || '' }));
        nuevos.forEach((d, k) => {
          const antes = W.disparos[k];
          if (!antes || antes.activo !== d.activo) ev && ev.push(evento(W, 'disparo', { tag: d.tag, causa: d.activo ? d.causa : (antes && antes.causa) || d.causa, activo: d.activo }));
        });
        W.disparos = nuevos; W.claveDisparos = cd;
      }
      const al = W.motor.alarmas();
      let ca = '';
      for (const a of al) ca += a.codigo + '|' + a.tag + ';';
      if (ca !== W.claveAlarmas) {
        const ahora = new Map();
        for (const a of al) ahora.set(a.codigo + '|' + a.tag, a);
        if (ev) {
          for (const [k, a] of W.alarmas) if (!ahora.has(k)) ev.push(evento(W, 'alarma', { codigo: a.codigo, tag: a.tag, nivel: a.nivel, texto: a.texto, activa: false }));
          for (const [k, a] of ahora) if (!W.alarmas.has(k)) ev.push(evento(W, 'alarma', { codigo: a.codigo, tag: a.tag, nivel: a.nivel, texto: a.texto, activa: true }));
        }
        W.alarmas = ahora; W.claveAlarmas = ca;
      }
    }

    /** n pasos fijos sobre el mundo W; con `ev` (lista) apunta los eventos de cada paso; sin él (repetición silenciosa) no detecta nada. */
    function pasosEn(W, n, ev) {
      for (let i = 0; i < n; i++) {
        W.motor.paso(); W.acum.contar(1);
        if (ev) detectar(W, ev);
      }
      if (n > 0) { W.motor.publicar(); if (!ev) tomarBase(W); }
    }

    /** Valida forma, tipo, destino y valores. → null o Resultado de rechazo. */
    function validarOrden(orden) {
      if (!esObjetoPlano(orden) || typeof orden.tipo !== 'string' || !T.ORIGENES.includes(orden.origen) || (orden.valores !== undefined && !esObjetoPlano(orden.valores))) {
        return rechazo('orden_invalida', 'Orden mal formada: necesita tipo, origen (alumno, profesor, guion o sistema) y, si lleva valores, un objeto.');
      }
      const d = DESC.get(orden.tipo);
      if (!d) return rechazo('orden_desconocida', `La orden ${orden.tipo} no existe en este simulador.`);
      if (d.destinos) { if (!d.destinos.includes(orden.destino)) return rechazo('destino_desconocido', `${orden.destino === undefined ? 'Falta el equipo' : orden.destino + ' no admite ' + orden.tipo}.`); }
      else if (orden.destino !== undefined) return rechazo('destino_desconocido', `La orden ${orden.tipo} no lleva equipo.`);
      const especial = def.validarOrden ? def.validarOrden(orden, d) : undefined;
      if (especial) return rechazo(especial.motivo || 'valores_invalidos', especial.texto);
      if (especial === undefined) { const p = problemaValores(orden.valores, d.valores, d.extras); if (p) return rechazo('valores_invalidos', `Valor no válido: ${p}.`); }
      return null;
    }

    /** Ejecuta una orden ya copiada sobre W. ev = lista de eventos (o null en silencio); apuntar = va al registro. */
    function ejecutarEn(W, orden, ev, apuntar) {
      const mal = validarOrden(orden);
      if (mal) return mal;
      const r = W.motor.ejecutar(orden) || rechazo('no_permitida');
      if (!r.ok) return Object.assign(rechazo(r.motivo || 'no_permitida', r.texto), r.datos ? { datos: r.datos } : {});
      if (apuntar) W.reg.apuntar(W.acum.pasos(), orden);
      W.motor.publicar();
      const res = { ok: true };
      if (r.texto) res.texto = r.texto;
      if (r.aviso) res.aviso = r.aviso;
      if (r.datos) res.datos = r.datos;
      if (ev) ev.push(evento(W, 'orden', { orden, resultado: clonar(res) }));
      // Averías: qué instancias aparecen y desaparecen con esta orden
      const ahora = W.motor.activas(), mapa = new Map(ahora.map(a => [a.instancia, a]));
      const accionQuitada = orden.tipo === 'averias.reparar' ? 'reparada' : /^protecciones\./.test(orden.tipo) ? 'retirada_por_maniobra' : 'quitada';
      for (const [inst, a] of W.activas) if (!mapa.has(inst)) { W.desde.delete(inst); ev && ev.push(evento(W, 'averia', { accion: accionQuitada, id: a.id, instancia: inst, tags: a.tags.slice() })); }
      for (const a of ahora) if (!W.activas.has(a.instancia)) { W.desde.set(a.instancia, W.acum.pasos()); ev && ev.push(evento(W, 'averia', { accion: 'activada', id: a.id, instancia: a.instancia, tags: a.tags.slice() })); }
      if (orden.tipo === 'averias.reparar' && r.datos && r.datos.correcta === false && ev) {
        for (const a of ahora) ev.push(evento(W, 'averia', { accion: 'reparacion_fallida', id: a.id, instancia: a.instancia, tags: a.tags.slice() }));
      }
      W.activas = mapa;
      if (ev) detectar(W, ev); else tomarBase(W);
      return res;
    }

    // ---- estado de la Simulacion ----
    const ini = leerOpciones(opciones, null);
    let W = construir(ini.semilla, ini.escenario);
    let cacheEstado = null, ocupado = false, antiguaCache = null;
    const emisor = crearEmisor();
    const emitirTodos = ev => { for (const e of ev) emisor.emitir(e); };

    function avanzar(dtS) {
      if (ocupado) return rechazo('reentrada');
      const m = W.acum.validarDt(dtS);
      if (m) return rechazo(m);
      if (dtS === 0) return { ok: true, datos: { pasos: 0 } };
      ocupado = true;
      try {
        const k = W.acum.cuantos(dtS), ev = [];
        pasosEn(W, k, ev);
        if (k > 0) cacheEstado = null;
        emitirTodos(ev);
        return { ok: true, datos: { pasos: k } };
      } finally { ocupado = false; }
    }
    function avanzarPasos(n) {
      if (ocupado) return rechazo('reentrada');
      const m = W.acum.validarPasos(n);
      if (m) return rechazo(m);
      if (n === 0) return { ok: true, datos: { pasos: 0 } };
      ocupado = true;
      try {
        const ev = [];
        pasosEn(W, n, ev);
        cacheEstado = null;
        emitirTodos(ev);
        return { ok: true, datos: { pasos: n } };
      } finally { ocupado = false; }
    }
    function ejecutar(orden) {
      if (ocupado) return rechazo('reentrada');
      ocupado = true;
      try {
        let copia;
        try { copia = clonarCongelado(orden); } catch (error) { copia = null; }
        const ev = [];
        const res = ejecutarEn(W, copia, ev, true);
        if (!res.ok) { emisor.emitir(evento(W, 'orden_rechazada', { orden: copia === undefined ? null : copia, resultado: clonar(res) })); return res; }
        cacheEstado = null;
        emitirTodos(ev);
        return res;
      } finally { ocupado = false; }
    }

    // ---- medidas ----
    const CAMPO_PUNTO = { multimetro: 'a', osciloscopio: 'a', pinza: 'conductor' };
    function validarPeticion(p) {
      if (!esObjetoPlano(p) || typeof p.instrumento !== 'string' || typeof p.magnitud !== 'string') return { motivo: 'peticion_invalida', texto: 'Medida mal pedida: hace falta instrumento y magnitud.' };
      const mags = MAGNITUDES[p.instrumento];
      if (!mags) return { motivo: 'instrumento_desconocido', texto: `Aquí no hay ${p.instrumento}.` };
      if (!mags.includes(p.magnitud)) return { motivo: 'magnitud_invalida', texto: `El ${p.instrumento} no mide ${p.magnitud}.` };
      if (p.opciones !== undefined) {
        if (!esObjetoPlano(p.opciones)) return { motivo: 'peticion_invalida', texto: 'opciones debe ser un objeto.' };
        const n = p.opciones.puntos;
        if (n !== undefined && !(Number.isInteger(n) && n >= 4 && n <= 400)) return { motivo: 'peticion_invalida', texto: 'puntos: entero de 4 a 400.' };
      }
      const campo = CAMPO_PUNTO[p.instrumento] || 'elemento';
      const sinPunto = p.instrumento === 'termografia' && p.magnitud === 'imagen';
      if (!sinPunto && typeof p[campo] !== 'string') return { motivo: 'peticion_invalida', texto: `Falta ${campo === 'a' ? 'la punta roja (a)' : campo === 'conductor' ? 'el conductor' : 'el elemento'}.` };
      return null;
    }
    function medir(peticion) {
      let copia;
      try { copia = clonar(peticion); } catch (error) { copia = null; }
      const mal = validarPeticion(copia);
      let med;
      if (mal) med = { valida: false, motivo: mal.motivo, texto: mal.texto };
      else med = W.motor.medir(copia) || { valida: false, motivo: 'punto_desconocido', texto: TEXTOS.punto_desconocido };
      if (med.valida && med.valor === Infinity) med.datos = Object.assign({}, med.datos || {}, { ol: true });
      if (!med.texto) med.texto = med.valida ? `${med.valor} ${med.unidad || ''}`.trim() : TEXTOS[med.motivo] || 'Medida no válida';
      emisor.emitir(evento(W, 'medida', { peticion: copia === undefined ? null : copia, medida: clonar(med) }));
      return med;
    }

    // ---- instantáneas, registro y reinicio ----
    function instantanea() {
      const t = W.acum.tiempo(), r = W.reg.exportar(t.pasos);
      return { simulador: id, versionContrato: T.VERSION_CONTRATO, pasoFijoS: PASO, semilla: W.semilla, escenario: clonar(W.escenario), pasos: t.pasos, restoS: t.restoS,
        datos: { ordenes: r.ordenes } };
    }
    /** Rehace un mundo repitiendo el registro en silencio (contrato §2.9, restauración por repetición: R5 y R10). */
    function rehacer(semilla, escenario, ordenes, pasos) {
      const N2 = construir(semilla, escenario);
      for (const e of ordenes) {
        if (!esObjetoPlano(e) || !Number.isInteger(e.paso) || e.paso < N2.acum.pasos() || e.paso > pasos) throw errorCodigo('instantanea_invalida');
        pasosEn(N2, e.paso - N2.acum.pasos(), null);
        const copia = clonarCongelado(e.orden);
        const r = ejecutarEn(N2, copia, null, true);
        if (!r.ok) throw errorCodigo('instantanea_invalida', `La orden ${copia && copia.tipo} del paso ${e.paso} no se puede repetir.`);
      }
      pasosEn(N2, pasos - N2.acum.pasos(), null);
      return N2;
    }
    function restaurar(x) {
      if (ocupado) return rechazo('reentrada');
      if (!esObjetoPlano(x) || typeof x.simulador !== 'string' || typeof x.versionContrato !== 'number' || typeof x.pasoFijoS !== 'number' || !esObjetoPlano(x.datos) || !Array.isArray(x.datos.ordenes)
        || !Number.isInteger(x.pasos) || x.pasos < 0 || typeof x.restoS !== 'number' || !Number.isFinite(x.restoS) || x.restoS < 0 || !semillaValida(x.semilla)) return rechazo('instantanea_invalida');
      if (x.simulador !== id) return rechazo('simulador_incompatible');
      if (x.versionContrato !== T.VERSION_CONTRATO) return rechazo('version_incompatible');
      if (x.pasoFijoS !== PASO) return rechazo('paso_incompatible');
      if (x.restoS >= PASO) return rechazo('instantanea_invalida');
      ocupado = true;
      try {
        let N2;
        try {
          const esc = x.escenario == null ? null : x.escenario;
          if (esc !== null && problemaEscenario(esc, id, def.esquemaCondiciones)) return rechazo('instantanea_invalida');
          N2 = rehacer(x.semilla, esc === null ? null : clonarCongelado(esc), x.datos.ordenes, x.pasos);
        } catch (error) { return rechazo('instantanea_invalida', error && error.codigo === 'instantanea_invalida' && error.message !== 'instantanea_invalida' ? error.message : undefined); }
        N2.acum.fijar(x.pasos, x.restoS);
        W = N2; cacheEstado = null;
        emisor.emitir(evento(W, 'restauracion', { pasos: x.pasos }));
        return { ok: true, datos: { pasos: x.pasos } };
      } finally { ocupado = false; }
    }
    function reiniciar(op) {
      if (ocupado) return rechazo('reentrada');
      let nuevas, N2;
      try { nuevas = leerOpciones(op, { semilla: W.semilla, escenario: W.escenario }); N2 = construir(nuevas.semilla, nuevas.escenario); }
      catch (error) { return rechazo(error && error.codigo && TEXTOS[error.codigo] ? error.codigo : 'opciones_invalidas', error && error.message); }
      ocupado = true;
      try {
        W = N2; cacheEstado = null;
        emisor.emitir(evento(W, 'reinicio', { semilla: W.semilla, escenario: clonar(W.escenario) }));
        return { ok: true };
      } finally { ocupado = false; }
    }

    const sim = {
      id, versionContrato: T.VERSION_CONTRATO, pasoFijoS: PASO,
      avanzar, avanzarPasos,
      tiempo: () => W.acum.tiempo(),
      estado: () => cacheEstado || (cacheEstado = clonarCongelado(W.motor.estadoVivo())),
      ejecutar,
      ordenesDisponibles: () => clonar(ordenesPublicas),
      puntos: () => clonar(puntosCache || (puntosCache = clonarCongelado(def.puntos()))),
      medir,
      averias: {
        catalogo: () => clonar(catalogoCache || (catalogoCache = clonarCongelado(def.catalogo()))),
        activas: () => W.motor.activas().map(a => ({ instancia: a.instancia, id: a.id, tags: a.tags.slice(), parametros: clonar(a.parametros), desdePaso: W.desde.has(a.instancia) ? W.desde.get(a.instancia) : 0 }))
          .sort((p, q) => p.desdePaso - q.desdePaso || (p.instancia < q.instancia ? -1 : p.instancia > q.instancia ? 1 : 0)),
      },
      suscribir: fn => emisor.suscribir(fn),
      instantanea, restaurar,
      registro: () => W.reg.exportar(W.acum.pasos()),
      reiniciar,
    };
    if (def.antigua) sim.antigua = () => antiguaCache || (antiguaCache = def.antigua(sim, () => W.motor));
    return sim;
  }

  const api = { registrar, fabrica, crearSimulacionContrato, envolver, problemaValor, problemaValores, problemaParametrosAveria, problemaEscenario, TEXTOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    const P = (window.PCT = window.PCT || {});
    P.nucleo = Object.assign(P.nucleo || {}, { crearSimulacionContrato, envolver });
    P.contrato = Object.assign(P.contrato || {}, { registrar, fabrica, crearSimulacionContrato, envolver });
  }
})();
