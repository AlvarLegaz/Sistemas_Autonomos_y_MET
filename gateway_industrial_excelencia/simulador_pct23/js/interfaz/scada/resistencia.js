(function () {
  const { ObjetoScada } = typeof require !== 'undefined' ? require('./objeto_scada.js') : PCT.objetoScada;

  // Calefacción: el círculo RES y la línea de la resistencia se encienden con la salida RES y potencia mayor que 0.
  class Resistencia extends ObjetoScada {
    constructor(canvas, id, idLinea) {
      super(canvas, id);
      this.linea = canvas.buscar(idLinea);
    }

    actualizar(estado) {
      const calefaccion = !!estado.salidas.RES && estado.consignas.potenciaPct > 0;
      this.elemento.classList.toggle('on', calefaccion);
      this.linea.style.stroke = calefaccion ? 'var(--caliente)' : '';
    }
  }

  const api = { Resistencia };
  if (typeof module !== 'undefined') module.exports = api; else PCT.resistencia = api;
})();
