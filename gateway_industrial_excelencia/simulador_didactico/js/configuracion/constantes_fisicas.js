(function () {
  const CONSTANTES_FISICAS = Object.freeze({
    temperaturaAmbienteC: 22, capacidadDepositoMl: 5000, caudalMaxN1MlMin: 550,
    llenadoMlMin: 260, refrigeracionMlMin: 450, vaciadoMlMin: 600, // vaciadoMlMin: V3 abierta (didáctico)
    constanteCalentadorS: 200, constanteEnfriamientoS: 360, limiteTermicoC: 91, margenDisparoC: 0.05,
    temperaturaRearmeC: 70, constanteCorteS: 900, subidaCalentadorC: 69, // subida del agua con el calefactor al 100 %
    eficienciaIntercambio: 0.79, reduccionPorCaudal: 0.25, acoplamientoCaudal: 0.15,
  });
  const SALIDAS = Object.freeze(['N1', 'N2', 'SOL1', 'SOL2', 'SOL3', 'SOL4', 'SOL5', 'RES']);

  const api = { CONSTANTES_FISICAS, SALIDAS };
  if (typeof module !== 'undefined') module.exports = api; else PCT.constantesFisicas = api;
})();
