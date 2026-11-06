(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;

  // SOL4 repone A; SOL5 repone B (hipótesis didáctica). V3 abierta vacía B.
  function reponerYVaciarDepositos(estado, segundosPaso) {
    const cap = constantes.capacidadDepositoMl;
    if (estado.salidas.SOL4) estado.depositoAMl = matematicas.limitar(estado.depositoAMl + constantes.llenadoMlMin * segundosPaso / 60, 0, cap);
    if (estado.salidas.SOL5) estado.depositoBMl = matematicas.limitar(estado.depositoBMl + constantes.llenadoMlMin * segundosPaso / 60, 0, cap);
    if (estado.valvulaV3) estado.depositoBMl = Math.max(0, estado.depositoBMl - constantes.vaciadoMlMin * segundosPaso / 60);
  }

  /** Calcula el caudal de producto que drena N1 y lo devuelve en ml. */
  function calcularCaudalProducto(estado, segundosPaso) {
    const sol = estado.salidas;
    const volumen = sol.SOL2 ? estado.depositoBMl : estado.depositoAMl;
    const habilitada = sol.N1 && !estado.giro.N1 && estado.consignas.velocidadN1Pct > 0;
    const nominal = habilitada ? constantes.caudalMaxN1MlMin * matematicas.limitar(estado.consignas.velocidadN1Pct, 0, 100) / 100 : 0;
    const drenado = Math.min(volumen, nominal * segundosPaso / 60);
    estado.caudalProductoMlMin = (habilitada && segundosPaso > 0) ? drenado / segundosPaso * 60 : 0;
    estado.vacio = habilitada && volumen < 1;
    return drenado;
  }

  // Con SOL1 activa el producto rechazado vuelve al tanque de alimentación: se cuenta aparte y el tanque no baja.
  function repartirProductoDrenado(estado, ml) {
    if (estado.salidas.SOL1) {
      estado.desviadoMl += ml;
      return;
    }
    if (estado.salidas.SOL2) estado.depositoBMl = Math.max(0, estado.depositoBMl - ml);
    else estado.depositoAMl = Math.max(0, estado.depositoAMl - ml);
    estado.finalMl += ml;
  }

  // El frío circula si SOL3 está abierta; los ramales SOL4/SOL5 se ilustran por separado.
  function calcularCaudalFrio(estado, segundosPaso) {
    estado.caudalFrioMlMin = estado.salidas.SOL3 ? constantes.refrigeracionMlMin : 0;
    estado.desagueMl += estado.caudalFrioMlMin * segundosPaso / 60;
  }

  const api = { reponerYVaciarDepositos, calcularCaudalProducto, repartirProductoDrenado, calcularCaudalFrio };
  if (typeof module !== 'undefined') module.exports = api; else PCT.hidraulica = api;
})();
