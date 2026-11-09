(function () {
  class ObjetoScada {
    constructor(canvas, id) {
      this.id = id;
      this.elemento = canvas.buscar(id);
    }

    actualizar(estado, lecturas) {}

    marcarHijos(selector, activo) {
      this.elemento.querySelectorAll(selector).forEach(e => e.classList.toggle('on', !!activo));
    }
  }

  const api = { ObjetoScada };
  if (typeof module !== 'undefined') module.exports = api; else PCT.objetoScada = api;
})();
