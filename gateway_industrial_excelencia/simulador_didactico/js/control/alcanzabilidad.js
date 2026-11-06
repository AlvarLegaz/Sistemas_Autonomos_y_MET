(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const constantesControl = typeof require !== 'undefined' ? require('../configuracion/constantes_control.js') : PCT.constantesControl;
  const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
  const termica = typeof require !== 'undefined' ? require('../modelo/termica.js') : PCT.termica;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;
  const CONFIG_BASE = constantesControl.CONFIG_BASE;

  /** T2 de régimen según el modo: en modo T2/todo-nada es la consigna (si cabe); en los demás, el tope de potencia. */
  function t2Estacionaria(ajustes, t2Maximo, acoplamiento) {
    if (ajustes.modoRegulacion === 'manual') {
      return termica.aguaConPotencia(matematicas.limitar(ajustes.potenciaManualPct, 0, ajustes.potenciaMaxPct), acoplamiento);
    }
    if (ajustes.modoRegulacion === 'T2' || ajustes.modoRegulacion === 'onoff') return Math.min(ajustes.consignaT2C, t2Maximo);
    return t2Maximo;
  }

  /** T1 que el modelo da en régimen con esa configuración (para avisar de consignas imposibles). */
  function t1Estacionaria(ajustes) {
    const caudalPct = ajustes.modoRegulacion === 'multiple'
      ? matematicas.limitar(ajustes.consignaF1MlMin / constantes.caudalMaxN1MlMin * 100, 0, 100)
      : ajustes.caudalPct;
    const eficiencia = termica.eficienciaPorCaudal(caudalPct);
    const acoplamiento = termica.acoplamientoConCaudal(caudalPct);
    const t2Maximo = termica.aguaConPotencia(ajustes.potenciaMaxPct, acoplamiento);
    const t1 = termica.productoConAgua(t2Estacionaria(ajustes, t2Maximo, acoplamiento), eficiencia);
    const conLazoT1 = ['T1', 'cascada', 'multiple'].includes(ajustes.modoRegulacion);
    return conLazoT1 ? Math.min(t1, ajustes.consignaT1C) : t1;
  }

  /** T1 máxima que el modelo puede dar con ese caudal y potencia (para avisar de consignas imposibles). */
  function t1Alcanzable(caudalPct, potenciaPct) {
    const agua = termica.aguaConPotencia(matematicas.limitar(potenciaPct, 0, 100), termica.acoplamientoConCaudal(caudalPct));
    return termica.productoConAgua(agua, termica.eficienciaPorCaudal(matematicas.limitar(caudalPct, 0, 100)));
  }

  // Modo demostración: el usuario solo marca la temperatura de T1; el resto lo decide la secuencia.
  function t1MaximaDemostracion() {
    const caudales = constantesControl.CAUDALES_DEMO;
    const caudalMinimo = caudales[caudales.length - 1];
    return Math.floor(t1Alcanzable(caudalMinimo, CONFIG_BASE.potenciaMaxPct) - constantesControl.MARGEN_DEMO);
  }

  function configDemostracion(temperaturaC, origen) {
    const caudales = constantesControl.CAUDALES_DEMO;
    const margen = constantesControl.MARGEN_DEMO;
    const t = matematicas.limitar(Number(temperaturaC) || 0, 30, t1MaximaDemostracion());
    const caudal = caudales.find(candidato => t1Alcanzable(candidato, CONFIG_BASE.potenciaMaxPct) >= t + margen) || caudales[caudales.length - 1];
    return { modoRegulacion: 'cascada', origen: origen === 'B' ? 'B' : 'A', consignaT1C: t, caudalPct: caudal };
  }

  const api = { t1Estacionaria, t1Alcanzable, t1MaximaDemostracion, configDemostracion };
  if (typeof module !== 'undefined') module.exports = api; else PCT.alcanzabilidad = api;
})();
