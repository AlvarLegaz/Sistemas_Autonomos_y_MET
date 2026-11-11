// Ficha de cada equipo de la planta real: al pulsar (o clic derecho) un equipo del esquema se abre una ventana con qué es, qué hace en el simulador,
// su estado en vivo y botones para verlo en 3D y para ir a medirlo. Propia de la planta real (no reutiliza ayuda.js, atada a la maqueta PCT23).
(function () {
  const textos = typeof require !== 'undefined' ? require('./textos_ayuda.js') : PCT.htstTextosAyuda;
  const puntos = typeof require !== 'undefined' ? require('./puntos_medida.js') : PCT.htstPuntosMedida;

  /** Tag del equipo (atributo data-tag) del elemento pulsado o de alguno de sus padres; null si no es un equipo. */
  function tagDelElemento(nodo, raiz) {
    for (let n = nodo; n && n !== raiz; n = n.parentNode) { if (n.dataset && n.dataset.tag) return n.dataset.tag; }
    return null;
  }

  /** Activa las fichas sobre `svg`. contexto: { sim(), alVer3d(tag), alMedir(tag) }. */
  function iniciarAyuda(svg, contexto) {
    const ELEMENTOS = textos.construirElementos();
    const ventana = document.createElement('div');
    ventana.id = 'ficha-equipo'; ventana.hidden = true; ventana.setAttribute('role', 'dialog'); ventana.setAttribute('aria-label', 'Ficha del equipo');
    ventana.innerHTML = '<header><h3></h3><button type="button" class="ficha-cerrar" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header><span class="etiqueta-ficha"></span>' +
      '<p class="ficha-que"></p><h4>En el simulador</h4><p class="ficha-sim"></p><h4>Estado ahora</h4><p class="ficha-vivo"></p>' +
      '<div class="ficha-botones"><button type="button" class="ficha-3d">Ver en 3D ▸</button><button type="button" class="ficha-medir">Medir ▸</button></div>';
    document.body.appendChild(ventana);
    let actual = null, temporizador = null;
    const vivo = () => { if (actual && !ventana.hidden) ventana.querySelector('.ficha-vivo').textContent = textos.estadoVivo(actual, contexto.sim().estado()) || '—'; };
    function cerrar() { ventana.hidden = true; actual = null; clearInterval(temporizador); }
    function abrir(tag) {
      const e = ELEMENTOS[tag]; if (!e) return;
      actual = tag;
      ventana.querySelector('h3').textContent = e.titulo; ventana.querySelector('.etiqueta-ficha').textContent = e.etiqueta;
      ventana.querySelector('.ficha-que').textContent = e.queEs; ventana.querySelector('.ficha-sim').textContent = e.enSimulador || '—';
      ventana.querySelector('.ficha-medir').hidden = puntos.puntosDeEquipo(tag).length === 0;
      ventana.hidden = false; vivo(); clearInterval(temporizador); temporizador = setInterval(vivo, 500);
    }
    ventana.querySelector('.ficha-cerrar').addEventListener('click', cerrar);
    ventana.querySelector('.ficha-3d').addEventListener('click', () => { const t = actual; cerrar(); if (contexto.alVer3d) contexto.alVer3d(t); });
    ventana.querySelector('.ficha-medir').addEventListener('click', () => { const t = actual; cerrar(); if (contexto.alMedir) contexto.alMedir(t); });
    const alPulsar = evento => { const tag = tagDelElemento(evento.target, svg); if (tag && ELEMENTOS[tag]) { evento.preventDefault(); abrir(tag); } };
    svg.addEventListener('click', alPulsar);
    svg.addEventListener('contextmenu', alPulsar);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ventana.hidden) cerrar(); });
    return { abrir, cerrar };
  }

  const api = { tagDelElemento, iniciarAyuda };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstAyuda = api;
})();
