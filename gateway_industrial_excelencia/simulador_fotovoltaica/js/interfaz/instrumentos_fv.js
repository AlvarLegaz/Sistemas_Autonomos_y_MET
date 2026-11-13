// Instrumentos de medida virtuales de la instalación fotovoltaica: multímetro (V⎓, V∿, Ω-continuidad), pinza amperimétrica, megóhmetro, trazador de curvas I-V y
// cámara termográfica. Aquí está SOLO la lógica (qué se lee, con qué unidad y qué avisos da el aparato): los números salen siempre del modelo (sim.medir, sim.continuidad,
// sim.corriente, sim.aislamiento, sim.curvaIV, sim.curvaIVReferencia, sim.resumenIV, sim.termografia; contrato en API_INSTRUMENTOS.md). Si el modelo todavía no tiene una
// función, el instrumento responde { ok: false, noDisponible: true } y la página lo dice sin romperse. Sin DOM: se prueba con node:test (tests/interfaz_instrumentos.test.js).
(function () {
  const enNode = typeof require !== 'undefined';
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const F = enNode ? require('./formato_fv.js') : PCT.fvFormato;
  const { dec } = F;
  const num = v => typeof v === 'number' && Number.isFinite(v);

  const INSTRUMENTOS = [
    { id: 'multimetro', nombre: 'Multímetro', corto: 'Multímetro', icono: 'V Ω', ayuda: 'Tensión continua y alterna entre dos puntos, y continuidad.' },
    { id: 'pinza', nombre: 'Pinza amperimétrica', corto: 'Pinza', icono: 'A', ayuda: 'Corriente de un conductor, con su sentido, sin abrir el circuito.' },
    { id: 'megohmetro', nombre: 'Megóhmetro', corto: 'Megóhmetro', icono: 'MΩ', ayuda: 'Aislamiento de una cadena a tierra. Exige el seccionador abierto.' },
    { id: 'trazadorIV', nombre: 'Trazador de curvas I-V', corto: 'Trazador I-V', icono: 'I-V', ayuda: 'Curva medida de una cadena frente a la de referencia: Voc, Isc, Pmpp y factor de forma.' },
    { id: 'termografia', nombre: 'Cámara termográfica', corto: 'Cámara', icono: '°C', ayuda: 'Vista térmica. Toca un equipo para leer su temperatura.' },
  ];
  const MODOS_MULTIMETRO = [
    { id: 'VDC', nombre: 'V⎓', titulo: 'Tensión continua' }, { id: 'VAC', nombre: 'V∿', titulo: 'Tensión alterna' }, { id: 'OHM', nombre: 'Ω cont.', titulo: 'Continuidad (sin tensión)' },
  ];
  const MODOS_PINZA = [{ id: 'DC', nombre: 'A⎓', titulo: 'Corriente continua' }, { id: 'AC', nombre: 'A∿', titulo: 'Corriente alterna' }];
  const CADENAS = ['STR-101', 'STR-102', 'STR-201', 'STR-202'];
  const SECCIONADOR_DE = { 'STR-101': 'QS-101', 'STR-102': 'QS-101', 'STR-201': 'QS-201', 'STR-202': 'QS-201' };
  const UMBRAL_TENSION_OHM_V = 1;          // por encima, medir continuidad es peligroso (y la medida no vale)
  const TENSION_PELIGROSA_DC_V = 120, TENSION_PELIGROSA_AC_V = 50, RANGO_MAX_V = 1000, RANGO_PINZA_A = 400;
  const AISLAMIENTO_MIN_MOHM = 1;          // IEC 62446-1: ≥ 1 MΩ (ensayo a 500 V para sistemas de menos de 500 V; a 1000 V para los de más)
  const IRRADIANCIA_MIN_IV = 400;          // IEC 62446-1: por debajo de 400 W/m² la curva I-V no es concluyente

  const tiene = (sim, nombre) => !!sim && typeof sim[nombre] === 'function';
  const noDisponible = que => ({ ok: false, noDisponible: true, pantalla: '— — —', unidad: '', valor: null, avisos: [{ nivel: 'aviso', texto: `${que}: no disponible todavía en el modelo.` }], texto: 'no disponible' });
  const aviso = (nivel, texto) => ({ nivel, texto });
  const seguro = (fn, def = null) => { try { return fn(); } catch (error) { return def; } };
  const estadoProt = (sim, tag) => { const p = sim && sim.estado && sim.estado.protecciones && sim.estado.protecciones[tag]; return p ? p.estado : undefined; };
  const campoDeCadena = id => (/^STR-1/.test(id) ? 'A' : 'B');
  const descripcionPunto = (sim, id) => { const p = ((sim && sim.puntos) || []).find(x => x.id === id); return p ? p.descripcion : id; };
  const tension = v => `${dec(v, Math.abs(v) < 10 ? 2 : 1)}`;

  /* ---------- multímetro ---------- */
  /**
   * Lectura del multímetro en `modo` ('VDC' | 'VAC' | 'OHM') con la punta roja en el nodo `roja` y la negra en `negra`.
   * → { ok, pantalla, unidad, valor, avisos: [{ nivel: 'info'|'aviso'|'peligro', texto }], peligro, texto /* para el cuaderno *\/ }.
   */
  function lecturaMultimetro(sim, modo, roja, negra) {
    if (!roja || !negra) return { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('info', !roja ? 'Toca un punto para la punta ROJA.' : 'Ahora, la punta NEGRA.')], texto: '' };
    if (!tiene(sim, 'medir')) return noDisponible('Multímetro');
    const m = seguro(() => sim.medir(roja, negra));
    if (!m || m.ok === false) return { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('aviso', (m && m.texto) || 'Punto de medida desconocido.')], texto: 'punto desconocido' };
    const avisos = [], esAlterna = m.tipo === 'AC', sinRef = m.tipo === 'sin_referencia';
    const vdc = num(m.vdc) ? m.vdc : (m.tipo === 'DC' && num(m.valor) ? m.valor : 0), vac = num(m.vac) ? m.vac : (esAlterna && num(m.valor) ? Math.abs(m.valor) : 0);
    if (modo === 'OHM') {
      const peligro = (v, texto) => ({ ok: true, valida: false, pantalla: 'PELIGRO', unidad: '', valor: null, peligro: true, voltios: v,
        avisos: [aviso('peligro', texto || `Hay ${tension(v)} V entre las puntas: NUNCA midas continuidad con tensión (rompes el multímetro y la lectura no vale). Abre antes el seccionador o la protección.`)],
        texto: `CON TENSIÓN${num(v) && v > 0 ? ` (${tension(v)} V)` : ''}: medida no válida` });
      let hay, ohm;
      if (tiene(sim, 'resistencia')) {      // el modelo aplica las reglas del óhmetro (tensión entre las puntas, elemento en carga…)
        const r = seguro(() => sim.resistencia(roja, negra));
        if (!r) return noDisponible('Continuidad');
        if (r.ok === false) return r.conTension ? peligro(Math.abs(r.voltios || 0), r.texto) : { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('aviso', r.texto || 'Punto de medida desconocido.')], texto: 'punto desconocido' };
        ohm = r.abierto ? Infinity : r.ohm; hay = 'continuidad' in r ? !!r.continuidad : (num(ohm) && ohm < 50);
      } else {
        const v = Math.max(Math.abs(vdc), Math.abs(vac));
        if (v > UMBRAL_TENSION_OHM_V) return peligro(v);
        if (!tiene(sim, 'continuidad')) return noDisponible('Continuidad');
        hay = !!seguro(() => sim.continuidad(roja, negra), false); ohm = hay ? 0.2 : Infinity;
      }
      if (sinRef && !hay) avisos.push(aviso('info', 'Esos dos puntos están en circuitos distintos: no hay camino entre ellos.'));
      if (hay) return { ok: true, pantalla: dec(ohm, ohm < 10 ? 2 : 0), unidad: 'Ω cont.', valor: ohm, avisos: avisos.concat(aviso('info', 'Continuidad (pitido): camino cerrado entre las puntas.')), texto: `${dec(ohm, ohm < 10 ? 2 : 0)} Ω · continuidad` };
      if (num(ohm) && ohm < 2e7) { const t = ohm >= 1e6 ? `${dec(ohm / 1e6, 2)} MΩ` : ohm >= 1000 ? `${dec(ohm / 1000, 1)} kΩ` : `${dec(ohm, 0)} Ω`; return { ok: true, pantalla: t.split(' ')[0], unidad: t.split(' ')[1], valor: ohm, avisos: avisos.concat(aviso('aviso', 'Resistencia alta: no es un camino franco (no pita).')), texto: `${t} · sin continuidad` }; }
      return { ok: true, pantalla: 'OL', unidad: 'Ω', valor: Infinity, avisos: avisos.concat(aviso('aviso', 'Circuito abierto (OL): no hay camino entre las puntas.')), texto: 'OL · circuito abierto' };
    }
    if (sinRef) avisos.push(aviso('aviso', 'Sin referencia común: son circuitos aislados entre sí y la lectura no vale. Mide dentro del mismo circuito.'));
    if (modo === 'VAC') {
      if (m.tipo === 'DC' && Math.abs(vdc) > 0.5) avisos.push(aviso('aviso', 'Entre estos puntos la tensión es CONTINUA: en V∿ el multímetro marca 0. Pasa a V⎓.'));
      const v = esAlterna ? vac : 0;
      if (v > RANGO_MAX_V) return { ok: true, pantalla: 'OL', unidad: 'V∿', valor: v, peligro: false, avisos: [aviso('peligro', 'Fuera de rango (más de 1000 V).')], texto: 'OL · fuera de rango' };
      if (v > TENSION_PELIGROSA_AC_V) avisos.push(aviso('peligro', `Tensión peligrosa (${dec(v, 0)} V∿): puntas con protección, una sola mano y nunca toques la parte metálica.`));
      if (esAlterna && v > 253) avisos.push(aviso('aviso', 'Por encima de 253 V (230 V + 10 %): tensión de red alta.'));
      if (esAlterna && v < 1) avisos.push(aviso('info', 'Sin tensión alterna entre las puntas.'));
      return { ok: true, pantalla: dec(v, 1), unidad: 'V∿', valor: v, avisos, texto: `${dec(v, 1)} V∿` };
    }
    // V⎓
    if (esAlterna && vac > 0.5) avisos.push(aviso('aviso', 'Entre estos puntos la tensión es ALTERNA: en V⎓ el multímetro marca 0. Pasa a V∿.'));
    const v = m.tipo === 'DC' ? vdc : 0;
    if (Math.abs(v) > RANGO_MAX_V) return { ok: true, pantalla: 'OL', unidad: 'V⎓', valor: v, avisos: [aviso('peligro', 'Fuera de rango (más de 1000 V).')], texto: 'OL · fuera de rango' };
    if (v < -0.05) avisos.push(aviso('aviso', 'Signo negativo = polaridad invertida: la roja está en el punto de MENOS potencial (o el cableado está al revés).'));
    if (Math.abs(v) >= TENSION_PELIGROSA_DC_V) avisos.push(aviso('peligro', `Tensión peligrosa (${dec(Math.abs(v), 0)} V⎓): en continua el arco no se apaga solo. CAT III 1000 V, guantes y una sola mano.`));
    if (m.tipo === 'DC' && Math.abs(v) < 0.05) avisos.push(aviso('info', '0 V⎓: mismo potencial o circuito abierto aguas arriba.'));
    return { ok: true, pantalla: tension(v), unidad: 'V⎓', valor: v, avisos, texto: `${tension(v)} V⎓` };
  }

  /* ---------- pinza amperimétrica ---------- */
  /** Lista de conductores que el modelo deja medir: [{ id, descripcion, tipo: 'DC'|'AC' }]. Vacía si el modelo no la da. */
  function conductores(sim) {
    const c = sim && sim.conductores;
    const lista = Array.isArray(c) ? c : c && typeof c === 'object' ? Object.entries(c).map(([id, v]) => Object.assign({ id }, typeof v === 'object' ? v : { descripcion: String(v) })) : [];
    return lista.map(x => (typeof x === 'string' ? { id: x, descripcion: x } : x)).filter(x => x && x.id).map(x => Object.assign({}, x, { descripcion: x.descripcion || x.nombre || x.id, tipo: /^(AC|alterna|CA)$/i.test(x.tipo || '') ? 'AC' : /^(DC|continua|CC)$/i.test(x.tipo || '') ? 'DC' : (x.tipo || '') }));
  }
  /**
   * Lectura de la pinza en el conductor `id` con el selector en `modo` ('DC' | 'AC'). El signo y el sentido los da el modelo:
   * positivo = la corriente va en el sentido de referencia del conductor (el que dice su descripción).
   */
  function lecturaPinza(sim, id, modo = 'DC') {
    if (!id) return { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('info', 'Toca un CABLE. Abraza un solo conductor: ida y vuelta juntos marcan 0.')], texto: '' };
    if (!tiene(sim, 'corriente')) return noDisponible('Pinza amperimétrica');
    const r = seguro(() => sim.corriente(id));
    if (r == null || (typeof r === 'object' && r.ok === false)) return { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('aviso', (r && r.texto) || 'Conductor desconocido.')], texto: 'conductor desconocido' };
    const c = conductores(sim).find(x => x.id === id) || {};
    const tipo = (typeof r === 'object' && r.tipo) || c.tipo || 'DC', esAC = /^(AC|alterna|CA)$/i.test(tipo);
    const a = typeof r === 'number' ? r : num(r.valor) ? r.valor : num(r.a) ? r.a : num(r.i) ? r.i : 0;
    const avisos = [], unidad = modo === 'AC' ? 'A∿' : 'A⎓';
    if (esAC !== (modo === 'AC')) {
      avisos.push(aviso('aviso', esAC ? 'Por este cable va corriente ALTERNA: en A⎓ la pinza marca 0. Pasa a A∿.' : 'Por este cable va corriente CONTINUA: en A∿ la pinza marca 0. Pasa a A⎓ (y haz el cero antes de medir).'));
      return { ok: true, pantalla: dec(0, 2), unidad, valor: 0, avisos, texto: `0 ${unidad} (selector equivocado)` };
    }
    if (Math.abs(a) > RANGO_PINZA_A) return { ok: true, pantalla: 'OL', unidad, valor: a, avisos: [aviso('peligro', 'Fuera de rango de la pinza.')], texto: 'OL' };
    const sentido = typeof r === 'object' && r.sentido ? String(r.sentido) : '';
    const esTierra = /^PE\.|L\+N$/.test(String(id));
    if (esTierra && Math.abs(a) >= 0.0003) avisos.push(aviso('peligro', 'Por tierra (o entre fase y neutro) no debe pasar corriente: hay una FUGA a tierra aguas abajo.'));
    else if (Math.abs(a) < 0.0003) avisos.push(aviso('info', esTierra ? 'Sin corriente de fuga: correcto.' : 'No circula corriente: sin sol, sin consumo o circuito abierto.'));
    else if (sentido) avisos.push(aviso('info', `Sentido: ${sentido}.`));
    else if (!esAC) avisos.push(aviso('info', a > 0 ? 'Signo +: sentido normal (de la fuente a la carga).' : 'Signo −: sentido inverso al normal.'));
    const v = esAC ? Math.abs(a) : a, mili = Math.abs(v) < 1, signo = !esAC && v >= 0.0003 ? '+' : '';      // por debajo de 1 A la pinza pasa a miliamperios (fugas a tierra)
    const pantalla = `${signo}${mili ? dec(v * 1000, Math.abs(v) < 0.1 ? 1 : 0) : dec(v, Math.abs(v) < 10 ? 2 : 1)}`, u = mili ? `m${unidad}` : unidad;
    return { ok: true, pantalla, unidad: u, valor: v, avisos, texto: `${pantalla} ${u}${sentido ? ' · ' + sentido : ''}` };
  }

  /* ---------- megóhmetro ---------- */
  /**
   * Aislamiento a tierra del polo `polo` ('+' | '-') de la cadena `cadena`. Exige el seccionador del campo abierto: con el inversor conectado la medida no vale
   * (y los 500–1000 V del ensayo lo pueden dañar).
   */
  function lecturaMegohmetro(sim, cadena, polo = '+') {
    if (!cadena) return { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('info', 'Elige la cadena y el polo.')], texto: '' };
    if (!tiene(sim, 'aislamiento')) return noDisponible('Megóhmetro');
    const conPolo = Array.isArray(sim.puntosAislamiento), qs = SECCIONADOR_DE[cadena], est = estadoProt(sim, qs);
    const bloqueo = texto => ({ ok: false, bloqueado: true, valida: false, pantalla: 'ABRE ' + (qs || ''), unidad: '', valor: null, avisos: [aviso('peligro', texto)], texto: `no medido: ${qs || 'seccionador'} cerrado` });
    const explicacion = `El megóhmetro inyecta cientos de voltios: con el inversor conectado lo puedes dañar y la medida no vale. Abre ${qs} (sin carga) y repite.`;
    if (!conPolo && qs && est === 'CERRADO') return bloqueo(`El seccionador ${qs} está cerrado. ${explicacion}`);      // el modelo antiguo no lo exige: lo exige el instrumento
    const r = seguro(() => sim.aislamiento(conPolo ? `${cadena}.${polo}` : cadena));
    if (!r || r.ok === false) {
      const t = (r && r.texto) || 'Punto de medida desconocido.';
      return /seccionador|abre/i.test(t) ? bloqueo(`${t.replace(/\.$/, '')}. ${explicacion}`) : { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('aviso', t)], texto: 'no medido' };
    }
    const mohm = num(r.mohm) ? r.mohm : NaN;
    if (!num(mohm)) return { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('aviso', r.texto || 'Sin lectura.')], texto: 'sin lectura' };
    const minimo = num(r.minimoMohm) ? r.minimoMohm : AISLAMIENTO_MIN_MOHM, bien = 'correcto' in r ? !!r.correcto : mohm >= minimo, prueba = num(r.tensionPruebaV) ? `${r.tensionPruebaV} V` : '';
    const pantalla = mohm >= 500 ? '> 500' : dec(mohm, mohm < 10 ? 2 : 1);
    return { ok: true, pantalla, unidad: 'MΩ', valor: mohm, correcto: bien, tensionPruebaV: r.tensionPruebaV,
      avisos: [aviso(bien ? 'info' : 'peligro', bien ? `Aislamiento correcto: por encima del mínimo de ${dec(minimo, 1)} MΩ${prueba ? ` (ensayo a ${prueba}, IEC 62446-1)` : ''}.` : `FALLO DE AISLAMIENTO: por debajo de ${dec(minimo, 1)} MΩ${prueba ? ` (ensayo a ${prueba})` : ''} hay una fuga a tierra (cable pelado, conector con agua, panel dañado). El inversor no debe conectar.`),
        aviso('info', 'Tras el ensayo la cadena queda cargada: descárgala antes de tocar.')],
      texto: `${pantalla} MΩ a tierra${prueba ? ` (${prueba})` : ''} · ${bien ? 'correcto' : 'FALLO'}` };
  }

  /* ---------- trazador de curvas I-V ---------- */
  /** Resumen de una curva [{ v, i, p }]: { voc, isc, pmpp, vmpp, impp, ff, maximos /* nº de picos de la curva P-V *\/, escalones /* = maximos − 1: diodos de paso conduciendo *\/ }. */
  function resumenCurva(curva) {
    const c = (curva || []).filter(q => q && num(q.v) && num(q.i));
    if (c.length < 3) return { voc: 0, isc: 0, pmpp: 0, vmpp: 0, impp: 0, ff: 0, maximos: 0, escalones: 0 };
    const pts = c.slice().sort((a, b) => a.v - b.v).map(q => ({ v: q.v, i: Math.max(0, q.i), p: q.v * Math.max(0, q.i) }));
    const isc = pts[0].i, conI = pts.filter(q => q.i > 1e-3), voc = conI.length < pts.length ? (pts[conI.length] || pts[pts.length - 1]).v : pts[pts.length - 1].v;
    let mejor = pts[0]; for (const q of pts) if (q.p > mejor.p) mejor = q;
    // picos de la curva P-V: un punto mayor que sus vecinos y que destaca al menos un 3 % del máximo sobre el valle que lo separa del pico anterior
    let maximos = 0, valle = 0, ultimoPico = -1;
    for (let k = 1; k < pts.length - 1; k++) {
      const q = pts[k];
      if (q.p >= pts[k - 1].p && q.p > pts[k + 1].p && q.p > 0.05 * mejor.p) {
        if (ultimoPico < 0 || (Math.min(q.p, ultimoPico) - valle) > 0.03 * mejor.p) { maximos++; ultimoPico = q.p; valle = q.p; } else ultimoPico = Math.max(ultimoPico, q.p);
      }
      if (ultimoPico >= 0) valle = Math.min(valle, q.p);
    }
    if (!maximos && mejor.p > 0) maximos = 1;
    return { voc, isc, pmpp: mejor.p, vmpp: mejor.v, impp: mejor.i, ff: voc > 0 && isc > 0 ? mejor.p / (voc * isc) : 0, maximos, escalones: Math.max(0, maximos - 1) };
  }
  const medidoDe = r => ({ voc: r.voc, isc: r.isc, pmpp: r.pmpp, vmpp: r.vmpp, impp: r.impp, ff: r.factorForma, escalones: r.escalones || 0, maximos: (r.escalones || 0) + 1 });
  const esperadoDe = r => (num(r.pmppEsperada) ? { voc: r.vocEsperada, isc: r.iscEsperada, pmpp: r.pmppEsperada, ff: r.factorFormaEsperado, vmpp: 0, impp: 0, escalones: 0, maximos: 1 } : null);
  /**
   * Medida del trazador en la cadena `id`: { ok, curva, referencia, resumen, resumenRef, desviacionPct, irradiancia, avisos, texto }.
   * La referencia es la curva de la misma cadena sana con la misma luz y temperatura (sim.curvaIVReferencia); sin ella solo se da la medida.
   */
  function lecturaTrazador(sim, id, puntos = 80) {
    if (!id) return { ok: false, avisos: [aviso('info', 'Elige la cadena y pulsa «Trazar curva».')], texto: '' };
    if (!tiene(sim, 'curvaIV')) return Object.assign(noDisponible('Trazador de curvas'), { curva: [], referencia: null });
    const cruda = seguro(() => sim.curvaIV(id, puntos), []);
    const curva = Array.isArray(cruda) ? cruda : (cruda && cruda.curva) || [];
    const refCruda = tiene(sim, 'curvaIVReferencia') ? seguro(() => sim.curvaIVReferencia(id, puntos)) : null;
    const referencia = Array.isArray(refCruda) ? refCruda : (refCruda && refCruda.curva) || null;
    const bruto = tiene(sim, 'resumenIV') ? seguro(() => sim.resumenIV(id)) : null, delModelo = bruto && bruto.ok !== false && num(bruto.voc) ? bruto : null;
    if (bruto && bruto.ok === false && !curva.length) return { ok: false, curva: [], referencia: null, avisos: [aviso('aviso', bruto.texto || 'Cadena desconocida.')], texto: 'no medido' };
    const propio = resumenCurva(curva), resumen = delModelo ? Object.assign({}, propio, medidoDe(delModelo)) : propio;
    const resumenRef = (delModelo && esperadoDe(delModelo)) || (referencia ? resumenCurva(referencia) : null);
    const desviacionPct = delModelo && num(delModelo.desviacionPct) ? delModelo.desviacionPct : resumenRef && resumenRef.pmpp > 1 ? 100 * (resumen.pmpp - resumenRef.pmpp) / resumenRef.pmpp : null;
    const campo = sim.estado && sim.estado.campos && sim.estado.campos[campoDeCadena(id)], g = delModelo && num(delModelo.irradianciaWm2) ? delModelo.irradianciaWm2 : campo ? campo.gPlanoWm2 : null;
    const avisos = [];
    const valida = !(delModelo && delModelo.valida === false) && !(num(g) && g < IRRADIANCIA_MIN_IV);
    if (delModelo && delModelo.estable === false) avisos.push(aviso('aviso', 'Irradiancia inestable (nubes): la curva puede salir deformada. Espera y repite.'));
    if (num(g) && g < IRRADIANCIA_MIN_IV) avisos.push(aviso('aviso', `Irradiancia de ${dec(g, 0)} W/m²: IEC 62446-1 pide al menos ${IRRADIANCIA_MIN_IV} W/m² (mejor más de 700). Repite con más sol.`));
    if ((delModelo && delModelo.abierta) || (resumen.isc < 0.05 && resumen.voc > 5)) avisos.push(aviso('peligro', 'Sin corriente: la cadena está ABIERTA (MC4 suelto o cable cortado).'));
    else if (resumen.voc < 1) avisos.push(aviso('aviso', 'Sin tensión: es de noche, o la cadena no llega al trazador.'));
    if (resumen.escalones > 0) avisos.push(aviso('aviso', `${resumen.escalones} ${resumen.escalones === 1 ? 'escalón' : 'escalones'} en la curva: hay diodos de paso conduciendo (sombra parcial, célula dañada o suciedad localizada).`));
    if (resumenRef && resumenRef.voc > 5 && resumen.voc < 0.93 * resumenRef.voc && resumen.isc > 0.05) avisos.push(aviso('aviso', `Voc un ${dec(100 * (1 - resumen.voc / resumenRef.voc), 0)} % por debajo de la referencia: falta tensión (una subcadena puenteada por su diodo de paso, o un panel de menos).`));
    if (resumenRef && resumenRef.isc > 0.5 && resumen.isc < 0.9 * resumenRef.isc && resumen.isc > 0.05) avisos.push(aviso('aviso', `Isc un ${dec(100 * (1 - resumen.isc / resumenRef.isc), 0)} % por debajo de la referencia: llega menos luz a las células (suciedad o sombra uniforme).`));
    if (resumenRef && resumenRef.ff > 0.1 && resumen.ff < 0.93 * resumenRef.ff && resumen.isc > 0.05) avisos.push(aviso('aviso', 'Factor de forma bajo con Voc e Isc casi normales: resistencia en serie (conector o borna con mal contacto) o pérdidas repartidas.'));
    if (num(desviacionPct) && Math.abs(desviacionPct) <= 5 && !avisos.some(a => a.nivel !== 'info')) avisos.push(aviso('info', 'Coincide con la referencia (± 5 %): cadena sana.'));
    const texto = `Voc ${dec(resumen.voc, 1)} V · Isc ${dec(resumen.isc, 2)} A · Pmpp ${dec(resumen.pmpp, 0)} W · FF ${dec(resumen.ff, 2)}${num(desviacionPct) ? ` · ${desviacionPct > 0 ? '+' : ''}${dec(desviacionPct, 0)} % frente a referencia` : ''}${resumen.escalones ? ` · ${resumen.escalones} escalón(es)` : ''}${num(g) ? ` · ${dec(g, 0)} W/m²` : ''}`;
    return { ok: true, valida, curva, referencia, resumen, resumenRef, desviacionPct, irradiancia: g, temperaturaCelulaC: delModelo ? delModelo.temperaturaCelulaC : null, avisos, texto: valida ? texto : `${texto} · NO CONCLUYENTE (poca luz o inestable)`, valor: resumen.pmpp, unidad: 'W' };
  }

  /* ---------- cámara termográfica ---------- */
  const NOMBRE_TIPO = { subcadena: 'Subcadena de células', conector: 'Conector MC4', rejilla: 'Rejilla de ventilación de la caseta', caseta: 'Aire interior de la caseta', caja: 'Bornas de la caja de continua', bateria: 'Bornes de la batería' };
  function nombreZona(z) {
    if (z.tipo === 'subcadena') return `Subcadena ${String(z.tag).split('.s')[1] || ''} de ${z.equipo || String(z.tag).split('.')[0]}`;
    if (z.tipo === 'conector') return `Conector MC4 ${String(z.tag).split('.mc4.')[1] || ''} de ${String(z.tag).split('.')[0]}`;
    return NOMBRE_TIPO[z.tipo] ? `${NOMBRE_TIPO[z.tipo]}${z.equipo && !/caseta|rejilla/.test(z.tipo) ? ' ' + z.equipo : ''}` : nombreEquipo(z.equipo || z.tag);
  }
  const nombreEquipo = tag => { const q = layout.EQUIPOS.find(x => x.tag === tag); return q ? q.nombre : tag; };
  /**
   * Mapa térmico: [{ id, tag /* equipo del sinóptico o null *\/, nombre, tempC }]. Usa sim.termografia() si existe; si no, lo compone con lo que ya publica el modelo
   * (temperatura de célula de cada panel, de los inversores, de la batería, de la caseta y de los conectores).
   */
  function mapaTermico(sim) {
    if (tiene(sim, 'termografia')) {
      const r = seguro(() => sim.termografia());
      const out = ((r && r.elementos) || []).filter(z => z && z.tag && num(z.tempC)).map(z => ({ id: z.tag, tag: z.equipo || null, tipo: z.tipo || '', nombre: nombreZona(z), tempC: z.tempC, deltaC: num(z.deltaC) ? z.deltaC : null, nota: z.nota || '', zona: z.zona || '' }));
      if (out.length) return out;
    }
    const e = sim && sim.estado; if (!e || !e.campos) return [];
    const M = seguro(() => sim.medidas, {}) || {}, out = [];
    const amb = num(e.ambiente && e.ambiente.temperaturaAmbienteC) ? e.ambiente.temperaturaAmbienteC : 20, caseta = num(M['CAS-001.t']) ? M['CAS-001.t'] : num(e.ambiente && e.ambiente.temperaturaCasetaC) ? e.ambiente.temperaturaCasetaC : amb + 3;
    for (const k of ['A', 'B']) for (const c of e.campos[k].cadenas || []) {
      for (const p of c.paneles || []) if (num(p.tempCelulaC)) out.push({ id: p.tag, tag: p.tag, nombre: nombreEquipo(p.tag), tempC: p.tempCelulaC });
      const tc = num(M[`${c.id}.conectorC`]) ? M[`${c.id}.conectorC`] : amb + 6 * Math.min(1, Math.max(0, (c.i || 0) / 8));
      out.push({ id: `${c.id}.mc4.0`, tag: c.id, tipo: 'conector', nombre: `Conectores MC4 de ${c.id}`, tempC: tc });
    }
    for (const t of ['INV-101', 'INV-201']) if (e.inversores && e.inversores[t] && num(e.inversores[t].temperaturaC)) out.push({ id: t, tag: t, nombre: nombreEquipo(t), tempC: e.inversores[t].temperaturaC });
    if (e.bateria && num(e.bateria.temperaturaC)) out.push({ id: 'BAT-101', tag: 'BAT-101', nombre: nombreEquipo('BAT-101'), tempC: e.bateria.temperaturaC });
    for (const t of ['CB-101', 'QA-301']) out.push({ id: t, tag: t, nombre: nombreEquipo(t), tempC: caseta + 1 });
    return out;
  }
  /** Escala de la cámara: { min, max } redondeados a 5 °C, con al menos 20 °C de margen para que un punto caliente destaque. */
  function escalaTermica(zonas) {
    const t = (zonas || []).map(z => z.tempC).filter(num);
    if (!t.length) return { min: 0, max: 50 };
    let min = Math.floor(Math.min(...t) / 5) * 5, max = Math.ceil(Math.max(...t) / 5) * 5;
    if (max - min < 20) max = min + 20;
    return { min, max };
  }
  // Paleta «hierro» de las cámaras termográficas: negro → violeta → rojo → naranja → amarillo → blanco
  const PALETA = [[0, 0, 0], [45, 0, 110], [140, 0, 150], [215, 40, 60], [250, 130, 0], [255, 220, 40], [255, 255, 235]];
  /** Color (#rrggbb) de una temperatura en la escala { min, max }. */
  function colorTermico(tempC, escala) {
    const x = Math.max(0, Math.min(1, (tempC - escala.min) / Math.max(1e-6, escala.max - escala.min))) * (PALETA.length - 1);
    const k = Math.min(PALETA.length - 2, Math.floor(x)), f = x - k;
    return '#' + [0, 1, 2].map(j => Math.round(PALETA[k][j] + (PALETA[k + 1][j] - PALETA[k][j]) * f).toString(16).padStart(2, '0')).join('');
  }
  /** Zonas que destacan: más de `margen` °C por encima de la mediana de las de su clase (paneles con paneles, conectores con conectores…). */
  function puntosCalientes(zonas, margen = 12) {      // un inversor en carga va siempre bastante más caliente que el aire de la caseta: para él, el doble de margen
    const clase = z => z.tipo || (/^PV-/.test(z.id) ? 'panel' : /mc4/i.test(z.id) ? 'conector' : /^INV-/.test(z.id) ? 'inversor' : 'otro');
    const grupos = {}, out = [];
    for (const z of zonas || []) { if (num(z.deltaC)) { if (z.deltaC >= (z.tipo === 'inversor' ? 2 * margen : margen) && z.tipo !== 'caseta' && z.tipo !== 'rejilla') out.push(z.id); } else (grupos[clase(z)] = grupos[clase(z)] || []).push(z); }
    for (const g of Object.values(grupos)) { const o = g.map(z => z.tempC).sort((a, b) => a - b), med = o[Math.floor((o.length - 1) / 2)]; for (const z of g) if (g.length > 1 && z.tempC - med > margen) out.push(z.id); }
    return out;
  }
  /** Lectura de la cámara en una zona: lo que se apunta en el cuaderno. */
  function lecturaTermografia(sim, id) {
    const zonas = mapaTermico(sim);
    if (!zonas.length) return noDisponible('Cámara termográfica');
    const z = zonas.find(x => x.id === id) || zonas.find(x => x.tag === id);
    if (!z) return { ok: false, pantalla: '— — —', unidad: '', valor: null, avisos: [aviso('info', 'Toca una zona para leer su temperatura.')], texto: '' };
    const caliente = puntosCalientes(zonas).includes(z.id), avisos = [];
    const delta = num(z.deltaC) ? ` (${z.deltaC > 0 ? '+' : ''}${dec(z.deltaC, 0)} °C respecto a sus iguales)` : '';
    if (caliente) avisos.push(aviso('peligro', `PUNTO CALIENTE${delta}. Conector o borna: mala conexión. Célula: sombra o daño. Aparato: sobrecarga o mala ventilación.`));
    else avisos.push(aviso('info', `Temperatura normal${delta}. Compara con un elemento igual y con la misma carga: sin corriente no hay calor.`));
    if (z.nota) avisos.push(aviso(caliente ? 'aviso' : 'info', z.nota));
    return { ok: true, pantalla: dec(z.tempC, 1), unidad: '°C', valor: z.tempC, zona: z, caliente, avisos, texto: `${dec(z.tempC, 1)} °C${num(z.deltaC) ? ` (Δ ${z.deltaC > 0 ? '+' : ''}${dec(z.deltaC, 0)} °C)` : ''}${caliente ? ' · PUNTO CALIENTE' : ''}` };
  }

  const api = { INSTRUMENTOS, MODOS_MULTIMETRO, MODOS_PINZA, CADENAS, SECCIONADOR_DE, UMBRAL_TENSION_OHM_V, AISLAMIENTO_MIN_MOHM, IRRADIANCIA_MIN_IV, tiene, descripcionPunto,
    lecturaMultimetro, conductores, lecturaPinza, lecturaMegohmetro, resumenCurva, lecturaTrazador, mapaTermico, escalaTermica, colorTermico, puntosCalientes, lecturaTermografia, PALETA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvInstrumentos = api;
})();
