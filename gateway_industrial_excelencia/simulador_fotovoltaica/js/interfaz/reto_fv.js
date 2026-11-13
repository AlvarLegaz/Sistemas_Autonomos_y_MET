// Modo Diagnóstico: reto con una avería OCULTA que el alumno localiza midiendo, hoja de diagnóstico y nota. Aquí está la lógica, sin DOM (se prueba con node:test,
// tests/interfaz_reto.test.js): descodificar la clave del reto del profesor, qué se oculta en pantalla, comparar las medidas del cuaderno con las medidas clave del
// catálogo, corregir (acierto total, parcial o nulo), calcular la nota con su desglose y preparar el envío al aula (POST /api/reto/resultado).
// La avería real NUNCA se escribe en pantalla ni en la consola antes de entregar: vive solo en la memoria del panel de diagnóstico.
// La lógica común (clave, corrección, nota, medidas clave, maniobras peligrosas y envío al aula) está en comun/js/diagnostico/logica_diagnostico.js; aquí queda lo propio de la
// fotovoltaica (qué elementos valen como averiado, cómo se agrupan los puntos por equipo, firmas y escenario) y la API pública de siempre.
(function () {
  const enNode = typeof require !== 'undefined';
  const L = enNode ? require('../../../comun/js/diagnostico/logica_diagnostico.js') : (window.PCT && PCT.diagnostico && PCT.diagnostico.logica);
  if (!L) { if (!enNode && typeof console !== 'undefined') console.warn('[fotovoltaica] falta comun/js/diagnostico/logica_diagnostico.js: el modo Diagnóstico no está disponible.'); return; }
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const SIM = 'fotovoltaica';
  const { CLAVE_ALMACEN, MAX_DETALLE, PUNTOS, TIEMPO_PLENO_S, TIEMPO_CERO_S, barajar, calcularNota, detalleJson, codificarClave } = L;
  const num = v => typeof v === 'number' && Number.isFinite(v);

  /* ---------- reto ---------- */
  /** Id de avería de la `clave` del reto (base64 del id). null si la clave no es de una avería del contrato. */
  const descodificarClave = (clave, averias = layout.AVERIAS) => L.descodificarClave(clave, averias.map(a => a.id));
  /**
   * Interpreta la respuesta de GET /api/reto?sim=fotovoltaica. → { id, averia, titulo, pistas } o null (sin reto del profesor, respuesta rara o clave desconocida).
   * `averia` es el id real: quien lo recibe no debe enseñarlo.
   */
  function leerReto(respuesta) {
    const r = respuesta && respuesta.reto; if (!r || typeof r !== 'object') return null;
    const averia = descodificarClave(r.clave); if (!averia) return null;
    return { id: r.id === undefined || r.id === null ? '' : r.id, averia, titulo: typeof r.titulo === 'string' && r.titulo ? r.titulo : 'Reto del profesor', pistas: r.pistas !== false };
  }
  /** Reto libre («Practicar con una avería al azar»): id vacío. `azar` es una función 0–1 (Math.random por defecto). */
  function retoLibre(azar = Math.random, averias = layout.AVERIAS) {
    return { id: '', averia: averias[Math.min(averias.length - 1, Math.floor(azar() * averias.length))].id, titulo: 'Práctica libre: avería al azar', pistas: true };
  }
  /* ---------- qué se oculta ---------- */
  const AYUDAS = ['panelAverias', 'tarjetaDiagnostico', 'alarmas', 'burbujas', 'lecturas', 'graficas', 'estadoFicha', 'coloresEstado', 'sustituir'];
  /**
   * Qué ayudas se ocultan en cada modo de la página: en 'diagnostico' todas las que delatarían la avería (el panel de averías del profesor, la tarjeta causa → efecto, los
   * textos de alarma, las burbujas de medida, la pestaña de lecturas, las gráficas, el estado en vivo de la ficha, los colores de estado y el botón de sustituir). Tras
   * entregar y pedir «ver la avería» (`revelado`), vuelven. En los demás modos no se oculta nada.
   */
  function ocultacion(modo, revelado = false) {
    const oculto = modo === 'diagnostico' && !revelado;
    return Object.fromEntries(AYUDAS.map(a => [a, oculto]));
  }

  /* ---------- firma de diagnóstico de la avería (del catálogo del modelo) ---------- */
  /** Firma de una avería: la del catálogo (`firma` o las propiedades colgadas de `diagnostico`) y, si el catálogo aún no la trae, una mínima hecha con lo que hay. */
  function firmaDe(id, catalogo) {
    const a = catalogo && catalogo.porId ? catalogo.porId(id) : null, L = layout.AVERIAS.find(x => x.id === id) || { titulo: id, tag: '' };
    const f = a && (a.firma || (a.diagnostico && a.diagnostico.medidasClave ? a.diagnostico : null));
    const textos = a && Array.isArray(a.diagnostico) ? a.diagnostico.filter(t => typeof t === 'string') : [];
    const circuito = layout.CIRCUITOS[layout.circuitoDe(L.tag)] || 'la instalación';
    const base = { sintoma: (a && a.sintomas && a.sintomas[0]) || '', escenario: null, medidasClave: [],
      pistas: [(a && a.sintomas && a.sintomas[0]) || 'Compara lo que produce cada campo con el sol que hay.', `Mira en: ${circuito.toLowerCase()}.`, textos[0] || `Mide en ${L.tag}.`],
      explicacion: [a && a.descripcion, a && a.solucion && a.solucion.texto].filter(Boolean).join(' Reparación: ') || L.titulo, distractores: [] };
    if (!f) return base;
    return { sintoma: f.sintoma || base.sintoma, escenario: f.escenario || null, medidasClave: Array.isArray(f.medidasClave) ? f.medidasClave : [],
      pistas: Array.isArray(f.pistas) && f.pistas.length ? f.pistas.slice(0, 3) : base.pistas, explicacion: f.explicacion || base.explicacion, distractores: Array.isArray(f.distractores) ? f.distractores : [] };
  }

  /**
   * Condiciones del reto para el alumno, a partir del escenario de la firma: fecha, hora, cielo, batería, modo y cargas. NO dice nada de las sombras ni de la avería
   * (la sombra se ve en el sinóptico, como se vería en la cubierta). '' si la firma no trae escenario.
   */
  function textoEscenario(esc, formato) {
    if (!esc) return '';
    const F = formato || (enNode ? require('./formato_fv.js') : PCT.fvFormato), p = [];
    if (num(esc.diaAnio)) p.push(F.textoFecha(esc.diaAnio));
    if (num(esc.horaSolar)) p.push(`${F.formatoHora(esc.horaSolar)} solar${esc.horaSolar < 6 || esc.horaSolar > 20 ? ', de noche' : ''}`);
    if (num(esc.nubosidad)) p.push(esc.nubosidad < 0.15 ? 'despejado' : esc.nubosidad > 0.7 ? 'cubierto' : `nubosidad ${Math.round(esc.nubosidad * 100)} %`);
    if (num(esc.socInicialPct)) p.push(`batería ${Math.round(esc.socInicialPct)} %`);
    if (esc.modoEasun) p.push(`EASun: ${String(esc.modoEasun).replace(/_/g, ' ').toLowerCase().replace(/^bateria/, 'batería')}`);
    for (const [tag, w] of Object.entries(esc.cargas || {})) p.push(`${tag}: ${Math.round(w)} W`);
    if (num(esc.esperaS) && esc.esperaS >= 600) p.push(`lleva ${Math.round(esc.esperaS / 60)} min funcionando así`);
    return p.join(' · ');
  }

  /* ---------- medidas clave ---------- */
  const equipoDe = id => { if (id === 'N' || id === 'TIERRA') return 'QA-301'; const s = String(id); return /^PE\./.test(s) ? s.slice(3) : s.split('.')[0]; };
  const idsDeClave = c => L.idsDeClave(c);
  const claveHecha = (c, entradas) => L.claveHecha(c, entradas, { equipoDe });
  const medidasClaveHechas = (claves, entradas) => L.medidasClaveHechas(claves, entradas, { equipoDe });

  /* ---------- corrección ---------- */
  // Elementos que también valen como «elemento averiado» además del tag de la avería (la avería afecta a varios o el tag del contrato es solo uno de ellos).
  const panelesDe = cadena => { for (const c of ['A', 'B']) { const s = layout.CAMPOS[c].cadenas.find(x => x.id === cadena); if (s) return s.paneles; } return []; };
  const EQUIVALENTES = {
    SUCIEDAD_ALTA_A: ['STR-102'].concat(panelesDe('STR-101'), panelesDe('STR-102')), SOMBRA_PARAPETO: ['PV-206', 'STR-202'], FALLO_AISLAMIENTO_B: panelesDe('STR-201'),
    CONECTOR_RESISTIVO_B2: panelesDe('STR-202'), DIODO_BYPASS_PV104: [], DIODO_BYPASS_ABIERTO_PV203: [], COMUNICACION_PERDIDA_EASUN: [],
  };
  const elementosValidos = id => { const a = layout.AVERIAS.find(x => x.id === id); return a ? [a.tag].concat(EQUIVALENTES[id] || []) : []; };
  /** Corrige la hipótesis. → { acierto: 0 | 0.5 | 1, averiaOk, elementoOk, distractor } (ver logica_diagnostico.js). */
  const corregir = datos => L.corregir(datos, elementosValidos);

  /** Maniobra peligrosa (abrir QS-101/QS-201 con carga): la lógica común con las corrientes de los dos campos. */
  const peligroManiobra = (d, e) => L.peligroManiobra(d, e);
  /** Campos del POST /api/reto/resultado: los de la lógica común con sim = fotovoltaica (r.sesion, si viene, va en el campo `sesion`). */
  const camposEnvio = r => L.camposEnvio(r, SIM);
  const codificarEnvio = r => L.codificarEnvio(r, SIM);
  const leerResultados = almacen => L.leerResultados(almacen, CLAVE_ALMACEN);
  const guardarResultado = (almacen, r) => L.guardarResultado(almacen, r, CLAVE_ALMACEN);

  const api = { SIM, CLAVE_ALMACEN, MAX_DETALLE, PUNTOS, TIEMPO_PLENO_S, TIEMPO_CERO_S, AYUDAS, descodificarClave, codificarClave, leerReto, retoLibre, barajar, ocultacion, firmaDe, textoEscenario, equipoDe, idsDeClave,
    claveHecha, medidasClaveHechas, elementosValidos, corregir, calcularNota, peligroManiobra, detalleJson, camposEnvio, codificarEnvio, leerResultados, guardarResultado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvReto = api;
})();
