// Núcleo común · copias y congelado de datos (contrato §2.3, §2.10, §6). Sin dependencias. Doble export: module.exports / PCT.nucleo.
//   clonar(x)            copia profunda de datos planos (objetos, listas y primitivos; conserva Infinity; descarta funciones y undefined)
//   congelar(x)          Object.freeze recursivo (todo objeto alcanzable queda congelado)
//   clonarCongelado(x)   copia nueva y congelada en profundidad (lo que devuelve estado() y lo que llevan los eventos)
//   esObjetoPlano(x)     objeto literal (no lista, no null, prototipo Object o null)
(function () {
  'use strict';

  const esObjetoPlano = x => {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) return false;
    const p = Object.getPrototypeOf(x);
    return p === Object.prototype || p === null;
  };

  function clonar(x) {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) { const a = new Array(x.length); for (let i = 0; i < x.length; i++) { const v = x[i]; a[i] = typeof v === 'function' ? null : clonar(v); } return a; }
    const o = {};
    for (const k of Object.keys(x)) { const v = x[k]; if (v !== undefined && typeof v !== 'function') o[k] = clonar(v); }
    return o;
  }

  function congelar(x, vistos) {
    if (x === null || typeof x !== 'object') return x;
    const v = vistos || new Set();
    if (v.has(x)) return x;
    v.add(x);
    Object.freeze(x);
    for (const k of Object.keys(x)) congelar(x[k], v);
    return x;
  }

  /** Copia y congela a la vez (más rápido que clonar + congelar: el resultado es un árbol nuevo, sin ciclos). */
  function clonarCongelado(x) {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) { const a = new Array(x.length); for (let i = 0; i < x.length; i++) { const v = x[i]; a[i] = typeof v === 'function' ? null : clonarCongelado(v); } return Object.freeze(a); }
    const o = {};
    for (const k of Object.keys(x)) { const v = x[k]; if (v !== undefined && typeof v !== 'function') o[k] = clonarCongelado(v); }
    return Object.freeze(o);
  }

  const api = { esObjetoPlano, clonar, congelar, clonarCongelado };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); P.nucleo = Object.assign(P.nucleo || {}, api); }
})();
