(function () {
  const ESPACIO_SVG = 'http://www.w3.org/2000/svg';
  const { ControlDeslizador, ControlBoton } = typeof require !== 'undefined' ? require('./controles_scada.js') : PCT.controlesScada;

  // Caja única dentro del SVG con filas apiladas. Cada fila: título, botón opcional y deslizador opcional.
  class PanelControles {
    constructor(canvas, posicion, filas) {
      this.caja = document.createElementNS(ESPACIO_SVG, 'foreignObject');
      this.caja.setAttribute('x', String(posicion.x));
      this.caja.setAttribute('y', String(posicion.y));
      this.caja.setAttribute('width', String(posicion.ancho));
      this.caja.setAttribute('height', String(posicion.alto));
      this.contenedor = document.createElement('div');
      this.contenedor.className = 'panel-ctl';
      this.contenedor.setAttribute('role', 'group');
      this.contenedor.setAttribute('aria-label', 'Controles de bombas y calefactor');
      this.caja.appendChild(this.contenedor);
      canvas.svg.appendChild(this.caja);
      this.controles = filas.flatMap(fila => this.crearFila(fila));
    }

    crearFila(fila) {
      const elemento = document.createElement('div');
      elemento.className = 'fila-ctl';
      const cabecera = document.createElement('div');
      cabecera.className = 'cab-ctl';
      cabecera.innerHTML = `<span class="ctl-titulo">${fila.titulo}</span>`;
      elemento.appendChild(cabecera);
      const controles = [];
      if (fila.boton) controles.push(new ControlBoton(cabecera, fila.boton));
      if (fila.deslizador) controles.push(new ControlDeslizador(elemento, fila.deslizador));
      this.contenedor.appendChild(elemento);
      return controles;
    }

    actualizar(estado) {
      this.controles.forEach(control => control.actualizar(estado));
    }
  }

  const api = { PanelControles };
  if (typeof module !== 'undefined') module.exports = api; else PCT.panelControles = api;
})();
