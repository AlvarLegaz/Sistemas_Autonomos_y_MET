(function () {
  const PERIODO_MS = 250;

  // Un único temporizador para todas las páginas; el paso decide si la planta avanza.
  function iniciarBucle(alPaso) {
    setInterval(alPaso, PERIODO_MS);
  }

  PCT.bucle = { iniciarBucle };
})();
