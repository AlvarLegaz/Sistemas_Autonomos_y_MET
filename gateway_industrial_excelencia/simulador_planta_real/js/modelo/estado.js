// Estado completo de la planta HTST (contrato v1, ARQUITECTURA.md §4). Un solo objeto que lee la interfaz y el 3D. Aquí solo se construye.
// Extensiones respecto al borrador: `alimentacion` ({ v24, fusibleF201 }), `proceso.pasteurizadoReal` y `contadores.noConformeL`.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : PCT.htstConstantes;

  function crearEstado() {
    const T = C.tanque, ent = T.temperaturaC, amb = C.aguaCaliente.ambienteC;
    const equipos = {};
    for (const e of layout.EQUIPOS) equipos[e.tag] = {};
    Object.assign(equipos, {
      'TK-101': { nivelPct: T.nivelInicialPct, volumenL: T.capacidadL * T.nivelInicialPct / 100, reponiendo: false, desbordando: false },
      'FLT-101': { obstruccion01: 0 },
      'P-101': { marcha: false, velocidadPct: 0, caudalLh: 0, corrienteA: 0, temperaturaDisipadorC: C.variador.ambienteC, fallo: false, ventiladorOK: true },
      'P-201': { marcha: false, corrienteA: 0 },
      'HX-101': { regeneracion: { tempC: ent }, calentamiento: { tempC: ent }, enfriamiento: { tempC: ent }, fugaPlaca01: 0 },
      'HT-101': { volumenL: C.proceso.volumenTuboResidenciaL, tiempoResidenciaS: Infinity },
      'FDV-101': { posicion: 'DESVIO', apertura01: 0, aireOK: true, atascada: false },
      'SV-101': { energizada: false, bobinaOhm: C.electrico.resistenciaBobinaSV101Ohm },
      'FRL-501': { presionBar: C.aire.presionNominalBar },
      'PSL-501': { contactoCerrado: true },
      'HW-201': { banco1: false, banco2: false, potenciaKW: 0, temperaturaC: amb, nivelPct: C.aguaCaliente.nivelInicialPct, volumenL: C.aguaCaliente.capacidadL * C.aguaCaliente.nivelInicialPct / 100 },
      'XV-301': { abierta: false }, 'XV-401': { abierta: false },
      'XV-101': { abierta: false }, 'XV-102': { abierta: false }, 'XV-201': { abierta: false }, 'XV-202': { abierta: false },
      'LSL-201': { contactoCerrado: true },
      'TSH-201': { abierto: false, disparado: false, falsoContacto: false },
      'ES-001': { rearmado: true }, 'QF-201': { armado: true },
      'PS-001': { tensionV: C.electrico.tension24V, ok: true }, 'F-001': { fundido: false },
      'VFD-101': { fallo: false },
      'KM-203': { cerrado: false, pegado: false },
      'KM-201': { cerrado: false, pegado: false }, 'KM-202': { cerrado: false, pegado: false },
      'PB-001': { pulsado: false }, 'HL-001': { encendida: false },
    });
    return {
      version: 1, tiempoS: 0, modo: 'PARADA',
      tanque: { nivelPct: T.nivelInicialPct, volumenL: equipos['TK-101'].volumenL, temperaturaC: ent },
      aguaCaliente: { nivelPct: equipos['HW-201'].nivelPct, volumenL: equipos['HW-201'].volumenL, temperaturaC: amb },
      proceso: {
        caudalLh: 0,
        temperaturas: { entrada: ent, trasRegeneracion: ent, trasRegeneracionPas: ent, trasCalentamiento: ent, salidaTubo: ent, salidaFinal: ent, aguaCaliente: amb },
        presiones: { crudoBar: 0.3, pasteurizadoBar: 0.3 }, tiempoResidenciaS: Infinity, pasteurizadoReal: false,
      },
      equipos, instrumentos: {}, salidasPLC: { DO: {}, AO: {} }, alarmas: [],
      contadores: { producidoL: 0, desviadoL: 0, energiaKWh: 0, noConformeL: 0 },
      averiasActivas: [], alimentacion: { v24: C.electrico.tension24V, fusibleF201: true },
    };
  }

  const api = { crearEstado };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstEstado = api; }
})();
