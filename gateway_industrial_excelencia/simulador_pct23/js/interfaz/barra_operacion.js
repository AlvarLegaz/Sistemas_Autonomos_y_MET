(function () {
  const { $ } = PCT.dom;

  // Botones 1×/5×/20× sobre el select de velocidad, que es la fuente de verdad.
  function iniciarVelocidad(opciones) {
    const selector = $('sim-velocidad');
    if (!selector) return;
    const botones = Array.from(document.querySelectorAll('.velocidad button'));
    const sincronizar = () => botones.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === selector.value)));
    botones.forEach(b => b.addEventListener('click', () => {
      selector.value = b.dataset.v;
      selector.dispatchEvent(new Event('change'));
    }));
    selector.addEventListener('change', () => {
      sincronizar();
      if (opciones.alCambiarVelocidad) opciones.alCambiarVelocidad(Number(selector.value));
    });
    sincronizar();
  }

  // Se cierra al elegir una opción o al pulsar fuera.
  function iniciarMenuMas() {
    const mas = document.querySelector('.mas');
    if (!mas) return;
    mas.addEventListener('click', e => { if (e.target.closest('button')) mas.open = false; });
    document.addEventListener('click', e => { if (!mas.contains(e.target)) mas.open = false; });
  }

  // La primera pestaña es la que viene marcada; el resto son opcionales.
  // En pantalla grande las gráficas salen de las pestañas y van fijas debajo del esquema.
  function iniciarPestanas() {
    const pestanas = Array.from(document.querySelectorAll('.pestanas [role="tab"]'));
    if (!pestanas.length) return;
    const panelGraficas = $('p-graficas');
    const pestanaGraficas = $('tab-graficas');
    const pantallaGrande = window.matchMedia('(min-width: 1280px)');
    const lateral = panelGraficas ? panelGraficas.parentElement : null;
    const marcadorLateral = panelGraficas ? panelGraficas.nextElementSibling : null;

    const graficasAbajo = () => Boolean(panelGraficas) && pantallaGrande.matches;
    const mostrar = pestana => pestanas.forEach(t => {
      const seleccionada = t === pestana;
      t.setAttribute('aria-selected', String(seleccionada));
      if (t === pestanaGraficas && graficasAbajo()) return;
      $(t.getAttribute('aria-controls')).hidden = !seleccionada;
    });
    const primeraVisible = () => pestanas.find(t => t !== pestanaGraficas) || pestanas[0];

    function colocarGraficas() {
      if (!panelGraficas) return;
      if (graficasAbajo()) {
        document.querySelector('.escena').appendChild(panelGraficas);
        panelGraficas.classList.add('bajo-esquema');
        panelGraficas.hidden = false;
        pestanaGraficas.hidden = true;
        if (pestanaGraficas.getAttribute('aria-selected') === 'true') mostrar(primeraVisible());
      } else {
        lateral.insertBefore(panelGraficas, marcadorLateral);
        panelGraficas.classList.remove('bajo-esquema');
        pestanaGraficas.hidden = false;
        mostrar(pestanas.find(t => t.getAttribute('aria-selected') === 'true') || pestanas[0]);
      }
      window.dispatchEvent(new Event('resize'));
    }

    pestanas.forEach(t => t.addEventListener('click', () => mostrar(t)));
    pantallaGrande.addEventListener('change', colocarGraficas);
    mostrar(pestanas.find(t => t.getAttribute('aria-selected') === 'true') || pestanas[0]);
    colocarGraficas();
  }

  function iniciarBarra(opciones = {}) {
    iniciarVelocidad(opciones);
    iniciarMenuMas();
    iniciarPestanas();
  }

  PCT.barraOperacion = { iniciarBarra };
})();
