(function () {
  const constantesControl = typeof require !== 'undefined' ? require('../configuracion/constantes_control.js') : PCT.constantesControl;

  function registrarEvento(secuencia, estado, mensaje) {
    secuencia.eventos.push({ tiempo: estado.tiempo, mensaje });
  }

  function cambiarFase(secuencia, estado, fase, motivo) {
    secuencia.fase = fase;
    secuencia.segundosFase = 0;
    secuencia.segundosEstable = 0;
    secuencia.motivo = motivo || '';
    registrarEvento(secuencia, estado, `Fase: ${constantesControl.NOMBRES_FASE[fase]}${motivo ? ' · ' + motivo : ''}`);
  }

  // Acción de seguridad inmediata: sin calentamiento ni producto; N2 sigue para enfriar el agua.
  function dispararAlarma(secuencia, estado, causa, accion) {
    secuencia.alarma = { causa, accion };
    estado.salidas.RES = false;
    estado.consignas.potenciaPct = 0;
    estado.salidas.N1 = false; estado.salidas.SOL1 = true; estado.salidas.SOL3 = false;
    cambiarFase(secuencia, estado, 'alarma', causa);
  }

  /** Reconoce la alarma: si quedaba proceso en marcha pasa a parada ordenada; tras emergencia, a reposo. */
  function reconocer(secuencia, estado) {
    if (secuencia.fase !== 'alarma') return;
    const eraEmergencia = secuencia.alarma && secuencia.alarma.causa === 'Parada de emergencia';
    secuencia.alarma = null;
    cambiarFase(secuencia, estado, eraEmergencia ? 'reposo' : 'parada', 'alarma reconocida');
  }

  const api = { registrarEvento, cambiarFase, dispararAlarma, reconocer };
  if (typeof module !== 'undefined') module.exports = api; else PCT.alarmas = api;
})();
