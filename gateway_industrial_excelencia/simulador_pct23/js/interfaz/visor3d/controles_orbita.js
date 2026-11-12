// Controles de órbita para el visor 3D: arrastrar gira, botón derecho (o Mayús + arrastrar, o dos dedos) desplaza la cámara de lado, rueda o pellizco acercan,
// doble clic reinicia. Sin dependencias.
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

  const TAN_MEDIO_CAMPO = Math.tan((38 / 2) * Math.PI / 180);   // la cámara del visor es de 38° de campo vertical
  const LIMITE_OBJETIVO = 1500;                                  // cm: el objetivo no se aleja más de esto del origen (no perderse)

  /**
   * Desplazamiento lateral: mueve `vista.objetivo` por el plano de la pantalla. dx y dy son píxeles arrastrados (a la derecha y hacia abajo) y `altoPx` el alto
   * del lienzo; la escena sigue al dedo: arrastrar a la derecha lleva la escena a la derecha. Devuelve la misma vista (se modifica).
   */
  function desplazarObjetivo(vista, dx, dy, altoPx) {
    const porPixel = 2 * vista.distancia * TAN_MEDIO_CAMPO / Math.max(1, altoPx);
    const sa = Math.sin(vista.azimut), ca = Math.cos(vista.azimut), se = Math.sin(vista.elevacion), ce = Math.cos(vista.elevacion);
    const derecha = { x: ca, y: 0, z: -sa }, arriba = { x: -sa * se, y: ce, z: -ca * se };      // ejes de la pantalla en el mundo
    const o = vista.objetivo;
    vista.objetivo = {
      x: limitar(o.x - derecha.x * dx * porPixel + arriba.x * dy * porPixel, -LIMITE_OBJETIVO, LIMITE_OBJETIVO),
      y: limitar(o.y - derecha.y * dx * porPixel + arriba.y * dy * porPixel, -LIMITE_OBJETIVO, LIMITE_OBJETIVO),
      z: limitar(o.z - derecha.z * dx * porPixel + arriba.z * dy * porPixel, -LIMITE_OBJETIVO, LIMITE_OBJETIVO),
    };
    return vista;
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
      this.desplazando = false;        // el gesto de un solo puntero desplaza en lugar de girar (botón derecho o Mayús)
      this.centroPellizco = null;      // centro de los dos dedos en el último movimiento (para desplazar con dos dedos)
      this.alMenu = e => e.preventDefault();      // sin el menú del navegador sobre el visor: el botón derecho es para desplazar
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
      elemento.addEventListener('contextmenu', this.alMenu);
    }

    /** True si el último gesto fue un arrastre (para no tomarlo por un clic de selección). */
    seArrastro() { return this.arrastre > UMBRAL_ARRASTRE_PX; }

    pulsar(e) {
      this.elemento.setPointerCapture(e.pointerId);
      this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.punteros.size === 1) { this.arrastre = 0; this.desplazando = e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey; }
      if (this.punteros.size === 2) { this.distanciaPellizco = this.distanciaEntrePunteros(); this.centroPellizco = this.centroEntrePunteros(); }
    }

    mover(e) {
      const anterior = this.punteros.get(e.pointerId);
      if (!anterior) return;
      const dx = e.clientX - anterior.x, dy = e.clientY - anterior.y;
      this.punteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.arrastre += Math.abs(dx) + Math.abs(dy);
      if (this.punteros.size === 1) {
        if (this.desplazando) desplazarObjetivo(this.vista, dx, dy, this.elemento.clientHeight || 600);
        else {
          this.vista.azimut -= dx * SENSIBILIDAD_GIRO;
          // `elevacionMinima` (opcional, en la vista de la escena) impide bajar la cámara por debajo del suelo de la escena (p. ej. de la cubierta fotovoltaica)
          const minimaEl = typeof this.vista.elevacionMinima === 'number' ? this.vista.elevacionMinima : -ELEVACION_MAXIMA;
          this.vista.elevacion = limitar(this.vista.elevacion + dy * SENSIBILIDAD_GIRO, minimaEl, ELEVACION_MAXIMA);
        }
      } else if (this.punteros.size === 2) {
        const distancia = this.distanciaEntrePunteros(), centro = this.centroEntrePunteros();
        if (this.distanciaPellizco > 0 && distancia > 0) this.acercar(this.distanciaPellizco / distancia);
        if (this.centroPellizco) desplazarObjetivo(this.vista, centro.x - this.centroPellizco.x, centro.y - this.centroPellizco.y, this.elemento.clientHeight || 600);   // dos dedos que se mueven a la vez: desplazar
        this.distanciaPellizco = distancia; this.centroPellizco = centro;
      }
      this.alCambiar();
    }

    soltar(e) {
      this.punteros.delete(e.pointerId);
      this.distanciaPellizco = 0; this.centroPellizco = null;
      if (this.punteros.size === 0) this.desplazando = false;
    }

    centroEntrePunteros() {
      const [a, b] = Array.from(this.punteros.values());
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
      e.removeEventListener('contextmenu', this.alMenu);
    }
  }

  const api = { ControlesOrbita, posicionOrbita, desplazarObjetivo, ELEVACION_MAXIMA };
  if (typeof module !== 'undefined') module.exports = api; else PCT.controlesOrbita = api;
})();
