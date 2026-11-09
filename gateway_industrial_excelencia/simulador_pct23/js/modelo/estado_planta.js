(function () {
  const constantesFisicas = typeof require !== 'undefined' ? require('../configuracion/constantes_fisicas.js') : PCT.constantesFisicas;
  const matematicas = typeof require !== 'undefined' ? require('../utilidades/matematicas.js') : PCT.matematicas;
  const constantes = constantesFisicas.CONSTANTES_FISICAS;
  const SALIDAS = constantesFisicas.SALIDAS;

  function crearEstado() {
    const ambiente = constantes.temperaturaAmbienteC;
    return {
      tiempo: 0, ejecutando: false, velocidad: 1,
      salidas: Object.fromEntries(SALIDAS.map(id => [id, false])),
      valvulaV3: false,
      giro: { N1: false, N2: false },
      consignas: { potenciaPct: 100, velocidadN1Pct: 100, velocidadN2Pct: 100 },
      depositoAMl: 1760, depositoBMl: 1270, aguaCalienteC: ambiente,
      t1C: ambiente, t3C: ambiente, t4C: ambiente, t5C: ambiente,
      caudalProductoMlMin: 0, caudalFrioMlMin: 0,
      finalMl: 0, desviadoMl: 0, desagueMl: 0,
      temperaturaCorte: false, vacio: false,
    };
  }

  function activarEjemplo(estado) {
    estado.salidas.N1 = true;
    estado.salidas.N2 = true;
    estado.salidas.SOL3 = true;
    estado.salidas.SOL2 = false; // Alimentación desde A en este modelo.
    estado.salidas.SOL1 = false; // Salida de producto final.
    estado.giro.N1 = false; estado.giro.N2 = false;
    estado.salidas.RES = true;
    estado.consignas.velocidadN1Pct = 60;
    estado.consignas.potenciaPct = 75;
    estado.consignas.velocidadN2Pct = 60;
    return estado;
  }

  function ponerLlenado(estado, deposito, porcentaje) {
    const ml = matematicas.limitar(Number(porcentaje) || 0, 0, 100) / 100 * constantes.capacidadDepositoMl;
    if (deposito === 'B') estado.depositoBMl = ml; else estado.depositoAMl = ml;
    return estado;
  }

  function porcentajeLlenado(estado, deposito) {
    const ml = deposito === 'B' ? estado.depositoBMl : estado.depositoAMl;
    return ml / constantes.capacidadDepositoMl * 100;
  }

  const api = { crearEstado, activarEjemplo, ponerLlenado, porcentajeLlenado };
  if (typeof module !== 'undefined') module.exports = api; else PCT.estadoPlanta = api;
})();
