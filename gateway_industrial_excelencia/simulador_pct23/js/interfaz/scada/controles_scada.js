(function () {
  // Deslizador 0-100 % con su nombre y su valor. Sigue a la consigna y avisa al moverlo o soltarlo.
  class ControlDeslizador {
    constructor(padre, o) {
      this.o = o;
      this.contenedor = document.createElement('div');
      this.contenedor.className = 'ctl-deslizador';
      this.contenedor.innerHTML = `<span>${o.nombre}</span><input type="range" min="0" max="100" step="1" aria-label="${o.nombre}"><output></output>`;
      this.rango = this.contenedor.querySelector('input');
      this.salida = this.contenedor.querySelector('output');
      this.rango.addEventListener('input', () => o.alCambiar(Number(this.rango.value)));
      this.rango.addEventListener('change', () => o.alSoltar && o.alSoltar());
      padre.appendChild(this.contenedor);
    }

    actualizar(estado) {
      const valor = this.o.valorDe(estado);
      this.rango.value = String(valor);
      this.salida.textContent = `${Math.round(valor)} %`;
    }
  }

  // Botón que cambia un estado al pulsarlo; su texto refleja el estado actual.
  class ControlBoton {
    constructor(padre, o) {
      this.o = o;
      this.boton = document.createElement('button');
      this.boton.type = 'button';
      this.boton.className = 'ctl-boton';
      this.boton.addEventListener('click', () => o.alPulsar());
      padre.appendChild(this.boton);
    }

    actualizar(estado) {
      this.boton.textContent = this.o.textoDe(estado);
    }
  }

  const api = { ControlDeslizador, ControlBoton };
  if (typeof module !== 'undefined') module.exports = api; else PCT.controlesScada = api;
})();
