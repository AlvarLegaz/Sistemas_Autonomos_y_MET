(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const constantesControl = typeof require !== 'undefined' ? require('../configuracion/constantes_control.js') : PCT.constantesControl;
  const planta = typeof require !== 'undefined' ? require('../modelo/planta.js') : PCT.planta;
  const alarmas = typeof require !== 'undefined' ? require('./alarmas.js') : PCT.alarmas;
  const fases = typeof require !== 'undefined' ? require('./fases.js') : PCT.fases;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;

  function crearSecuencia(ajustes) {
    return {
      fase: 'reposo', segundosFase: 0, segundosTotal: 0,
      ajustes: Object.assign({}, constantesControl.CONFIG_BASE, ajustes || {}),
      integralLazoT1: 0, integralCascada: 0, integralInterna: 0, integralF1: 0,
      segundosEnBanda: 0, resistenciaActiva: true, consignaT2Activa: null,
      desviando: true, segundosEstable: 0, finalInicialMl: 0, tiempoDesvioS: 0,
      alarma: null, motivo: '', eventos: [],
    };
  }

  function apagarTodo(estado) {
    for (const id of constantesFisicas.SALIDAS) estado.salidas[id] = false;
    estado.giro.N1 = false; estado.giro.N2 = false;
  }

  /** Producción de referencia máxima: lo que hay ahora en el tanque de origen (nunca más que su capacidad). */
  function referenciaMaxima(estado, origen) {
    const volumen = origen === 'B' ? estado.depositoBMl : estado.depositoAMl;
    return Math.floor(Math.min(volumen, constantes.capacidadDepositoMl));
  }

  function reiniciarControl(secuencia) {
    secuencia.alarma = null;
    secuencia.integralLazoT1 = 0; secuencia.integralCascada = 0; secuencia.integralInterna = 0; secuencia.integralF1 = 0;
    secuencia.segundosEnBanda = 0; secuencia.resistenciaActiva = true; secuencia.consignaT2Activa = null;
    secuencia.segundosTotal = 0; secuencia.tiempoDesvioS = 0; secuencia.desviando = true;
  }

  // La producción de referencia no puede superar lo que hay en el tanque de origen.
  function limitarVolumenObjetivo(secuencia, estado) {
    const ajustes = secuencia.ajustes;
    const maxRef = referenciaMaxima(estado, ajustes.origen);
    if (ajustes.volumenObjetivoMl != null && ajustes.volumenObjetivoMl > maxRef) {
      alarmas.registrarEvento(secuencia, estado, `Producción de referencia limitada a ${maxRef} ml (lo que hay en el tanque ${ajustes.origen})`);
      ajustes.volumenObjetivoMl = maxRef;
    }
  }

  /** Pone en marcha la secuencia. Devuelve false (y deja alarma) si no se dan las condiciones. */
  function iniciar(secuencia, estado) {
    if (!['reposo', 'finalizada'].includes(secuencia.fase)) return false;
    const ajustes = secuencia.ajustes;
    reiniciarControl(secuencia);
    if (estado.temperaturaCorte) {
      alarmas.dispararAlarma(secuencia, estado, 'Corte térmico activo: no se puede arrancar', 'Esperar a que T2 baje y reconocer la alarma');
      return false;
    }
    if (fases.volumenOrigen(estado, secuencia) < ajustes.volumenMinimoMl) {
      alarmas.dispararAlarma(secuencia, estado, `Tanque ${ajustes.origen} casi vacío`, `Rellenar el tanque (SOL${ajustes.origen === 'A' ? 4 : 5}) o cambiar de origen`);
      return false;
    }
    limitarVolumenObjetivo(secuencia, estado);
    alarmas.cambiarFase(secuencia, estado, 'arranque');
    return true;
  }

  function ordenarParada(secuencia, estado) {
    if (['arranque', 'precalentamiento', 'produccion', 'lavado'].includes(secuencia.fase)) {
      alarmas.cambiarFase(secuencia, estado, 'parada', 'solicitada');
    }
  }

  function emergencia(secuencia, estado) {
    apagarTodo(estado);
    estado.consignas.potenciaPct = 0;
    secuencia.alarma = { causa: 'Parada de emergencia', accion: 'Revisar la planta y reconocer la alarma' };
    alarmas.cambiarFase(secuencia, estado, 'alarma', 'emergencia');
  }

  function terminarProduccion(secuencia, estado) {
    if (secuencia.fase === 'produccion') alarmas.cambiarFase(secuencia, estado, 'lavado', 'producción terminada a mano');
  }

  function saltarFase(secuencia, estado) {
    const i = constantesControl.ORDEN_FASES.indexOf(secuencia.fase);
    if (i >= 0 && i < constantesControl.ORDEN_FASES.length - 1) {
      alarmas.cambiarFase(secuencia, estado, constantesControl.ORDEN_FASES[i + 1], 'forzado');
    }
  }

  /** Un paso completo: controla, avanza el modelo y cuenta el tiempo. */
  function paso(secuencia, estado, segundosPaso) {
    fases.controlar(secuencia, estado, segundosPaso);
    planta.avanzar(estado, segundosPaso);
    if (!['reposo', 'finalizada', 'alarma'].includes(secuencia.fase)) {
      secuencia.segundosFase += segundosPaso;
      secuencia.segundosTotal += segundosPaso;
    }
  }

  const api = { crearSecuencia, iniciar, ordenarParada, emergencia, terminarProduccion, saltarFase, paso,
    cambiarFase: alarmas.cambiarFase, registrarEvento: alarmas.registrarEvento, apagarTodo, volumenOrigen: fases.volumenOrigen, referenciaMaxima };
  if (typeof module !== 'undefined') module.exports = api; else PCT.secuencia = api;
})();
