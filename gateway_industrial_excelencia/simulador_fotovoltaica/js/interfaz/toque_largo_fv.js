// Pulsación larga (iPad: dedo o lápiz) para abrir la ficha de un equipo, como el clic derecho del ratón. Reutiliza PCT.pulsacionLarga del simulador de la maqueta (3 s, 10 px).
//   · Con ratón no hace nada (el ratón ya tiene el clic derecho). Solo pointerType 'touch' o 'pen'.
//   · Al cumplirse la pulsación se abre la ficha y el clic que llega al soltar el dedo NO acciona el equipo (se suprime una vez). Un toque corto sigue accionando.
//   · Mientras se mantiene, un anillo se llena en 3 s alrededor del equipo; desaparece al soltar o mover el dedo.
//   · Se evita el menú de iOS/Android (contextmenu de un toque se anula: la ficha la abre solo la pulsación de 3 s).
// La lógica (`crearToqueLargo`) es pura y con temporizador inyectable: se prueba con node:test. `activar(svg, opciones)` la une al DOM.
(function () {
  const enNode = typeof require !== 'undefined';
  const PL = enNode ? require('../../../simulador_pct23/js/interfaz/pulsacion_larga.js') : PCT.pulsacionLarga;
  const TIPOS_TACTILES = ['touch', 'pen'];
  const esTactil = tipo => TIPOS_TACTILES.includes(tipo);

  /**
   * Núcleo sin DOM. opciones: { alCumplir(dato), alEmpezar(dato), alCancelar(), programar, anular, duracionMs, umbralPx }.
   * abajo({ pointerType, x, y, dato }) → true si se empieza a contar; mover({ x, y }); arriba() → true si hay que suprimir el clic que sigue; cancelar().
   */
  function crearToqueLargo(opciones = {}) {
    const { alCumplir = () => {}, alEmpezar = () => {}, alCancelar = () => {} } = opciones;
    let activo = false, suprimir = false;
    const pl = PL.crearPulsacionLarga({ alCumplir: dato => { activo = false; suprimir = true; alCumplir(dato); }, duracionMs: opciones.duracionMs, umbralPx: opciones.umbralPx, programar: opciones.programar, anular: opciones.anular });
    return {
      abajo({ pointerType, x, y, dato }) {
        if (!esTactil(pointerType)) return false;
        suprimir = false; activo = true; pl.empezar(x, y, dato); alEmpezar(dato); return true;
      },
      mover({ x, y }) { if (!activo) return; pl.mover(x, y); },       // si el dedo se mueve más del umbral, el temporizador se cancela dentro de pl
      arriba() { const fue = pl.terminar(); if (activo) { activo = false; alCancelar(); } return fue || suprimir; },
      cancelar() { pl.cancelar(); if (activo) { activo = false; alCancelar(); } },
      /** ¿Hay que tragarse el clic que llega ahora? (una sola vez) */
      consumirSupresion() { const s = suprimir; suprimir = false; return s; },
      estaContando: () => activo,
    };
  }

  /** Une la pulsación larga a un SVG con equipos g[data-tag]. opciones: { abrir(tag, elementoG), existe(tag) }. Devuelve { cancelar }. */
  function activar(svg, opciones) {
    const NS = 'http://www.w3.org/2000/svg';
    let anillo = null, ultimoTactil = false, tiempoSuprimir = 0;
    const quitarAnillo = () => { if (anillo) { anillo.remove(); anillo = null; } };
    const tagDe = ev => { const g = ev.target.closest ? ev.target.closest('g[data-tag]') : null; return g && (!opciones.existe || opciones.existe(g.dataset.tag)) ? g : null; };
    const n = crearToqueLargo({
      alEmpezar: g => {
        quitarAnillo();
        const r = g.querySelector(':scope > rect.forma, :scope > rect.caja, :scope > rect.caseta, :scope > rect.bandeja') || g;
        let b; try { b = r.getBBox(); } catch (error) { return; }
        const m = Math.max(0, (44 - Math.min(b.width, b.height)) / 2) + 6;
        anillo = document.createElementNS(NS, 'rect');
        anillo.setAttribute('class', 'anillo-toque'); anillo.setAttribute('x', b.x - m); anillo.setAttribute('y', b.y - m); anillo.setAttribute('width', b.width + 2 * m); anillo.setAttribute('height', b.height + 2 * m);
        anillo.setAttribute('rx', 10); anillo.setAttribute('pathLength', 100); anillo.style.animationDuration = `${(opciones.duracionMs || PL.DURACION_MS) / 1000}s`;
        g.appendChild(anillo);
      },
      alCancelar: quitarAnillo,
      alCumplir: g => { quitarAnillo(); if (navigator.vibrate) { try { navigator.vibrate(30); } catch (error) { /* sin vibración */ } } opciones.abrir(g.dataset.tag, g); },
      duracionMs: opciones.duracionMs, programar: opciones.programar, anular: opciones.anular,
    });
    svg.addEventListener('pointerdown', ev => { ultimoTactil = esTactil(ev.pointerType); const g = tagDe(ev); if (g) n.abajo({ pointerType: ev.pointerType, x: ev.clientX, y: ev.clientY, dato: g }); }, { passive: true });
    svg.addEventListener('pointermove', ev => n.mover({ x: ev.clientX, y: ev.clientY }), { passive: true });
    for (const t of ['pointerup', 'pointercancel']) svg.addEventListener(t, () => { if (n.arriba()) tiempoSuprimir = Date.now(); }, { passive: true });
    svg.addEventListener('pointerleave', () => n.cancelar(), { passive: true });
    // el clic que llega al soltar tras una pulsación larga no acciona (captura: antes que el resto de manejadores)
    svg.addEventListener('click', ev => { if (n.consumirSupresion() || Date.now() - tiempoSuprimir < 600) { tiempoSuprimir = 0; ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
    // el menú contextual de un toque (Android lo dispara a los ~500 ms) no abre la ficha antes de los 3 s
    svg.addEventListener('contextmenu', ev => { if (ultimoTactil) { ev.preventDefault(); ev.stopImmediatePropagation(); } }, true);
    return { cancelar: () => { n.cancelar(); quitarAnillo(); } };
  }

  const api = { crearToqueLargo, activar, esTactil, TIPOS_TACTILES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvToqueLargo = api;
})();
