(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;

  /** Fracción de calor que el producto en marcha le quita al agua caliente. fraccionCaudal: 0..1 del caudal máximo de N1. */
  function factorAcoplamiento(n2Encendida, n1vPct, fraccionCaudal) {
    const factorEficiencia = n2Encendida ? factorFlujo(n1vPct) : 0.08 / constantes.eficienciaIntercambio;
    return constantes.acoplamientoCaudal * matematicas.limitar(fraccionCaudal, 0, 1) * factorEficiencia;
  }

  /** Parte de la eficiencia de intercambio que queda con ese caudal (%). */
  function factorFlujo(caudalPct) {
    return 1 - constantes.reduccionPorCaudal * caudalPct / 100;
  }

  /** Eficiencia del intercambio con el producto circulando a ese caudal (%). */
  function eficienciaPorCaudal(caudalPct) {
    return constantes.eficienciaIntercambio * factorFlujo(caudalPct);
  }

  /** Acoplamiento en régimen con ese caudal (%): el mismo que usan los lazos de regulación. */
  function acoplamientoConCaudal(caudalPct) {
    return factorAcoplamiento(true, caudalPct, caudalPct / 100);
  }

  /** Temperatura del agua caliente en régimen con esa potencia (%) y ese acoplamiento. */
  function aguaConPotencia(potenciaPct, acoplamiento) {
    return constantes.temperaturaAmbienteC + constantes.subidaCalentadorC * potenciaPct / 100 / (1 + acoplamiento);
  }

  /** Potencia (%) que mantiene el agua caliente en t2C con ese acoplamiento (inversa de aguaConPotencia). */
  function potenciaParaAgua(t2C, acoplamiento) {
    return (t2C - constantes.temperaturaAmbienteC) * (1 + acoplamiento) / constantes.subidaCalentadorC * 100;
  }

  /** Temperatura del producto tras el intercambio con el agua (entrada por defecto: ambiente). */
  function productoConAgua(aguaC, eficiencia, entradaC = constantes.temperaturaAmbienteC) {
    return entradaC + (aguaC - entradaC) * eficiencia;
  }

  /** Agua caliente necesaria para que el producto salga a t1C (inversa de productoConAgua). */
  function aguaParaProducto(t1C, eficiencia) {
    const ambiente = constantes.temperaturaAmbienteC;
    return ambiente + (t1C - ambiente) / eficiencia;
  }

  function avanzarAguaCaliente(estado, segundosPaso) {
    const ambiente = constantes.temperaturaAmbienteC;
    // Las dos resistencias de 120 V van en serie (una sola a 230 V), por ráfagas de 50 ciclos: R % = R/100 de los ciclos.
    const fraccionPotencia = estado.salidas.RES ? matematicas.limitar(estado.consignas.potenciaPct / 100, 0, 1) : 0;
    const objetivoAgua = ambiente + constantes.subidaCalentadorC * fraccionPotencia;
    const temperaturaObjetivo = estado.temperaturaCorte ? ambiente : objetivoAgua;
    const tau = estado.temperaturaCorte ? constantes.constanteCorteS : (fraccionPotencia ? constantes.constanteCalentadorS : constantes.constanteEnfriamientoS);
    // El producto en circulación le quita calor al agua caliente: con caudal, T2 baja y se mueve algo más deprisa.
    const acoplamiento = factorAcoplamiento(estado.salidas.N2, estado.consignas.velocidadN1Pct, estado.caudalProductoMlMin / constantes.caudalMaxN1MlMin);
    const objetivoEfectivo = ambiente + (temperaturaObjetivo - ambiente) / (1 + acoplamiento);
    estado.aguaCalienteC += (objetivoEfectivo - estado.aguaCalienteC) * (1 - Math.exp(-segundosPaso * (1 + acoplamiento) / tau));
    estado.aguaCalienteC = matematicas.limitar(estado.aguaCalienteC, ambiente, 97);
  }

  // Termostato con histéresis; simulado, no sistema certificado de protección.
  function revisarTermostato(estado) {
    if (!estado.temperaturaCorte && estado.aguaCalienteC >= constantes.limiteTermicoC - constantes.margenDisparoC) {
      estado.temperaturaCorte = true;
      estado.salidas.RES = false;
    }
    if (estado.temperaturaCorte && estado.aguaCalienteC <= constantes.temperaturaRearmeC) estado.temperaturaCorte = false;
  }

  function avanzarProductoCirculando(estado, segundosPaso, entrada) {
    const sol = estado.salidas;
    const eficiencia = sol.N2 ? eficienciaPorCaudal(estado.consignas.velocidadN1Pct) : 0.08;
    const objetivoProducto = productoConAgua(estado.aguaCalienteC, eficiencia, entrada);
    // T4 es el producto que sale de la sección de calentamiento; T1 llega después por el tubo de residencia.
    estado.t4C = matematicas.acercarExponencial(estado.t4C, objetivoProducto, segundosPaso, 8);
    estado.t1C = matematicas.acercarExponencial(estado.t1C, objetivoProducto, segundosPaso, 20);
    const recuperacion = 0.22 * (estado.t1C - entrada);
    const enfriamiento = sol.SOL3 ? 0.77 : 0.09;
    const objetivoSalida = entrada + (estado.t1C - entrada - recuperacion) * (1 - enfriamiento);
    estado.t3C = matematicas.acercarExponencial(estado.t3C, objetivoSalida, segundosPaso, 22);
  }

  function enfriarProductoParado(estado, segundosPaso) {
    const ambiente = constantes.temperaturaAmbienteC;
    estado.t1C = matematicas.acercarExponencial(estado.t1C, ambiente, segundosPaso, 320);
    estado.t3C = matematicas.acercarExponencial(estado.t3C, ambiente, segundosPaso, 200);
    estado.t4C = matematicas.acercarExponencial(estado.t4C, ambiente, segundosPaso, 320);
  }

  function avanzarTemperaturasProducto(estado, segundosPaso) {
    const ambiente = constantes.temperaturaAmbienteC;
    if (estado.caudalProductoMlMin > 0) avanzarProductoCirculando(estado, segundosPaso, ambiente);
    else enfriarProductoParado(estado, segundosPaso);
    estado.t4C = matematicas.limitar(estado.t4C, ambiente, 100);
    // T5 está conectada a la sección de calentamiento: producto a mitad de camino entre la entrada y T4 (supuesto)
    estado.t5C = ambiente + (estado.t4C - ambiente) * 0.5;
    estado.t1C = matematicas.limitar(estado.t1C, ambiente, 100);
    estado.t3C = matematicas.limitar(estado.t3C, ambiente, 100);
  }

  const api = { factorAcoplamiento, eficienciaPorCaudal, acoplamientoConCaudal, aguaConPotencia, potenciaParaAgua,
    productoConAgua, aguaParaProducto, avanzarAguaCaliente, revisarTermostato, avanzarTemperaturasProducto };
  if (typeof module !== 'undefined') module.exports = api; else PCT.termica = api;
})();
