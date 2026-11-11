// Estado de demostración v1 (ARQUITECTURA.md §4) para probar las escenas 3D sin esperar a la simulación del PROGRAMADOR-MODELO.
// Función pura: sin THREE ni DOM. La usan las pruebas y el banco de pruebas del navegador; la planta real usa el estado de PCT.htst.simulacion.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;

  /**
   * opciones: modo ('PRODUCCION' | 'PARADA' | 'RECIRCULACION_AGUA' | 'CIP'), caudalLh, temperaturaC (TT-103), desvio (bool: la FDV está en desvío),
   * averias: [{ id, tags }], nivelPct.
   */
  function estadoDemo(opciones = {}) {
    const modo = opciones.modo || 'PRODUCCION';
    const produce = modo === 'PRODUCCION';
    const caudal = opciones.caudalLh !== undefined ? opciones.caudalLh : (produce ? 2000 : 0);
    const t103 = opciones.temperaturaC !== undefined ? opciones.temperaturaC : (produce ? 73.5 : 25);
    const desvio = !!opciones.desvio;
    const marcha = modo !== 'PARADA';
    const aguaC = produce ? 78 : (modo === 'RECIRCULACION_AGUA' ? 70 : 25);
    const equipos = {};
    for (const e of layout.EQUIPOS) equipos[e.tag] = {};
    Object.assign(equipos['P-101'], { marcha: caudal > 0, velocidadPct: caudal > 0 ? Math.min(100, caudal / 25) : 0, caudalLh: caudal, corrienteA: caudal > 0 ? 6.5 : 0, temperaturaDisipadorC: 45, fallo: false });
    Object.assign(equipos['P-102'], { marcha, velocidadPct: 100 });
    Object.assign(equipos['P-103'], { marcha: produce && !desvio, velocidadPct: 100 });
    Object.assign(equipos['FDV-101'], { posicion: desvio ? 'DESVIO' : 'AVANCE', apertura01: desvio ? 0 : 1, aireOK: true });
    Object.assign(equipos['SV-101'], { energizada: !desvio && produce, bobinaOhm: 480 });
    Object.assign(equipos['HW-101'], { banco1: marcha, banco2: produce, potenciaKW: produce ? 18 : 9, temperaturaC: aguaC });
    Object.assign(equipos['XV-301'], { abierta: produce }, {});
    Object.assign(equipos['XV-401'], { abierta: modo === 'CIP' });
    for (const km of ['KM-102', 'KM-103', 'KM-201', 'KM-202']) equipos[km] = { cerrado: marcha, pegado: false };
    Object.assign(equipos['HX-101'], { fugaPlaca01: 0 });
    Object.assign(equipos['FLT-101'], { obstruccion01: 0 });
    Object.assign(equipos['VFD-101'], { marcha: caudal > 0, fallo: false, temperaturaDisipadorC: 45 });
    Object.assign(equipos['PS-001'], { v24: 24 });
    Object.assign(equipos['F-201'], { fundido: false });
    Object.assign(equipos['ES-001'], { pulsado: false });
    Object.assign(equipos['TSH-101'], { disparado: false });
    Object.assign(equipos['HL-001'], { encendida: false });
    const instrumentos = {};
    for (const s of layout.SENALES) if (s.tipo === 'AI' || s.tipo === 'DI') instrumentos[s.tag] = { valorProceso: 0, mA: 12, valorPLC: 0, calidad: 'OK', nivel: 1 };
    return {
      version: 1, tiempoS: 0, modo,
      tanque: { nivelPct: opciones.nivelPct !== undefined ? opciones.nivelPct : 65, volumenL: 650, temperaturaC: 4 },
      proceso: {
        caudalLh: caudal,
        temperaturas: { entrada: 4, trasRegeneracion: produce ? 66 : 20, trasCalentamiento: t103, salidaTubo: t103, salidaFinal: produce ? 5 : 20, aguaCaliente: aguaC },
        presiones: { crudoBar: produce ? 2.2 : 0.1, pasteurizadoBar: produce ? 2.45 : 0.1 }, tiempoResidenciaS: caudal > 0 ? 10.5 / (caudal / 3600) : 0,
      },
      equipos, instrumentos, salidasPLC: { DO: {}, AO: {} }, alarmas: [],
      contadores: { producidoL: 0, desviadoL: 0, energiaKWh: 0 }, averiasActivas: opciones.averias || [],
    };
  }

  const api = { estadoDemo };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstEstadoDemo = api; }
})();
