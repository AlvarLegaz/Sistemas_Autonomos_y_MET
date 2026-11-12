// Diagnóstico para el alumno: por qué cada inversor produce o no produce (texto CAUSA → EFECTO que sale del estado del modelo, no de números fijos) y resumen de la
// energía del día (producida por campo, consumida, importada, exportada, autoconsumo y ahorro). Funciones puras: se prueban con node:test (tests/interfaz_diagnostico.test.js).
(function () {
  const enNode = typeof require !== 'undefined';
  const F = enNode ? require('./formato_fv.js') : PCT.fvFormato;
  const { formatoPotencia, formatoEnergia, formatoTension, formatoPorcentaje, dec } = F;
  const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const TARIFA_EUR_KWH = 0.15;

  const prot = (e, tag) => (e && e.protecciones && e.protecciones[tag] && e.protecciones[tag].estado) || 'CERRADO';
  const abierta = (e, tag) => prot(e, tag) !== 'CERRADO';
  const nombreEstado = s => (s ? String(s).replace(/_/g, ' ').toLowerCase() : '—');
  const mayuscula = t => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

  /** Protecciones que no están cerradas, entre las dadas: «QS-101 abierto, F-101 fundido». */
  const textoProt = (e, tags) => tags.filter(t => abierta(e, t)).map(t => `${t} ${prot(e, t).toLowerCase()}`).join(', ');

  /**
   * Diagnóstico de un inversor: { nivel: 'ok'|'aviso'|'alarma'|'parado', estado, causa, efecto, produce }.
   *   causa  = por qué está así (la primera razón, de la más grave a la más leve)
   *   efecto = qué consecuencia tiene en la instalación
   */
  function diagnosticoInversor(e, tag) {
    if (!e || !e.inversores) return { nivel: 'parado', estado: '—', causa: 'Sin datos del simulador.', efecto: '', produce: false };
    return tag === 'INV-201' ? diagnosticoZcs(e) : diagnosticoEasun(e);
  }

  /** Pérdidas visibles de un campo: cadenas abiertas, fusibles, diodos de paso conduciendo, sombras y suciedad. Lista de textos cortos. */
  function perdidasCampo(e, id) {
    const campo = (e.campos && e.campos[id]) || { cadenas: [] }, L = [];
    for (const c of campo.cadenas || []) {
      if (c.abierta) L.push(`${c.id} abierta (no aporta nada)`);
      for (const p of c.paneles || []) {
        const by = (p.bypass || []).filter(Boolean).length;
        if (by) L.push(`${p.tag} con ${by === 1 ? 'un diodo de paso conduciendo (pierde un tercio)' : `${by} diodos de paso conduciendo`}`);
        else if (num(p.sombra01) > 0.25) L.push(`${p.tag} con sombra del ${Math.round(num(p.sombra01) * 100)} %`);
      }
    }
    const suc = num(e.ambiente && e.ambiente.suciedad && e.ambiente.suciedad[id]);
    if (suc > 0.12) L.push(`paneles sucios (${Math.round(suc * 100)} % de pérdida)`);
    return L;
  }

  function diagnosticoEasun(e) {
    const i = e.inversores['INV-101'] || {}, A = (e.campos && e.campos.A) || { cadenas: [] }, esDia = !(e.reloj && e.reloj.esDia === false);
    const estado = nombreEstado(i.estado), r = (nivel, causa, efecto, produce = false) => ({ nivel, estado, causa, efecto, produce });
    const pvP = num(i.pvP), pmpp = (A.cadenas || []).reduce((s, c) => s + (c.abierta ? 0 : num(c.pmpp)), 0);
    const redOk = !(e.red && e.red.disponible === false);
    const bat = e.bateria || {};
    if (i.encendido === false) return r('parado', 'Está apagado desde el mando (clic en el inversor, en Revisión).', 'No alimenta las cargas protegidas ni carga la batería: las cargas LOAD-302 se quedan sin tensión.');
    if (i.estado === 'FALLO') {
      const sinBat = textoProt(e, ['QB-101', 'FB-101']);
      if (sinBat || (bat.bms && bat.bms !== 'OK')) return r('alarma', `Sin batería: ${sinBat || `el BMS la ha cortado (${nombreEstado(bat.bms)})`}.`, 'Sin batería el EASun no puede estabilizar el bus de continua: no produce con el sol y las cargas pasan a la red (bypass).');
      return r('alarma', i.alarma || 'Fallo del inversor (sobretemperatura).', 'Inversor parado: sin solar, sin batería y sin cargas protegidas.');
    }
    // ¿llega energía del campo A?
    const causasSinSol = [];
    if (!esDia) causasSinSol.push('es de noche: no hay irradiancia');
    const cortes = textoProt(e, ['QS-101', 'F-101', 'F-102']);
    if (cortes) causasSinSol.push(`${cortes}: ${/QS-101/.test(cortes) ? 'el campo A no llega al inversor' : 'una cadena del campo A queda sin salida'}`);
    const abiertas = (A.cadenas || []).filter(c => c.abierta).map(c => c.id);
    if (abiertas.length) causasSinSol.push(`${abiertas.join(' y ')} abierta${abiertas.length > 1 ? 's' : ''} (sin corriente)`);
    if (!causasSinSol.length && num(A.gPlanoWm2) < 60) causasSinSol.push(`poca luz: ${dec(A.gPlanoWm2, 0)} W/m² en el plano del campo A (nubosidad ${formatoPorcentaje(e.ambiente && e.ambiente.nubosidad)})`);
    if (!causasSinSol.length && pmpp < 20) causasSinSol.push('los paneles casi no producen (sombras o suciedad)');
    if (pvP < 5 && pmpp > 50 && !causasSinSol.length && (num(bat.soc01) > 0.85 || /FLOTACION|ABSORCION/.test(i.etapaCarga || ''))) {
      return r('ok', `El EASun no toma sol: los paneles podrían dar ${formatoPotencia(pmpp)}, pero la batería (${formatoPorcentaje(bat.soc01)}) ya no admite más y las cargas están cubiertas.`, 'Es normal: el MPPT se aparta del punto de máxima potencia y el sol que sobra no se aprovecha (se ve en la curva I-V).');
    }
    if (pvP < 5) {
      const efecto = !redOk ? 'La batería alimenta las cargas protegidas mientras dure; no se carga.' : 'La batería y la red alimentan las cargas protegidas; la batería no se carga con sol.';
      return r(i.estado === 'REDUCIDO' ? 'aviso' : 'parado', causasSinSol.length ? `No hay producción solar: ${causasSinSol.join('; ')}.` : `Sin producción solar ahora mismo (batería ${formatoPorcentaje(bat.soc01)} y cargas cubiertas).`, efecto);
    }
    // produce: ¿trabaja lejos del máximo posible?
    const llena = num(bat.soc01) > 0.85 || /FLOTACION|ABSORCION/.test(i.etapaCarga || '');
    const conSombra = perdidasCampo(e, 'A').some(t => /sombra|diodo/.test(t));       // `enMaximoLocal` del modelo también se activa cuando el EASun recorta por batería llena
    const local = (A.cadenas || []).filter(c => c.enMaximoLocal).map(c => c.id);
    if (pmpp > 50 && pvP < 0.9 * pmpp) {
      if (llena && !conSombra) return r('ok', `El EASun limita la producción a ${formatoPotencia(pvP)} de ${formatoPotencia(pmpp)} posibles: la batería (${formatoPorcentaje(bat.soc01)}, etapa ${nombreEstado(i.etapaCarga)}) ya no admite más y las cargas están cubiertas.`, 'El MPPT se aparta del punto de máxima potencia (se ve en la curva I-V): es normal, el sol que sobra no se aprovecha.', true);
      if (local.length && conSombra) return r('aviso', `El MPPT se ha quedado en un máximo local de ${local.join(' y ')}: entrega ${formatoPotencia(pvP)} de ${formatoPotencia(pmpp)} posibles. Con sombra parcial la curva de potencia tiene varios picos y el seguidor puede engancharse al pico equivocado.`, 'Pierdes producción aunque el campo sí podría dar más: mira la curva I-V de la cadena (punto de trabajo frente al máximo ideal).', true);
    }
    if (i.estado === 'REDUCIDO') return r('aviso', i.alarma || 'Funciona a potencia reducida.', 'Entrega menos de lo que podría: revisa la temperatura y la sobrecarga.', true);
    const perd = perdidasCampo(e, 'A');
    if (cortes || perd.length) return r('aviso', `Produce ${formatoPotencia(pvP)}, pero el campo A pierde producción: ${[cortes && `${cortes} (una cadena queda sin salida)`].concat(perd).filter(Boolean).join('; ')}.`, 'Da menos de lo que podría: compara con la irradiancia y con el otro campo, y mira la curva I-V de cada cadena.', true);
    if (i.alarma) return r('aviso', i.alarma, 'Sigue produciendo, pero revisa la alarma.', true);
    const fuente = i.fuente === 'RED' ? 'las cargas se alimentan de la red (bypass)' : 'las cargas se alimentan del inversor';
    const bp = num(i.bateriaP), bt = bp > 5 ? `carga la batería con ${formatoPotencia(bp)}` : bp < -5 ? `descarga la batería ${formatoPotencia(-bp)}` : 'la batería está en reposo';
    return r('ok', `Produce ${formatoPotencia(pvP)} con el campo A (MPPT a ${formatoTension(i.pvV, 0)}).`, `${mayuscula(fuente)}, ${bt}.`, true);
  }

  function diagnosticoZcs(e) {
    const i = e.inversores['INV-201'] || {}, B = (e.campos && e.campos.B) || { cadenas: [] }, esDia = !(e.reloj && e.reloj.esDia === false), red = e.red || {};
    const estado = nombreEstado(i.estado), r = (nivel, causa, efecto, produce = false) => ({ nivel, estado, causa, efecto, produce });
    const acP = num(i.acP), pmpp = (B.cadenas || []).reduce((s, c) => s + (c.abierta ? 0 : num(c.pmpp)), 0);
    const cortesRed = textoProt(e, ['QF-301', 'ID-301', 'QF-303']);
    switch (i.estado) {
      case 'APAGADO': {
        if (i.encendido === false) return r('parado', 'Está apagado desde el mando (clic en el inversor, en Revisión).', 'El campo B no produce y el centro consume todo de la red.');
        const causas = [];
        if (!esDia) causas.push('es de noche');
        const c = textoProt(e, ['QS-201']); if (c) causas.push(`${c}: el campo B no llega al inversor`);
        const cad = B.cadenas || [], ab = cad.filter(x => x.abierta); if (ab.length && ab.length === cad.length) causas.push('las dos cadenas están abiertas');
        if (!causas.length) causas.push(num(B.gPlanoWm2) < 60 ? `poca luz (${dec(B.gPlanoWm2, 0)} W/m²)` : 'la tensión de las cadenas no llega a los 100 V de arranque');
        return r('parado', `Dormido: ${causas.join('; ')}.`, 'El ZCS no arranca: el campo B no produce y el centro consume todo de la red.');
      }
      case 'ESPERA_AISLAMIENTO': return r('aviso', 'Mide el aislamiento del campo FV a tierra antes de conectar (30 s).', 'Todavía no inyecta nada; si el aislamiento es menor de 0,5 MΩ no conectará.');
      case 'ESPERA_RED': {
        const sinRed = red.disponible === false || !!cortesRed || /sin red|tensi[oó]n de red/i.test(i.alarma || '');
        if (sinRed) {
          const why = red.disponible === false ? 'la red de la acometida ha caído' : cortesRed ? `${cortesRed}: no hay red en el cuadro` : num(red.v) > 250 ? `la tensión de red es ${formatoTension(red.v, 0)} (demasiado alta)` : (i.alarma || 'red fuera de rango');
          return r('aviso', `Desconectado por anti-isla: ${why}.`, 'No puede inyectar a una red sin tensión (seguridad de las personas): el campo B no produce.');
        }
        return r('aviso', `Esperando para conectar: la red es válida y faltan ${Math.max(0, Math.ceil(num(i.segundosParaConexion)))} s (tiempo de reconexión obligatorio).`, 'Todavía no inyecta; conectará solo cuando termine la cuenta atrás.');
      }
      case 'FALLO': {
        if (/temperatura|sobretemp/i.test(i.alarma || '')) return r('alarma', 'Sobretemperatura: inversor parado.', 'El campo B no produce hasta que se enfríe; revisa la ventilación de la caseta.');
        return r('alarma', `Fallo de aislamiento: ${dec(i.aislamientoMohm, 2)} MΩ, por debajo del mínimo de 0,5 MΩ (fuga a tierra en el campo B).`, 'El ZCS se niega a conectar (sería peligroso): el campo B no produce. Reintenta cada 60 s.');
      }
      case 'REDUCIDO': return r('aviso', i.alarma || 'Potencia limitada.', `Entrega ${formatoPotencia(acP)} de ${formatoPotencia(pmpp)} que daría el campo: pierdes producción.`, true);
      case 'OPERANDO': {
        const m = i.mppt || [], inactiva = m.findIndex(x => num(x.v) <= 1);
        if (inactiva >= 0 && m.length === 2) return r('aviso', `Produce ${formatoPotencia(acP)}, pero la entrada MPPT${inactiva + 1} no tiene tensión (${(B.cadenas || [])[inactiva] ? B.cadenas[inactiva].id : 'cadena'} abierta).`, 'Solo trabaja media instalación: el campo B da la mitad.', true);
        const imp = num(red.p), perd = perdidasCampo(e, 'B');
        if (perd.length) return r('aviso', `Produce ${formatoPotencia(acP)}, pero el campo B pierde producción: ${perd.join('; ')}.`, 'Da menos de lo que podría: compara con la irradiancia y con el otro campo, y mira la curva I-V de cada cadena.', true);
        return r('ok', `Produce ${formatoPotencia(acP)} (MPPT1 ${formatoPotencia(m[0] && m[0].p)}, MPPT2 ${formatoPotencia(m[1] && m[1].p)}).`, imp < -1 ? `Parte se consume en el centro y ${formatoPotencia(-imp)} se vierte a la red.` : 'Todo se consume en el propio centro (no se vierte nada).', true);
      }
      default: return r('parado', i.alarma || '—', '');
    }
  }

  /** Foto de los contadores de energía en un instante: base para «energía del día». */
  function tomarBase(e) {
    const en = (e && e.energia) || {}, r = (e && e.red) || {};
    return { dia: e && e.reloj ? e.reloj.diaAnio : null, hora: e && e.reloj ? e.reloj.horaSolar : 0, prodA: num(en.produccionAWh), prodB: num(en.produccionBWh), consumo: num(en.consumoWh), importada: num(r.energiaImportadaWh), exportada: num(r.energiaExportadaWh) };
  }

  /**
   * Resumen de la energía desde la base (inicio del día simulado). Devuelve { prodA, prodB, produccion, consumo, importada, exportada, autoconsumo (Wh), autoconsumoPct, cubiertoPct, ahorroEuros }.
   * autoconsumo = lo producido que no se exporta; cubiertoPct = parte del consumo que no se importó de la red.
   */
  function resumenEnergia(e, base) {
    const b = base || { prodA: 0, prodB: 0, consumo: 0, importada: 0, exportada: 0 }, a = tomarBase(e);
    const d = k => Math.max(0, a[k] - b[k]);
    const prodA = d('prodA'), prodB = d('prodB'), produccion = prodA + prodB, consumo = d('consumo'), importada = d('importada'), exportada = d('exportada');
    const autoconsumo = Math.max(0, produccion - exportada);
    return { prodA, prodB, produccion, consumo, importada, exportada, autoconsumo, autoconsumoPct: produccion > 1 ? Math.min(100, 100 * autoconsumo / produccion) : 0,
      cubiertoPct: consumo > 1 ? Math.max(0, Math.min(100, 100 * (consumo - importada) / consumo)) : 0, ahorroEuros: autoconsumo / 1000 * TARIFA_EUR_KWH };
  }

  /** Filas del resumen de energía para la tarjeta: [[nombre, valor]]. */
  function filasEnergia(r) {
    return [['Producida campo A', formatoEnergia(r.prodA)], ['Producida campo B', formatoEnergia(r.prodB)], ['Consumida', formatoEnergia(r.consumo)], ['Importada de la red', formatoEnergia(r.importada)],
      ['Exportada a la red', formatoEnergia(r.exportada)], ['Autoconsumo', `${dec(r.autoconsumoPct, 0)} %`], ['Ahorro', `${dec(r.ahorroEuros, 2)} €`]];
  }

  /**
   * Punto de trabajo del MPPT frente al máximo ideal de una cadena: { idealW, realW, perdidaPct, texto }. `cadena` es la del estado (con pmpp, v, i, p).
   * Con sombra parcial el seguidor puede quedarse en un máximo local y la pérdida sube.
   */
  function trabajoFrenteIdeal(cadena, curva) {
    if (!cadena) return null;
    let ideal = num(cadena.pmpp);
    for (const q of curva || []) { const p = Number.isFinite(q.p) ? q.p : q.v * q.i; if (p > ideal) ideal = p; }
    const real = cadena.abierta ? 0 : num(cadena.p), perdida = ideal > 5 ? Math.max(0, Math.min(100, 100 * (1 - real / ideal))) : 0;
    let texto;
    if (cadena.abierta) texto = 'Cadena abierta: no circula corriente.';
    else if (ideal <= 5) texto = 'Sin potencia que seguir (poca luz).';
    else if (perdida < 3) texto = `El MPPT trabaja en el máximo: ${formatoPotencia(real)} de ${formatoPotencia(ideal)} posibles.`;
    else texto = `El MPPT entrega ${formatoPotencia(real)} de ${formatoPotencia(ideal)} posibles (pierde ${dec(perdida, 0)} %): está lejos del máximo ideal.`;
    return { idealW: ideal, realW: real, perdidaPct: perdida, texto };
  }

  const api = { diagnosticoInversor, perdidasCampo, tomarBase, resumenEnergia, filasEnergia, trabajoFrenteIdeal, TARIFA_EUR_KWH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvDiagnostico = api;
})();
