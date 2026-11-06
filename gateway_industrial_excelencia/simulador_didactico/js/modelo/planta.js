(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
  const termica = typeof require !== 'undefined' ? require('./termica.js') : PCT.termica;
  const hidraulica = typeof require !== 'undefined' ? require('./hidraulica.js') : PCT.hidraulica;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;

  // Integración en pasos de hasta 1 segundo para estabilidad.
  function avanzar(estado, segundos) {
    let pendientes = matematicas.limitar(Number(segundos) || 0, 0, 10000);
    while (pendientes > 0) {
      const segundosPaso = Math.min(1, pendientes);
      avanzarPaso(estado, segundosPaso);
      pendientes -= segundosPaso;
    }
    return estado;
  }

  function avanzarPaso(estado, segundosPaso) {
    estado.tiempo += segundosPaso;
    termica.avanzarAguaCaliente(estado, segundosPaso);
    termica.revisarTermostato(estado);
    hidraulica.reponerYVaciarDepositos(estado, segundosPaso);
    const drenado = hidraulica.calcularCaudalProducto(estado, segundosPaso);
    hidraulica.repartirProductoDrenado(estado, drenado);
    hidraulica.calcularCaudalFrio(estado, segundosPaso);
    termica.avanzarTemperaturasProducto(estado, segundosPaso);
  }

  function observaciones(estado) {
    const cap = constantes.capacidadDepositoMl;
    return {
      T1: estado.t1C, T2: estado.aguaCalienteC, T3: estado.t3C, T4: estado.t4C, T5: estado.t5C,
      F1: estado.caudalProductoMlMin, L1: (estado.depositoAMl / cap) * 250,
      HL: estado.depositoBMl / cap >= 0.80,
      LL: estado.depositoBMl / cap <= 0.20,
      TERM: estado.temperaturaCorte,
      LVLC: false, HLC: false,
    };
  }

  const api = { avanzar, avanzarPaso, observaciones };
  if (typeof module !== 'undefined') module.exports = api; else PCT.planta = api;
})();
