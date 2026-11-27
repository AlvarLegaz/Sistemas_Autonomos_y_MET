(function () {
  // Parámetros térmicos AJUSTADOS con una ejecución real de la maqueta (27/11/2026, CSV del sinóptico): ver gemelo_calibrado/README.md.
  // Los que la prueba no permite identificar (subida en régimen, pérdidas del depósito, efecto del caudal) se fijan a valores físicos razonables.
  const CONSTANTES_FISICAS = Object.freeze({
    temperaturaAmbienteC: 22, capacidadDepositoMl: 5000, llenadoUnidadCalentamientoPct: 70, caudalMaxN1MlMin: 550,
    llenadoMlMin: 260, refrigeracionMlMin: 450, vaciadoMlMin: 600, // vaciadoMlMin: V3 abierta
    limiteTermicoC: 70, margenDisparoC: 0.05, temperaturaRearmeC: 60,
    // Agua caliente en DOS nodos: el circuito del calefactor (lo que llega al intercambiador) y el depósito donde está T2.
    subidaCalentadorC: 150,          // subida del circuito del calefactor en régimen con la resistencia al 100 % (fijado)
    constanteCalentadorS: 1095,      // ajustado: la pendiente inicial es subida / constante = 0,137 °C/s
    mezclaConN2S: 536,               // ajustado: intercambio circuito <-> depósito con N2 en marcha
    mezclaSinN2S: 20000,             // ajustado: casi no hay intercambio con N2 parada
    relacionCapacidades: 1.315,      // ajustado: cuánto mueve a T2 el calor que recibe del circuito
    perdidasDepositoS: 40000,        // fijado: el depósito apenas se enfría (en 25 min, menos de 1 °C)
    // Producto
    eficienciaIntercambio: 1.0, reduccionPorCaudal: 0.02, // ajustado a 0,985 con N1 al 75 % (el efecto del caudal no se pudo medir)
    acoplamientoCaudal: 0,           // ajustado: el producto no enfría de forma medible el circuito caliente
    constanteT4S: 140, retencionT1: 0.954, constanteT1S: 33, // T4 sigue al circuito caliente; T1 llega por el tubo de residencia
    recuperacionT3: 0.273, constanteT3S: 132,                // T3 solo se calienta con el producto a salida normal
    constanteParadoT4S: 992, constanteParadoT1S: 708, constanteParadoT3S: 454, // producto quieto enfriándose
  });
  const SALIDAS = Object.freeze(['N1', 'N2', 'SOL1', 'SOL2', 'SOL3', 'SOL4', 'SOL5', 'RES']);

  const api = { CONSTANTES_FISICAS, SALIDAS };
  if (typeof module !== 'undefined') module.exports = api; else PCT.constantesFisicas = api;
})();
