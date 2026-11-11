// Física térmica de la planta HTST: intercambiador de placas por secciones, agua caliente, termostato de seguridad y variador. Funciones puras.
// Modelo por efectividades (ε-NTU simplificado): cada sección recupera una fracción de la diferencia máxima de temperatura.
(function () {
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : PCT.htstConstantes;
  const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

  /** Acerca `actual` a `objetivo` con una constante de tiempo tauS (respuesta de primer orden, estable para cualquier dt). */
  const acercar = (actual, objetivo, dt, tauS) => objetivo + (actual - objetivo) * Math.exp(-dt / Math.max(tauS, 1e-6));

  /** La efectividad baja un poco con el caudal (menos tiempo de contacto). */
  const efectividad = (ef, caudalLh, caudalMaxLh) => ef * (1 - 0.04 * limitar(caudalLh / caudalMaxLh, 0, 1));

  /**
   * Temperaturas objetivo del producto en régimen, a partir de:
   *   entradaC (leche cruda), aguaC (agua caliente), salidaTuboC (temperatura del producto pasteurizado que vuelve a la regeneración),
   *   caudalLh, hayAvance (la FDV deja pasar el producto caliente por el lado pasteurizado de la regeneración), aguaFria (XV-301 abierta).
   * Devuelve { t102 (crudo tras la regeneración), tCalentamiento (salida del calentamiento = entrada al tubo), tTrasRegeneracionPas, t104 (salida) }.
   */
  function objetivosProducto({ entradaC, aguaC, salidaTuboC, caudalLh, hayAvance, aguaFria }) {
    const I = C.intercambiador, qMax = C.p101.caudalMaximoLh;
    if (caudalLh < 1) {            // producto quieto: se relaja despacio hacia el agua (calentamiento) o hacia el ambiente (el resto)
      return { t102: entradaC, tCalentamiento: entradaC + 0.5 * (aguaC - entradaC), tTrasRegeneracionPas: entradaC, t104: entradaC };
    }
    const efReg = efectividad(I.efRegeneracion, caudalLh, qMax);
    const t102 = hayAvance ? entradaC + efReg * (salidaTuboC - entradaC) : entradaC;      // sin avance no llega producto caliente a la regeneración
    const tCalentamiento = t102 + efectividad(I.efCalentamiento, caudalLh, qMax) * (aguaC - t102);
    const tTrasRegeneracionPas = hayAvance ? salidaTuboC - efReg * (salidaTuboC - entradaC) : entradaC;
    const ef = aguaFria ? I.efEnfriamiento : I.efEnfriamientoSinAgua;
    const t104 = tTrasRegeneracionPas - ef * (tTrasRegeneracionPas - I.temperaturaAguaFriaC);
    return { t102, tCalentamiento, tTrasRegeneracionPas, t104 };
  }

  /** Potencia (kW) que el agua caliente cede a la leche en el calentamiento: ṁ·c·ΔT. */
  function potenciaALeche(caudalLh, tEntradaC, tSalidaC) {
    const kgPorS = caudalLh * C.leche.densidadKgL / 3600;
    return kgPorS * C.leche.calorEspecificoKJkgK * Math.max(0, tSalidaC - tEntradaC);
  }

  /** Un paso del depósito de agua caliente: calentadores - leche - pérdidas al ambiente. Devuelve la nueva temperatura.
   *  volumenL (opcional): el agua que hay de verdad; con menos agua la inercia es menor (se calienta y se enfría más deprisa). */
  function pasoAguaCaliente(aguaC, { potenciaKW, perdidaLecheKW, dt, volumenL }) {
    const A = C.aguaCaliente;
    const volumen = volumenL == null ? A.volumenL : Math.max(volumenL, A.volumenMinimoInerciaL);
    const perdidaAmbienteKW = A.perdidasWK * (aguaC - A.ambienteC) / 1000 * (volumen / A.capacidadL);   // menos agua, menos superficie mojada
    const capacidadKJK = volumen * A.calorEspecificoKJkgK;
    const nueva = aguaC + (potenciaKW - perdidaLecheKW - perdidaAmbienteKW) * dt / capacidadKJK;
    return limitar(nueva, A.ambienteC, A.maximoFisicoC);
  }

  /**
   * Nivel del depósito de agua caliente tras un paso: llena XV-302 (agua de red fría, que se mezcla y baja la temperatura) y vacía XV-303.
   * Tiene rebosadero: no pasa del 100 %. Devuelve { volumenL, temperaturaC }.
   */
  function pasoNivelAguaCaliente(volumenL, aguaC, { llenando, vaciando, dt }) {
    const A = C.aguaCaliente;
    let v = volumenL, temp = aguaC;
    if (vaciando) v = Math.max(0, v - A.vaciadoXV303Lh * dt / 3600);
    if (llenando) {
      const entra = Math.min(A.llenadoXV302Lh * dt / 3600, A.capacidadL - v);        // lo que sobra rebosa y no se mezcla
      if (entra > 0) { temp = (v * temp + entra * A.temperaturaRedC) / (v + entra); v += entra; }
    }
    return { volumenL: v, temperaturaC: limitar(temp, 0, A.maximoFisicoC) };
  }

  /** Termostato de seguridad TSH-101 (NC): dispara a 90 °C y solo se rearma, a mano, por debajo de 80 °C. Devuelve el nuevo estado `abierto`. */
  function pasoTermostato(abierto, aguaC, rearmar) {
    const A = C.aguaCaliente;
    if (!abierto) return aguaC >= A.tshDisparoC;
    return !(rearmar && aguaC <= A.tshRearmeC);
  }

  /** Temperatura del disipador del variador: depende de la corriente y del ventilador (parado = se calienta hasta unos 95 °C). */
  function pasoDisipadorVariador(tempC, { corrienteA, ventiladorOK, dt }) {
    const V = C.variador;
    const objetivo = ventiladorOK ? V.ambienteC + V.subidaPorCorrienteC * corrienteA : V.ventiladorParadoC;
    return acercar(tempC, objetivo, dt, V.tauS);
  }

  const api = { acercar, efectividad, objetivosProducto, potenciaALeche, pasoAguaCaliente, pasoNivelAguaCaliente, pasoTermostato, pasoDisipadorVariador, limitar };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstFisicaTermica = api; }
})();
