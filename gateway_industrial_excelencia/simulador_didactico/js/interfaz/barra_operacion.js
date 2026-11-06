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
  function iniciarPestanas() {
    const pestanas = Array.from(document.querySelectorAll('.pestanas [role="tab"]'));
    if (!pestanas.length) return;
    const mostrar = pestana => pestanas.forEach(t => {
      const seleccionada = t === pestana;
      t.setAttribute('aria-selected', String(seleccionada));
      $(t.getAttribute('aria-controls')).hidden = !seleccionada;
    });
    pestanas.forEach(t => t.addEventListener('click', () => mostrar(t)));
    mostrar(pestanas.find(t => t.getAttribute('aria-selected') === 'true') || pestanas[0]);
  }

  function iniciarBarra(opciones = {}) {
    iniciarVelocidad(opciones);
    iniciarMenuMas();
    iniciarPestanas();
  }

  PCT.barraOperacion = { iniciarBarra };
})();
