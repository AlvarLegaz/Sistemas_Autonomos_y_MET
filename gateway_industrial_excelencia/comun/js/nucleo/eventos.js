// Núcleo común · emisor de eventos (contrato §2.8 y §6).
//   crearEmisor() → { suscribir(fn) → cancelar(), emitir(evento), cuantos() }
//   · síncrono, en el orden de suscripción; la misma función suscrita dos veces se llama dos veces;
//   · cancelar() es idempotente y vale también durante una emisión (el cancelado ya no recibe lo que queda);
//   · si un suscriptor lanza, el error se descarta y los demás reciben el evento igual;
//   · cada evento se entrega congelado en profundidad (nadie puede alterar el que recibe otro).
(function () {
  'use strict';
  const { congelar } = typeof require !== 'undefined' ? require('./congelar.js') : window.PCT.nucleo;

  function crearEmisor() {
    let subs = [];
    return {
      suscribir(fn) {
        if (typeof fn !== 'function') return () => {};
        const entrada = { fn, activa: true };
        subs = subs.concat([entrada]);
        return () => { if (!entrada.activa) return; entrada.activa = false; subs = subs.filter(s => s !== entrada); };
      },
      emitir(evento) {
        const ev = congelar(evento);
        for (const s of subs) {
          if (!s.activa) continue;
          try { s.fn(ev); } catch (error) { /* el error de un suscriptor no afecta ni a la simulación ni a los demás suscriptores */ }
        }
        return ev;
      },
      cuantos: () => subs.length,
    };
  }

  const api = { crearEmisor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); P.nucleo = Object.assign(P.nucleo || {}, api); }
})();
