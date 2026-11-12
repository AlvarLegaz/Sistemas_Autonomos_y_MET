// Pestaña «Lecturas» del lateral: alarmas activas, producción y consumo con su energía acumulada, y las medidas de cadenas, inversores, batería y red en tablas.
// `seccionesLecturas(estado)` es pura (se prueba sin navegador); `crearPanelLecturas` la dibuja.
(function () {
  const enNode = typeof require !== 'undefined';
  const F = enNode ? require('./formato_fv.js') : PCT.fvFormato;
  const E = enNode ? require('../scada2d/esquema_fv.js') : PCT.fvEsquema;
  const { formatoPotencia, formatoEnergia, formatoTension, formatoCorriente, formatoPorcentaje, formatoTemperatura, dec } = F;
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Secciones de la tabla de lecturas: [{ id, titulo, filas: [[nombre, valor, estadoVisual?]] }]. */
  function seccionesLecturas(e) {
    if (!e) return [];
    const S = [], inv1 = e.inversores['INV-101'] || {}, inv2 = e.inversores['INV-201'] || {}, b = e.bateria || {}, r = e.red || {}, en = e.energia || {};
    S.push({ id: 'energia', titulo: 'Energía acumulada', filas: [['Producción campo A', formatoEnergia(en.produccionAWh)], ['Producción campo B', formatoEnergia(en.produccionBWh)], ['Consumo', formatoEnergia(en.consumoWh)],
      ['Importada de la red', formatoEnergia(r.energiaImportadaWh)], ['Exportada a la red', formatoEnergia(r.energiaExportadaWh)], ['Autoconsumo', `${dec(en.autoconsumoPct, 0)} %`], ['Ahorro (0,15 €/kWh)', `${dec(en.ahorroEuros, 2)} €`]] });
    S.push({ id: 'ambiente', titulo: 'Sol y ambiente', filas: [['Reloj solar', e.reloj.texto], ['Altura del sol', `${dec(e.sol.alturaGrados, 1)}°`], ['Irradiancia horizontal', `${dec(e.ambiente.ghWm2, 0)} W/m²`],
      ['Irradiancia plano A', `${dec(e.campos.A.gPlanoWm2, 0)} W/m²`], ['Irradiancia plano B', `${dec(e.campos.B.gPlanoWm2, 0)} W/m²`], ['Temperatura ambiente', formatoTemperatura(e.ambiente.temperaturaAmbienteC, 1)], ['Nubosidad', formatoPorcentaje(e.ambiente.nubosidad)]] });
    const cad = [];
    for (const c of ['A', 'B']) for (const s of e.campos[c].cadenas) cad.push([s.id, s.abierta ? `abierta · Voc ${formatoTension(s.voc, 0)}` : `${formatoTension(s.v, 0)} · ${formatoCorriente(s.i, 1)} · ${formatoPotencia(s.p)}`, E.estadoVisual(e, s.id)]);
    S.push({ id: 'cadenas', titulo: 'Cadenas de paneles', filas: cad });
    S.push({ id: 'inversores', titulo: 'Inversores', filas: [
      ['EASun · estado', (inv1.estado || '—').replace(/_/g, ' '), E.estadoVisual(e, 'INV-101')], ['EASun · solar', formatoPotencia(inv1.pvP)], ['EASun · batería', formatoPotencia(inv1.bateriaP)], ['EASun · red / cargas', `${formatoPotencia(inv1.redP)} / ${formatoPotencia(inv1.cargaP)}`], ['EASun · temperatura', formatoTemperatura(inv1.temperaturaC)],
      ['ZCS · estado', (inv2.estado || '—').replace(/_/g, ' '), E.estadoVisual(e, 'INV-201')], ['ZCS · salida', `${formatoPotencia(inv2.acP)} · ${formatoTension(inv2.acV, 0)}`], ['ZCS · aislamiento', `${dec(inv2.aislamientoMohm, 1)} MΩ`], ['ZCS · temperatura', formatoTemperatura(inv2.temperaturaC)]] });
    S.push({ id: 'bateria', titulo: 'Batería y red', filas: [['SoC', formatoPorcentaje(b.soc01)], ['Tensión', formatoTension(b.v)], ['Corriente (+ carga)', formatoCorriente(b.i)], ['Celdas mín / máx', `${dec(b.vCeldaMin, 2)} / ${dec(b.vCeldaMax, 2)} V`], ['BMS', b.bms || '—', E.estadoVisual(e, 'BAT-101')],
      ['Red', r.disponible === false ? 'sin red' : `${formatoTension(r.v)} · ${dec(r.f, 2)} Hz`, E.estadoVisual(e, 'RED-301')], ['Potencia de red (+ importa)', formatoPotencia(r.p)]] });
    return S;
  }

  /** Alarmas ordenadas por gravedad (la más grave primero). */
  function alarmasOrdenadas(e) {
    const orden = { alarma: 0, aviso: 1, info: 2 };
    return ((e && e.alarmas) || []).slice().sort((a, b) => (orden[a.severidad] ?? 3) - (orden[b.severidad] ?? 3));
  }

  function crearPanelLecturas(contenedor) {
    contenedor.innerHTML = '<section class="alarmas-fv" aria-label="Alarmas"><h2 id="alarmas-titulo">ALARMAS</h2><ul id="lista-alarmas-fv"></ul></section><div id="tablas-lecturas"></div>';
    const lista = contenedor.querySelector('#lista-alarmas-fv'), tablas = contenedor.querySelector('#tablas-lecturas'), titulo = contenedor.querySelector('#alarmas-titulo');
    let firmaAl = '', firmaTa = '';
    function actualizar(e) {
      const al = alarmasOrdenadas(e), fa = al.map(a => `${a.codigo}|${a.tag}|${a.severidad}`).join('#');
      if (fa !== firmaAl) {
        firmaAl = fa; titulo.textContent = al.length ? `ALARMAS · ${al.length}` : 'ALARMAS · ninguna';
        lista.innerHTML = al.length ? al.map(a => `<li class="al-${a.severidad}"><span class="simbolo" aria-hidden="true">${a.severidad === 'alarma' ? '✖' : a.severidad === 'aviso' ? '▲' : 'ℹ'}</span><span>${a.tag ? `<b>${escapar(a.tag)}</b> ` : ''}${escapar(a.texto)}</span></li>`).join('') : '<li class="al-ok"><span class="simbolo" aria-hidden="true">✔</span><span>Instalación sin alarmas.</span></li>';
      }
      const secs = seccionesLecturas(e), ft = JSON.stringify(secs);
      if (ft !== firmaTa) {
        firmaTa = ft;
        tablas.innerHTML = secs.map(s => `<section class="tabla-fv" aria-label="${escapar(s.titulo)}"><h2>${escapar(s.titulo).toUpperCase()}</h2><dl>${s.filas.map(([n, v, est]) => `<div${est ? ` class="e-${est}"` : ''}><dt>${escapar(n)}</dt><dd>${escapar(v)}</dd></div>`).join('')}</dl></section>`).join('');
      }
    }
    return { actualizar };
  }

  const api = { seccionesLecturas, alarmasOrdenadas, crearPanelLecturas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvPanelLecturas = api;
})();
