(function () {
  const { ObjetoScada } = typeof require !== 'undefined' ? require('./objeto_scada.js') : PCT.objetoScada;

  // Sensor de nivel o de temperatura: el círculo pasa a alarma cuando su señal está activa.
  class Sensor extends ObjetoScada {
    constructor(canvas, id, clave) {
      super(canvas, id);
      this.clave = clave;
    }

    actualizar(estado, lecturas) {
      this.elemento.classList.toggle('alarma', !!lecturas[this.clave]);
    }
  }

  const api = { Sensor };
  if (typeof module !== 'undefined') module.exports = api; else PCT.sensor = api;
})();
