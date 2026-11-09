(function () {
  const ESPACIO_SVG = 'http://www.w3.org/2000/svg';

  function esAtributos(valor) {
    return !!valor && typeof valor === 'object' && !Array.isArray(valor);
  }

  function ponerAtributos(nodo, atributos) {
    Object.keys(atributos).forEach(nombre => nodo.setAttribute(nombre, String(atributos[nombre])));
  }

  function construirHijo(hijo) {
    return typeof hijo === 'string' ? document.createTextNode(hijo) : construirNodo(hijo);
  }

  // Especificación: [etiqueta, atributos?, ...hijos]; los hijos son textos o más especificaciones.
  function construirNodo(spec) {
    const conAtributos = esAtributos(spec[1]);
    const nodo = document.createElementNS(ESPACIO_SVG, spec[0]);
    if (conAtributos) ponerAtributos(nodo, spec[1]);
    spec.slice(conAtributos ? 2 : 1).forEach(hijo => nodo.appendChild(construirHijo(hijo)));
    return nodo;
  }

  class Canvas {
    constructor(esquema) {
      this.svg = construirNodo(esquema);
    }

    buscar(id) {
      return this.svg.querySelector(`[id="${id}"]`);
    }

    buscarTodos(selector) {
      return Array.from(this.svg.querySelectorAll(selector));
    }
  }

  const api = { Canvas, construirNodo };
  if (typeof module !== 'undefined') module.exports = api; else PCT.canvas = api;
})();
