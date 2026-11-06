(function () {
  const { $ } = PCT.dom;
  const LIMITE_LINEAS = 16;

  function registrarEventoEnPantalla(texto) {
    const lista = $('sim-log');
    const item = document.createElement('li');
    item.textContent = texto;
    lista.prepend(item);
    while (lista.children.length > LIMITE_LINEAS) lista.lastElementChild.remove();
  }

  function vaciarRegistro() { $('sim-log').replaceChildren(); }

  PCT.registroEventos = { registrarEventoEnPantalla, vaciarRegistro };
})();
