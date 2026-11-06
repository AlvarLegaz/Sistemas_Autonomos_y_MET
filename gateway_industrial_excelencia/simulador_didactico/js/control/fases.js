(function () {
  const alarmas = typeof require !== 'undefined' ? require('./alarmas.js') : PCT.alarmas;
  const regulacion = typeof require !== 'undefined' ? require('./regulacion.js') : PCT.regulacion;

  function volumenOrigen(estado, secuencia) {
    return secuencia.ajustes.origen === 'B' ? estado.depositoBMl : estado.depositoAMl;
  }

  function fijarSalidasComunes(secuencia, estado) {
    estado.salidas.SOL2 = secuencia.ajustes.origen === 'B';
    estado.salidas.SOL4 = false; estado.salidas.SOL5 = false;
    estado.giro.N1 = false; estado.giro.N2 = false;
    estado.consignas.velocidadN2Pct = 100;
  }

  function controlarArranque(secuencia, estado) {
    const ajustes = secuencia.ajustes;
    estado.salidas.N2 = true; estado.salidas.RES = true;
    estado.consignas.potenciaPct = ajustes.potenciaPrecalentamientoPct;
    estado.salidas.N1 = false; estado.salidas.SOL1 = true; estado.salidas.SOL3 = false;
    if (secuencia.segundosFase >= ajustes.segundosArranque) {
      alarmas.cambiarFase(secuencia, estado, 'precalentamiento', 'N2 y calefactor en marcha');
    }
  }

  function controlarPrecalentamiento(secuencia, estado, segundosPaso) {
    const ajustes = secuencia.ajustes;
    estado.salidas.N2 = true;
    regulacion.regular(secuencia, estado, segundosPaso, 'precalentamiento');
    estado.salidas.SOL1 = true;          // producto rechazado: recircula al tanque
    estado.salidas.SOL3 = true;          // el agua fría ya circula
    secuencia.segundosEstable = estado.t1C >= ajustes.consignaT1C - 1 ? secuencia.segundosEstable + segundosPaso : 0;
    if (secuencia.segundosEstable >= ajustes.segundosEstabilizacion) {
      secuencia.finalInicialMl = estado.finalMl; secuencia.desviando = true; secuencia.segundosEnBanda = 0;
      if (ajustes.modoRegulacion === 'T1' || ajustes.modoRegulacion === 'multiple') secuencia.integralLazoT1 = 0;
      alarmas.cambiarFase(secuencia, estado, 'produccion', `T1 = ${estado.t1C.toFixed(1)} °C`);
    } else if (secuencia.segundosFase >= ajustes.segundosMaxPrecalentamiento) {
      alarmas.dispararAlarma(secuencia, estado,
        `T1 no alcanza ${ajustes.consignaT1C} °C en ${Math.round(ajustes.segundosMaxPrecalentamiento / 60)} min`,
        'Bajar la consigna o el caudal; el modelo no llega a esa temperatura');
    }
  }

  // Desvía en cuanto T1 baja de la tolerancia; para volver a la salida normal exige T1 en banda segundosEstabilizacion seguidos.
  function decidirDesvio(secuencia, estado, segundosPaso) {
    const ajustes = secuencia.ajustes;
    secuencia.segundosEnBanda = estado.t1C >= ajustes.consignaT1C - ajustes.histeresisC ? secuencia.segundosEnBanda + segundosPaso : 0;
    if (estado.t1C < ajustes.consignaT1C - ajustes.toleranciaDesvioC) secuencia.desviando = true;
    else if (secuencia.desviando && secuencia.segundosEnBanda >= ajustes.segundosEstabilizacion) secuencia.desviando = false;
    if (secuencia.desviando !== estado.salidas.SOL1) {
      const t1 = estado.t1C.toFixed(1);
      alarmas.registrarEvento(secuencia, estado, secuencia.desviando
        ? `Producto desviado (T1 = ${t1} °C)`
        : `Producto a temperatura: salida normal (T1 = ${t1} °C)`);
    }
    estado.salidas.SOL1 = secuencia.desviando;
    if (secuencia.desviando) secuencia.tiempoDesvioS += segundosPaso;
  }

  function controlarProduccion(secuencia, estado, segundosPaso) {
    const ajustes = secuencia.ajustes;
    estado.salidas.N2 = true;
    regulacion.regular(secuencia, estado, segundosPaso, 'produccion');
    estado.salidas.SOL3 = true;
    decidirDesvio(secuencia, estado, segundosPaso);
    const producido = estado.finalMl - secuencia.finalInicialMl;
    if (ajustes.volumenObjetivoMl != null && producido >= ajustes.volumenObjetivoMl) {
      alarmas.cambiarFase(secuencia, estado, 'lavado', `producción de referencia alcanzada: ${Math.round(producido)} ml de producto acabado`);
    } else if (volumenOrigen(estado, secuencia) <= ajustes.volumenAgotadoMl) {
      alarmas.cambiarFase(secuencia, estado, 'lavado', `tanque ${ajustes.origen} agotado · ${Math.round(producido)} ml de producto acabado`);
    }
  }

  function controlarLavado(secuencia, estado) {
    // Simplificación: el modelo no tiene otro fluido; se recircula con agua caliente y SOL1 activa.
    const ajustes = secuencia.ajustes;
    estado.salidas.N2 = true; estado.salidas.RES = true; estado.consignas.potenciaPct = 50;
    estado.salidas.N1 = true; estado.consignas.velocidadN1Pct = 100;
    estado.salidas.SOL1 = true; estado.salidas.SOL3 = false;
    if (secuencia.segundosFase >= ajustes.segundosLavado) alarmas.cambiarFase(secuencia, estado, 'parada', 'lavado terminado');
  }

  function controlarParada(secuencia, estado) {
    const ajustes = secuencia.ajustes;
    estado.salidas.RES = false; estado.consignas.potenciaPct = 0;
    estado.salidas.N1 = false; estado.salidas.SOL1 = false; estado.salidas.SOL3 = false;
    estado.salidas.N2 = estado.aguaCalienteC > ajustes.enfriarHastaC;   // N2 enfría el calefactor
    if (!estado.salidas.N2) {
      alarmas.cambiarFase(secuencia, estado, 'finalizada', `T2 = ${estado.aguaCalienteC.toFixed(1)} °C`);
    }
  }

  // Protecciones comunes a todas las fases con proceso. Devuelve true si disparó una alarma.
  function hayProteccion(secuencia, estado) {
    const ajustes = secuencia.ajustes;
    if (estado.temperaturaCorte) {
      alarmas.dispararAlarma(secuencia, estado, 'Corte térmico (sobretemperatura del agua caliente)', 'Dejar enfriar T2; reconocer la alarma y repetir el arranque');
      return true;
    }
    if (estado.vacio && secuencia.fase !== 'lavado') {
      alarmas.dispararAlarma(secuencia, estado, `Tanque ${ajustes.origen} vacío: N1 sin producto`, `Rellenar el tanque (SOL${ajustes.origen === 'A' ? 4 : 5}) y reconocer la alarma`);
      return true;
    }
    return false;
  }

  /** Decide los actuadores de este instante (se llama antes de avanzar el modelo). */
  function controlar(secuencia, estado, segundosPaso) {
    if (['reposo', 'finalizada', 'alarma'].includes(secuencia.fase)) {
      if (secuencia.fase === 'alarma') { estado.salidas.RES = false; estado.consignas.potenciaPct = 0; }
      return;
    }
    if (secuencia.fase !== 'parada' && hayProteccion(secuencia, estado)) return;
    fijarSalidasComunes(secuencia, estado);
    switch (secuencia.fase) {
      case 'arranque': controlarArranque(secuencia, estado); break;
      case 'precalentamiento': controlarPrecalentamiento(secuencia, estado, segundosPaso); break;
      case 'produccion': controlarProduccion(secuencia, estado, segundosPaso); break;
      case 'lavado': controlarLavado(secuencia, estado); break;
      case 'parada': controlarParada(secuencia, estado); break;
    }
  }

  const api = { controlar, controlarArranque, controlarPrecalentamiento, controlarProduccion, controlarLavado, controlarParada, fijarSalidasComunes, volumenOrigen };
  if (typeof module !== 'undefined') module.exports = api; else PCT.fases = api;
})();
