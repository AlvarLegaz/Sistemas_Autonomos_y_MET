/* Interfaz del modo automático y de la demostración: lo que el motor de la secuencia (secuencia_ui.js) no pinta.
   Las lecturas las da el propio esquema (SCADA); aquí está el estado de la barra, la pista de fases y la pestaña de lecturas.
   Solo lee la simulación; no la modifica. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const nf = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
  const c1 = v => v.toFixed(1).replace('.', ',');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ----- termómetros ----- */
  const ESC = [20, 100];
  const frac = t => clamp((t - ESC[0]) / (ESC[1] - ESC[0]), 0, 1) * 100;
  function termometro(id, valor, marca, pie) {
    $('k-' + id).innerHTML = c1(valor) + '<small>°C</small>';
    $('r-' + id).style.width = frac(valor) + '%';
    const m = $('m-' + id);
    if (m) { m.hidden = marca == null; if (marca != null) m.style.left = frac(marca) + '%'; }
    if (pie != null) $('p-' + id).textContent = pie;
  }

  function pieT2(s, e) {
    const c = s.cfg, calef = e.salidas.RES ? 'encendido al ' + c1(e.consignas.R) + ' %' : 'apagado';
    switch (c.modoControl) {
      case 'T2': case 'onoff': return `Consigna ${c.consignaT2} °C. Calefactor ${calef}.`;
      case 'cascada': return s.consignaT2Activa != null ? `Consigna calculada ${c1(s.consignaT2Activa)} °C. Calefactor ${calef}.` : `Calefactor ${calef}.`;
      case 'manual': return `Potencia fija. Calefactor ${calef}.`;
      default: return `Calefactor ${calef}.`;
    }
  }

  /* ----- lecturas y estado ----- */
  function pintar() {
    const A = window.secuenciaPCT23;
    if (!A) return;
    const e = A.estado(), s = A.sec(), o = A.modelo.observaciones(e), cap = A.modelo.PARAMS.capacidadMl;

    // estado global para el estilo: la pista cambia de color según lo que pasa
    const pausado = $('b-pausa').textContent.includes('Reanudar');
    document.body.dataset.estado = s.fase === 'alarma' ? 'alarma' : s.fase === 'finalizada' ? 'fin'
      : s.fase === 'reposo' ? 'reposo' : pausado ? 'pausa' : 'marcha';

    const quieto = document.body.dataset.estado;
    if (quieto === 'reposo') $('fase-motivo').textContent = 'Revisa los ajustes y pulsa Iniciar secuencia.';
    else if (quieto === 'fin') $('fase-motivo').textContent = 'Secuencia terminada. Cambia los ajustes y repite si quieres.';
    termometro('t1', o.T1, s.cfg.consignaT1, `Consigna ${s.cfg.consignaT1} °C. Por debajo de ${s.cfg.consignaT1 - s.cfg.toleranciaDesvioC} °C el producto se desvía.`);
    const marcaT2 = s.cfg.modoControl === 'cascada' ? s.consignaT2Activa : (['T2', 'onoff'].includes(s.cfg.modoControl) ? s.cfg.consignaT2 : null);
    termometro('t2', o.T2, marcaT2, pieT2(s, e));
    termometro('t3', o.T3, null, null);

    const producido = ['produccion', 'lavado', 'parada', 'finalizada'].includes(s.fase) ? Math.max(0, e.finalMl - s.finalInicialMl) : 0;
    $('k-final').innerHTML = nf.format(producido) + ' <small>ml</small>';
    const ref = s.cfg.volumenObjetivoMl;
    $('barra-ref').hidden = ref == null;
    if (ref != null) $('r-ref').style.width = clamp(producido / ref * 100, 0, 100) + '%';
    $('p-ref').textContent = ref != null ? `${nf.format(producido)} de ${nf.format(ref)} ml de referencia` : 'Sin referencia: produce hasta agotar el tanque de origen.';
    $('k-desv').textContent = nf.format(e.desviadoMl) + ' ml';
    $('k-total').textContent = nf.format(e.finalMl + e.desviadoMl) + ' ml';
    $('k-sol1').textContent = e.salidas.SOL1 ? 'Desvío activo' : 'Salida normal';

    for (const [d, ml] of [['a', e.aMl], ['b', e.bMl]]) {
      $('k-t' + d).textContent = `${nf.format(ml)} ml (${Math.round(ml / cap * 100)} %)`;
      $('r-t' + d).style.width = (ml / cap * 100) + '%';
    }

    const enProd = ['produccion', 'lavado', 'parada', 'finalizada'].includes(s.fase);
    $('k-avance').textContent = enProd ? (ref != null ? `${nf.format(producido)} de ${nf.format(ref)} ml producidos` : `${nf.format(producido)} ml producidos`) : '';

    // avance dentro de la fase actual, cuando se conoce
    document.querySelectorAll('#fases li').forEach(li => li.style.removeProperty('--avance'));
    const actual = document.querySelector('#fases li.actual');
    if (actual && document.body.dataset.estado === 'marcha') {
      let a = null;
      if (s.fase === 'arranque') a = s.tFase / s.cfg.arranqueS * 100;
      else if (s.fase === 'lavado') a = s.tFase / s.cfg.lavadoS * 100;
      else if (s.fase === 'produccion' && ref != null) a = producido / ref * 100;
      if (a != null) actual.style.setProperty('--avance', clamp(a, 0, 100).toFixed(1));
    }
  }
  setInterval(pintar, 250);
  pintar();
})();
