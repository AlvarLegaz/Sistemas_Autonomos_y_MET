// Fábrica del contrato común de simulación para la planta real HTST (comun/CONTRATO.md; tablas de §4.3 y §5.3). Doble export: module.exports = { id, crearSimulacion }
// y PCT.htst.contrato (se registra solo en PCT.contrato si el núcleo está cargado). La API antigua (PCT.htst.crearSimulacion) no cambia; sim.antigua() la da por encima de ejecutar.
// ORDEN DE CARGA en el navegador: comun/tipos.js → comun/js/nucleo/{congelar,azar,paso_fijo,eventos,registro,contrato}.js → layout, constantes, modelo, PLC y averías → este.
// Paso fijo 0,1 s (el tick de la simulación). Cada adaptador tiene su propio motor de averías: reiniciar empieza de cero, también la numeración de instancias (R8).
// Órdenes nuevas del modelo (decisión 4 del plan, R6): 'controlTemperatura' y 'llenarDepositos'. Se aceptan siempre en ejecutar() y se repiten bien, pero solo salen en
// ordenesDisponibles() cuando comun/tipos.js las añada a ORDENES_POR_SIMULADOR.planta_real (hoy la prueba C14 exige que no haya tipos fuera de esa lista).
(function () {
  'use strict';
  const enNode = typeof require !== 'undefined';
  const T = enNode ? require('../../../comun/tipos.js') : window.PCT.contratoTipos;
  const Nc = enNode ? require('../../../comun/js/nucleo/contrato.js') : window.PCT.contrato;
  const { clonar } = enNode ? require('../../../comun/js/nucleo/congelar.js') : window.PCT.nucleo;
  const layout = enNode ? require('../layout.js') : window.PCT.htstLayout;
  const Sim = enNode ? require('./simulacion.js') : window.PCT.htst.simulacion;
  const Medidas = enNode ? require('./medidas.js') : window.PCT.htstMedidas;
  const plc = enNode ? require('../plc/programa.js') : window.PCT.htstPrograma;
  const Mot = enNode ? require('../averias/motor.js') : window.PCT.htstAverias;

  const id = 'planta_real';
  const PASO = T.PASO_FIJO_S[id];
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const CAT = Mot.CATALOGO, porId = new Map(CAT.map(a => [a.id, a]));
  const DESTINOS_MANUAL = plc.DO_MANUALES.concat(['VFD-101']);
  const DEPOSITO = { 'TK-101': 'tanque', 'HW-201': 'aguaCaliente' };
  const TAGS_AI = layout.SENALES.filter(s => s.tipo === 'AI').map(s => s.tag);
  const TAGS_EQUIPOS = Array.from(new Set(layout.EQUIPOS.map(e => e.tag).concat(TAGS_AI, ...CAT.map(a => a.equipos), CAT.map(a => a.solucion.tag).filter(Boolean),
    ...CAT.map(a => (a.parametros.tag ? a.parametros.tag.opciones : [])))));
  const NUEVAS = ['controlTemperatura', 'llenarDepositos'];

  // ------------------------------------------------------------------------------------------------ órdenes (§4.3) ----
  const ej = (tipo, destino, valores) => Object.assign({ tipo }, destino ? { destino } : {}, valores ? { valores } : {}, { origen: 'guion' });
  const codigoVacio = Mot.crearMotorAverias().codigo();
  const ORDENES = [
    { tipo: 'arrancar', texto: 'MARCHA: arranca en recirculación de agua (pasa a producción al cumplirse las condiciones).', ejemplo: ej('arrancar') },
    { tipo: 'parar', texto: 'PARO: lleva la planta a PARADA.', ejemplo: ej('parar') },
    { tipo: 'consignaTemperaturaC', texto: 'Consigna de TT-103 (temperatura de pasteurización).', valores: { temperaturaC: { tipo: 'numero', min: 60, max: 85, unidad: '°C' } },
      ejemplo: ej('consignaTemperaturaC', null, { temperaturaC: 75 }) },
    { tipo: 'consignaCaudalLh', texto: 'Consigna de caudal de P-101.', valores: { caudalLh: { tipo: 'numero', min: 0, max: layout.PROCESO.caudalMaximoLh, unidad: 'L/h' } },
      ejemplo: ej('consignaCaudalLh', null, { caudalLh: 2000 }) },
    { tipo: 'modo', texto: 'Cambia el modo del PLC.', valores: { modo: { tipo: 'opcion', opciones: layout.MODOS.slice() } }, ejemplo: ej('modo', null, { modo: 'MANUAL' }) },
    { tipo: 'pulsador', texto: 'Pulsa REARME (PB-001) o el rearme manual del termostato (TSH-201).', destinos: ['PB-001', 'TSH-201'], ejemplo: ej('pulsador', 'PB-001') },
    { tipo: 'manual', texto: 'Orden manual a una salida: 0/1 (o true/false) en las digitales, 0-100 % en VFD-101; null devuelve el mando al PLC.', destinos: DESTINOS_MANUAL,
      valores: { valor: { tipo: 'numero', min: 0, max: 100, nulo: true } }, ejemplo: ej('manual', 'XV-101', { valor: 1 }) },
    { tipo: 'paroEmergencia', texto: 'Pulsa (true) o rearma (false) la seta de emergencia.', destinos: ['ES-001'], valores: { activo: { tipo: 'booleano' } },
      ejemplo: ej('paroEmergencia', 'ES-001', { activo: false }) },
    { tipo: 'nivelDeposito', texto: 'Fija el nivel de un depósito (TK-101 tanque de balance, HW-201 agua caliente).', destinos: ['TK-101', 'HW-201'],
      valores: { pct: { tipo: 'numero', min: 0, max: 100, unidad: '%' } }, ejemplo: ej('nivelDeposito', 'TK-101', { pct: 100 }) },
    { tipo: 'averias.activar', texto: 'Inyecta una avería del catálogo (valores: id y, si hace falta, parametros).', valores: { id: { tipo: 'texto' } }, ejemplo: ej('averias.activar', null, { id: 'AV-FUSIBLE-F201' }) },
    { tipo: 'averias.quitar', texto: 'Retira una avería por su instancia (I1, I2…).', valores: { instancia: { tipo: 'texto' } }, ejemplo: ej('averias.quitar', null, { instancia: 'I1' }) },
    { tipo: 'averias.limpiar', texto: 'Retira todas las averías.', ejemplo: ej('averias.limpiar') },
    { tipo: 'averias.reparar', texto: 'El alumno hace una reparación sobre un equipo.', destinos: TAGS_EQUIPOS, valores: { accion: { tipo: 'opcion', opciones: T.ACCIONES_REPARACION.slice() } },
      ejemplo: ej('averias.reparar', 'F-001', { accion: 'sustituir' }) },
    { tipo: 'averias.cargarCodigo', texto: 'Carga las averías de un código HTST-… (sustituye a las activas).', valores: { codigo: { tipo: 'texto' } }, ejemplo: ej('averias.cargarCodigo', null, { codigo: codigoVacio }) },
  ];
  const OCULTAS = [
    { tipo: 'controlTemperatura', texto: 'Control de la temperatura del agua en MANUAL: histéresis o PID sobre TT-201 que manda P-201, KM-201 y KM-202 (off lo apaga).',
      valores: { modo: { tipo: 'opcion', opciones: ['off', 'histeresis', 'pid'] }, consignaC: { tipo: 'numero', min: 20, max: 85, unidad: '°C', opcional: true },
        bandaC: { tipo: 'numero', min: 0.5, max: 20, unidad: '°C', opcional: true }, kp: { tipo: 'numero', min: 0, max: 100, opcional: true },
        ki: { tipo: 'numero', min: 0, max: 5, opcional: true }, kd: { tipo: 'numero', min: 0, max: 500, opcional: true } },
      ejemplo: ej('controlTemperatura', null, { modo: 'pid', consignaC: 70 }) },
    { tipo: 'llenarDepositos', texto: 'Llena TK-101 y HW-201 abriendo XV-101 y XV-201 hasta que estén llenos (false lo cancela).', valores: { activo: { tipo: 'booleano' } },
      ejemplo: ej('llenarDepositos', null, { activo: true }) },
  ];
  const publicables = (T.ORDENES_POR_SIMULADOR[id] || []);
  const ORDENES_VISIBLES = ORDENES.concat(OCULTAS.filter(d => publicables.includes(d.tipo)));
  const ORDENES_OCULTAS = OCULTAS.filter(d => !publicables.includes(d.tipo));

  const problema = texto => ({ motivo: 'valores_invalidos', texto: `Valor no válido: ${texto}.` });
  function validarOrden(o, d) {
    const v = o.valores || {};
    if (o.tipo === 'manual') {
      const resto = Object.keys(v).filter(k => k !== 'valor');
      if (resto.length) return problema(`valor desconocido: ${resto[0]}`);
      if (!Object.prototype.hasOwnProperty.call(v, 'valor')) return problema('falta el valor');
      const x = v.valor;
      if (o.destino === 'VFD-101') return x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100) ? null : problema('VFD-101 admite 0-100 % o null');
      return [0, 1, true, false, null].includes(x) ? null : problema(`${o.destino} admite 0, 1, true, false o null`);
    }
    if (o.tipo === 'averias.activar') {
      const resto = Object.assign({}, v); delete resto.parametros;
      const q = Nc.problemaValores(resto, d.valores);
      if (q) return problema(q);
      if (v.parametros !== undefined && (v.parametros === null || typeof v.parametros !== 'object' || Array.isArray(v.parametros))) return problema('parametros debe ser un objeto');
      return null;
    }
    return undefined;
  }

  // ------------------------------------------------------------------------------------------------ catálogo (§5.4) ----
  function averiaContrato(a) {
    const parametros = {};
    for (const [k, p] of Object.entries(a.parametros || {})) {
      parametros[k] = p.tipo === 'opcion' ? { tipo: 'opcion', opciones: p.opciones.slice(), defecto: p.defecto } : { tipo: 'numero', min: p.min, max: p.max, defecto: p.defecto, unidad: p.unidad || '' };
    }
    const r = { id: a.id, titulo: a.nombre, equipos: a.equipos.slice(), dificultad: a.dificultad, sintomas: a.sintomasScada.slice(), parametros,
      solucion: { texto: a.solucion.texto, accion: a.solucion.accion, tag: a.solucion.tag || null } };
    if (a.firma) r.firma = clonar(a.firma);
    return r;
  }
  const CATALOGO = () => CAT.map(averiaContrato);

  // ------------------------------------------------------------------------------------------------ puntos y medidas (§5.3) ----
  const MAG = { V: 'tension', mA: 'corriente', ohm: 'resistencia', continuidad: 'continuidad' };
  const MODO = { tension: 'V', corriente: 'mA', resistencia: 'ohm', continuidad: 'continuidad' };
  const conOsciloscopio = idp => /:LAZO$/.test(idp) || idp === 'PS-001:SALIDA' || idp === 'SV-101:BORNAS';
  const IDS = new Set(Medidas.PUNTOS.map(p => p.id));
  function puntos() {
    const L = [];
    for (const p of Medidas.PUNTOS) {
      const equipo = p.id.split(':')[0];
      if (p.modo === 'temperatura') L.push({ id: p.id, instrumento: 'termometro', magnitudes: ['temperatura'], texto: p.descripcion, equipo });
      else if (p.modo === 'presion') L.push({ id: p.id, instrumento: 'manometro', magnitudes: ['presion'], texto: p.descripcion, equipo });
      else L.push({ id: p.id, instrumento: 'multimetro', magnitudes: [MAG[p.modo]], texto: p.descripcion, equipo });
      if (conOsciloscopio(p.id)) L.push({ id: p.id, instrumento: 'osciloscopio', magnitudes: ['formaOnda'], texto: p.descripcion, equipo });
    }
    return L;
  }
  const no = (motivo, texto) => ({ valida: false, motivo, texto });
  function medirHTST(v, p) {
    if (p.instrumento === 'osciloscopio') {
      if (!IDS.has(p.a)) return no('punto_desconocido', `No hay punto de medida ${p.a}.`);
      const r = v.medidas.medir('osciloscopio', p.a, null, null);
      if (!r.ok) return no('magnitud_invalida', `El osciloscopio no tiene nada que ver en ${p.a}: usa el multímetro.`);
      return { valida: true, unidad: r.unidad, texto: r.texto, datos: { muestras: r.muestras.slice(), unidad: r.unidad, dtMs: r.dtMs } };
    }
    const punto = p.instrumento === 'multimetro' ? p.a : p.elemento;
    const modo = p.instrumento === 'termometro' ? 'temperatura' : p.instrumento === 'manometro' ? 'presion' : MODO[p.magnitud];
    if (!IDS.has(punto)) return no('punto_desconocido', `No hay punto de medida ${punto}.`);
    const r = v.medidas.medir('multimetro', punto, null, modo);
    if (!r.ok) return no(/desconocido/.test(r.texto) ? 'punto_desconocido' : 'magnitud_invalida', r.texto);
    const datos = {};
    if (r.continuidad !== undefined) datos.continuidad = r.continuidad;
    if (r.lecturaTransmisor !== undefined) datos.lecturaTransmisor = r.lecturaTransmisor;
    return Object.assign({ valida: true, valor: r.valor, unidad: r.unidad, texto: r.texto }, Object.keys(datos).length ? { datos } : {});
  }

  // ------------------------------------------------------------------------------------------------ el motor ----
  function crearMotor({ semilla, condiciones }) {
    const viejo = Sim.crearSimulacion({ semilla, valvulasManuales: !!condiciones.valvulasManuales });
    const k = viejo._contrato, O = viejo.ordenes, M = viejo.averias;
    const disparos = [{ tag: 'QE-001', activo: false, causa: '' }, { tag: 'TSH-201', activo: false, causa: 'Sobretemperatura del agua caliente' }, { tag: 'VFD-101', activo: false, causa: 'Sobretemperatura del variador' }];
    const ok = datos => Object.assign({ ok: true }, datos ? { datos } : {});
    const activasMotor = () => M.activas().map(a => ({ instancia: a.instancia, id: a.id, tags: a.tags.slice(), parametros: Object.assign({}, a.parametros) }));
    function ejecutar(o) {
      const v = o.valores || {}, d = o.destino;
      switch (o.tipo) {
        case 'arrancar': O.arrancar(); return ok();
        case 'parar': O.parar(); return ok();
        case 'consignaTemperaturaC': O.consignaTemperaturaC(v.temperaturaC); return ok();
        case 'consignaCaudalLh': O.consignaCaudalLh(v.caudalLh); return ok();
        case 'modo': O.modo(v.modo); return ok();
        case 'pulsador': O.pulsador(d); return ok();
        case 'manual': O.manual(d, v.valor); return ok();
        case 'paroEmergencia': O.paroEmergencia(v.activo); return ok();
        case 'nivelDeposito': O.nivelDeposito(DEPOSITO[d], v.pct); return ok();
        case 'controlTemperatura': O.controlTemperatura(v); return ok();
        case 'llenarDepositos': O.llenarDepositos(v.activo); return ok();
        case 'averias.activar': {
          const a = porId.get(v.id);
          if (!a) return { ok: false, motivo: 'averia_desconocida', texto: `No existe la avería ${v.id}.` };
          const p = Nc.problemaParametrosAveria(averiaContrato(a), v.parametros);
          if (p) return { ok: false, motivo: 'valores_invalidos', texto: `Parámetro no válido: ${p}.` };
          const par = v.parametros ? clonar(v.parametros) : {};
          const q = M.puedeInyectar(v.id, par);
          if (!q.ok) return { ok: false, motivo: 'averia_incompatible', texto: q.motivo };
          return ok({ instancia: M.inyectar(v.id, par) });
        }
        case 'averias.quitar':
          if (!M.quitar(v.instancia)) return /^I\d+$/.test(v.instancia) ? { ok: false, motivo: 'no_permitida', texto: `La avería ${v.instancia} no está activa.` }
            : { ok: false, motivo: 'instancia_desconocida', texto: `No hay ninguna avería ${v.instancia}.` };
          return ok();
        case 'averias.limpiar': for (const a of M.activas()) M.quitar(a.instancia); return ok();
        case 'averias.reparar': {
          const activas = M.activas();
          const buenas = activas.filter(i => { const a = porId.get(i.id); return a.solucion.accion === v.accion && (a.solucion.tag ? [a.solucion.tag] : i.tags).includes(d); });
          if (buenas.length) { for (const i of buenas) M.reparar(i.instancia, { accion: v.accion, tag: d }); return ok({ correcta: true, ids: buenas.map(i => i.id) }); }
          for (const i of activas) M.reparar(i.instancia, { accion: v.accion, tag: d });          // se anota el intento en cada instancia activa
          return ok({ correcta: false });
        }
        case 'averias.cargarCodigo': {
          // Se prueba antes en un motor aparte: un código que falla no debe tocar nada (ni el contador de instancias)
          const prueba = Mot.crearMotorAverias(CAT, { semilla }).desdeCodigo(v.codigo);
          if (!prueba.ok) return { ok: false, motivo: /Código no válido|No existe/.test(prueba.motivo || '') ? 'codigo_invalido' : 'averia_incompatible', texto: prueba.motivo || 'Código no válido' };
          const r = M.desdeCodigo(v.codigo);
          return ok({ instancias: r.instancias });
        }
        default: return { ok: false, motivo: 'orden_desconocida', texto: `La orden ${o.tipo} no existe.` };
      }
    }
    return {
      viejo,
      paso: () => k.tick(),
      publicar() {},
      estadoVivo: () => viejo.estado(),
      ejecutar,
      medir: p => medirHTST(viejo, p),
      activas: activasMotor,
      alarmas: () => (viejo.estado().alarmas || []).map(a => ({ codigo: a.codigo, tag: a.tag, nivel: a.nivel, texto: a.texto })),
      disparos() {
        const e = viejo.estado(), plcE = e.plc || {};
        disparos[0].activo = !!plcE.paro; disparos[0].causa = (plcE.motivosParo || []).join(', ');
        disparos[1].activo = !!e.equipos['TSH-201'].disparado;
        disparos[2].activo = !!e.equipos['P-101'].fallo;
        return disparos;
      },
    };
  }

  // ------------------------------------------------------------------------------------------------ API antigua (§2.12) ----
  function antigua(sim, motorActual) {
    const viejo = () => motorActual().viejo;
    const num = x => x !== null && x !== '' && Number.isFinite(Number(x));
    const A = Nc.envolver(sim, {
      ordenes: {
        arrancar: () => ({ tipo: 'arrancar' }), parar: () => ({ tipo: 'parar' }),
        consignaTemperaturaC: c => (num(c) ? { tipo: 'consignaTemperaturaC', valores: { temperaturaC: limitar(Number(c), 60, 85) } } : null),
        consignaCaudalLh: q => (num(q) ? { tipo: 'consignaCaudalLh', valores: { caudalLh: limitar(Number(q), 0, layout.PROCESO.caudalMaximoLh) } } : null),
        modo: m => (layout.MODOS.includes(m) ? { tipo: 'modo', valores: { modo: m } } : null),
        pulsador: tag => (tag === 'PB-001' || tag === 'TSH-201' ? { tipo: 'pulsador', destino: tag } : null),
        manual: (tag, valor) => {
          if (!DESTINOS_MANUAL.includes(tag)) return null;
          const v = valor === undefined || valor === null ? null : tag === 'VFD-101' ? limitar(Number(valor) || 0, 0, 100) : (valor ? 1 : 0);
          return { tipo: 'manual', destino: tag, valores: { valor: v } };
        },
        paroEmergencia: activo => ({ tipo: 'paroEmergencia', destino: 'ES-001', valores: { activo: !!activo } }),
        nivelDeposito: (cual, pct) => {
          const tag = cual === 'tanque' ? 'TK-101' : cual === 'aguaCaliente' ? 'HW-201' : null;
          return tag && num(pct) ? { tipo: 'nivelDeposito', destino: tag, valores: { pct: limitar(Number(pct), 0, 100) } } : null;
        },
        controlTemperatura: (cfg = {}) => {
          const v = { modo: ['off', 'histeresis', 'pid'].includes(cfg.modo) ? cfg.modo : 'off' };
          for (const [k2, [a, b]] of Object.entries({ consignaC: [20, 85], bandaC: [0.5, 20], kp: [0, 100], ki: [0, 5], kd: [0, 500] })) if (num(cfg[k2])) v[k2] = limitar(Number(cfg[k2]), a, b);
          return { tipo: 'controlTemperatura', valores: v };
        },
        llenarDepositos: activo => ({ tipo: 'llenarDepositos', valores: { activo: !!activo } }),
      },
    });
    const M = () => viejo().averias;
    const ejA = o => sim.ejecutar(Object.assign({ origen: 'profesor' }, o));
    A.averias = {
      inyectar: (idAveria, parametros) => { const r = ejA({ tipo: 'averias.activar', valores: Object.assign({ id: String(idAveria) }, parametros ? { parametros } : {}) }); return r.ok ? r.datos.instancia : null; },
      quitar: instancia => ejA({ tipo: 'averias.quitar', valores: { instancia: String(instancia) } }).ok,
      reparar: (instancia, { accion, tag } = {}) => {
        const r = sim.ejecutar({ tipo: 'averias.reparar', destino: tag, valores: { accion }, origen: 'alumno' });
        if (!r.ok) return { ok: false, motivo: r.texto };
        return r.datos.correcta ? { ok: true, texto: (porId.get(r.datos.ids[0]) || { solucion: { texto: '' } }).solucion.texto } : { ok: false, motivo: 'Esa acción no resuelve esta avería' };
      },
      desdeCodigo: texto => { const r = ejA({ tipo: 'averias.cargarCodigo', valores: { codigo: String(texto || '').trim() } }); return r.ok ? { ok: true, instancias: r.datos.instancias } : { ok: false, motivo: r.texto }; },
    };
    for (const nombre of ['listar', 'activas', 'puedeInyectar', 'hay', 'parametrosDe', 'codigo', 'buscarAveria', 'ultimoMotivoRechazo', 'resolverTags', 'sustituirTags']) A.averias[nombre] = (...args) => M()[nombre](...args);
    A.estado = () => viejo().estado();
    A.senales = () => viejo().senales();
    A.alarmas = () => viejo().alarmas();
    A.paso = dt => { let resto = Math.max(0, Number(dt) || 0); while (resto > 0) { const d = Math.min(T.DT_MAX_S, resto); sim.avanzar(d); resto -= d; } };
    A.reiniciar = () => { sim.reiniciar(); };
    A.medidas = { medir: (...args) => viejo().medidas.medir(...args), puntos: Medidas.PUNTOS };
    return A;
  }

  // ------------------------------------------------------------------------------------------------ fábrica ----
  const DEF = {
    id, pasoFijoS: PASO, esquemaCondiciones: { valvulasManuales: { tipo: 'booleano' } },
    ordenes: ORDENES_VISIBLES, ordenesOcultas: ORDENES_OCULTAS, validarOrden, crearMotor, puntos, catalogo: CATALOGO, antigua,
  };
  const crearSimulacion = opciones => Nc.crearSimulacionContrato(DEF, opciones);

  const api = { id, crearSimulacion, averiaContrato, ORDENES_NUEVAS: NUEVAS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    const P = (window.PCT = window.PCT || {});
    (P.htst = P.htst || {}).contrato = { id, crearSimulacion };
    if (P.contrato && typeof P.contrato.registrar === 'function') P.contrato.registrar(id, crearSimulacion);
  }
})();
