(function () {
  const { ObjetoScada } = typeof require !== 'undefined' ? require('./objeto_scada.js') : PCT.objetoScada;

  // El círculo se ilumina con la marcha y la flecha se invierte con el sentido de giro.
  class Bomba extends ObjetoScada {
    constructor(canvas, id, clave) {
      super(canvas, id);
      this.clave = clave;
      this.flecha = this.elemento.querySelector('path');
    }

    actualizar(estado) {
      this.marcarHijos('.valvula,.instr', estado.salidas[this.clave]);
      this.flecha.classList.toggle('invertida', !!estado.giro[this.clave]);
    }
  }

  const api = { Bomba };
  if (typeof module !== 'undefined') module.exports = api; else PCT.bomba = api;
})();
