(function () {
  const { $ } = PCT.dom;

  function lecturasDeEstado(estado) {
    return PCT.planta.observaciones(estado);
  }

  class ScadaWidget {
    constructor(idContenedor, canvas) {
      this.canvas = canvas;
      this.objetos = [];
      $(idContenedor).replaceChildren(canvas.svg);
    }

    anadirObjetos(lista) {
      this.objetos.push(...lista);
    }

    // enMarcha: si la simulación avanza; en pausa, el flujo animado de las tuberías se congela.
    actualizar(estado, enMarcha = estado.ejecutando) {
      this.canvas.svg.classList.toggle('en-pausa', !enMarcha);
      const lecturas = lecturasDeEstado(estado);
      this.objetos.forEach(objeto => objeto.actualizar(estado, lecturas));
    }

    alPulsar(id, funcion) {
      this.canvas.buscar(id).addEventListener('click', funcion);
    }
  }

  PCT.scadaWidget = { ScadaWidget, lecturasDeEstado };
})();
