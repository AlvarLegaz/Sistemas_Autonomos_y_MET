// Panel de modo MANUAL de la planta real HTST: el operador manda cada actuador (bombas, variador, bancos del calentador, FDV, válvulas de agua fría,
// de CIP y de llenado/vaciado). La parte pura (zonas, orden frente a estado real, enclavamientos con su motivo, acciones peligrosas, confirmación en dos pasos)
// se exporta para probarla con node:test; la parte con DOM arma el panel y los mandos de la ficha de cada equipo.
//
// Reglas de diseño (revisión UX, criterios ISA-101): cada mando muestra la ORDEN pedida y el ESTADO REAL del equipo por separado (así «orden ON y contactor
// abierto» se ve como lo que es: un fallo); un mando bloqueado por un enclavamiento dice el MOTIVO en la propia fila; las acciones peligrosas piden
// confirmación en dos pasos con su consecuencia; y todo queda en el registro de actuaciones.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;

  /** Mandos por zona, en el orden del proceso (izquierda → derecha del esquema). tipo: 'onoff' o 'numerico' (VFD-101, 0-100 %). */
  const ZONAS = [
    { id: 'entrada', titulo: 'Entrada', mandos: [
      { tag: 'P-101', nombre: 'Bomba de alimentación', tipo: 'onoff' },
      { tag: 'VFD-101', nombre: 'Velocidad de P-101 (variador)', tipo: 'numerico', unidad: '%', min: 0, max: 100 }] },
    { id: 'agua_caliente', titulo: 'Agua caliente', mandos: [
      { tag: 'P-102', nombre: 'Bomba del agua caliente', tipo: 'onoff' },
      { tag: 'KM-201', nombre: 'Banco 1 del calentador (30 kW)', tipo: 'onoff' },
      { tag: 'KM-202', nombre: 'Banco 2 del calentador (30 kW)', tipo: 'onoff' }] },
    { id: 'salida', titulo: 'Salida y FDV', mandos: [{ tag: 'SV-101', nombre: 'FDV-101: avance (piloto energizado) / desvío', tipo: 'onoff', textoOn: 'AVANCE', textoOff: 'DESVÍO' }] },
    { id: 'agua_fria', titulo: 'Agua fría', mandos: [{ tag: 'XV-301', nombre: 'Válvula de agua fría', tipo: 'onoff', textoOn: 'ABIERTA', textoOff: 'CERRADA' }] },
    { id: 'cip', titulo: 'Limpieza CIP', mandos: [{ tag: 'XV-401', nombre: 'Válvula de CIP', tipo: 'onoff', textoOn: 'ABIERTA', textoOff: 'CERRADA' }] },
    { id: 'llenado', titulo: 'Llenado y vaciado', mandos: [
      { tag: 'XV-101', nombre: 'Llenado del tanque de balance', tipo: 'onoff', textoOn: 'ABIERTA', textoOff: 'CERRADA' },
      { tag: 'XV-102', nombre: 'Vaciado del tanque de balance', tipo: 'onoff', textoOn: 'ABIERTA', textoOff: 'CERRADA' },
      { tag: 'XV-302', nombre: 'Llenado del depósito de agua caliente', tipo: 'onoff', textoOn: 'ABIERTA', textoOff: 'CERRADA' },
      { tag: 'XV-303', nombre: 'Vaciado del depósito de agua caliente', tipo: 'onoff', textoOn: 'ABIERTA', textoOff: 'CERRADA' }] },
  ];
  const MANDOS = ZONAS.flatMap(z => z.mandos.map(m => Object.assign({ zona: z.id }, m)));
  const mandoDe = tag => MANDOS.find(m => m.tag === tag) || null;
  const textoOn = m => m.textoOn || 'ON', textoOff = m => m.textoOff || 'OFF';

  /** Protecciones que siguen activas en modo manual (el PLC no automatiza, pero estas están cableadas o son esenciales). */
  const PROTECCIONES = [
    'ES-001: la seta para toda la planta (hay que rearmarla).',
    'Pérdida de 24 V (F-201 o fuente PS-001): sin tensión no hay ninguna salida.',
    'TSH-101: el termostato de seguridad corta el calentador (también con TT-105 ≥ 88 °C).',
    'PSL-201: sin aire comprimido la FDV cae a desvío por el muelle.',
    'LSL-301 y P-102: los bancos del calentador se cortan sin nivel de agua o sin circulación.',
    'LSL-101: sin leche en TK-101, P-101 se para por marcha en seco.',
  ];

  /* ---------- lectura del estado ---------- */
  const eq = (e, tag) => (e && e.equipos && e.equipos[tag]) || {};
  const nivelDI = (e, tag) => (e && e.instrumentos && e.instrumentos[tag] && e.instrumentos[tag].nivel);
  const valorAI = (e, tag) => (e && e.instrumentos && e.instrumentos[tag] && e.instrumentos[tag].valorPLC);
  const salidas = e => (e && e.salidasPLC) || { DO: {}, AO: {} };

  /** Orden que el PLC está dando: true/false para on/off; número (0-100) para el variador. */
  function ordenDe(e, tag) {
    const m = mandoDe(tag), s = salidas(e);
    if (!m) return null;
    return m.tipo === 'numerico' ? Number((s.AO && s.AO[tag]) || 0) : !!(s.DO && s.DO[tag]);
  }
  /** Estado real del equipo (lo que hace de verdad), como booleano para on/off (null si no se puede saber). */
  function realActivo(e, tag) {
    const q = eq(e, tag);
    if (tag === 'SV-101') return q.energizada === undefined ? null : !!q.energizada;
    if (tag === 'VFD-101') return !!eq(e, 'P-101').marcha;
    if ('marcha' in q) return !!q.marcha;
    if ('cerrado' in q) return !!q.cerrado;
    if ('abierta' in q) return !!q.abierta;
    return null;
  }
  /** Texto del estado real. */
  function textoReal(e, tag) {
    const q = eq(e, tag), m = mandoDe(tag);
    if (!m) return '—';
    if (tag === 'VFD-101') return `${Math.round(eq(e, 'P-101').velocidadPct || 0)} % de velocidad real`;
    if (tag === 'SV-101') { const pos = eq(e, 'FDV-101').posicion; return `FDV ${pos === 'AVANCE' ? 'en avance' : pos === 'DESVIO' ? 'en desvío' : 'en movimiento'}`; }
    if ('marcha' in q) return q.marcha ? 'en marcha' : 'parada';
    if ('cerrado' in q) return q.cerrado ? 'contactor cerrado' : 'contactor abierto';
    if ('abierta' in q) return q.abierta ? 'abierta' : 'cerrada';
    return '—';
  }
  const textoOrden = (e, tag) => { const m = mandoDe(tag), o = ordenDe(e, tag); return m.tipo === 'numerico' ? `${Math.round(o)} %` : (o ? textoOn(m) : textoOff(m)); };

  /**
   * Causa que impide o explica un mando, distinguiendo lo que enseña el mantenimiento: { clase, etiqueta, texto } o null.
   *   clase 'sin24v'     → falta tensión (fusible F-201 o fuente PS-001): TODAS las entradas digitales leen 0, también la seta;
   *   clase 'paro'       → la seta ES-001 está pulsada (o el paro sigue enclavado hasta rearmar);
   *   clase 'proteccion' → una protección cableada o esencial actúa (no es una avería: es el sistema haciendo su trabajo).
   * Se lee del estado REAL de los equipos (F-201, PS-001, ES-001), no de las entradas digitales: sin 24 V la seta «lee» 0 aunque nadie la haya pulsado.
   */
  function causaBloqueo(e, tag) {
    if (!e) return null;
    const f201 = eq(e, 'F-201'), ps = eq(e, 'PS-001'), es = eq(e, 'ES-001');
    const fusible = !!f201.fundido, fuente = ps.ok === false || (ps.ok === undefined && nivelDI(e, 'PS-001') === 0);
    if (fusible || fuente) {
      return { clase: 'sin24v', etiqueta: fusible ? 'Sin 24 V (F-201)' : 'Sin 24 V (PS-001)',
        texto: `${fusible ? 'el fusible F-201 está fundido' : 'la fuente PS-001 no da tensión'}: las salidas y las entradas del PLC no tienen alimentación. Mide F-201 y PS-001.` };
    }
    const seta = es.rearmado === false || (es.rearmado === undefined && nivelDI(e, 'ES-001') === 0);
    if (seta) return { clase: 'paro', etiqueta: 'Paro de emergencia (ES-001)', texto: 'seta pulsada: nada arranca hasta rearmar.' };
    if (e.plc && e.plc.paro) return { clase: 'paro', etiqueta: 'Paro de emergencia enclavado', texto: 'la seta ya está liberada, pero hay que rearmar con «Rearmar» (PB-001).' };
    const proteccion = texto => ({ clase: 'proteccion', etiqueta: 'Protegida', texto });
    if (tag === 'P-101' && nivelDI(e, 'LSL-101') === 0) return proteccion('tanque de balance vacío (LSL-101): P-101 se para por marcha en seco. Llénalo con XV-101.');
    if ((tag === 'P-101' || tag === 'VFD-101') && eq(e, 'VFD-101').fallo) return proteccion('variador VFD-101 en fallo.');
    if (tag === 'KM-201' || tag === 'KM-202') {
      if (nivelDI(e, 'TSH-101') === 0) return proteccion('termostato de seguridad TSH-101 disparado: el calentador no se puede conectar.');
      if (nivelDI(e, 'LSL-301') === 0) return proteccion('nivel bajo en el depósito de agua caliente (LSL-301): las resistencias no deben trabajar sin agua. Llénalo con XV-302.');
      if (!eq(e, 'P-102').marcha) return proteccion('sin circulación: P-102 está parada y los bancos se cortarían. Arranca P-102 primero.');
      if (typeof valorAI(e, 'TT-105') === 'number' && valorAI(e, 'TT-105') >= 88) return proteccion('agua a 88 °C o más (TT-105): protección por sobretemperatura.');
    }
    if (tag === 'SV-101' && nivelDI(e, 'PSL-201') === 0) return proteccion('sin aire comprimido (PSL-201): la FDV queda en desvío por el muelle.');
    return null;
  }
  const textoCausa = c => (c ? `${c.etiqueta}: ${c.texto}` : null);

  /** Motivo (texto) por el que un mando NO se puede activar ahora (enclavamiento) o null si se puede. Ver causaBloqueo. */
  function bloqueo(e, tag) { return textoCausa(causaBloqueo(e, tag)); }

  /** Consecuencia de ACTIVAR un mando peligroso (pide confirmación en dos pasos) o null si no lo es. */
  function peligro(e, tag) {
    if (tag === 'KM-201' || tag === 'KM-202') return 'Conectas 30 kW de resistencias. Si el agua no circula o el nivel es bajo, se dañan: las protecciones cortarán, pero comprueba antes la circulación.';
    if (tag === 'XV-102') return 'Vas a vaciar el tanque de balance: P-101 se parará por marcha en seco cuando llegue al mínimo.';
    if (tag === 'XV-303') return 'Vas a vaciar el depósito de agua caliente: con nivel bajo las resistencias se cortan y el agua se pierde.';
    if (tag === 'SV-101' && !(e && e.plc && e.plc.cumpleCondiciones)) return 'La FDV pasará a AVANCE sin cumplir 72,5 °C, el tiempo de residencia y el diferencial: la leche se contará como NO CONFORME (alarma A220).';
    if (tag === 'P-101' && ((e && e.tanque && e.tanque.nivelPct) || 0) < 15) return 'El tanque de balance está casi vacío: P-101 trabajará casi en seco.';
    if (tag === 'XV-401' && ((e && e.proceso && e.proceso.caudalLh) || 0) > 0) return 'Hay leche circulando: la solución de limpieza no debe mezclarse con ella.';
    if (tag === 'XV-101' && ((e && e.tanque && e.tanque.nivelPct) || 0) >= 95) return 'El tanque de balance está casi lleno: rebosará.';
    if (tag === 'XV-302' && ((e && e.aguaCaliente && e.aguaCaliente.nivelPct) || 0) >= 95) return 'El depósito de agua caliente está casi lleno: rebosará.';
    return null;
  }

  /** Aviso cuando la orden y el estado real no coinciden (típico de mantenimiento: orden ON y contactor abierto), o null. */
  function discrepancia(e, tag) {
    const m = mandoDe(tag);
    if (!m || m.tipo !== 'onoff') return null;
    if (tag === 'SV-101' && eq(e, 'FDV-101').posicion === 'MOVIENDO') return null;     // la FDV tarda ~1,5 s en moverse
    const real = realActivo(e, tag), orden = ordenDe(e, tag);
    if (real === null || real === orden) return null;
    if (causaBloqueo(e, tag)) return null;                      // una protección, el paro o la falta de 24 V lo explican: no es una avería
    return `Posible avería: la orden (${orden ? textoOn(m) : textoOff(m)}) no se cumple (${textoReal(e, tag)}) y ninguna protección lo explica. Mide las bornas de la salida y de la bobina con el multímetro.`;
  }

  /** Lista de órdenes que llevan toda la planta a una parada segura (bombas y calentador apagados, FDV en desvío, válvulas cerradas, variador a 0). */
  const PARADA_SEGURA = MANDOS.map(m => [m.tag, 0]);

  /**
   * Confirmación en dos pasos: el primer pulsado «arma» la acción y el segundo (antes de `plazoMs`) la confirma; si pasa el plazo se desarma.
   * `ahora` (ms) y `programar` son inyectables para probarlo.
   */
  function crearDosPasos({ plazoMs = 5000, ahora = () => Date.now(), alCambiar = () => {} } = {}) {
    let armada = null, desde = 0;
    return {
      /** Devuelve 'armada' (primer pulsado) o 'confirmada' (segundo pulsado a tiempo). */
      pulsar(clave) {
        if (armada === clave && ahora() - desde <= plazoMs) { armada = null; alCambiar(); return 'confirmada'; }
        armada = clave; desde = ahora(); alCambiar(); return 'armada';
      },
      estaArmada(clave) { if (armada === clave && ahora() - desde > plazoMs) { armada = null; } return armada === clave; },
      cancelar() { armada = null; alCambiar(); },
    };
  }

  /* ---------- DOM ---------- */
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /**
   * Un mando (botón ON/OFF o campo numérico) con su estado y su motivo. Devuelve { nodo, actualizar(estado) }.
   * contexto: { sim(), registro, dosPasos }.
   */
  function crearMando(def, contexto, { compacto = false } = {}) {
    const nodo = document.createElement('div');
    nodo.className = 'manual-mando';
    const idMotivo = `motivo-${def.tag}-${compacto ? 'f' : 'p'}`;
    let boton = null, campo = null;
    const registrar = texto => { if (contexto.registro) contexto.registro.anotar('accion', texto); };

    if (def.tipo === 'numerico') {
      nodo.innerHTML = `<span class="manual-numero"><input type="number" min="${def.min}" max="${def.max}" step="5" value="0" aria-label="${escapar(def.nombre)} en ${def.unidad}"><span>${def.unidad}</span>` +
        '<button type="button" class="mando mando-aplicar">Aplicar</button></span>';
      campo = nodo.querySelector('input'); boton = nodo.querySelector('button');
      const aplicar = () => {
        const n = Number(campo.value);
        if (campo.value.trim() === '' || !Number.isFinite(n)) { campo.value = String(Math.round(ordenDe(contexto.sim().estado(), def.tag))); return; }   // entrada no numérica: se ignora
        const v = Math.max(def.min, Math.min(def.max, n)); campo.value = String(v);
        if (boton.getAttribute('aria-disabled') === 'true') return;
        contexto.sim().ordenes.manual(def.tag, v); if (contexto.alOrden) contexto.alOrden(); registrar(`Manual: ${def.tag} → ${v} ${def.unidad}`);
      };
      boton.addEventListener('click', aplicar);
      campo.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); aplicar(); } });
    } else {
      nodo.innerHTML = '<button type="button" class="mando" aria-pressed="false"></button>';
      boton = nodo.querySelector('button');
      boton.addEventListener('click', () => {
        const e = contexto.sim().estado();
        if (boton.getAttribute('aria-disabled') === 'true') return;
        const nuevo = !ordenDe(e, def.tag);
        const riesgo = nuevo ? peligro(e, def.tag) : null;
        if (riesgo && contexto.dosPasos.pulsar(def.tag) === 'armada') return;            // primer pulsado: se arma y se muestra la consecuencia
        contexto.dosPasos.cancelar();
        contexto.sim().ordenes.manual(def.tag, nuevo ? 1 : 0); if (contexto.alOrden) contexto.alOrden();
        registrar(`Manual: ${def.tag} → ${nuevo ? textoOn(def) : textoOff(def)}`);
      });
    }

    /** Pone al día el botón; devuelve { bloqueo, riesgo, armada } para que la fila escriba su motivo. */
    function actualizar(e) {
      const motivoBloqueo = bloqueo(e, def.tag), orden = ordenDe(e, def.tag);
      if (def.tipo === 'numerico') {
        boton.setAttribute('aria-disabled', String(!!motivoBloqueo));
        if (document.activeElement !== campo && campo.dataset.tocado !== '1') campo.value = String(Math.round(orden));
        if (motivoBloqueo) boton.setAttribute('aria-describedby', idMotivo); else boton.removeAttribute('aria-describedby');
        return { bloqueo: motivoBloqueo, riesgo: null, armada: false };
      }
      const armada = contexto.dosPasos.estaArmada(def.tag) && !orden;
      const bloqueado = !!motivoBloqueo && !orden;                                       // encender bloqueado; apagar siempre se puede
      boton.setAttribute('aria-disabled', String(bloqueado));
      boton.setAttribute('aria-pressed', String(!!orden));
      boton.classList.toggle('armado', armada);
      boton.textContent = armada ? 'Confirmar' : orden ? textoOn(def) : textoOff(def);
      boton.setAttribute('aria-label', `${def.tag}, ${def.nombre}: orden ${orden ? textoOn(def) : textoOff(def)}${armada ? ', pulsa de nuevo para confirmar' : ''}`);
      if (bloqueado || armada) boton.setAttribute('aria-describedby', idMotivo); else boton.removeAttribute('aria-describedby');
      return { bloqueo: motivoBloqueo, riesgo: peligro(e, def.tag), armada };
    }
    return { nodo, actualizar, idMotivo };
  }

  /**
   * Panel completo: aviso, acciones globales, protecciones y una sección plegable por zona. contexto: { sim(), registro, alVolverAAuto() }.
   * Devuelve { actualizar(estado), crearMandoFicha(tag) }.
   */
  function crearPanelManual(contenedor, contexto) {
    const dosPasos = crearDosPasos({ alCambiar: () => refrescar() });
    const ctx = Object.assign({ dosPasos }, contexto);
    const pausada = () => !!(contexto.enMarcha && !contexto.enMarcha());
    contenedor.innerHTML = '<p class="manual-aviso"><b>Modo MANUAL:</b> el PLC no automatiza nada. Tú mandas cada actuador; cada fila muestra la <b>orden</b> que pides y el <b>estado real</b> del equipo, y por qué un mando está bloqueado cuando lo está.</p>' +
      '<div class="manual-acciones"><button type="button" id="manual-auto">Volver a AUTO (recirculación de agua)</button><button type="button" id="manual-parada">Todo a parada segura</button></div>';
    const filas = [];
    for (const zona of ZONAS) {
      const det = document.createElement('details'); det.className = 'manual-zona'; det.open = true;
      det.innerHTML = `<summary>${escapar(zona.titulo)} <small class="resumen"></small></summary>`;
      const resumenZona = det.querySelector('.resumen');
      const filasZona = [];
      for (const def of zona.mandos) {
        const fila = document.createElement('div'); fila.className = 'manual-fila'; fila.dataset.tag = def.tag;
        const mando = crearMando(def, ctx);
        fila.innerHTML = `<div class="nombre"><b>${escapar(def.tag)}</b><small>${escapar(def.nombre)}</small></div><div class="real"><span>Estado real</span><b class="v-real">—</b></div><div class="orden"><span>Orden</span><b class="v-orden">—</b></div><div class="mando-celda"></div>` +
          `<p class="motivo" id="${mando.idMotivo}" hidden></p>`;
        fila.querySelector('.mando-celda').appendChild(mando.nodo);
        det.appendChild(fila);
        const filaObj = { def, fila, mando, real: fila.querySelector('.v-real'), orden: fila.querySelector('.v-orden'), motivo: fila.querySelector('.motivo') };
        filas.push(filaObj); filasZona.push(filaObj);
      }
      det.resumenZona = resumenZona; det.filasZona = filasZona;
      contenedor.appendChild(det);
    }
    const prot = document.createElement('div'); prot.className = 'manual-protecciones';
    prot.innerHTML = `<b>El PLC aún protege (cableado o esencial):</b><ul>${PROTECCIONES.map(p => `<li>${escapar(p)}</li>`).join('')}</ul>`;
    contenedor.appendChild(prot);

    contenedor.querySelector('#manual-auto').addEventListener('click', () => { if (contexto.alVolverAAuto) contexto.alVolverAAuto(); });
    contenedor.querySelector('#manual-parada').addEventListener('click', () => {
      for (const [tag, valor] of PARADA_SEGURA) contexto.sim().ordenes.manual(tag, valor);
      if (contexto.alOrden) contexto.alOrden();
      if (contexto.registro) contexto.registro.anotar('accion', 'Manual: todo a parada segura (bombas, calentador, FDV en desvío, válvulas cerradas, variador a 0)');
    });

    let ultimo = null;
    function refrescar() { if (ultimo) actualizar(ultimo); }
    function actualizar(e) {
      ultimo = e;
      for (const f of filas) {
        const r = f.mando.actualizar(e), orden = ordenDe(e, f.def.tag);
        f.real.textContent = textoReal(e, f.def.tag); f.orden.textContent = textoOrden(e, f.def.tag);
        const disc = pausada() ? null : discrepancia(e, f.def.tag);          // con la simulación parada el equipo no ha tenido tiempo de seguir la orden
        let texto = '', clase = '';
        if (r.armada && r.riesgo) { texto = `⚠ ${r.riesgo} Pulsa «Confirmar» en 5 s para seguir.`; clase = 'peligro'; }
        else if (r.bloqueo && (orden === false || orden === 0)) { texto = `🔒 Bloqueado · ${r.bloqueo}`; clase = 'bloqueo'; }
        else if (r.bloqueo && orden) { texto = `🛡 ${r.bloqueo}`; clase = 'bloqueo'; }
        else if (disc) { texto = `⚠ ${disc}`; clase = 'discrepancia'; }
        f.motivo.hidden = !texto; f.motivo.className = `motivo ${clase}`.trim(); if (f.motivo.textContent !== texto) f.motivo.textContent = texto;
        f.fila.classList.toggle('bloqueada', !!r.bloqueo && !orden);
      }
      contenedor.querySelectorAll('details.manual-zona').forEach(det => {
        const activos = det.filasZona.filter(f => (typeof ordenDe(e, f.def.tag) === 'number' ? ordenDe(e, f.def.tag) > 0 : ordenDe(e, f.def.tag))).length;
        const bloqueados = det.filasZona.filter(f => bloqueo(e, f.def.tag) && !ordenDe(e, f.def.tag)).length;
        det.resumenZona.textContent = `${activos} de ${det.filasZona.length} activos${bloqueados ? ` · ${bloqueados} bloqueados` : ''}`;
      });
    }
    /** Mando para la ficha de un equipo: null si ese equipo no se manda a mano. Usa el mismo estado y las mismas reglas. */
    function crearMandoFicha(tag) {
      const def = mandoDe(tag);
      if (!def) return null;
      const mando = crearMando(def, ctx, { compacto: true });
      const caja = document.createElement('div'); caja.className = 'mando-ficha';
      caja.innerHTML = `<h4>Mando manual</h4><p class="motivo" id="${mando.idMotivo}" hidden></p>`;
      caja.insertBefore(mando.nodo, caja.querySelector('.motivo'));
      return { nodo: caja, actualizar(e) {
        const r = mando.actualizar(e), disc = pausada() ? null : discrepancia(e, tag), orden = ordenDe(e, tag), m = caja.querySelector('.motivo');
        const texto = r.armada && r.riesgo ? `⚠ ${r.riesgo} Pulsa «Confirmar» en 5 s.` : r.bloqueo ? (orden ? `🛡 ${r.bloqueo}` : `🔒 Bloqueado · ${r.bloqueo}`) : disc ? `⚠ ${disc}` : '';
        m.hidden = !texto; if (m.textContent !== texto) m.textContent = texto;
      } };
    }
    return { actualizar, crearMandoFicha };
  }

  const api = { ZONAS, MANDOS, PROTECCIONES, PARADA_SEGURA, mandoDe, ordenDe, realActivo, textoReal, textoOrden, causaBloqueo, bloqueo, peligro, discrepancia, crearDosPasos, crearMando, crearPanelManual };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstPanelManual = api;
})();
