(function () {
  const ESPACIO_SVG = 'http://www.w3.org/2000/svg';

  // Crea una caja HTML dentro del SVG con la posición y el tamaño del control.
  function crearCaja(canvas, o, clase) {
    const caja = document.createElementNS(ESPACIO_SVG, 'foreignObject');
    caja.setAttribute('x', String(o.x));
    caja.setAttribute('y', String(o.y));
    caja.setAttribute('width', String(o.ancho));
    caja.setAttribute('height', String(o.alto));
    const contenedor = document.createElement('div');
    contenedor.className = clase;
    caja.appendChild(contenedor);
    canvas.svg.appendChild(caja);
    return contenedor;
  }

  // Deslizador 0-100 % con su nombre y su valor. Sigue a la consigna y avisa al moverlo o soltarlo.
  class ControlDeslizador {
    constructor(canvas, o) {
      this.o = o;
      this.contenedor = crearCaja(canvas, o, 'ctl-scada');
      this.contenedor.innerHTML = `<span class="ctl-nombre">${o.nombre}</span><input type="range" min="0" max="100" step="1" aria-label="${o.nombre}"><output></output>`;
      this.rango = this.contenedor.querySelector('input');
      this.salida = this.contenedor.querySelector('output');
      this.rango.addEventListener('input', () => o.alCambiar(Number(this.rango.value)));
      this.rango.addEventListener('change', () => o.alSoltar && o.alSoltar());
    }

    actualizar(estado) {
      const valor = this.o.valorDe(estado);
      this.rango.value = String(valor);
      this.salida.textContent = `${valor} %`;
    }
  }

  // Botón que cambia un estado al pulsarlo; su texto refleja el estado actual.
  class ControlBoton {
    constructor(canvas, o) {
      this.o = o;
      this.contenedor = crearCaja(canvas, o, 'ctl-scada ctl-caja-boton');
      this.boton = document.createElement('button');
      this.boton.type = 'button';
      this.boton.className = 'ctl-boton';
      this.boton.addEventListener('click', () => o.alPulsar());
      this.contenedor.appendChild(this.boton);
    }

    actualizar(estado) {
      this.boton.textContent = this.o.textoDe(estado);
    }
  }

  const api = { ControlDeslizador, ControlBoton };
  if (typeof module !== 'undefined') module.exports = api; else PCT.controlesScada = api;
})();
