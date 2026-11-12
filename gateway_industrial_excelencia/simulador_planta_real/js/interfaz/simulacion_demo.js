// SIMULACIÓN DE DEMOSTRACIÓN de la interfaz: cumple la superficie de la API de simulación (ARQUITECTURA.md §4) con una física muy simple, para poder probar
// la página, los instrumentos virtuales y el panel del profesor mientras (o si) no está cargado el modelo real del PROGRAMADOR-MODELO.
// La página la usa SOLO si no encuentra el modelo real, y avisa de ello en pantalla. No es el modelo de la planta: no la uses para evaluar a nadie.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const SAL = layout.SENALES;

  const CATALOGO = [
    { id: 'AV-FUSIBLE-F201', nombre: 'Fusible de 24 V fundido', capa: 'alimentacion', dificultad: 1, equipos: ['F-001'], parametros: {} },
    { id: 'AV-LAZO-ABIERTO', nombre: 'Lazo 4-20 mA abierto en TT-103', capa: 'lazo', dificultad: 1, equipos: ['TT-103'], parametros: {} },
    { id: 'AV-PT100-ABIERTA', nombre: 'Pt100 abierta en TT-102', capa: 'sensor', dificultad: 2, equipos: ['TT-102'], parametros: {} },
    { id: 'AV-DERIVA-TT103', nombre: 'Deriva de calibración de TT-103', capa: 'sensor', dificultad: 3, equipos: ['TT-103'], parametros: { deriva: { tipo: 'numero', min: -5, max: 5, defecto: 2, unidad: '°C' } } },
  ];
  const SOLUCION = { 'AV-FUSIBLE-F201': ['sustituir', 'F-001'], 'AV-LAZO-ABIERTO': ['reparar', 'TT-103'], 'AV-PT100-ABIERTA': ['sustituir', 'TT-102'], 'AV-DERIVA-TT103': ['recalibrar', 'TT-103'] };

  function crearSimulacion() {
    let s;
    let siguienteInstancia = 1;
    const activas = [];
    const hay = id => activas.some(a => a.id === id);
    const nueva = () => ({ tiempoS: 0, modo: 'PARADA', consignaC: 73.5, aguaC: 20, tt103: 4, tt102: 4, nivel: 80, producidoL: 0, desviadoL: 0 });
    s = nueva();

    function calcular() {
      const produciendo = s.modo === 'PRODUCCION' && !hay('AV-FUSIBLE-F201');
      const caudal = produciendo ? 2000 : 0;
      const sano = !hay('AV-FUSIBLE-F201');
      const deriva = (activas.find(a => a.id === 'AV-DERIVA-TT103') || { params: { deriva: 0 } }).params.deriva || 0;
      const lazo = tag => {
        const q = { 'TT-101': 4, 'TT-102': s.tt102, 'TT-103': s.tt103, 'TT-104': caudal ? 4.5 : 20, 'TT-201': s.aguaC, 'TT-106': caudal ? 12 : 20, 'FT-101': caudal, 'PT-101': caudal ? 1.2 : 0.1, 'PT-102': caudal ? 1.4 : 0.1, 'LT-101': s.nivel }[tag];
        const r = SAL.find(x => x.tipo === 'AI' && x.tag === tag).rango;
        let valorLeido = tag === 'TT-103' ? q + deriva : q, mA = layout.aMilisamperios(valorLeido, r[0], r[1]), calidad = 'OK';
        if (!sano) { mA = 0; calidad = 'ABIERTO'; }
        else if ((tag === 'TT-103' && hay('AV-LAZO-ABIERTO')) ) { mA = 0; calidad = 'ABIERTO'; }
        else if (tag === 'TT-102' && hay('AV-PT100-ABIERTA')) { mA = 21; calidad = 'CORTO'; }
        return { valorProceso: q, mA, valorPLC: calidad === 'OK' ? layout.deMilisamperios(mA, r[0], r[1]) : null, calidad };
      };
      const instrumentos = {};
      for (const sl of SAL.filter(x => x.tipo === 'AI')) { const l = lazo(sl.tag); instrumentos[sl.tag] = l.calidad === 'OK' ? l : Object.assign(l, { valorPLC: undefined }); }
      const tt103Ok = instrumentos['TT-103'].calidad === 'OK' && instrumentos['FT-101'].calidad === 'OK' && instrumentos['TT-103'].valorPLC >= 72;
      const avance = produciendo && tt103Ok;
      const alarmas = [];
      if (!sano) alarmas.push({ codigo: 'A140', tag: 'F-001', nivel: 'alta', desdeS: s.tiempoS, texto: 'Fuente o fusible de 24 V' });
      for (const [tag, i] of Object.entries(instrumentos)) { if (i.calidad === 'ABIERTO') alarmas.push({ codigo: 'A101', tag, nivel: 'alta', desdeS: s.tiempoS, texto: `Hilo roto en ${tag}` }); if (i.calidad === 'CORTO') alarmas.push({ codigo: 'A102', tag, nivel: 'alta', desdeS: s.tiempoS, texto: `Sobreescala en ${tag}` }); }
      const marcha = s.modo !== 'PARADA' && sano;
      const equipos = {
        'P-101': { marcha: produciendo, velocidadPct: 70, caudalLh: caudal }, 'P-201': { marcha },
        'FDV-101': { posicion: avance ? 'AVANCE' : 'DESVIO', aireOK: true }, 'SV-101': { energizada: avance }, 'XV-301': { abierta: produciendo },
        'HW-201': { banco1: marcha && s.aguaC < 78, banco2: marcha && s.aguaC < 76 }, 'F-001': { fundido: !sano }, 'PS-001': { ok: true }, 'VFD-101': { fallo: false },
        'KM-203': { cerrado: marcha }, 'KM-201': { cerrado: marcha && s.aguaC < 78 }, 'KM-202': { cerrado: marcha && s.aguaC < 76 },
      };
      const di = { 'PS-001': 1, 'ES-001': 1, 'TSH-201': 1, 'QF-201': 1, 'PSL-501': 1, 'PB-001': 0, 'ZS-101': avance ? 1 : 0, 'ZS-102': avance ? 0 : 1, 'LSH-101': 0, 'LSL-101': 1, 'LSL-201': 1, 'LSH-201': 1 };
      for (const [tag, nivel] of Object.entries(di)) instrumentos[tag] = { nivel };
      return { version: 1, tiempoS: s.tiempoS, modo: s.modo, tanque: { nivelPct: s.nivel }, proceso: { caudalLh: caudal, tiempoResidenciaS: caudal ? 15.1 : 0,
        temperaturas: { entrada: 4, trasRegeneracion: s.tt102, trasRegeneracionPas: caudal ? 12 : 20, trasCalentamiento: s.tt103, salidaTubo: s.tt103, salidaFinal: caudal ? 4.5 : 20, aguaCaliente: s.aguaC }, presiones: { crudoBar: 1.2, pasteurizadoBar: 1.4 } },
        equipos, instrumentos, salidasPLC: { DO: { 'HL-001': alarmas.length > 0 }, AO: {} }, alarmas, contadores: { producidoL: s.producidoL, desviadoL: s.desviadoL, energiaKWh: 0 },
        averiasActivas: activas.map(a => ({ instancia: a.instancia, id: a.id, tags: a.tags })) };
    }

    const averias = {
      listar: () => CATALOGO,
      inyectar(id, params = {}) { const c = CATALOGO.find(x => x.id === id); if (!c || hay(id)) return null; const a = { instancia: `i${siguienteInstancia++}`, id, nombre: c.nombre, tags: c.equipos, params, intentos: [] }; activas.push(a); return a.instancia; },
      quitar(instancia) { const i = activas.findIndex(a => a.instancia === instancia); if (i >= 0) activas.splice(i, 1); },
      reparar(instancia, { accion, tag }) { const a = activas.find(x => x.instancia === instancia); if (!a) return { ok: false, motivo: 'No existe esa avería' }; const [acc, t] = SOLUCION[a.id]; if (acc === accion && t === tag) { averias.quitar(instancia); return { ok: true }; } a.intentos.push({ accion, tag }); return { ok: false, motivo: 'Esa acción no resuelve esta avería' }; },
      activas: () => activas.map(a => Object.assign({}, a)),
      codigo: () => 'HTST-' + btoa(JSON.stringify(activas.map(a => [a.id, a.params]))).replace(/=+$/, ''),
      desdeCodigo(texto) { if (!/^HTST-/.test(texto)) return { ok: false, motivo: 'empieza por HTST-' }; JSON.parse(atob(texto.slice(5))).forEach(([id, p]) => averias.inyectar(id, p)); return { ok: true }; },
      ultimoMotivoRechazo: () => 'Esa avería ya está activa',
    };

    // Misma forma que js/modelo/medidas.js del modelo real: puntos [{ id, descripcion, modo }] y medir(instrumento, punto, null, modo) → { ok, valor, unidad, texto }.
    const PUNTOS = [
      { id: 'F-001:ENTRADA', descripcion: 'Fusible F-001, lado fuente', modo: 'V' }, { id: 'F-001:SALIDA', descripcion: 'Fusible F-001, lado instrumentos', modo: 'V' },
      { id: 'F-001:FUSIBLE', descripcion: 'Continuidad del fusible F-001', modo: 'continuidad' }, { id: 'TT-103:LAZO', descripcion: 'Lazo 4-20 mA de TT-103 (en serie)', modo: 'mA' },
      { id: 'TT-102:PT100', descripcion: 'Resistencia de la Pt100 de TT-102', modo: 'ohm' },
    ];
    const medidas = {
      puntos: PUNTOS,
      medir(instrumento, punto, b, modo, estado = calcular()) {
        const fundido = !!estado.equipos['F-001'].fundido, ok = (valor, unidad, extra = {}) => Object.assign({ ok: true, valor, unidad, texto: `${valor} ${unidad}` }, extra);
        const mal = uso => ({ ok: false, valor: null, unidad: '', texto: `Modo ${modo} no válido en este punto: usa ${uso}` });
        if (instrumento === 'osciloscopio') {
          if (!/^(F-001:SALIDA|F-001:ENTRADA)$/.test(punto)) return { ok: false, valor: null, unidad: '', texto: 'Sin onda en este punto' };
          const base = punto === 'F-001:SALIDA' && fundido ? 0 : 24, muestras = [];
          for (let k = 0; k < 200; k++) muestras.push(base + 0.04 * Math.sin(2 * Math.PI * 100 * k * 0.0001));
          return { ok: true, muestras, unidad: 'V', dtMs: 0.1, texto: base ? '24 V casi planos' : '0 V' };
        }
        if (punto === 'F-001:ENTRADA') return modo === 'V' ? ok(24, 'V') : mal('V');
        if (punto === 'F-001:SALIDA') return modo === 'V' ? ok(fundido ? 0 : 24, 'V') : mal('V');
        if (punto === 'F-001:FUSIBLE') return modo === 'continuidad' ? ok(fundido ? Infinity : 0.01, 'Ω', { continuidad: !fundido }) : mal('continuidad');
        if (punto === 'TT-103:LAZO') return modo === 'mA' ? ok(estado.instrumentos['TT-103'].mA, 'mA') : mal('mA');
        if (punto === 'TT-102:PT100') return modo === 'ohm' ? ok(hay('AV-PT100-ABIERTA') ? Infinity : 100 * (1 + 0.00385 * s.tt102), 'Ω') : mal('ohm');
        return { ok: false, valor: null, unidad: '', texto: `Punto de medida desconocido: ${punto}` };
      },
    };

    return {
      demo: true,
      estado: calcular,
      paso(dt) {
        s.tiempoS += dt;
        const marcha = s.modo !== 'PARADA' && !hay('AV-FUSIBLE-F201');
        s.aguaC += ((marcha ? 80 : 20) - s.aguaC) * Math.min(1, dt / 60);
        s.tt103 += ((s.modo === 'PRODUCCION' && marcha ? Math.min(s.consignaC, s.aguaC - 4) : 4) - s.tt103) * Math.min(1, dt / 8);
        s.tt102 += ((s.modo === 'PRODUCCION' && marcha ? 66 : 4) - s.tt102) * Math.min(1, dt / 8);
        if (s.modo === 'PRODUCCION' && marcha) s.producidoL += 2000 / 3600 * dt;
      },
      ordenes: { arrancar() { s.modo = s.modo === 'PARADA' ? 'RECIRCULACION_AGUA' : s.modo; }, parar() { s.modo = 'PARADA'; }, consignaTemperaturaC(c) { s.consignaC = c; }, consignaCaudalLh() {}, modo(m) { s.modo = m; }, pulsador() {}, manual() {} },
      senales: () => ({}), alarmas: () => calcular().alarmas, medidas, averias, reiniciar() { s = nueva(); activas.length = 0; },
    };
  }

  const api = { crearSimulacion, CATALOGO };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstDemo = api;
})();
