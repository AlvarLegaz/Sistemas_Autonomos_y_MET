(function () {
  // Tramos de tubería (por selector) que se iluminan cuando su condición es cierta.
  class Tuberia {
    constructor(canvas, selector, activa) {
      this.elementos = canvas.buscarTodos(selector);
      this.activa = activa;
    }

    actualizar(estado) {
      const on = !!this.activa(estado);
      this.elementos.forEach(e => e.classList.toggle('activo', on));
    }
  }

  const api = { Tuberia };
  if (typeof module !== 'undefined') module.exports = api; else PCT.tuberia = api;
})();
