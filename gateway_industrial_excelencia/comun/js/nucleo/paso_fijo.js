// Núcleo común · acumulador de paso fijo (contrato §2.2 y §3). El modelo avanza SIEMPRE en pasos de `pasoFijoS`; la interfaz pide segundos y el acumulador
// le dice cuántos pasos caben. Así el resultado no depende de cómo se trocee el tiempo (avanzar(0,1)×10 ≡ avanzar(1)).
//   crearAcumulador(pasoFijoS, límites?) → { pasoFijoS, validarDt(dt), validarPasos(n), cuantos(dt), contar(k), tiempo(), fijar(pasos, restoS), reiniciar() }
//   cuantos(dt) suma dt al resto y devuelve los pasos que caben (el llamador los da y luego llama a contar(k)).
(function () {
  'use strict';
  const LIMITES = { DT_MAX_S: 3600, EPS_PASO_S: 1e-9, PASOS_MAX_POR_LLAMADA: 36000 };

  function crearAcumulador(pasoFijoS, limites) {
    if (!(typeof pasoFijoS === 'number' && pasoFijoS > 0 && Number.isFinite(pasoFijoS))) throw new Error('paso_fijo_invalido');
    const L = Object.assign({}, LIMITES, limites || {});
    let pasos = 0, resto = 0;
    return {
      pasoFijoS,
      /** null si dt vale; si no, el motivo del contrato ('dt_invalido' | 'dt_excesivo'). */
      validarDt(dt) {
        if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) return 'dt_invalido';
        if (dt > L.DT_MAX_S) return 'dt_excesivo';
        return null;
      },
      validarPasos(n) { return Number.isInteger(n) && n >= 0 && n <= L.PASOS_MAX_POR_LLAMADA ? null : 'pasos_invalidos'; },
      /** Acumula dt y devuelve cuántos pasos fijos caben ahora (ya descontados del resto). */
      cuantos(dt) {
        if (dt === 0) return 0;
        resto += dt;
        let k = 0;
        while (resto >= pasoFijoS - L.EPS_PASO_S) { resto -= pasoFijoS; k++; }
        if (resto < 0) resto = 0;
        return k;
      },
      contar(k) { pasos += k; },
      pasos: () => pasos,
      tiempo: () => ({ pasos, tS: pasos * pasoFijoS, restoS: resto }),
      fijar(p, r) { pasos = p; resto = r; },
      reiniciar() { pasos = 0; resto = 0; },
    };
  }

  const api = { crearAcumulador, LIMITES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); P.nucleo = Object.assign(P.nucleo || {}, api); }
})();
