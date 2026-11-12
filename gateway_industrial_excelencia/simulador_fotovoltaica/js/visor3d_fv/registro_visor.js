// Integración de la instalación fotovoltaica con el visor 3D de simulador_pct23 (visor3d.js): registra el modelo «FV», adapta las fichas de ayuda (las de textos_ayuda.js si están
// cargadas, y si no unas sencillas hechas con layout.js) y calcula las lecturas de las etiquetas. La escena en sí (escena_fv.js) es del diseñador; aquí no se dibuja nada.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.fvLayout;
  const K = typeof require !== 'undefined' ? require('./kit.js') : PCT.fvKit;
  const decimal = (v, c = 0) => K.decimal(v, c);

  // Etiquetas que se ven sobre la instalación (las demás piezas se eligen en la lista del panel o con un clic): así no se amontonan 70 rótulos.
  const CON_ETIQUETA = new Set(['INV-101', 'INV-201', 'BAT-101', 'CB-101', 'QA-301', 'QB-101', 'QS-201', 'COM-101', 'RED-301', 'PV-101', 'PV-104', 'PV-201', 'PV-205', 'CAS-001']);
  const sinEtiqueta = id => !CON_ETIQUETA.has(id);
  const NOMBRE_CORTO = { 'INV-101': 'EASun', 'INV-201': 'ZCS', 'BAT-101': 'Batería', 'CB-101': 'HT 8WAY', 'QA-301': 'Cuadro CA', 'CAS-001': 'Caseta', 'COM-101': 'Dongle', 'RED-301': 'Acometida' };
  const nombreEtiqueta = id => NOMBRE_CORTO[id] || id;

  /** Lecturas del visor a partir del estado: sensores[id] = { valor, texto, alarma, activo } (el visor muestra `texto` en la etiqueta y colorea según alarma/activo). */
  function lecturasFv(estado) {
    const sensores = {};
    if (estado) {
      const i1 = K.inversorDe(estado, 'INV-101'), i2 = K.inversorDe(estado, 'INV-201'), bat = K.bateriaDe(estado);
      const alarma1 = i1.estado === 'FALLO', alarma2 = i2.estado === 'FALLO';
      sensores['INV-101'] = { valor: K.num(i1.pvP, 0), activo: i1.estado === 'OPERANDO' || i1.estado === 'REDUCIDO', alarma: alarma1, texto: alarma1 ? 'FALLO' : `${decimal(i1.pvP)} W` };
      sensores['INV-201'] = { valor: K.num(i2.acP, 0), activo: i2.estado === 'OPERANDO' || i2.estado === 'REDUCIDO', alarma: alarma2, texto: alarma2 ? 'FALLO' : (i2.estado || '').startsWith('ESPERA') ? '… espera' : `${decimal(i2.acP)} W` };
      sensores['BAT-101'] = { valor: K.num(bat.soc01, 0), activo: true, alarma: !!bat.bms && bat.bms !== 'OK', texto: `${decimal(K.num(bat.soc01, 0) * 100)} %` };
      for (const campo of Object.values(estado.campos || {})) for (const c of (campo.cadenas || [])) for (const p of (c.paneles || [])) {
        sensores[p.tag] = { valor: K.num(p.p, 0), activo: K.num(p.p, 0) > 1, alarma: !!c.abierta, texto: c.abierta ? 'abierta' : `${decimal(p.p)} W` };
      }
      for (const tag of ['QB-101', 'QS-201', 'QA-301', 'CB-101']) {
        const pr = K.proteccionDe(estado, tag).estado, malo = pr === 'DISPARADO' || pr === 'ABIERTO' || pr === 'FUNDIDO' || pr === 'AGOTADO';
        if (tag === 'QB-101' || tag === 'QS-201') sensores[tag] = { activo: !malo, alarma: pr === 'DISPARADO', texto: pr ? pr.toLowerCase() : '' };
      }
      const r = estado.red || {};
      sensores['RED-301'] = { activo: r.disponible !== false, alarma: r.disponible === false, texto: r.disponible === false ? 'sin red' : `${decimal(K.num(r.v, 230))} V` };
    }
    return { fraccion: 0, alturaLiquidoCm: 0, volumenMl: 0, presionFondoPa: 0, temperaturaAguaC: null, sensores };
  }

  /** Fichas para el panel del visor: las de textos_ayuda.js (qué es, en el simulador) y, si no están, una básica con el nombre de layout.js. */
  function ayudas() {
    const textos = typeof PCT !== 'undefined' && PCT.fvTextos && PCT.fvTextos.construirElementos ? PCT.fvTextos.construirElementos() : {};
    const salida = {};
    for (const e of layout.EQUIPOS) {
      const t = textos[e.tag] || {};
      salida[e.tag] = { titulo: t.titulo || e.nombre, etiqueta: t.etiqueta || `Código: ${e.tag}`, queEs: t.queEs || e.nombre + '.', enSimulador: t.enSimulador || 'En el 3D se mueve y se ilumina con el estado de la simulación.' };
    }
    return salida;
  }
  const RESUMEN = 'Cubierta del CIFP Politécnico con el campo A (policristalino, 6 paneles), el campo B (monocristalino, 8 paneles sobre bloques triangulares), la bandeja con los cables y la caseta metálica con los inversores EASun y ZCS, la batería, las cajas de continua y el cuadro de alterna. El sol sigue la hora del simulador. Pulsa una pieza para ver qué es; las medidas son aproximadas.';

  /** Registra el modelo y la escena en el visor de simulador_pct23. Devuelve false si el visor o la escena del diseñador no están cargados. */
  function registrar() {
    if (typeof PCT === 'undefined' || !PCT.visor3dEspecificaciones) return false;
    PCT.visor3dRutaThree = '/simulador/js/vendor/three.js';
    PCT.visor3dEspecificaciones.MODELOS.FV = {
      escena: 'fv', panel: 'planta', pesada: false, titulo: layout.INSTALACION.nombre, resumen: RESUMEN,
      captadores: [], conexiones: [], lecturas: lecturasFv, observaciones: () => ({}), sinEtiqueta, nombreEtiqueta,
    };
    Object.defineProperty(PCT.visor3dEspecificaciones.MODELOS.FV, 'ayudas', { enumerable: true, get: ayudas });
    PCT.visor3dEscenas = PCT.visor3dEscenas || {};
    if (PCT.fvEscena) { PCT.visor3dEscenas.fv = PCT.fvEscena; return true; }
    return false;
  }

  const api = { CON_ETIQUETA, sinEtiqueta, nombreEtiqueta, lecturasFv, ayudas, registrar };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvVisor = api; }
})();
