// Núcleo común · registro de órdenes por número de paso y repetición (contrato §2.10 y §3.3).
//   crearRegistro({ simulador, versionContrato, semilla, escenario, pasoFijoS }) → { apuntar(paso, orden), exportar(pasos), ordenes(), cuantas() }
//   repetir(registro, crearSimulacion) → Simulacion: la misma sesión rehecha solo con la API pública (así la prueba de contrato la puede escribir igual).
(function () {
  'use strict';
  const enNode = typeof require !== 'undefined';
  const { clonar, clonarCongelado } = enNode ? require('./congelar.js') : window.PCT.nucleo;
  const PASOS_MAX = 36000;

  function crearRegistro({ simulador, versionContrato = 1, semilla, escenario = null, pasoFijoS }) {
    const lista = [];
    const esc = escenario == null ? null : clonarCongelado(escenario);
    return {
      /** Apunta una orden ejecutada con ok:true (se guarda una copia congelada, tal cual llegó). */
      apuntar(paso, orden) { lista.push(Object.freeze({ paso, orden: clonarCongelado(orden) })); },
      /** Registro del contrato: copia nueva cada vez. */
      exportar(pasos) {
        return { simulador, versionContrato, semilla, escenario: clonar(esc), pasoFijoS, pasos, ordenes: lista.map(e => ({ paso: e.paso, orden: clonar(e.orden) })) };
      },
      ordenes: () => lista,
      cuantas: () => lista.length,
    };
  }

  const fallo = (codigo, texto) => Object.assign(new Error(texto || codigo), { codigo });

  /** Avanza `n` pasos en tramos de 36 000 como mucho (el contrato limita cada llamada). */
  function darPasos(s, n) {
    let falta = n;
    while (falta > 0) {
      const k = Math.min(PASOS_MAX, falta);
      const r = s.avanzarPasos(k);
      if (!r || !r.ok) throw fallo('registro_inconsistente', `avanzarPasos(${k}) devolvió ${r && r.motivo}`);
      falta -= k;
    }
  }

  function repetir(r, crear) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.ordenes)) throw fallo('registro_incompatible', 'Registro mal formado');
    const s = crear({ semilla: r.semilla, escenario: r.escenario == null ? undefined : r.escenario });
    if (s.pasoFijoS !== r.pasoFijoS || s.id !== r.simulador || s.versionContrato !== r.versionContrato) throw fallo('registro_incompatible');
    for (const { paso, orden } of r.ordenes) {
      const falta = paso - s.tiempo().pasos;
      if (!Number.isInteger(falta) || falta < 0) throw fallo('registro_inconsistente', `paso ${paso} fuera de orden`);
      darPasos(s, falta);
      const res = s.ejecutar(orden);
      if (!res || !res.ok) throw fallo('registro_inconsistente', `la orden ${orden && orden.tipo} del paso ${paso} devolvió ${res && res.motivo}`);
    }
    const falta = r.pasos - s.tiempo().pasos;
    if (!Number.isInteger(falta) || falta < 0) throw fallo('registro_inconsistente', 'pasos finales');
    darPasos(s, falta);
    return s;
  }

  const api = { crearRegistro, repetir };
  if (enNode && typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    const P = (window.PCT = window.PCT || {});
    P.nucleo = Object.assign(P.nucleo || {}, api);
    P.contrato = Object.assign(P.contrato || {}, { repetir });
  }
})();
