// Ventana aparte de los diagramas eléctricos (fuerza.html y mando.html): dibuja el diagrama con el Canvas del SCADA, lo refresca cada 250 ms con el estado de la
// ventana que la abrió (window.opener.PCT.htstApp.estadoActual()) y, si no hay ventana de origen, con una planta real parada (o la de demostración si no hay modelo).
// Clic derecho sobre un equipo = ficha (htstAyuda); clic izquierdo = accionarlo en la página principal (htstApp.accionarEquipo, si existe).
// Solo navegador: la parte pura de los diagramas está en js/scada2d/diagrama_fuerza.js y diagrama_mando.js.
(function () {
  const VISTAS = {
    fuerza: { nombre: 'Fuerza', modulo: 'htstDiagramaFuerza', otra: ['mando', 'Mando'] },
    mando: { nombre: 'Mando', modulo: 'htstDiagramaMando', otra: ['fuerza', 'Fuerza'] },
  };

  /** Prepara la ventana. `vista` es 'fuerza' o 'mando'. Devuelve { sim, estado, objetos } (sim solo si no hay ventana de origen: sirve para probar). */
  async function iniciar(vista) {
    const V = VISTAS[vista], $ = id => document.getElementById(id);
    await HTST_CARGADOR.cargarScript('/simulador/js/interfaz/pulsacion_larga.js');
    for (const ruta of ['js/scada2d/diagrama_fuerza.js', 'js/scada2d/diagrama_mando.js', 'js/interfaz/puntos_medida.js', 'js/interfaz/ayuda_htst.js']) await HTST_CARGADOR.cargarScript(ruta);
    const D = PCT[V.modulo], planta = (PCT.htstLayout && PCT.htstLayout.PLANTA) || { fabrica: 'Planta real', corto: 'HTST' };
    const titulo = `${planta.fabrica} · ${planta.corto} · ${V.nombre}`;
    document.title = titulo; $('dg-titulo').textContent = titulo;
    $('dg-otra').textContent = `Ver ${V.otra[1]}`; $('dg-otra').setAttribute('href', `${V.otra[0]}.html`);
    $('dg-cerrar').addEventListener('click', () => window.close());

    // estado: el de la ventana de origen; si no la hay, una planta real parada (así se ve el diagrama completo sin simulador detrás)
    const origen = () => { try { const o = window.opener; return o && !o.closed && o.PCT && o.PCT.htstApp ? o : null; } catch (error) { return null; } };
    let ultimo = null, sim = null;
    if (!origen()) {
      if (PCT.htst && PCT.htst.crearSimulacion) { sim = PCT.htst.crearSimulacion({}); sim.paso(0.5); }
      else { await HTST_CARGADOR.cargarScript('js/interfaz/simulacion_demo.js'); sim = PCT.htstDemo.crearSimulacion({}); }
      ultimo = sim.estado();
      $('dg-aviso').hidden = false; $('dg-aviso').textContent = 'Sin simulador detrás: planta parada de demostración.';
    }
    const estado = () => {
      const o = origen();
      if (o) { try { const e = o.PCT.htstApp.estadoActual(); if (e) ultimo = e; } catch (error) { /* la ventana de origen se cerró */ } }
      else if (sim) { try { sim.paso(0.25); ultimo = sim.estado(); } catch (error) { /* se queda el último */ } }
      return ultimo;
    };

    const canvas = new PCT.canvas.Canvas(D.ESQUEMA);
    $('dg-lienzo').appendChild(canvas.svg);
    const objetos = D.crearObjetos(canvas);

    // fichas: clic derecho; clic izquierdo = accionar el equipo en la página principal
    if (PCT.htstAyuda && PCT.htstAyuda.iniciarAyuda) {
      PCT.htstAyuda.iniciarAyuda(canvas.svg, {
        sim: () => ({ estado }), nivel: () => 2, niveles: PCT.htstNiveles,
        alVer3d: tag => { const o = origen(); const abrir = (o && o.PCT.visor3d && o.PCT.visor3d.abrirEnVentana) || (PCT.visor3d && PCT.visor3d.abrirEnVentana); if (abrir) abrir('HTST', () => estado(), tag, true); },
        alMedir: () => {}, mandoFicha: () => null,
        clicIzquierdo: tag => { const o = origen(); if (o && o.PCT.htstApp.accionarEquipo) o.PCT.htstApp.accionarEquipo(tag); },
      });
    }

    function refrescar() {
      const e = estado();
      try { objetos.forEach(o => o.actualizar(e)); } catch (error) { console.error(error); }
      const info = e && PCT.htstLayout.MODOS_INFO[e.modo];
      const M = (PCT.htstLayout.PLANTA && PCT.htstLayout.PLANTA.modos) || { normal: 'Normal', manual: 'Revisión' };
      $('dg-modo').textContent = e ? `Modo: ${e.modo === 'MANUAL' ? `${M.manual} (manual)` : `${M.normal} · ${info ? info.nombre : e.modo || '—'}`}` : 'Sin estado';
    }
    refrescar(); setInterval(refrescar, 250);
    return { sim, estado, objetos };
  }

  window.HTST_VENTANA_DIAGRAMA = { iniciar };
})();
