(function () {
  function limitar(valor, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, valor));
  }

  function acercarExponencial(actual, objetivo, segundosPaso, constanteS) {
    return actual + (objetivo - actual) * (1 - Math.exp(-segundosPaso / constanteS));
  }

  const api = { limitar, acercarExponencial };
  if (typeof module !== 'undefined') module.exports = api; else PCT.matematicas = api;
})();
