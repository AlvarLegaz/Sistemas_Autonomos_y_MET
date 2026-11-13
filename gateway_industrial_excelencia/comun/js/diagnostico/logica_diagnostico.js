// Lógica pura del modo Diagnóstico, común a los simuladores (sin DOM, sin simulador): clave del reto, corrección de la hipótesis, nota con su desglose,
// repaso de medidas clave, maniobras peligrosas y envío al aula (POST /api/reto/resultado). Extraída de simulador_fotovoltaica/js/interfaz/reto_fv.js.
// Lo que depende del simulador (qué elementos valen como «averiado», cómo se agrupan los puntos por equipo) llega por parámetro.
// Las medidas clave y las entradas del cuaderno se aceptan en dos formatos: el del contrato (`peticion: { instrumento, magnitud, a, b, elemento, conductor }`)
// y el antiguo de la FV (`{ instrumento, modo, puntos|conductor|tag|punto|cadena }`).
(function () {
  const PUNTOS = { averia: 5, elemento: 1, distractor: 2.5, medidasClave: 2.5, hoja: 0.5, tiempo: 1, pista: 1, peligro: 1, intento: 1, maxPeligros: 2 };
  const TOPE_SIN_MEDIDAS = 4;
  const TIEMPO_PLENO_S = 600, TIEMPO_CERO_S = 1800;      // hasta 10 min, el punto de tiempo entero; a partir de 30 min, nada
  const MAX_DETALLE = 4000, MAX_GUARDADOS = 30, CLAVE_ALMACEN = 'fv_retos_resultados';
  const CORRIENTE_CARGA_A = 1;
  const num = v => typeof v === 'number' && Number.isFinite(v);

  /* ---------- clave del reto ---------- */
  const b64aTexto = t => (typeof atob === 'function' ? atob(t) : Buffer.from(t, 'base64').toString('binary'));
  const textoAb64 = t => (typeof btoa === 'function' ? btoa(t) : Buffer.from(t, 'binary').toString('base64'));
  /** Id de avería de la `clave` (base64 del id) si está entre `ids` (lista de ids o de objetos con `id`); null si no. */
  function descodificarClave(clave, ids) {
    if (typeof clave !== 'string' || !clave) return null;
    let id; try { id = b64aTexto(clave.trim()).trim(); } catch (error) { return null; }
    return (ids || []).some(a => (a && a.id !== undefined ? a.id : a) === id) ? id : null;
  }
  const codificarClave = id => textoAb64(String(id));
  /** Baraja determinista (misma semilla, mismo orden). */
  function barajar(lista, semilla = 1) {
    const a = lista.slice(); let s = (Math.floor(semilla) >>> 0) || 1;
    for (let k = a.length - 1; k > 0; k--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (k + 1); [a[k], a[j]] = [a[j], a[k]]; }
    return a;
  }

  /* ---------- corrección ---------- */
  /**
   * Corrige la hipótesis. → { acierto: 0 | 0.5 | 1, averiaOk, elementoOk, distractor }.
   * `elementosValidos` (opcional): función id de avería → lista de elementos que valen como «el averiado».
   * 1 = acierta la avería; 0,5 = señala el elemento averiado o una avería «distractora» de síntoma parecido; 0 = ni lo uno ni lo otro.
   */
  function corregir({ real, averiaRespuesta, elementoRespuesta, distractores = [] }, elementosValidos) {
    const validos = typeof elementosValidos === 'function' ? elementosValidos(real) || [] : [];
    const averiaOk = !!real && averiaRespuesta === real, elementoOk = !!elementoRespuesta && validos.includes(elementoRespuesta);
    const distractor = !averiaOk && !!averiaRespuesta && distractores.includes(averiaRespuesta);
    return { acierto: averiaOk ? 1 : elementoOk || distractor ? 0.5 : 0, averiaOk, elementoOk, distractor };
  }

  /**
   * Nota de 0 a 10 con un decimal y su desglose. datos: { correccion, clavesHechas, clavesTotal, medidas, pistas (0–3), peligros, segundos, intento, sintoma,
   * reparacion, evidencias }. Hipótesis hasta 6 (avería 5 + elemento 1; una avería parecida vale 2,5), medidas clave hasta 2,5, hoja 0,5 y tiempo 1.
   * Restan: cada pista 1, cada maniobra peligrosa 1 (hasta 2) y cada intento anterior 1. Tope: sin ninguna medida clave la nota no pasa de 4.
   */
  function calcularNota(d) {
    const c = d.correccion || { averiaOk: false, elementoOk: false, distractor: false }, D = [];
    const fila = (concepto, puntos, max, detalle) => D.push({ concepto, puntos: Math.round(puntos * 100) / 100, max, detalle });
    fila('Avería', c.averiaOk ? PUNTOS.averia : c.distractor ? PUNTOS.distractor : 0, PUNTOS.averia, c.averiaOk ? 'Correcta.' : c.distractor ? 'No es esa, pero tiene un síntoma parecido.' : 'No es esa.');
    fila('Elemento averiado', c.elementoOk ? PUNTOS.elemento : 0, PUNTOS.elemento, c.elementoOk ? 'Correcto.' : 'Es otro.');
    const total = Math.max(0, d.clavesTotal || 0), hechas = Math.min(total, Math.max(0, d.clavesHechas || 0));
    const pm = total ? PUNTOS.medidasClave * hechas / total : PUNTOS.medidasClave * Math.min(1, (d.medidas || 0) / 3);
    fila('Medidas clave', pm, PUNTOS.medidasClave, total ? `${hechas} de ${total} medidas que la demuestran.` : `${d.medidas || 0} ${d.medidas === 1 ? 'medida' : 'medidas'} (sin medidas clave en el catálogo: cuentan hasta tres).`);
    const partes = [String(d.sintoma || '').trim().length >= 10, String(d.reparacion || '').trim().length >= 10, (d.evidencias || 0) > 0], nh = partes.filter(Boolean).length;
    fila('Hoja completa', PUNTOS.hoja * nh / 3, PUNTOS.hoja, nh === 3 ? 'Síntoma, evidencias y reparación rellenos.' : `Falta: ${[!partes[0] && 'describir el síntoma', !partes[2] && 'marcar alguna medida como evidencia', !partes[1] && 'explicar la reparación'].filter(Boolean).join(', ')}.`);
    const s = Math.max(0, d.segundos || 0), pt = s <= TIEMPO_PLENO_S ? PUNTOS.tiempo : s >= TIEMPO_CERO_S ? 0 : PUNTOS.tiempo * (TIEMPO_CERO_S - s) / (TIEMPO_CERO_S - TIEMPO_PLENO_S);
    fila('Tiempo', pt, PUNTOS.tiempo, `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s (punto entero hasta 10 min).`);
    const pistas = Math.max(0, Math.min(3, d.pistas || 0)), peligros = Math.max(0, d.peligros || 0), anteriores = Math.max(0, (d.intento || 1) - 1);
    if (pistas) fila('Pistas usadas', -PUNTOS.pista * pistas, 0, `${pistas} ${pistas === 1 ? 'pista' : 'pistas'}: −${PUNTOS.pista} cada una.`);
    if (peligros) fila('Maniobras peligrosas', -PUNTOS.peligro * Math.min(PUNTOS.maxPeligros, peligros), 0, `${peligros} ${peligros === 1 ? 'vez' : 'veces'} (p. ej. abrir un seccionador de continua con carga): −${PUNTOS.peligro} cada una, hasta −${PUNTOS.maxPeligros}.`);
    if (anteriores) fila('Intentos anteriores', -PUNTOS.intento * anteriores, 0, `Intento n.º ${anteriores + 1}: −${PUNTOS.intento} por cada intento anterior.`);
    // Sin ninguna medida que demuestre la avería, acertar es adivinar: la nota no pasa de TOPE_SIN_MEDIDAS aunque la hipótesis sea la buena
    const sinMedir = pm <= 0, antes = D.reduce((t, f) => t + f.puntos, 0);
    if (sinMedir && antes > TOPE_SIN_MEDIDAS) fila('Sin medidas que lo demuestren', TOPE_SIN_MEDIDAS - antes, 0, `Sin medidas que demuestren la avería, la nota no pasa de ${TOPE_SIN_MEDIDAS}.`);
    const suma = D.reduce((t, f) => t + f.puntos, 0);
    return { nota: Math.round(Math.max(0, Math.min(10, suma)) * 10) / 10, desglose: D };
  }

  /* ---------- medidas clave ---------- */
  const MODO_COMUN = { VDC: 'tension', VAC: 'tension', V: 'tension', OHM: 'resistencia', ohm: 'resistencia', mA: 'corriente', tension: 'tension', resistencia: 'resistencia', corriente: 'corriente', continuidad: 'continuidad' };
  const modoDe = m => (m === undefined || m === null ? '' : MODO_COMUN[m] || String(m));
  const equipoPorDefecto = id => String(id).split(/[.:]/)[0];
  /** Una medida clave o una entrada del cuaderno en forma común: { instrumento, modo, ids }. */
  function normalizar(x) {
    const p = x && x.peticion;
    if (p) return { instrumento: p.instrumento, modo: modoDe(p.magnitud), ids: [p.a, p.b, p.elemento, p.conductor].filter(v => v !== undefined && v !== null).map(String) };
    return { instrumento: x.instrumento, modo: modoDe(x.modo || x.magnitud), ids: [].concat(x.puntos || [], x.conductor || [], x.tag || [], x.punto || [], x.cadena || [], x.elemento || [], x.a || [], x.b || []).map(String) };
  }
  const idsDeClave = c => normalizar(c).ids;
  /**
   * ¿Ha hecho el alumno la medida clave `c`? Busca una entrada válida y no peligrosa con el mismo instrumento (y modo, si la clave lo trae), con los mismos puntos
   * sin importar el orden → 'exacta'; o con los mismos equipos → 'equivalente'; si no, ''. opciones.equipoDe: id → equipo (por defecto, lo anterior al primer . o :).
   */
  function claveHecha(c, entradas, opciones = {}) {
    const equipoDe = opciones.equipoDe || equipoPorDefecto, K = normalizar(c), ids = K.ids.slice().sort(), equipos = [...new Set(K.ids.map(equipoDe))];
    let mejor = '';
    for (const e of entradas || []) {
      if (e.valida === false || e.peligro) continue;
      const E = normalizar(e);
      if (E.instrumento !== K.instrumento) continue;
      if (K.modo && E.modo !== K.modo) continue;
      const pe = E.ids.slice().sort();
      if (pe.length === ids.length && pe.every((p, k) => p === ids[k])) return 'exacta';
      const eq = new Set(pe.map(equipoDe));
      if (equipos.length && equipos.every(q => eq.has(q))) mejor = 'equivalente';
    }
    return mejor;
  }
  /** Repaso de las medidas clave: [{ texto, instrumento, hecha, como }]. */
  function medidasClaveHechas(claves, entradas, opciones) {
    return (claves || []).map(c => { const como = claveHecha(c, entradas, opciones); const K = normalizar(c); return { texto: c.texto || `${K.instrumento}: ${K.ids.join(' ↔ ')}`, instrumento: K.instrumento, hecha: !!como, como }; });
  }

  /* ---------- maniobras peligrosas ---------- */
  /**
   * ¿Es peligrosa la orden `d` con el estado `e`? Abrir un seccionador de continua CON CARGA (el arco no se apaga solo). Acepta la orden del contrato
   * (`{ tipo:'protecciones.abrir', destino }`) y la antigua (`{ tipo:'orden', accion:'abrir', tag }`). opciones.corrientePorSeccionador: { 'QS-101': e => A }.
   * → texto del aviso o ''.
   */
  function peligroManiobra(d, e, opciones = {}) {
    if (!d || !e) return '';
    const tag = d.destino || d.tag, abre = d.tipo === 'protecciones.abrir' || (d.tipo === 'orden' && d.accion === 'abrir');
    if (!abre) return '';
    const leer = (opciones.corrientePorSeccionador || { 'QS-101': s => s.campos && s.campos.A && s.campos.A.i, 'QS-201': s => s.campos && s.campos.B && s.campos.B.i })[tag];
    const i = leer ? leer(e) : undefined;
    if (!(Math.abs(i || 0) > CORRIENTE_CARGA_A)) return '';
    return `MANIOBRA PELIGROSA: has abierto ${tag} con ${(Math.abs(i)).toFixed(1).replace('.', ',')} A de continua pasando. El arco en continua no se apaga solo: apaga antes el inversor.`;
  }

  /* ---------- envío al aula y copia local ---------- */
  /** `detalle` del envío: JSON de 4000 caracteres como mucho con el síntoma, la reparación y las medidas marcadas (se recortan los textos si no cabe). */
  function detalleJson({ sintoma = '', reparacion = '', evidencias = [], intento = 1, peligros = 0, titulo = '' }) {
    const hacer = (ls, lr, n, lt) => JSON.stringify({ sintoma: String(sintoma).slice(0, ls), reparacion: String(reparacion).slice(0, lr), medidas: evidencias.slice(0, n).map(t => String(t).slice(0, lt)), intento, peligros, titulo: String(titulo).slice(0, 80) });
    for (const [ls, lr, n, lt] of [[1200, 1200, 20, 160], [800, 800, 12, 120], [400, 400, 8, 90], [200, 200, 4, 60], [80, 80, 0, 0]]) { const j = hacer(ls, lr, n, lt); if (j.length <= MAX_DETALLE) return j; }
    return '{}';
  }
  /** Campos del POST /api/reto/resultado (urlencoded). `sim` es el id del simulador; `r.sesion` (opcional) va con el evento `entrego`. */
  function camposEnvio(r, sim) {
    const entero = (v, max = 1e9) => String(Math.max(0, Math.min(max, Math.round(num(v) ? v : 0))));
    const campos = { csrf: String(r.csrf || ''), reto: r.reto === undefined || r.reto === null ? '' : String(r.reto), sim: String(sim || r.sim || ''), averia_real: String(r.averiaReal || ''), averia_respuesta: String(r.averiaRespuesta || ''),
      elemento_respuesta: String(r.elementoRespuesta || ''), acierto: r.acierto === 1 ? '1' : r.acierto === 0.5 ? '0.5' : '0', nota: (Math.max(0, Math.min(10, num(r.nota) ? r.nota : 0))).toFixed(1),
      pistas: entero(r.pistas, 3), medidas: entero(r.medidas), segundos: entero(r.segundos), detalle: String(r.detalle || '{}').slice(0, MAX_DETALLE) };
    if (r.sesion) campos.sesion = String(r.sesion).slice(0, 64);
    return campos;
  }
  const codificarEnvio = (r, sim) => Object.entries(camposEnvio(r, sim)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  /** Resultados guardados en este navegador (los más recientes primero). `almacen` es localStorage o algo con getItem/setItem. */
  function leerResultados(almacen, clave = CLAVE_ALMACEN) {
    try { const L = JSON.parse((almacen && almacen.getItem(clave)) || '[]'); return Array.isArray(L) ? L : []; } catch (error) { return []; }
  }
  function guardarResultado(almacen, r, clave = CLAVE_ALMACEN) {
    const L = [r].concat(leerResultados(almacen, clave)).slice(0, MAX_GUARDADOS);
    try { almacen.setItem(clave, JSON.stringify(L)); return true; } catch (error) { return false; }
  }

  const api = { PUNTOS, TOPE_SIN_MEDIDAS, TIEMPO_PLENO_S, TIEMPO_CERO_S, MAX_DETALLE, MAX_GUARDADOS, CLAVE_ALMACEN, descodificarClave, codificarClave, barajar, corregir, calcularNota,
    idsDeClave, claveHecha, medidasClaveHechas, peligroManiobra, detalleJson, camposEnvio, codificarEnvio, leerResultados, guardarResultado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.PCT = window.PCT || {}; (PCT.diagnostico = PCT.diagnostico || {}).logica = api; }
})();
