(function () {
  const DURACION_MS = 3000;
  const UMBRAL_PX = 10;

  // Detecta una pulsación mantenida sin tocar el DOM; el temporizador es inyectable para probarla.
  function crearPulsacionLarga({ alCumplir, duracionMs = DURACION_MS, umbralPx = UMBRAL_PX, programar = setTimeout, anular = clearTimeout }) {
    let idTemporizador = null, inicio = null, cumplida = false;

    function cancelar() {
      if (idTemporizador !== null) anular(idTemporizador);
      idTemporizador = null;
    }

    function empezar(x, y, dato) {
      cancelar();
      inicio = { x, y };
      cumplida = false;
      idTemporizador = programar(() => { idTemporizador = null; cumplida = true; alCumplir(dato); }, duracionMs);
    }

    function mover(x, y) {
      if (idTemporizador !== null && Math.hypot(x - inicio.x, y - inicio.y) > umbralPx) cancelar();
    }

    function terminar() {
      cancelar();
      const fue = cumplida;
      cumplida = false;
      return fue;
    }

    return { empezar, mover, terminar, cancelar };
  }

  const api = { crearPulsacionLarga, DURACION_MS, UMBRAL_PX };
  if (typeof module !== 'undefined') module.exports = api; else PCT.pulsacionLarga = api;
})();
