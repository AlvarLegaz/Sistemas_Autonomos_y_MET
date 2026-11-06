(function () {
  const { ObjetoScada } = typeof require !== 'undefined' ? require('./objeto_scada.js') : PCT.objetoScada;

  // Lectura de texto: el formato lo recibe al crearla y se aplica con cada estado.
  class Etiqueta extends ObjetoScada {
    constructor(canvas, id, formato) {
      super(canvas, id);
      this.formato = formato;
    }

    actualizar(estado, lecturas) {
      this.elemento.textContent = this.formato(estado, lecturas);
    }
  }

  const api = { Etiqueta };
  if (typeof module !== 'undefined') module.exports = api; else PCT.etiqueta = api;
})();
