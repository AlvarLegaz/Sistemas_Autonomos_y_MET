// Calidad de los lazos 4-20 mA (criterio NAMUR NE43): lo que el PLC sabe de cada entrada analógica. Funciones puras.
//   < 3,6 mA  → ABIERTO (hilo roto o sin alimentación)      > 21 mA → CORTO (sobreescala o cortocircuito)
// Una avería puede fijar la calidad ella misma (p. ej. RUIDO o CONGELADO); un fallo de lazo (ABIERTO/CORTO) siempre manda.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const LIM = layout.LIMITES_LAZO_MA;

  /** Calidad que se deduce solo de los mA: OK, ABIERTO (< 3,6) o CORTO (> 21). */
  function clasificarLazo(mA) {
    if (!(mA >= LIM.hiloRoto)) return 'ABIERTO';        // incluye NaN
    if (mA > LIM.sobreescala) return 'CORTO';
    return 'OK';
  }

  /** Calidad final: la que fija la avería (si es de fallo) o, si no, la de los mA; y si los mA están sanos, la del motor (RUIDO, DERIVA…). */
  function combinarCalidad(calidadAveria, mA) {
    if (calidadAveria === 'ABIERTO' || calidadAveria === 'CORTO' || calidadAveria === 'CONGELADO') return calidadAveria;
    const porMA = clasificarLazo(mA);
    if (porMA !== 'OK') return porMA;
    return calidadAveria || 'OK';
  }

  /** ¿El PLC puede fiarse del valor? Un lazo con ruido o con deriva "parece" sano (la deriva no se detecta sola). */
  const lazoSano = calidad => calidad === 'OK' || calidad === 'RUIDO' || calidad === 'DERIVA';

  /** Valor que interpreta el PLC a partir de los mA (sin limitar: es lo que de verdad lee la tarjeta). */
  const valorPLC = (mA, min, max) => layout.deMilisamperios(mA, min, max);

  /** Número pseudoaleatorio determinista en [-1, 1] a partir de una semilla y un instante (para ruido repetible en las pruebas). */
  function ruido(semilla, tS, canal = 0) {
    let h = (Math.imul(Math.floor(tS * 10) + 1, 374761393) ^ Math.imul(semilla | 0, 668265263) ^ Math.imul(canal + 1, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967295) * 2 - 1;
  }

  const api = { clasificarLazo, combinarCalidad, lazoSano, valorPLC, ruido };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstCalidadSenal = api; }
})();
