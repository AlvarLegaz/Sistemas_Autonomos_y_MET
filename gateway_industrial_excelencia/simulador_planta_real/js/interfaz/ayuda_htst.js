// Ficha de cada equipo de la planta real: al pulsar (o clic derecho, o Intro con el equipo enfocado) un equipo del esquema se abre una ventana con qué es,
// qué hace en el simulador, su estado en vivo, botones para verlo en 3D y para ir a medirlo y, en modo MANUAL, su mando. Propia de la planta real
// (no reutiliza ayuda.js, atada a la maqueta PCT23). Accesible: el foco entra en la ficha al abrirla y vuelve al equipo al cerrarla (Esc o ×).
(function () {
  const textos = typeof require !== 'undefined' ? require('./textos_ayuda.js') : PCT.htstTextosAyuda;
  const puntos = typeof require !== 'undefined' ? require('./puntos_medida.js') : PCT.htstPuntosMedida;

  /** Tag del equipo (atributo data-tag) del elemento pulsado o de alguno de sus padres; null si no es un equipo. */
  function tagDelElemento(nodo, raiz) {
    for (let n = nodo; n && n !== raiz; n = n.parentNode) { if (n.dataset && n.dataset.tag) return n.dataset.tag; }
    return null;
  }

  /** Activa las fichas sobre `svg`. contexto: { sim(), alVer3d(tag), alMedir(tag), mandoFicha(tag) → { nodo, actualizar(estado) } | null, nivel(), niveles }. */
  function iniciarAyuda(svg, contexto) {
    const ELEMENTOS = textos.construirElementos();
    const ventana = document.createElement('div');
    ventana.id = 'ficha-equipo'; ventana.hidden = true; ventana.setAttribute('role', 'dialog'); ventana.setAttribute('aria-modal', 'true'); ventana.setAttribute('aria-labelledby', 'ficha-titulo');
    ventana.innerHTML = '<header><h3 id="ficha-titulo"></h3><button type="button" class="ficha-cerrar" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header><span class="etiqueta-ficha"></span>' +
      '<p class="ficha-que"></p><h4>En el simulador</h4><p class="ficha-sim"></p><h4>Estado ahora</h4><p class="ficha-vivo"></p><div class="ficha-mando"></div>' +
      '<div class="ficha-botones"><button type="button" class="ficha-3d">Ver en 3D ▸</button><button type="button" class="ficha-medir">Medir ▸</button></div>';
    document.body.appendChild(ventana);
    let actual = null, temporizador = null, origen = null, mando = null;
    const nivelActual = () => (contexto.nivel ? contexto.nivel() : 3);
    const sencilla = tag => (nivelActual() === 1 && contexto.niveles ? contexto.niveles.fichaSencilla(tag) : null);     // nivel 1: ficha en lenguaje de alumno nuevo
    const vivo = () => {
      if (!actual || ventana.hidden) return;
      const estado = contexto.sim().estado();
      ventana.querySelector('.ficha-vivo').textContent = (sencilla(actual) ? contexto.niveles.estadoVivoNivel1(actual, estado) : textos.estadoVivo(actual, estado)) || '—';
      if (mando) mando.actualizar(estado);
    };
    function cerrar() {
      if (ventana.hidden) return;
      ventana.hidden = true; actual = null; mando = null; clearInterval(temporizador); ventana.querySelector('.ficha-mando').replaceChildren();
      if (origen && origen.isConnected && origen.focus) origen.focus();                  // el foco vuelve al equipo desde el que se abrió
      origen = null;
    }
    function abrir(tag, desde) {
      const e = ELEMENTOS[tag]; if (!e) return;
      const simple = sencilla(tag);
      if (nivelActual() === 1 && !simple) return;           // un equipo que no está en el nivel 1 no se abre
      if (ventana.hidden) origen = desde || document.activeElement;
      actual = tag;
      ventana.querySelector('h3').textContent = simple ? simple.nombre : e.titulo; ventana.querySelector('.etiqueta-ficha').textContent = simple ? `Código: ${tag}` : e.etiqueta;
      ventana.querySelector('.ficha-que').textContent = simple ? simple.queEs : e.queEs; ventana.querySelector('.ficha-sim').textContent = (simple ? simple.queHace : e.enSimulador) || '—';
      ventana.querySelector('h4').textContent = simple ? 'Qué hace' : 'En el simulador';
      ventana.querySelector('.ficha-medir').hidden = nivelActual() < 3 || puntos.puntosDeEquipo(tag).length === 0;       // el multímetro es del nivel 3
      // En modo MANUAL, si el equipo se manda a mano, la ficha lleva su mando (con las mismas reglas que el panel).
      const cont = ventana.querySelector('.ficha-mando'); cont.replaceChildren(); mando = null;
      const estado = contexto.sim().estado();
      if (contexto.mandoFicha && estado && estado.modo === 'MANUAL') { mando = contexto.mandoFicha(tag); if (mando) cont.appendChild(mando.nodo); }
      ventana.hidden = false; vivo(); clearInterval(temporizador); temporizador = setInterval(vivo, 500);
      ventana.querySelector('.ficha-cerrar').focus();
    }
    ventana.querySelector('.ficha-cerrar').addEventListener('click', cerrar);
    ventana.querySelector('.ficha-3d').addEventListener('click', () => { const t = actual; cerrar(); if (contexto.alVer3d) contexto.alVer3d(t); });
    ventana.querySelector('.ficha-medir').addEventListener('click', () => { const t = actual; cerrar(); if (contexto.alMedir) contexto.alMedir(t); });
    const alPulsar = evento => { const tag = tagDelElemento(evento.target, svg); if (tag && ELEMENTOS[tag]) { evento.preventDefault(); abrir(tag, evento.target.closest ? evento.target.closest('g[data-tag]') : null); } };
    svg.addEventListener('click', alPulsar);
    svg.addEventListener('contextmenu', alPulsar);
    // Teclado: Intro o Espacio sobre un equipo enfocado abre su ficha
    svg.addEventListener('keydown', evento => {
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      const g = evento.target.closest && evento.target.closest('g[data-tag]');
      if (g && ELEMENTOS[g.dataset.tag]) { evento.preventDefault(); abrir(g.dataset.tag, g); }
    });
    // Esc cierra; el foco se queda dentro de la ficha mientras está abierta (Tab da la vuelta entre sus controles)
    document.addEventListener('keydown', e => {
      if (ventana.hidden) return;
      if (e.key === 'Escape') { cerrar(); return; }
      if (e.key === 'Tab') {
        const controles = [...ventana.querySelectorAll('button:not([hidden]), input, select, a[href]')].filter(c => c.offsetParent !== null);
        if (!controles.length) return;
        const primero = controles[0], ultimo = controles[controles.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    });
    return { abrir, cerrar };
  }

  const api = { tagDelElemento, iniciarAyuda };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstAyuda = api;
})();
