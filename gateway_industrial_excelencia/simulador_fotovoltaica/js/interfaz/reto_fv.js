// Modo Diagnóstico: reto con una avería OCULTA que el alumno localiza midiendo, hoja de diagnóstico y nota. Aquí está la lógica, sin DOM (se prueba con node:test,
// tests/interfaz_reto.test.js): descodificar la clave del reto del profesor, qué se oculta en pantalla, comparar las medidas del cuaderno con las medidas clave del
// catálogo, corregir (acierto total, parcial o nulo), calcular la nota con su desglose y preparar el envío al aula (POST /api/reto/resultado).
// La avería real NUNCA se escribe en pantalla ni en la consola antes de entregar: vive solo en la memoria del panel de diagnóstico.
(function () {
  const enNode = typeof require !== 'undefined';
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const SIM = 'fotovoltaica';
  const CLAVE_ALMACEN = 'fv_retos_resultados', MAX_GUARDADOS = 30, MAX_DETALLE = 4000;
  const TOPE_SIN_MEDIDAS = 4;
  const PUNTOS = { averia: 5, elemento: 1, distractor: 2.5, medidasClave: 2.5, hoja: 0.5, tiempo: 1, pista: 1, peligro: 1, intento: 1, maxPeligros: 2 };
  const TIEMPO_PLENO_S = 600, TIEMPO_CERO_S = 1800;      // hasta 10 min, el punto de tiempo entero; a partir de 30 min, nada
  const num = v => typeof v === 'number' && Number.isFinite(v);

  /* ---------- reto ---------- */
  const b64aTexto = t => (typeof atob === 'function' ? atob(t) : Buffer.from(t, 'base64').toString('binary'));
  const textoAb64 = t => (typeof btoa === 'function' ? btoa(t) : Buffer.from(t, 'binary').toString('base64'));
  /** Id de avería de la `clave` del reto (base64 del id). null si la clave no es de una avería del contrato. */
  function descodificarClave(clave, averias = layout.AVERIAS) {
    if (typeof clave !== 'string' || !clave) return null;
    let id; try { id = b64aTexto(clave.trim()).trim(); } catch (error) { return null; }
    return averias.some(a => a.id === id) ? id : null;
  }
  const codificarClave = id => textoAb64(String(id));
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
  /** Baraja determinista (misma semilla, mismo orden): la lista de averías de la hoja no sale en el orden del catálogo. */
  function barajar(lista, semilla = 1) {
    const a = lista.slice(); let s = (Math.floor(semilla) >>> 0) || 1;
    for (let k = a.length - 1; k > 0; k--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (k + 1); [a[k], a[j]] = [a[j], a[k]]; }
    return a;
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
    if (num(esc.horaSolar)) p.push(`${F.formatoHora(esc.horaSolar)} (hora solar)${esc.horaSolar < 6 || esc.horaSolar > 20 ? ', de noche' : ''}`);
    if (num(esc.nubosidad)) p.push(esc.nubosidad < 0.15 ? 'cielo despejado' : esc.nubosidad > 0.7 ? 'cielo cubierto' : `nubosidad del ${Math.round(esc.nubosidad * 100)} %`);
    if (num(esc.socInicialPct)) p.push(`batería al ${Math.round(esc.socInicialPct)} %`);
    if (esc.modoEasun) p.push(`EASun en modo ${String(esc.modoEasun).replace(/_/g, ' ').toLowerCase()}`);
    for (const [tag, w] of Object.entries(esc.cargas || {})) p.push(`${tag} consumiendo ${Math.round(w)} W`);
    if (num(esc.esperaS) && esc.esperaS >= 600) p.push(`la instalación lleva ${Math.round(esc.esperaS / 60)} min funcionando así`);
    return p.join(' · ');
  }

  /* ---------- medidas clave ---------- */
  const equipoDe = id => { if (id === 'N' || id === 'TIERRA') return 'QA-301'; const s = String(id); return /^PE\./.test(s) ? s.slice(3) : s.split('.')[0]; };
  const MODO_CLAVE = { VDC: 'tension', VAC: 'tension', OHM: 'resistencia', tension: 'tension', resistencia: 'resistencia' };
  /** Ids (puntos, conductor o elemento) que nombra una medida clave del catálogo. */
  const idsDeClave = c => [].concat(c.puntos || [], c.conductor || [], c.tag || [], c.punto || [], c.cadena || []).map(String);
  /**
   * ¿Ha hecho el alumno la medida clave `c`? Busca en las entradas del cuaderno una medida válida con el mismo instrumento (y modo, en el multímetro) y los mismos puntos
   * (sin importar el orden de las puntas) → 'exacta'; o, si no, en los mismos equipos (medir en la otra borna del mismo fusible o en el otro polo de la misma cadena
   * demuestra lo mismo) → 'equivalente'. Si no hay ninguna → ''.
   */
  function claveHecha(c, entradas) {
    const ids = idsDeClave(c).sort(), equipos = [...new Set(ids.map(equipoDe))];
    let mejor = '';
    for (const e of entradas || []) {
      if (e.instrumento !== c.instrumento || e.valida === false || e.peligro) continue;
      if (c.instrumento === 'multimetro' && c.modo && MODO_CLAVE[e.modo] !== MODO_CLAVE[c.modo]) continue;
      const pe = (e.puntos || []).map(String).slice().sort();
      if (pe.length === ids.length && pe.every((p, k) => p === ids[k])) return 'exacta';
      const eq = new Set(pe.map(equipoDe));
      if (equipos.length && equipos.every(q => eq.has(q))) mejor = 'equivalente';
    }
    return mejor;
  }
  /** Repaso de las medidas clave: [{ texto, instrumento, hecha: bool, como: 'exacta'|'equivalente'|'' }]. */
  function medidasClaveHechas(claves, entradas) {
    return (claves || []).map(c => { const como = claveHecha(c, entradas); return { texto: c.texto || `${c.instrumento}: ${idsDeClave(c).join(' ↔ ')}`, instrumento: c.instrumento, hecha: !!como, como }; });
  }

  /* ---------- corrección ---------- */
  // Elementos que también valen como «elemento averiado» además del tag de la avería (la avería afecta a varios o el tag del contrato es solo uno de ellos).
  const panelesDe = cadena => { for (const c of ['A', 'B']) { const s = layout.CAMPOS[c].cadenas.find(x => x.id === cadena); if (s) return s.paneles; } return []; };
  const EQUIVALENTES = {
    SUCIEDAD_ALTA_A: ['STR-102'].concat(panelesDe('STR-101'), panelesDe('STR-102')), SOMBRA_PARAPETO: ['PV-206', 'STR-202'], FALLO_AISLAMIENTO_B: panelesDe('STR-201'),
    CONECTOR_RESISTIVO_B2: panelesDe('STR-202'), DIODO_BYPASS_PV104: [], DIODO_BYPASS_ABIERTO_PV203: [], COMUNICACION_PERDIDA_EASUN: [],
  };
  const elementosValidos = id => { const a = layout.AVERIAS.find(x => x.id === id); return a ? [a.tag].concat(EQUIVALENTES[id] || []) : []; };
  /**
   * Corrige la hipótesis. → { acierto: 0 | 0.5 | 1, averiaOk, elementoOk, distractor }.
   * 1 = acierta la avería; 0,5 = no la acierta pero señala el elemento averiado o una avería «distractora» de síntoma parecido; 0 = ni lo uno ni lo otro.
   */
  function corregir({ real, averiaRespuesta, elementoRespuesta, distractores = [] }) {
    const averiaOk = !!real && averiaRespuesta === real, elementoOk = !!elementoRespuesta && elementosValidos(real).includes(elementoRespuesta);
    const distractor = !averiaOk && !!averiaRespuesta && distractores.includes(averiaRespuesta);
    return { acierto: averiaOk ? 1 : elementoOk || distractor ? 0.5 : 0, averiaOk, elementoOk, distractor };
  }

  /**
   * Nota de 0 a 10 con un decimal y su desglose. datos: { correccion, clavesHechas, clavesTotal, medidas /* nº de medidas hechas *\/, pistas (0–3), peligros (nº de maniobras
   * o medidas peligrosas), segundos (tiempo real), intento (1 = primero), sintoma, reparacion, evidencias (nº de medidas marcadas) }.
   * Reparto: hipótesis hasta 6 (avería 5 + elemento 1; una avería parecida vale 2,5), medidas clave hasta 2,5, hoja completa 0,5 y tiempo 1.
   * Restan: cada pista 1, cada maniobra peligrosa 1 (hasta 2) y cada intento anterior 1.
   * Tope: sin ninguna medida clave hecha la nota no pasa de 4 aunque se acierte (acertar sin medir es adivinar).
   */
  function calcularNota(d) {
    const c = d.correccion || { averiaOk: false, elementoOk: false, distractor: false }, D = [];
    const fila = (concepto, puntos, max, detalle) => D.push({ concepto, puntos: Math.round(puntos * 100) / 100, max, detalle });
    fila('Avería', c.averiaOk ? PUNTOS.averia : c.distractor ? PUNTOS.distractor : 0, PUNTOS.averia, c.averiaOk ? 'Has acertado la avería.' : c.distractor ? 'No es esa, pero es una avería de síntoma parecido: vas bien encaminado.' : 'No es esa avería.');
    fila('Elemento averiado', c.elementoOk ? PUNTOS.elemento : 0, PUNTOS.elemento, c.elementoOk ? 'Has señalado el elemento averiado.' : 'El elemento averiado es otro.');
    const total = Math.max(0, d.clavesTotal || 0), hechas = Math.min(total, Math.max(0, d.clavesHechas || 0));
    const pm = total ? PUNTOS.medidasClave * hechas / total : PUNTOS.medidasClave * Math.min(1, (d.medidas || 0) / 3);
    fila('Medidas clave', pm, PUNTOS.medidasClave, total ? `Has hecho ${hechas} de las ${total} medidas que demuestran esta avería.` : `Has hecho ${d.medidas || 0} ${d.medidas === 1 ? 'medida' : 'medidas'} (esta avería no tiene medidas clave en el catálogo: cuentan hasta tres).`);
    const partes = [String(d.sintoma || '').trim().length >= 10, String(d.reparacion || '').trim().length >= 10, (d.evidencias || 0) > 0], nh = partes.filter(Boolean).length;
    fila('Hoja completa', PUNTOS.hoja * nh / 3, PUNTOS.hoja, nh === 3 ? 'Síntoma, evidencias y reparación rellenos.' : `Falta: ${[!partes[0] && 'describir el síntoma', !partes[2] && 'marcar alguna medida como evidencia', !partes[1] && 'explicar la reparación'].filter(Boolean).join(', ')}.`);
    const s = Math.max(0, d.segundos || 0), pt = s <= TIEMPO_PLENO_S ? PUNTOS.tiempo : s >= TIEMPO_CERO_S ? 0 : PUNTOS.tiempo * (TIEMPO_CERO_S - s) / (TIEMPO_CERO_S - TIEMPO_PLENO_S);
    fila('Tiempo', pt, PUNTOS.tiempo, `Has tardado ${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s (el punto entero, hasta 10 min).`);
    const pistas = Math.max(0, Math.min(3, d.pistas || 0)), peligros = Math.max(0, d.peligros || 0), anteriores = Math.max(0, (d.intento || 1) - 1);
    if (pistas) fila('Pistas usadas', -PUNTOS.pista * pistas, 0, `${pistas} ${pistas === 1 ? 'pista' : 'pistas'}: cada una resta ${PUNTOS.pista} punto.`);
    if (peligros) fila('Maniobras peligrosas', -PUNTOS.peligro * Math.min(PUNTOS.maxPeligros, peligros), 0, `${peligros} ${peligros === 1 ? 'vez' : 'veces'} (abrir un seccionador de continua con carga, medir continuidad con tensión…): cada una resta ${PUNTOS.peligro} punto, hasta ${PUNTOS.maxPeligros}.`);
    if (anteriores) fila('Intentos anteriores', -PUNTOS.intento * anteriores, 0, `Este es tu intento n.º ${anteriores + 1}: cada intento anterior resta ${PUNTOS.intento} punto.`);
    // Sin ninguna medida que demuestre la avería, acertar es adivinar: la nota no pasa de TOPE_SIN_MEDIDAS (un suspenso) aunque la hipótesis sea la buena
    const sinMedir = pm <= 0, antes = D.reduce((t, f) => t + f.puntos, 0);
    if (sinMedir && antes > TOPE_SIN_MEDIDAS) fila('Sin medidas que lo demuestren', TOPE_SIN_MEDIDAS - antes, 0, `No has hecho ninguna medida que demuestre la avería: sin medir, la nota no pasa de ${TOPE_SIN_MEDIDAS} aunque aciertes.`);
    const suma = D.reduce((t, f) => t + f.puntos, 0);
    return { nota: Math.round(Math.max(0, Math.min(10, suma)) * 10) / 10, desglose: D };
  }

  /* ---------- maniobras peligrosas ---------- */
  const CORRIENTE_CARGA_A = 1;
  /**
   * ¿Es peligrosa la orden `d` (la de decidirClic) con el estado `e`? Abrir un seccionador de continua CON CARGA: en continua la corriente no pasa por cero y el arco no
   * se apaga solo. → texto del aviso o '' si no hay peligro. (Lo correcto: apagar antes el inversor, o abrir de noche.)
   */
  function peligroManiobra(d, e) {
    if (!d || d.tipo !== 'orden' || d.accion !== 'abrir' || !e || !e.campos) return '';
    const campo = d.tag === 'QS-101' ? e.campos.A : d.tag === 'QS-201' ? e.campos.B : null;
    if (!campo || !(Math.abs(campo.i || 0) > CORRIENTE_CARGA_A)) return '';
    return `MANIOBRA PELIGROSA: has abierto ${d.tag} con ${(Math.abs(campo.i)).toFixed(1).replace('.', ',')} A de continua pasando. En continua el arco no se apaga solo: apaga antes el inversor (sin corriente) y abre después.`;
  }

  /* ---------- envío al aula y copia local ---------- */
  /** `detalle` del envío: JSON de 4000 caracteres como mucho con el síntoma, la reparación propuesta y las medidas marcadas (se recortan los textos si no cabe). */
  function detalleJson({ sintoma = '', reparacion = '', evidencias = [], intento = 1, peligros = 0, titulo = '' }) {
    const hacer = (ls, lr, n, lt) => JSON.stringify({ sintoma: String(sintoma).slice(0, ls), reparacion: String(reparacion).slice(0, lr), medidas: evidencias.slice(0, n).map(t => String(t).slice(0, lt)), intento, peligros, titulo: String(titulo).slice(0, 80) });
    for (const [ls, lr, n, lt] of [[1200, 1200, 20, 160], [800, 800, 12, 120], [400, 400, 8, 90], [200, 200, 4, 60], [80, 80, 0, 0]]) { const j = hacer(ls, lr, n, lt); if (j.length <= MAX_DETALLE) return j; }
    return '{}';
  }
  /**
   * Campos del POST /api/reto/resultado (application/x-www-form-urlencoded), con el formato del contrato: acierto 0, 0.5 o 1; nota con un decimal; enteros lo demás.
   * r: { csrf, reto, averiaReal, averiaRespuesta, elementoRespuesta, acierto, nota, pistas, medidas, segundos, detalle }.
   */
  function camposEnvio(r) {
    const entero = (v, max = 1e9) => String(Math.max(0, Math.min(max, Math.round(num(v) ? v : 0))));
    return { csrf: String(r.csrf || ''), reto: r.reto === undefined || r.reto === null ? '' : String(r.reto), sim: SIM, averia_real: String(r.averiaReal || ''), averia_respuesta: String(r.averiaRespuesta || ''),
      elemento_respuesta: String(r.elementoRespuesta || ''), acierto: r.acierto === 1 ? '1' : r.acierto === 0.5 ? '0.5' : '0', nota: (Math.max(0, Math.min(10, num(r.nota) ? r.nota : 0))).toFixed(1),
      pistas: entero(r.pistas, 3), medidas: entero(r.medidas), segundos: entero(r.segundos), detalle: String(r.detalle || '{}').slice(0, MAX_DETALLE) };
  }
  /** Cuerpo urlencoded del envío. */
  const codificarEnvio = r => Object.entries(camposEnvio(r)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  /** Resultados guardados en este navegador (los más recientes primero). `almacen` es localStorage o cualquier objeto con getItem/setItem. */
  function leerResultados(almacen) {
    try { const L = JSON.parse((almacen && almacen.getItem(CLAVE_ALMACEN)) || '[]'); return Array.isArray(L) ? L : []; } catch (error) { return []; }
  }
  function guardarResultado(almacen, r) {
    const L = [r].concat(leerResultados(almacen)).slice(0, MAX_GUARDADOS);
    try { almacen.setItem(CLAVE_ALMACEN, JSON.stringify(L)); return true; } catch (error) { return false; }
  }

  const api = { SIM, CLAVE_ALMACEN, MAX_DETALLE, PUNTOS, TIEMPO_PLENO_S, TIEMPO_CERO_S, AYUDAS, descodificarClave, codificarClave, leerReto, retoLibre, barajar, ocultacion, firmaDe, textoEscenario, equipoDe, idsDeClave,
    claveHecha, medidasClaveHechas, elementosValidos, corregir, calcularNota, peligroManiobra, detalleJson, camposEnvio, codificarEnvio, leerResultados, guardarResultado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvReto = api;
})();
