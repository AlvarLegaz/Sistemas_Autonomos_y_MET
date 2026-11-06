(function () {
  const { ObjetoScada } = typeof require !== 'undefined' ? require('./objeto_scada.js') : PCT.objetoScada;

  // Electroválvula o símbolo de válvula: se ilumina según la función que indica si está activa.
  class Valvula extends ObjetoScada {
    constructor(canvas, id, estaActiva) {
      super(canvas, id);
      this.estaActiva = estaActiva;
    }

    actualizar(estado) {
      this.marcarHijos('.valvula,.instr', this.estaActiva(estado));
    }
  }

  const api = { Valvula };
  if (typeof module !== 'undefined') module.exports = api; else PCT.valvula = api;
})();
