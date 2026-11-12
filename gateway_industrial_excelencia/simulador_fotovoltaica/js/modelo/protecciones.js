// Protecciones y topología. Los estados son: CERRADO (en servicio) | ABIERTO (maniobrado a mano) | DISPARADO (magnetotérmico/diferencial por defecto,
// se rearma) | FUNDIDO (fusible; se sustituye) | AGOTADO (descargador de sobretensiones con el testigo en rojo; se sustituye).
//
// MAPA DE TOPOLOGÍA (qué cuelga de qué; todo lo que hay «aguas abajo» de un elemento que no conduce queda aislado):
//
//   CAMPO A (continua):  PV-101..103 → STR-101 → F-101 ─┐
//                        PV-104..106 → STR-102 → F-102 ─┴→ barra de CB-101 (con SPD-101) → QS-101 → entrada PV de INV-101 (EASun)
//       · F-101 fundido o STR abierta: esa cadena no aporta. QS-101 abierto: el EASun no ve nada de los dos paneles. SPD-101 agotado: no corta nada.
//   BATERÍA:             BAT-101 → FB-101 → QB-101 → bornes de batería de INV-101
//       · FB-101 fundido o QB-101 ABIERTO/DISPARADO (o el BMS abierto): el EASun «pierde» la batería (FALLO, no usa el sol, pasa a red si hay).
//   CAMPO B (continua):  PV-201..204 → STR-201 → (QS-201 / SPD-201) → MPPT1 de INV-201 (ZCS)
//                        PV-205..208 → STR-202 → (QS-201 / SPD-201) → MPPT2 de INV-201
//       · QS-201 abierto: el ZCS se queda sin entrada de continua en las dos cadenas.
//   ALTERNA:             RED-301 → QF-301 → ID-301 → barra del cuadro QA-301 ─┬→ QF-302 → INV-101 (entrada de red y salida a LOAD-302)
//                                                                               ├→ QF-303 → INV-201 (ZCS, vertido) y MED-201
//                                                                               ├→ LOAD-301 (consumo del centro) y TC-301 (schuko)
//                                                                               └→ SPD-301
//       · QF-301 o ID-301 abierto/disparado: el cuadro se queda sin red (LOAD-301 sin tensión, el ZCS se desconecta por anti-isla, el EASun pierde
//         la entrada de red pero sigue alimentando LOAD-302 desde sol y batería). QF-302 corta entrada de red Y salida a LOAD-302 del EASun.
//         QF-303 aísla solo el ZCS.
//
// Disparos por defecto: QF-301 (32 A), QF-302 (16 A) y QF-303 (16 A) disparan si la corriente supera 1,45 veces la nominal durante 10 s;
// QB-101 (125 A) igual. El resto de disparos y fusibles fundidos vienen de las averías.
(function () {
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : window.PCT.fv.constantes;

  const INTERRUPTORES = ['QS-101', 'QB-101', 'QS-201', 'QF-301', 'ID-301', 'QF-302', 'QF-303'];
  const FUSIBLES = ['F-101', 'F-102', 'FB-101'];
  const DESCARGADORES = ['SPD-101', 'SPD-201', 'SPD-301'];
  const TODOS = [...INTERRUPTORES, ...FUSIBLES, ...DESCARGADORES];
  const NOMINALES = { 'QF-301': C.PROTECCIONES.QF301.inA, 'QF-302': C.PROTECCIONES.QF302.inA, 'QF-303': C.PROTECCIONES.QF303.inA, 'QB-101': C.PROTECCIONES.QB101.inA };

  function crearProtecciones() {
    const est = {}, calor = {};
    const reiniciar = () => { for (const t of TODOS) { est[t] = { estado: 'CERRADO', causa: '' }; calor[t] = 0; } };
    reiniciar();
    const p = { estados: est, TODOS, INTERRUPTORES, FUSIBLES, DESCARGADORES, reiniciar };
    const existe = tag => Object.prototype.hasOwnProperty.call(est, tag);
    p.conduce = tag => !existe(tag) || est[tag].estado === 'CERRADO';
    p.estadoDe = tag => (existe(tag) ? est[tag].estado : 'CERRADO');
    p.cerrar = function (tag) {
      if (!existe(tag) || DESCARGADORES.includes(tag)) return false;
      const e = est[tag];
      if (e.estado === 'FUNDIDO') return false;                       // un fusible fundido no se «cierra»: se sustituye (rearmar)
      if (e.estado === 'ABIERTO' || e.estado === 'DISPARADO') { e.estado = 'CERRADO'; e.causa = ''; calor[tag] = 0; }
      return true;
    };
    p.abrir = function (tag) {
      if (!existe(tag) || DESCARGADORES.includes(tag)) return false;
      const e = est[tag];
      if (e.estado === 'CERRADO') { e.estado = 'ABIERTO'; e.causa = 'Abierto a mano'; }
      return true;
    };
    /** Rearma un disparado, sustituye un fusible fundido o un descargador agotado. Devuelve true si cambió algo. */
    p.rearmar = function (tag) {
      if (!existe(tag)) return false;
      const e = est[tag], antes = e.estado;
      if (antes === 'DISPARADO' || antes === 'FUNDIDO' || antes === 'AGOTADO' || (antes === 'ABIERTO' && FUSIBLES.includes(tag))) { e.estado = 'CERRADO'; e.causa = ''; calor[tag] = 0; return true; }
      return false;
    };
    p.disparar = (tag, causa = 'Disparo') => { if (existe(tag) && INTERRUPTORES.includes(tag)) { est[tag].estado = 'DISPARADO'; est[tag].causa = causa; } };
    p.fundir = (tag, causa = 'Fusible fundido') => { if (existe(tag) && FUSIBLES.includes(tag)) { est[tag].estado = 'FUNDIDO'; est[tag].causa = causa; } };
    p.agotar = (tag, causa = 'Descargador agotado') => { if (existe(tag) && DESCARGADORES.includes(tag)) { est[tag].estado = 'AGOTADO'; est[tag].causa = causa; } };

    /** Disparo térmico por sobrecorriente: acumula tiempo por encima de 1,45·In. Devuelve true si disparó en este paso. */
    p.vigilarCorriente = function (tag, corrienteA, dt) {
      const e = est[tag]; if (!e || e.estado !== 'CERRADO' || !NOMINALES[tag]) return false;
      if (Math.abs(corrienteA) > C.PROTECCIONES.factorDisparo * NOMINALES[tag]) calor[tag] += dt; else calor[tag] = Math.max(0, calor[tag] - dt);
      if (calor[tag] >= C.PROTECCIONES.tiempoDisparoS) { p.disparar(tag, `Sobrecorriente (${Math.abs(corrienteA).toFixed(0)} A > ${(C.PROTECCIONES.factorDisparo * NOMINALES[tag]).toFixed(0)} A)`); return true; }
      return false;
    };

    /**
     * Resuelve qué está conectado a qué. `redDisponible` y `tensionRedV` ya incluyen las averías de red.
     * Devuelve banderas de conexión usadas por el resto del modelo.
     */
    p.topologia = function ({ redDisponible = true, tensionRedV = 230 } = {}) {
      const redEnQF301 = !!redDisponible && tensionRedV > 50;
      const redEnCuadro = redEnQF301 && p.conduce('QF-301') && p.conduce('ID-301');
      return {
        cadenaConectada: { 'STR-101': p.conduce('F-101') && p.conduce('QS-101'), 'STR-102': p.conduce('F-102') && p.conduce('QS-101'),
          'STR-201': p.conduce('QS-201'), 'STR-202': p.conduce('QS-201') },
        pvAEnInversor: p.conduce('QS-101'),
        pvBEnInversor: p.conduce('QS-201'),
        bateriaConectada: p.conduce('FB-101') && p.conduce('QB-101'),
        redEnCuadro,
        redEasun: redEnCuadro && p.conduce('QF-302'),
        redZcs: redEnCuadro && p.conduce('QF-303'),
        cargas302Cableadas: p.conduce('QF-302'),
        cargas301Energizadas: redEnCuadro,
        tomaEnergizada: redEnCuadro,
      };
    };

    p.estadoPublico = () => { const o = {}; for (const t of TODOS) o[t] = { estado: est[t].estado, causa: est[t].causa }; return o; };
    return p;
  }

  const api = { crearProtecciones, INTERRUPTORES, FUSIBLES, DESCARGADORES, TODOS, NOMINALES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).protecciones = api; }
})();
