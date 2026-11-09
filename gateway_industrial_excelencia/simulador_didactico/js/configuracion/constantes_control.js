(function () {
  const MODOS_REGULACION = Object.freeze([
    { id: 'manual', nombre: 'Manual · potencia fija', detalle: 'El calefactor trabaja a la potencia que eliges, como el ajuste de potencia de la consola. T1 y T2 son resultado.', manual: 'p. 6 y 15' },
    { id: 'onoff', nombre: 'Todo/nada sobre T2', detalle: 'El calefactor se conecta y desconecta (entrada ON/OFF) para mantener T2 alrededor de su consigna, con histéresis.', manual: 'p. 14-15' },
    { id: 'T2', nombre: 'Lazo simple sobre T2', detalle: 'Un lazo (PI, sin término derivativo) ajusta la potencia para mantener la temperatura del agua caliente.', manual: 'p. 6 y 10' },
    { id: 'T1', nombre: 'Lazo simple sobre T1', detalle: 'Un lazo (PI) ajusta la potencia para mantener la temperatura del producto a la salida del tubo de residencia.', manual: 'p. 6 y 10' },
    { id: 'cascada', nombre: 'Cascada T1 → T2', detalle: 'El lazo externo de T1 fija la consigna de T2 y el lazo interno de T2 gobierna la potencia.', manual: 'p. 10' },
    { id: 'multiple', nombre: 'Lazos múltiples · T1 y caudal F1', detalle: 'Un lazo de T1 gobierna el calefactor y otro de F1 gobierna la velocidad de N1.', manual: 'p. 10' },
  ]);

  const FASES = Object.freeze(['reposo', 'arranque', 'precalentamiento', 'produccion', 'lavado', 'parada', 'finalizada', 'alarma']);

  const NOMBRES_FASE = Object.freeze({
    reposo: 'Reposo', arranque: 'Arranque', precalentamiento: 'Precalentamiento', produccion: 'Producción',
    lavado: 'Lavado', parada: 'Parada ordenada', finalizada: 'Finalizada', alarma: 'Alarma',
  });

  const ORDEN_FASES = Object.freeze(['arranque', 'precalentamiento', 'produccion', 'lavado', 'parada']);

  // Los valores por defecto son supuestos didácticos: el manual no da consignas.
  const CONFIG_BASE = Object.freeze({
    modoRegulacion: 'T1',      // ver MODOS_REGULACION
    consignaT1C: 45,           // °C a la salida del tubo de residencia (en todos los modos: mínima para no desviar)
    consignaT2C: 55,           // °C del agua caliente (modo 'T2')
    potenciaManualPct: 90,     // % del calefactor (modo 'manual')
    histeresisT2C: 2,          // banda del modo todo/nada
    consignaF1MlMin: 275,      // ml/min (modo 'multiple')
    toleranciaDesvioC: 2,      // se desvía el producto si T1 < consigna - tolerancia
    histeresisC: 0.5,          // vuelve a producto acabado cuando T1 >= consigna - histeresis
    origen: 'A',               // tanque de alimentación
    caudalPct: 50,             // PWM de N1 en proceso (%)
    volumenObjetivoMl: null,   // opcional: producto acabado tras el que termina la producción
    volumenAgotadoMl: 2,       // la producción sigue hasta que el tanque de origen se agota (≤ este volumen) o el usuario la termina
    segundosEstabilizacion: 30,
    segundosArranque: 5,
    segundosLavado: 120,
    potenciaPrecalentamientoPct: 90,
    potenciaMaxPct: 90,        // no se llega al 100 % para no rozar el corte térmico
    enfriarHastaC: 45,         // N2 sigue en la parada hasta que T2 baje de aquí
    segundosMaxPrecalentamiento: 1200,
    volumenMinimoMl: 200,      // mínimo en el tanque de origen para arrancar
    gananciaP: 2, gananciaI: 0.01,                 // corrección PI sobre la potencia (además de la acción directa)
    gananciaPExterna: 1, gananciaIExterna: 0.002,  // lazo externo de la cascada (T1 -> consigna de T2)
    consignaT2MaxC: 65,        // tope de la consigna de T2 (el termostato real salta a 70 °C)
  });

  // Modo demostración: caudales que prueba la secuencia de mayor a menor y margen sobre la consigna.
  const CAUDALES_DEMO = [50, 45, 40, 35, 30, 25, 20];
  const MARGEN_DEMO = 2;     // °C que debe poder superar el modelo para que la consigna sea alcanzable

  const api = { CONFIG_BASE, MODOS_REGULACION, FASES, NOMBRES_FASE, ORDEN_FASES, CAUDALES_DEMO, MARGEN_DEMO };
  if (typeof module !== 'undefined') module.exports = api; else PCT.constantesControl = api;
})();
