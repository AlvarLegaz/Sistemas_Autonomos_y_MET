(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
  const termica = typeof require !== 'undefined' ? require('../modelo/termica.js') : PCT.termica;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;

  function eficienciaActual(estado) {
    return termica.eficienciaPorCaudal(estado.consignas.velocidadN1Pct);
  }

  // Potencia que mantiene T2 en t2 con el caudal actual: hay que compensar el calor que se lleva el producto.
  function potenciaParaAgua(t2, estado) {
    return termica.potenciaParaAgua(t2, termica.acoplamientoConCaudal(estado.consignas.velocidadN1Pct));
  }

  /** Lazo sobre T2: acción directa (agua necesaria -> potencia) más corrección PI. */
  function lazoT2(secuencia, estado, segundosPaso, consigna) {
    const ajustes = secuencia.ajustes;
    const error = consigna - estado.aguaCalienteC;
    if (Math.abs(error) < 5) secuencia.integralInterna = matematicas.limitar(secuencia.integralInterna + error * segundosPaso, -2000, 2000);
    return matematicas.limitar(potenciaParaAgua(consigna, estado) + ajustes.gananciaP * error + ajustes.gananciaI * secuencia.integralInterna, 0, ajustes.potenciaMaxPct);
  }

  /** Lazo sobre T1 (acción directa + PI sobre la potencia). */
  function lazoT1(secuencia, estado, segundosPaso) {
    const ajustes = secuencia.ajustes;
    const aguaNecesaria = termica.aguaParaProducto(ajustes.consignaT1C, eficienciaActual(estado));
    const error = ajustes.consignaT1C - estado.t1C;
    if (Math.abs(error) < 5) secuencia.integralLazoT1 = matematicas.limitar(secuencia.integralLazoT1 + error * segundosPaso, -2000, 2000);
    return matematicas.limitar(potenciaParaAgua(aguaNecesaria, estado) + ajustes.gananciaP * error + ajustes.gananciaI * secuencia.integralLazoT1, 0, ajustes.potenciaMaxPct);
  }

  /** Cascada: el lazo externo de T1 da la consigna de T2 y el interno la sigue con la potencia. */
  function lazoCascada(secuencia, estado, segundosPaso) {
    const ambiente = constantes.temperaturaAmbienteC;
    const ajustes = secuencia.ajustes;
    const t2Necesaria = termica.aguaParaProducto(ajustes.consignaT1C, eficienciaActual(estado));
    const error = ajustes.consignaT1C - estado.t1C;
    if (Math.abs(error) < 5) secuencia.integralCascada = matematicas.limitar(secuencia.integralCascada + error * segundosPaso, -5000, 5000);
    const consignaCalculada = t2Necesaria + ajustes.gananciaPExterna * error + ajustes.gananciaIExterna * secuencia.integralCascada;
    secuencia.consignaT2Activa = matematicas.limitar(consignaCalculada, ambiente + 5, ajustes.consignaT2MaxC);
    return lazoT2(secuencia, estado, segundosPaso, secuencia.consignaT2Activa);
  }

  /** Lazo de caudal: N1 (PWM) para que F1 siga su consigna (acción directa + PI). */
  function lazoCaudal(secuencia, estado, segundosPaso) {
    const ajustes = secuencia.ajustes;
    const error = ajustes.consignaF1MlMin - estado.caudalProductoMlMin;
    if (Math.abs(error) < 100) secuencia.integralF1 = matematicas.limitar(secuencia.integralF1 + error * segundosPaso, -5000, 5000);
    const directa = ajustes.consignaF1MlMin / constantes.caudalMaxN1MlMin * 100;
    return matematicas.limitar(directa + 0.02 * error + 0.002 * secuencia.integralF1, 10, 100);
  }

  // Conexión ON/OFF con histéresis: potencia fija al tope y la resistencia se conecta y desconecta.
  function lazoTodoNada(secuencia, estado) {
    const ajustes = secuencia.ajustes;
    if (estado.aguaCalienteC <= ajustes.consignaT2C - ajustes.histeresisT2C) secuencia.resistenciaActiva = true;
    else if (estado.aguaCalienteC >= ajustes.consignaT2C + ajustes.histeresisT2C) secuencia.resistenciaActiva = false;
    estado.consignas.potenciaPct = ajustes.potenciaMaxPct;
    estado.salidas.RES = secuencia.resistenciaActiva;
  }

  function aplicarModo(secuencia, estado, segundosPaso, fase) {
    const ajustes = secuencia.ajustes;
    switch (ajustes.modoRegulacion) {
      case 'manual': estado.consignas.potenciaPct = matematicas.limitar(ajustes.potenciaManualPct, 0, ajustes.potenciaMaxPct); break;
      case 'onoff': lazoTodoNada(secuencia, estado); break;
      case 'T2': estado.consignas.potenciaPct = lazoT2(secuencia, estado, segundosPaso, ajustes.consignaT2C); break;
      case 'cascada': estado.consignas.potenciaPct = lazoCascada(secuencia, estado, segundosPaso); break;
      default: // 'T1' y 'multiple'
        estado.consignas.potenciaPct = fase === 'precalentamiento' ? ajustes.potenciaPrecalentamientoPct : lazoT1(secuencia, estado, segundosPaso);
    }
  }

  /** Fija caudal, estado y potencia del calefactor según el modo de regulación elegido. */
  function regular(secuencia, estado, segundosPaso, fase) {
    const ajustes = secuencia.ajustes;
    estado.salidas.N1 = true;
    estado.consignas.velocidadN1Pct = ajustes.modoRegulacion === 'multiple' ? lazoCaudal(secuencia, estado, segundosPaso) : ajustes.caudalPct;
    estado.salidas.RES = true;
    aplicarModo(secuencia, estado, segundosPaso, fase);
    // Protección: el termostato real salta a 70 °C; el control corta la resistencia al llegar al tope y la reconecta 3 °C por debajo.
    const tope = ajustes.consignaT2MaxC;
    if (estado.aguaCalienteC >= tope) secuencia.t2Limitada = true; else if (estado.aguaCalienteC <= tope - 3) secuencia.t2Limitada = false;
    if (secuencia.t2Limitada) estado.salidas.RES = false;
  }

  const api = { regular, lazoT2, lazoT1, lazoCascada, lazoCaudal, lazoTodoNada };
  if (typeof module !== 'undefined') module.exports = api; else PCT.regulacion = api;
})();
