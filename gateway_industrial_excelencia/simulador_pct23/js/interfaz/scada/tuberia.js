(function () {
  const ESPACIO_SVG = 'http://www.w3.org/2000/svg';

  // Capa de puntos animados sobre un tramo: se mueven en el sentido en que se dibujó el tubo
  // (o al revés si el tubo lleva data-sentido="inverso").
  function crearFlujo(tubo) {
    if (tubo.hasAttribute('data-sin-flujo')) return null;
    const flujo = document.createElementNS(ESPACIO_SVG, 'path');
    flujo.setAttribute('d', tubo.getAttribute('d'));
    flujo.setAttribute('class', tubo.getAttribute('data-sentido') === 'inverso' ? 'flujo inverso' : 'flujo');
    tubo.after(flujo);
    return flujo;
  }

  // Más velocidad de bomba, puntos más rápidos (de 2 s por ciclo al 10 % a 0,5 s al 100 %).
  function segundosPorCiclo(velocidadPct) {
    return 2.2 - 0.017 * Math.min(100, Math.max(10, velocidadPct));
  }

  // Tramos de tubería (por selector) que se iluminan y muestran flujo cuando su condición es cierta.
  class Tuberia {
    // invertir(estado): true si la bomba gira al revés y el flujo de este tramo debe ir en sentido contrario.
    constructor(canvas, selector, activa, velocidadPct = null, invertir = null) {
      this.elementos = canvas.buscarTodos(selector);
      this.activa = activa;
      this.velocidadPct = velocidadPct;
      this.invertir = invertir;
      this.flujos = this.elementos.map(crearFlujo).filter(Boolean);
    }

    actualizar(estado) {
      const on = !!this.activa(estado);
      this.elementos.forEach(e => e.classList.toggle('activo', on));
      this.flujos.forEach(f => f.classList.toggle('activo', on));
      const alReves = !!this.invertir && !!this.invertir(estado);
      this.flujos.forEach(f => f.classList.toggle('invertido', alReves));
      if (on && this.velocidadPct) {
        const duracion = `${segundosPorCiclo(this.velocidadPct(estado)).toFixed(2)}s`;
        this.flujos.forEach(f => { f.style.animationDuration = duracion; });
      }
    }
  }

  const api = { Tuberia, segundosPorCiclo };
  if (typeof module !== 'undefined') module.exports = api; else PCT.tuberia = api;
})();
