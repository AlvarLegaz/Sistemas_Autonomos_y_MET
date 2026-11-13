// Fábrica del contrato común de simulación para la fotovoltaica (comun/CONTRATO.md; tablas de §4.2 y §5.2). Doble export: module.exports = { id, crearSimulacion }
// y PCT.fv.contrato (se registra solo en PCT.contrato si el núcleo está cargado). La API antigua (PCT.fv.crearSimulacion) no cambia; sim.antigua() la da por encima de ejecutar.
// ORDEN DE CARGA en el navegador: comun/tipos.js → comun/js/nucleo/{congelar,azar,paso_fijo,eventos,registro,contrato}.js → los módulos del modelo y averías → este.
// Paso fijo: PASO_FIJO_S.fotovoltaica (1 s). Cada paso es UN micro-paso de la simulación de exactamente ese tiempo (R1), y la publicación del estado va aparte (R2).
(function () {
  'use strict';
  const enNode = typeof require !== 'undefined';
  const T = enNode ? require('../../../comun/tipos.js') : window.PCT.contratoTipos;
  const Nc = enNode ? require('../../../comun/js/nucleo/contrato.js') : window.PCT.contrato;
  const { clonar } = enNode ? require('../../../comun/js/nucleo/congelar.js') : window.PCT.nucleo;
  const Sim = enNode ? require('./simulacion.js') : window.PCT.fv.simulacion;
  const Medidas = enNode ? require('./medidas.js') : window.PCT.fv.medidas;
  const Prot = enNode ? require('./protecciones.js') : window.PCT.fv.protecciones;
  const Cat = enNode ? require('../averias/catalogo.js') : window.PCT.fv.catalogoAverias;
  const { layout } = enNode ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;

  const id = 'fotovoltaica';
  const PASO = T.PASO_FIJO_S[id];
  const PREPARACION_FIRMA_S = 400;          // lo que las pruebas de las firmas dejaban correr antes de activar la avería (tests/averias_diagnostico.test.js)
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));

  const PANELES = [].concat(...['A', 'B'].map(k => layout.CAMPOS[k].cadenas.map(c => c.paneles))).flat();
  const CADENAS = [].concat(...['A', 'B'].map(k => layout.CAMPOS[k].cadenas.map(c => c.id)));
  const MANIOBRABLES = Prot.INTERRUPTORES.concat(Prot.FUSIBLES);
  const REARMABLES = MANIOBRABLES.concat(Prot.DESCARGADORES);
  const MODOS_EASUN = layout.INVERSORES['INV-101'].modos;
  const GRUPO = Medidas.GRUPO;
  const CONDUCTOR = new Set(Medidas.CONDUCTORES.map(c => c.id));
  const TAGS_EQUIPOS = Array.from(new Set(layout.EQUIPOS.map(e => e.tag).concat(PANELES, CADENAS, Cat.CATALOGO.map(a => a.tag), Cat.CATALOGO.map(a => a.solucion.tag).filter(Boolean))));

  // ------------------------------------------------------------------------------------------------ órdenes (§4.2) ----
  const N01 = (texto, opcional) => Object.assign({ tipo: 'numero', min: 0, max: 1 }, opcional ? { opcional: true } : {}, texto ? { unidad: texto } : {});
  const ej = (tipo, destino, valores) => Object.assign({ tipo }, destino ? { destino } : {}, valores ? { valores } : {}, { origen: 'guion' });
  const ORDENES = [
    { tipo: 'reloj.poner', texto: 'Pone el día del año y la hora solar (al menos uno de los dos).',
      valores: { diaAnio: { tipo: 'entero', min: 1, max: 365, opcional: true }, horaSolar: { tipo: 'numero', min: 0, max: 24, unidad: 'h', opcional: true } }, ejemplo: ej('reloj.poner', null, { horaSolar: 12 }) },
    { tipo: 'ambiente.poner', texto: 'Cambia la nubosidad, la temperatura ambiente (null = automática) o la suciedad de cada campo (al menos uno).',
      valores: { nubosidad: N01('', true), temperaturaAmbienteC: { tipo: 'numero', min: -30, max: 60, unidad: '°C', nulo: true, opcional: true }, suciedadA: N01('', true), suciedadB: N01('', true) },
      ejemplo: ej('ambiente.poner', null, { nubosidad: 0.3 }) },
    { tipo: 'ambiente.sombra', texto: 'Sombra sobre un panel (0 = nada, 1 = entero).', destinos: PANELES, valores: { valor01: N01() }, ejemplo: ej('ambiente.sombra', 'PV-203', { valor01: 0.3 }) },
    { tipo: 'protecciones.cerrar', texto: 'Cierra un interruptor o seccionador (un fusible fundido no se cierra: se sustituye con rearmar).', destinos: MANIOBRABLES, ejemplo: ej('protecciones.cerrar', 'QS-101') },
    { tipo: 'protecciones.abrir', texto: 'Abre un interruptor, seccionador o portafusible.', destinos: MANIOBRABLES, ejemplo: ej('protecciones.abrir', 'QF-303') },
    { tipo: 'protecciones.rearmar', texto: 'Rearma un disparado, sustituye un fusible fundido o un descargador agotado.', destinos: REARMABLES, ejemplo: ej('protecciones.rearmar', 'QB-101') },
    { tipo: 'red.disponible', texto: 'Da o quita la red de la acometida.', destinos: ['RED-301'], valores: { disponible: { tipo: 'booleano' } }, ejemplo: ej('red.disponible', 'RED-301', { disponible: true }) },
    { tipo: 'red.tension', texto: 'Tensión de la red.', destinos: ['RED-301'], valores: { tensionV: { tipo: 'numero', min: 0, max: 300, unidad: 'V' } }, ejemplo: ej('red.tension', 'RED-301', { tensionV: 230 }) },
    { tipo: 'cargas.poner', texto: 'Consumo de una carga en W (null = perfil automático).', destinos: ['LOAD-301', 'LOAD-302'], valores: { w: { tipo: 'numero', min: 0, unidad: 'W', nulo: true } },
      ejemplo: ej('cargas.poner', 'LOAD-302', { w: 500 }) },
    { tipo: 'inversor.modoEasun', texto: 'Prioridad de fuentes del EASun.', destinos: ['INV-101'], valores: { modo: { tipo: 'opcion', opciones: MODOS_EASUN.slice() } },
      ejemplo: ej('inversor.modoEasun', 'INV-101', { modo: 'SOLAR_PRIMERO' }) },
    { tipo: 'inversor.encender', texto: 'Enciende o apaga un inversor.', destinos: ['INV-101', 'INV-201'], valores: { encendido: { tipo: 'booleano' } }, ejemplo: ej('inversor.encender', 'INV-201', { encendido: true }) },
    { tipo: 'bateria.socInicial', texto: 'Pone el estado de carga de la batería.', destinos: ['BAT-101'], valores: { pct: { tipo: 'numero', min: 0, max: 100, unidad: '%' } }, ejemplo: ej('bateria.socInicial', 'BAT-101', { pct: 60 }) },
    { tipo: 'averias.activar', texto: 'Activa una avería del catálogo (valores: id y, si hace falta, parametros).', valores: { id: { tipo: 'texto' } }, ejemplo: ej('averias.activar', null, { id: 'SPD_DISPARADO_A' }) },
    { tipo: 'averias.quitar', texto: 'Retira una avería activa (en la fotovoltaica la instancia es el id).', valores: { instancia: { tipo: 'texto' } }, ejemplo: ej('averias.quitar', null, { instancia: 'SPD_DISPARADO_A' }) },
    { tipo: 'averias.limpiar', texto: 'Retira todas las averías.', ejemplo: ej('averias.limpiar') },
    { tipo: 'averias.reparar', texto: 'El alumno hace una reparación sobre un equipo.', destinos: TAGS_EQUIPOS, valores: { accion: { tipo: 'opcion', opciones: T.ACCIONES_REPARACION.slice() } },
      ejemplo: ej('averias.reparar', 'SPD-101', { accion: 'sustituir' }) },
  ];

  const problema = texto => ({ motivo: 'valores_invalidos', texto: `Valor no válido: ${texto}.` });
  /** Comprobaciones que el esquema no expresa. undefined = usa el esquema; null = válido sin esquema; objeto = rechazo. */
  function validarOrden(o, d) {
    const v = o.valores || {};
    const p = Nc.problemaValores(o.valores, d.valores);
    if (o.tipo === 'averias.activar') {
      const resto = Object.assign({}, v); delete resto.parametros;
      const q = Nc.problemaValores(resto, d.valores);
      if (q) return problema(q);
      if (v.parametros !== undefined && (v.parametros === null || typeof v.parametros !== 'object' || Array.isArray(v.parametros))) return problema('parametros debe ser un objeto');
      return null;
    }
    if (p) return problema(p);
    if (o.tipo === 'reloj.poner') {
      if (v.diaAnio === undefined && v.horaSolar === undefined) return problema('falta diaAnio u horaSolar');
      if (v.horaSolar !== undefined && v.horaSolar >= 24) return problema('horaSolar debe ser menor que 24');
    }
    if (o.tipo === 'ambiente.poner' && ['nubosidad', 'temperaturaAmbienteC', 'suciedadA', 'suciedadB'].every(k => v[k] === undefined)) return problema('falta al menos un valor');
    return null;
  }

  // ------------------------------------------------------------------------------------------------ catálogo (§5.4) ----
  const rango = r => ({ min: Number.isFinite(r.min) ? r.min : null, max: Number.isFinite(r.max) ? r.max : null, unidad: r.unidad || '' });
  function peticionDe(m, ref) {
    if (m.instrumento === 'multimetro') { const p = ref || m.puntos; return { instrumento: 'multimetro', magnitud: m.modo === 'resistencia' ? 'resistencia' : 'tension', a: p[0], b: p[1] }; }
    if (m.instrumento === 'pinza') return { instrumento: 'pinza', magnitud: 'corriente', conductor: ref || m.conductor };
    if (m.instrumento === 'megohmetro') return { instrumento: 'megohmetro', magnitud: 'aislamiento', elemento: ref || m.tag };
    if (m.instrumento === 'trazadorIV') return { instrumento: 'trazadorIV', magnitud: m.campo || 'desviacionPct', elemento: ref || m.tag };
    return { instrumento: 'termografia', magnitud: (m.campo || 'deltaC') === 'deltaC' ? 'deltaC' : 'temperatura', elemento: ref || m.tag };
  }
  /** Escenario del contrato a partir del escenario de una firma antigua (lo que hacía prepararEscenario, como condiciones y órdenes iniciales). */
  function escenarioDe(a) {
    const e = a.firma.escenario, ordenes = [];
    ordenes.push(ej('bateria.socInicial', 'BAT-101', { pct: e.socInicialPct }));
    if (e.modoEasun) ordenes.push(ej('inversor.modoEasun', 'INV-101', { modo: e.modoEasun }));
    for (const [tag, w] of Object.entries(e.cargas || {})) ordenes.push(ej('cargas.poner', tag, { w }));
    for (const [tag, v] of Object.entries(e.sombras || {})) ordenes.push(ej('ambiente.sombra', tag, { valor01: v }));
    const esperaS = PREPARACION_FIRMA_S + e.esperaS;
    return { simulador: id, versionContrato: T.VERSION_CONTRATO, id: ('firma_' + a.id.toLowerCase()).slice(0, 40), titulo: `Escenario de diagnóstico: ${a.titulo}`,
      condiciones: { diaAnio: e.diaAnio, horaSolar: e.horaSolar, nubosidad: e.nubosidad }, ordenesIniciales: ordenes, esperaS };
  }
  function averiaContrato(a) {
    const parametros = {};
    for (const [k, p] of Object.entries(a.parametros || {})) parametros[k] = { tipo: 'numero', min: p.min, max: p.max, defecto: p.defecto, unidad: /Ohm$/.test(k) ? 'Ω' : '' };
    const f = a.firma, escenario = escenarioDe(a);
    const firma = {
      sintoma: f.sintoma, escenario, esperaS: escenario.esperaS,
      medidasClave: f.medidasClave.map(m => Object.assign({ peticion: peticionDe(m) }, m.referencia ? { referencia: peticionDe(m, m.referencia) } : {},
        m.preparar ? { preparar: m.preparar.filter(p => p.orden === 'abrir').map(p => ej('protecciones.abrir', p.tag)) } : {},
        { esperadoSano: rango(m.esperadoSano), esperadoAveria: rango(m.esperadoAveria), texto: m.texto })),
      pistas: f.pistas.slice(0, 3), explicacion: f.explicacion, distractores: f.distractores.slice(),
    };
    return { id: a.id, titulo: a.titulo, descripcion: a.descripcion, equipos: [a.tag], dificultad: a.dificultad, sintomas: a.sintomas.slice(), parametros,
      solucion: { texto: a.solucion.texto, accion: a.solucion.accion, tag: a.solucion.tag || null }, firma };
  }
  const CATALOGO = () => Cat.CATALOGO.map(averiaContrato);
  const porId = new Map(Cat.CATALOGO.map(a => [a.id, a]));

  // ------------------------------------------------------------------------------------------------ puntos de medida (§5.2) ----
  let elementosTermo = null;
  function puntos() {
    const L = [];
    for (const p of Medidas.PUNTOS) L.push({ id: p.id, instrumento: 'multimetro', magnitudes: ['tension', 'resistencia', 'continuidad'], texto: p.descripcion, equipo: p.equipo, grupo: p.grupo });
    for (const c of Medidas.CONDUCTORES) L.push({ id: c.id, instrumento: 'pinza', magnitudes: ['corriente'], texto: c.descripcion, equipo: c.equipo, grupo: c.grupo });
    const muestra = Sim.crearSimulacion({ semilla: 1 });
    for (const p of muestra.puntosAislamiento) L.push({ id: p.id, instrumento: 'megohmetro', magnitudes: ['aislamiento'], texto: p.descripcion, equipo: p.cadena });
    for (const c of CADENAS) L.push({ id: c, instrumento: 'trazadorIV', magnitudes: ['resumen', 'curva', 'curvaReferencia'].concat(T.CAMPOS_TRAZADOR), texto: `Curva I-V de la cadena ${c}`, equipo: c });
    L.push({ id: 'IMAGEN', instrumento: 'termografia', magnitudes: ['imagen'], texto: 'Imagen térmica de toda la instalación', equipo: 'CAS-001' });
    elementosTermo = elementosTermo || muestra.termografia().elementos.map(e => ({ tag: e.tag, tipo: e.tipo, equipo: e.equipo, zona: e.zona }));
    for (const e of elementosTermo) L.push({ id: e.tag, instrumento: 'termografia', magnitudes: ['temperatura', 'deltaC'], texto: `Temperatura de ${e.tag} (${e.tipo})`, equipo: e.equipo, grupo: e.zona });
    return L;
  }

  // ------------------------------------------------------------------------------------------------ medidas (§5.2) ----
  const UNIDAD_IV = { voc: 'V', isc: 'A', vmpp: 'V', impp: 'A', pmpp: 'W', resumen: 'W', factorForma: 'p.u.', desviacionPct: '%', desviacionVocPct: '%', desviacionIscPct: '%', escalones: 'escalones' };
  const no = (motivo, texto, datos) => Object.assign({ valida: false, motivo, texto }, datos ? { datos } : {});
  function medirFV(v, p) {
    const el = p.elemento;
    switch (p.instrumento) {
      case 'multimetro': {
        if (!GRUPO[p.a]) return no('punto_desconocido', `No hay punto de medida ${p.a}.`);
        if (typeof p.b !== 'string') return no('peticion_invalida', 'Falta la punta negra (b).');
        if (!GRUPO[p.b]) return no('punto_desconocido', `No hay punto de medida ${p.b}.`);
        if (p.magnitud === 'tension') {
          const x = v.medir(p.a, p.b);
          if (!x.ok) return no('punto_desconocido', x.texto);
          if (x.tipo === 'sin_referencia') return no('sin_referencia', x.texto);
          return { valida: true, valor: x.valor, unidad: 'V', texto: x.texto, datos: { tipo: x.tipo, vdc: x.vdc, vac: x.vac } };
        }
        const x = v.resistencia(p.a, p.b);
        if (!x.ok) return x.conTension ? no('con_tension', x.texto, { voltios: x.voltios }) : no('punto_desconocido', x.texto);
        return { valida: true, valor: x.ohm, unidad: 'Ω', texto: x.texto, datos: { continuidad: x.continuidad, abierto: x.abierto } };
      }
      case 'pinza': {
        if (!CONDUCTOR.has(p.conductor)) return no('punto_desconocido', `No hay conductor ${p.conductor}.`);
        const x = v.corriente(p.conductor);
        if (!x.ok) return no('punto_desconocido', x.texto);
        return { valida: true, valor: x.valor, unidad: 'A', texto: x.texto, datos: { tipo: x.tipo } };
      }
      case 'megohmetro': {
        if (!/^STR-\d+\.[+-]$/.test(el)) return no('punto_desconocido', `No hay polo de cadena ${el} (usa STR-201.+ o STR-201.-).`);
        const x = v.aislamiento(el);
        if (!x.ok) return /seccionador/.test(x.texto) ? no('requiere_maniobra', x.texto, { tensionPruebaV: x.tensionPruebaV, minimoMohm: x.minimoMohm }) : no('punto_desconocido', x.texto);
        return { valida: true, valor: x.mohm, unidad: 'MΩ', texto: x.texto, datos: { tensionPruebaV: x.tensionPruebaV, minimoMohm: x.minimoMohm, correcto: x.correcto } };
      }
      case 'trazadorIV': {
        if (!CADENAS.includes(el)) return no('punto_desconocido', `No hay cadena ${el}.`);
        const n = p.opciones && p.opciones.puntos !== undefined ? p.opciones.puntos : 60;
        if (p.magnitud === 'curva' || p.magnitud === 'curvaReferencia') {
          const pts = p.magnitud === 'curva' ? v.curvaIV(el, n) : v.curvaIVReferencia(el, n);
          return { valida: true, unidad: 'V·A', texto: `${p.magnitud === 'curva' ? 'Curva medida' : 'Curva esperada'} de ${el} (${pts.length} puntos)`, datos: { puntos: pts } };
        }
        const r = v.resumenIV(el), campo = p.magnitud === 'resumen' ? 'pmpp' : p.magnitud;
        return { valida: true, valor: r[campo], unidad: UNIDAD_IV[p.magnitud], texto: r.texto, datos: clonar(r) };
      }
      case 'termografia': {
        if (p.magnitud === 'imagen') return { valida: true, unidad: '°C', texto: 'Imagen térmica de la instalación', datos: v.termografia() };
        const e = v.termografia().elementos.find(q => q.tag === el);
        if (!e) return no('punto_desconocido', `La cámara no tiene el elemento ${el}.`);
        return { valida: true, valor: p.magnitud === 'deltaC' ? e.deltaC : e.tempC, unidad: '°C',
          texto: `${e.tempC.toFixed(1)} °C (${e.deltaC >= 0 ? '+' : ''}${e.deltaC.toFixed(1)} °C)${e.nota ? ' · ' + e.nota : ''}`, datos: { tempC: e.tempC, deltaC: e.deltaC, nota: e.nota, tipo: e.tipo, zona: e.zona } };
      }
      default: return no('instrumento_desconocido', `Aquí no hay ${p.instrumento}.`);
    }
  }

  // ------------------------------------------------------------------------------------------------ el motor ----
  const ESTADOS_DISPARO = ['DISPARADO', 'FUNDIDO', 'AGOTADO'];
  function crearMotor({ semilla, condiciones }) {
    const viejo = Sim.crearSimulacion(Object.assign({ semilla }, condiciones));
    const k = viejo._contrato, O = viejo.ordenes;
    let sucio = false;
    const disparos = Prot.TODOS.map(tag => ({ tag, activo: false, causa: '' }));
    const est = () => viejo.estado;

    function aviso(tag) {
      const campo = tag === 'QS-101' ? est().campos.A : tag === 'QS-201' ? est().campos.B : null;
      if (!campo || !(Math.abs(campo.i || 0) > 1)) return undefined;
      return `Maniobra peligrosa: has abierto ${tag} con ${Math.abs(campo.i).toFixed(1).replace('.', ',')} A de continua. El arco en continua no se apaga solo: apaga antes el inversor.`;
    }
    function ejecutar(o) {
      const v = o.valores || {}, d = o.destino, ok = datos => Object.assign({ ok: true }, datos ? { datos } : {});
      switch (o.tipo) {
        case 'reloj.poner': O.reloj.poner(v); return ok();
        case 'ambiente.poner': O.ambiente.poner(v); return ok();
        case 'ambiente.sombra': O.ambiente.sombra(d, v.valor01); return ok();
        case 'protecciones.cerrar':
          if (viejo._contrato.protecciones()[d].estado === 'FUNDIDO') return { ok: false, motivo: 'no_permitida', texto: `${d} está fundido: no se cierra, se sustituye (rearmar).` };
          O.protecciones.cerrar(d); return ok();
        case 'protecciones.abrir': { const a = aviso(d); O.protecciones.abrir(d); return Object.assign(ok(), a ? { aviso: a } : {}); }
        case 'protecciones.rearmar': {
          const e = viejo._contrato.protecciones()[d].estado;
          if (!(ESTADOS_DISPARO.includes(e) || (e === 'ABIERTO' && Prot.FUSIBLES.includes(d)))) return { ok: false, motivo: 'no_permitida', texto: `${d} no tiene nada que rearmar.` };
          O.protecciones.rearmar(d); return ok();
        }
        case 'red.disponible': O.red.disponible(v.disponible); return ok();
        case 'red.tension': O.red.tension(v.tensionV); return ok();
        case 'cargas.poner': O.cargas.poner(d, v.w); return ok();
        case 'inversor.modoEasun': O.inversor.modoEasun(v.modo); return ok();
        case 'inversor.encender': O.inversor.encender(d, v.encendido); return ok();
        case 'bateria.socInicial': O.bateria.socInicial(v.pct); return ok();
        case 'averias.activar': {
          const a = porId.get(v.id);
          if (!a) return { ok: false, motivo: 'averia_desconocida', texto: `No existe la avería ${v.id}.` };
          const p = Nc.problemaParametrosAveria(averiaContrato(a), v.parametros);
          if (p) return { ok: false, motivo: 'valores_invalidos', texto: `Parámetro no válido: ${p}.` };
          O.averias.activar(v.id, v.parametros ? clonar(v.parametros) : undefined);
          return ok({ instancia: v.id });
        }
        case 'averias.quitar':
          if (!k.hayAveria(v.instancia)) return porId.has(v.instancia) ? { ok: false, motivo: 'no_permitida', texto: `${v.instancia} no está activa.` } : { ok: false, motivo: 'instancia_desconocida', texto: `No hay ninguna avería ${v.instancia}.` };
          O.averias.desactivar(v.instancia); return ok();
        case 'averias.limpiar': O.averias.limpiar(); return ok();
        case 'averias.reparar': {
          const ids = O.averias.activas().filter(x => { const a = porId.get(x); return a && a.solucion.accion === v.accion && (a.solucion.tag || a.tag) === d; });
          for (const x of ids) O.averias.desactivar(x);
          return ok(ids.length ? { correcta: true, ids } : { correcta: false });
        }
        default: return { ok: false, motivo: 'orden_desconocida', texto: `La orden ${o.tipo} no existe.` };
      }
    }
    function activas() {
      return viejo.ordenes.averias.activas().map(x => {
        const a = porId.get(x), parametros = {};
        for (const nombre of Object.keys((a && a.parametros) || {})) parametros[nombre] = k.parametroAveria(x, nombre);
        return { instancia: x, id: x, tags: a ? [a.tag] : [], parametros };
      });
    }
    return {
      viejo,
      paso() { k.paso(PASO); sucio = true; },
      publicar() { if (sucio) { k.publicar(); sucio = false; } },
      estadoVivo: est,
      ejecutar(o) { const r = ejecutar(o); if (r.ok) sucio = false; return r; },     // las órdenes antiguas ya publican (refrescar)
      medir: p => medirFV(viejo, p),
      activas,
      alarmas: () => k.alarmas().map(a => ({ codigo: a.codigo, tag: a.tag, nivel: a.severidad, texto: a.texto })),
      disparos() { const e = k.protecciones(); for (const x of disparos) { const q = e[x.tag]; x.activo = ESTADOS_DISPARO.includes(q.estado); x.causa = q.causa; } return disparos; },
    };
  }

  // ------------------------------------------------------------------------------------------------ API antigua (§2.12) ----
  function antigua(sim, motorActual) {
    const viejo = () => motorActual().viejo;
    const def = (o, ks) => { const r = {}; for (const k of ks) if (o && o[k] !== undefined) r[k] = o[k]; return r; };
    const num = x => typeof x === 'number' && Number.isFinite(x);
    const okBool = r => !!(r && r.ok);
    const inicio = { diaAnio: 172, horaSolar: 9, nubosidad: 0.1 };
    const A = { ordenes: Nc.envolver(sim, {
      reloj: { poner(o = {}) {
        const v = {};
        if (num(o.diaAnio)) v.diaAnio = limitar(Math.round(o.diaAnio), 1, 365);
        if (num(o.horaSolar)) v.horaSolar = ((o.horaSolar % 24) + 24) % 24;
        return Object.keys(v).length ? { tipo: 'reloj.poner', valores: v } : null;
      } },
      ambiente: {
        poner(o = {}) {
          const v = {};
          if (num(o.nubosidad)) v.nubosidad = limitar(o.nubosidad, 0, 1);
          if (o.temperaturaAmbienteC === null) v.temperaturaAmbienteC = null; else if (num(o.temperaturaAmbienteC)) v.temperaturaAmbienteC = limitar(o.temperaturaAmbienteC, -30, 60);
          if (num(o.suciedadA)) v.suciedadA = limitar(o.suciedadA, 0, 1);
          if (num(o.suciedadB)) v.suciedadB = limitar(o.suciedadB, 0, 1);
          return Object.keys(v).length ? { tipo: 'ambiente.poner', valores: v } : null;
        },
        sombra: (tag, valor01) => ({ tipo: 'ambiente.sombra', destino: tag, valores: { valor01: limitar(Number(valor01) || 0, 0, 1) } }),
      },
      protecciones: {
        cerrar: tag => ({ orden: { tipo: 'protecciones.cerrar', destino: tag }, devolver: okBool }),
        abrir: tag => ({ orden: { tipo: 'protecciones.abrir', destino: tag }, devolver: okBool }),
        rearmar: tag => ({ orden: { tipo: 'protecciones.rearmar', destino: tag }, devolver: okBool }),
      },
      red: { disponible: x => ({ tipo: 'red.disponible', destino: 'RED-301', valores: { disponible: !!x } }), tension: x => (num(x) ? { tipo: 'red.tension', destino: 'RED-301', valores: { tensionV: limitar(x, 0, 300) } } : null) },
      cargas: { poner: (tag, w) => ({ tipo: 'cargas.poner', destino: tag, valores: { w: w == null ? null : Math.max(0, Number(w) || 0) } }) },
      inversor: {
        modoEasun: m => (MODOS_EASUN.includes(m) ? { tipo: 'inversor.modoEasun', destino: 'INV-101', valores: { modo: m } } : null),
        encender: (tag, x) => ({ tipo: 'inversor.encender', destino: tag, valores: { encendido: !!x } }),
      },
      bateria: { socInicial: pct => (num(pct) ? { tipo: 'bateria.socInicial', destino: 'BAT-101', valores: { pct: limitar(pct, 0, 100) } } : null) },
      averias: {
        activar(idAveria, parametros) {
          const a = porId.get(idAveria), p = {};
          if (a) for (const [k, d] of Object.entries(a.parametros || {})) if (parametros && num(parametros[k])) p[k] = limitar(parametros[k], d.min, d.max);
          return { orden: { tipo: 'averias.activar', valores: Object.assign({ id: String(idAveria) }, Object.keys(p).length ? { parametros: p } : {}) }, devolver: okBool };
        },
        desactivar: x => ({ orden: { tipo: 'averias.quitar', valores: { instancia: String(x) } }, devolver: okBool }),
        limpiar: () => ({ tipo: 'averias.limpiar' }),
      },
    }) };
    A.ordenes.averias.activas = () => viejo().ordenes.averias.activas();
    A.paso = dt => { let resto = Math.max(0, Number(dt) || 0); while (resto > 0) { const d = Math.min(T.DT_MAX_S, resto); sim.avanzar(d); resto -= d; } return viejo().estado; };
    A.reiniciar = opts => {
      Object.assign(inicio, def(opts, ['diaAnio', 'horaSolar', 'nubosidad']));
      const semilla = opts && Number.isInteger(opts.semilla) && opts.semilla >= 1 ? opts.semilla : undefined;
      const r = sim.reiniciar(Object.assign({ escenario: { simulador: id, versionContrato: T.VERSION_CONTRATO, id: 'reinicio', titulo: 'Reinicio', condiciones: clonar(inicio), ordenesIniciales: [] } },
        semilla ? { semilla } : {}));
      return r.ok ? viejo().estado : viejo().estado;
    };
    for (const nombre of ['medir', 'continuidad', 'potencial', 'resistencia', 'corriente', 'termografia', 'curvaIV', 'curvaIVReferencia', 'resumenIV', 'aislamiento']) A[nombre] = (...args) => viejo()[nombre](...args);
    for (const nombre of ['estado', 'medidas', 'puntos', 'conductores', 'puntosAislamiento', 'motor']) Object.defineProperty(A, nombre, { enumerable: true, get: () => viejo()[nombre] });
    return A;
  }

  // ------------------------------------------------------------------------------------------------ fábrica ----
  const DEF = {
    id, pasoFijoS: PASO,
    esquemaCondiciones: { diaAnio: { tipo: 'entero', min: 1, max: 365 }, horaSolar: { tipo: 'numero', min: 0, max: 24 }, nubosidad: { tipo: 'numero', min: 0, max: 1 } },
    ordenes: ORDENES, validarOrden, crearMotor, puntos, catalogo: CATALOGO, antigua,
  };
  const crearSimulacion = opciones => Nc.crearSimulacionContrato(DEF, opciones);

  const api = { id, crearSimulacion, averiaContrato, PREPARACION_FIRMA_S };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    const P = (window.PCT = window.PCT || {});
    (P.fv = P.fv || {}).contrato = { id, crearSimulacion };
    if (P.contrato && typeof P.contrato.registrar === 'function') P.contrato.registrar(id, crearSimulacion);
  }
})();
