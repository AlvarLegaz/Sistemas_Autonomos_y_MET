(function () {
  const { ObjetoScada } = typeof require !== 'undefined' ? require('./objeto_scada.js') : PCT.objetoScada;
  const constantesFisicas = typeof require !== 'undefined' ? require('../../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const CAPACIDAD_ML = constantesFisicas.CONSTANTES_FISICAS.capacidadDepositoMl;
  const ALTO_INTERIOR = 136;
  const BASE_Y = 208;

  // Nivel del líquido: el rectángulo sube y baja con el volumen del depósito.
  class Deposito extends ObjetoScada {
    constructor(canvas, id, volumenDe) {
      super(canvas, id);
      this.volumenDe = volumenDe;
    }

    actualizar(estado) {
      const alto = ALTO_INTERIOR * this.volumenDe(estado) / CAPACIDAD_ML;
      this.elemento.setAttribute('y', String(BASE_Y - alto));
      this.elemento.setAttribute('height', String(alto));
    }
  }

  const api = { Deposito };
  if (typeof module !== 'undefined') module.exports = api; else PCT.deposito = api;
})();
