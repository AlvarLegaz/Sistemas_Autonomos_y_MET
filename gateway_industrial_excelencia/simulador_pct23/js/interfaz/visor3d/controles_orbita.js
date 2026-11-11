// Controles de órbita para el visor 3D: arrastrar gira, rueda o pellizco acercan, doble clic reinicia. Sin dependencias.
(function () {
  const limitar = (valor, minimo, maximo) => Math.max(minimo, Math.min(maximo, valor));
  const ELEVACION_MAXIMA = 1.45;   // rad: sin llegar al cénit para no voltear la cámara
  const SENSIBILIDAD_GIRO = 0.008; // rad por píxel
  const UMBRAL_ARRASTRE_PX = 5;    // menos que esto cuenta como clic y no como giro

  /** Posición de la cámara en una órbita (azimut y elevación en rad) alrededor de un objetivo. */
  function posicionOrbita(azimut, elevacion, distancia, objetivo) {
    return {
      x: objetivo.x + distancia * Math.cos(elevacion) * Math.sin(azimut),
      y: objetivo.y + distancia * Math.sin(elevacion),
      z: objetivo.z + distancia * Math.cos(elevacion) * Math.cos(azimut),
    };
  }

  class ControlesOrbita {
    constructor(elemento, vistaInicial, alCambiar) {
      this.elemento = elemento;
      this.inicial = Object.assign({}, vistaInicial);
      this.vista = Object.assign({}, vistaInicial);   // { azimut, elevacion, distancia, minimo, maximo, objetivo }
      this.alCambiar = alCambiar;
      this.punteros = new Map();
      this.distanciaPellizco = 0;
      this.arrastre = 0;
      this.alPulsar = e => this.pulsar(e);
      this.alMover = e => this.mover(e);
      this.alSoltar = e => this.soltar(e);
      this.alRueda = e => { e.preventDefault(); this.acercar(Math.exp(e.deltaY * 0.0012)); };
      this.alDobleClic = () => this.reiniciar();
      elemento.style.touchAction = 'none';
      elemento.addEventListener('pointerdown', this.alPulsar);
      elemento.addEventListener('pointermove', this.alMover);
      elemento.addEventListener('pointerup', this.alSoltar);
      elemento.addEventListener('pointercancel', this.alSoltar);
      elemento.addEventListener('wheel', this.alRueda, { passive: false });
      elemento.addEventListener('dblclick', this.alDobleClic);
    }

    /** True si el último gesto fue un arrastre (para no tomarlo por un clic de selección). */
    seArrastro() { return this.arrastre > UMBRAL_ARRASTRE_PX; }

    pulsar(e) {
      this.elemento.setPointerCapture(e.pointerId);
      this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.punteros.size === 1) this.arrastre = 0;
      if (this.punteros.size === 2) this.distanciaPellizco = this.distanciaEntrePunteros();
    }

    mover(e) {
      const anterior = this.punteros.get(e.pointerId);
      if (!anterior) return;
      const dx = e.clientX - anterior.x, dy = e.clientY - anterior.y;
      this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.arrastre += Math.abs(dx) + Math.abs(dy);
      if (this.punteros.size === 1) {
        this.vista.azimut -= dx * SENSIBILIDAD_GIRO;
        this.vista.elevacion = limitar(this.vista.elevacion + dy * SENSIBILIDAD_GIRO, -ELEVACION_MAXIMA, ELEVACION_MAXIMA);
      } else if (this.punteros.size === 2) {
        const distancia = this.distanciaEntrePunteros();
        if (this.distanciaPellizco > 0 && distancia > 0) this.acercar(this.distanciaPellizco / distancia);
        this.distanciaPellizco = distancia;
      }
      this.alCambiar();
    }

    soltar(e) {
      this.punteros.delete(e.pointerId);
      this.distanciaPellizco = 0;
    }

    distanciaEntrePunteros() {
      const [a, b] = Array.from(this.punteros.values());
      return Math.hypot(a.x - b.x, a.y - b.y);
    }

    acercar(factor) {
      this.vista.distancia = limitar(this.vista.distancia * factor, this.vista.minimo, this.vista.maximo);
      this.alCambiar();
    }

    reiniciar() {
      this.vista = Object.assign({}, this.inicial);
      this.alCambiar();
    }

    posicion() {
      return posicionOrbita(this.vista.azimut, this.vista.elevacion, this.vista.distancia, this.vista.objetivo);
    }

    liberar() {
      const e = this.elemento;
      e.removeEventListener('pointerdown', this.alPulsar);
      e.removeEventListener('pointermove', this.alMover);
      e.removeEventListener('pointerup', this.alSoltar);
      e.removeEventListener('pointercancel', this.alSoltar);
      e.removeEventListener('wheel', this.alRueda);
      e.removeEventListener('dblclick', this.alDobleClic);
    }
  }

  const api = { ControlesOrbita, posicionOrbita, ELEVACION_MAXIMA };
  if (typeof module !== 'undefined') module.exports = api; else PCT.controlesOrbita = api;
})();
