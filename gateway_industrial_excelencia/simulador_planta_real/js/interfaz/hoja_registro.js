// Hojas del alumno: registro de actuaciones (con CSV), calibración de lazos 4-20 mA, pruebas de enclavamientos y diagnóstico/reparación.
// La lógica (cálculos, comprobaciones sobre el estado, registro) es pura y se prueba con node:test; el DOM va al final.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;

  /* ---------- registro de actuaciones ---------- */
  const TIPOS_REGISTRO = ['accion', 'alarma', 'medida', 'calibracion', 'enclavamiento', 'diagnostico', 'averia'];

  /** Registro de todo lo que hace el alumno, con el tiempo de la simulación. relojS(): segundos de simulación. */
  function crearRegistro(relojS = () => 0) {
    const entradas = [];
    return {
      anotar(tipo, texto, datos = {}) {
        const entrada = { n: entradas.length + 1, tiempoS: Math.round(relojS() * 10) / 10, tipo, texto, datos };
        entradas.push(entrada);
        return entrada;
      },
      entradas: () => entradas.slice(),
      limpiar() { entradas.length = 0; },
      aCsv: () => registroACsv(entradas),
    };
  }

  const celdaCsv = valor => { const t = String(valor === undefined || valor === null ? '' : valor); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  /** CSV con separador «;» (el que abre bien Excel en español). Una fila por actuación. */
  function registroACsv(entradas) {
    const cabecera = ['n', 'tiempo_s', 'tipo', 'texto', 'datos'];
    const filas = entradas.map(e => [e.n, e.tiempoS, e.tipo, e.texto, JSON.stringify(e.datos)].map(celdaCsv).join(';'));
    return [cabecera.join(';'), ...filas].join('\n') + '\n';
  }

  /* ---------- calibración de lazos ---------- */
  const PUNTOS_CALIBRACION_PCT = [0, 25, 50, 75, 100];
  const TOLERANCIA_FONDO_ESCALA_PCT = 0.5;                 // tolerancia típica de un transmisor de calidad (ilustrativa)

  /** Lazos que se pueden calibrar: los analógicos del contrato. */
  const lazosCalibrables = (lay = layout) => lay.SENALES.filter(s => s.tipo === 'AI');

  /** mA que debería dar el lazo para un valor patrón de proceso. */
  const mAEsperado = (valorPatron, rango) => 4 + 16 * (valorPatron - rango[0]) / (rango[1] - rango[0]);

  /**
   * Compara el lazo con el patrón. patron: valor de referencia (en unidades de proceso); mA: lo medido en serie con el multímetro;
   * valorScada: lo que muestra el SCADA/PLC. Distingue si falla el transmisor/cableado (mA) o el escalado/entrada del PLC (SCADA).
   */
  function evaluarLazo({ patron, mA, valorScada, rango, tolerancia = TOLERANCIA_FONDO_ESCALA_PCT }) {
    const esperado = mAEsperado(patron, rango);
    const errorMa = mA - esperado, errorMaPct = errorMa / 16 * 100;
    const errorValor = valorScada - patron, errorValorPct = errorValor / (rango[1] - rango[0]) * 100;
    const okTransmisor = Math.abs(errorMaPct) <= tolerancia, okScada = Math.abs(errorValorPct) <= tolerancia;
    let diagnostico = 'ok';
    if (!okTransmisor) diagnostico = mA < 3.6 ? 'hilo_roto' : mA > 21 ? 'sobreescala' : 'transmisor_o_sonda';
    else if (!okScada) diagnostico = 'escalado_o_entrada_plc';
    return { mAEsperado: esperado, errorMa, errorMaPct, errorValor, errorValorPct, okTransmisor, okScada, ok: okTransmisor && okScada, diagnostico };
  }

  const TEXTO_DIAGNOSTICO_LAZO = {
    ok: 'Lazo correcto dentro de la tolerancia.',
    hilo_roto: 'Menos de 3,6 mA: hilo roto, borna floja o transmisor sin alimentación (¿hay 24 V en las bornas?).',
    sobreescala: 'Más de 21 mA: sobreescala o cortocircuito (¿Pt100 abierta con burnout alto, o cable en corto?).',
    transmisor_o_sonda: 'Los mA no corresponden al patrón: deriva de la sonda o del transmisor. Hay que recalibrar o sustituir.',
    escalado_o_entrada_plc: 'Los mA son correctos pero el SCADA no coincide: revisar el escalado de la entrada analógica del PLC.',
  };

  /* ---------- pruebas de enclavamientos ---------- */
  const alarmasDe = estado => (estado.alarmas || []).map(a => a.codigo);
  const equipoDe = (estado, tag) => (estado.equipos && estado.equipos[tag]) || {};
  const fdvEnDesvio = estado => equipoDe(estado, 'FDV-101').posicion === 'DESVIO';
  const bancosFuera = estado => !equipoDe(estado, 'HW-101').banco1 && !equipoDe(estado, 'HW-101').banco2;
  const bombasParadas = estado => ['P-101', 'P-102', 'P-103'].every(tag => !equipoDe(estado, tag).marcha);

  /**
   * Pruebas de enclavamientos: el alumno provoca la condición (pulsar la seta, pedir una avería al profesor...) y pulsa «Comprobar»:
   * se mira si el sistema reaccionó como debe. `comprobar(estado)` → { ok, detalle }.
   */
  const PRUEBAS_ENCLAVAMIENTO = [
    { id: 'ES-001', nombre: 'Paro de emergencia (ES-001)', condicion: 'Pulsa la seta con la planta en producción.',
      esperado: 'FDV en desvío, bancos del calentador fuera, bombas paradas y alarma A180.',
      comprobar: e => resultado(alarmasDe(e).includes('A180') && fdvEnDesvio(e) && bancosFuera(e) && bombasParadas(e), 'A180, FDV en desvío, calentador fuera y bombas paradas') },
    { id: 'TSH-101', nombre: 'Termostato de seguridad (TSH-101)', condicion: 'Abre el termostato (o pide la avería «TSH disparado»).',
      esperado: 'Calentador fuera y alarma A170; el rearme es manual.',
      comprobar: e => resultado(alarmasDe(e).includes('A170') && bancosFuera(e), 'A170 y bancos fuera') },
    { id: 'TT-103', nombre: 'Fallo de TT-103 → desvío', condicion: 'Con producción, provoca un lazo abierto o una Pt100 abierta en TT-103.',
      esperado: 'La FDV pasa a desvío (seguridad positiva) y sale la alarma de lazo (A101 o A102).',
      comprobar: e => resultado((alarmasDe(e).includes('A101') || alarmasDe(e).includes('A102')) && fdvEnDesvio(e), 'alarma de lazo y FDV en desvío') },
    { id: 'DP-REGEN', nombre: 'Diferencial de la regeneración', condicion: 'Provoca una fuga de placa o baja la presión del lado pasteurizado.',
      esperado: 'Alarma A110 y FDV en desvío (no se avanza producto con ΔP insuficiente).',
      comprobar: e => resultado(alarmasDe(e).includes('A110') && fdvEnDesvio(e), 'A110 y FDV en desvío') },
    { id: 'AIRE', nombre: 'Aire comprimido bajo (PSL-201)', condicion: 'Baja la presión de aire (avería «aire bajo»).',
      esperado: 'Alarma A160 y FDV en desvío: sin aire, el muelle la lleva a desvío.',
      comprobar: e => resultado(alarmasDe(e).includes('A160') && fdvEnDesvio(e), 'A160 y FDV en desvío') },
    { id: 'FUENTE', nombre: 'Fuente o fusible de 24 V', condicion: 'Funde el fusible F-201 o baja la fuente (averías de alimentación).',
      esperado: 'Alarma A140, FDV en desvío y paro de los equipos.',
      comprobar: e => resultado(alarmasDe(e).includes('A140') && fdvEnDesvio(e) && bombasParadas(e), 'A140, FDV en desvío y bombas paradas') },
  ];
  function resultado(ok, esperado) { return { ok, detalle: ok ? `Correcto: ${esperado}.` : `No se cumple todavía: se esperaba ${esperado}.` }; }

  function evaluarEnclavamiento(id, estado) {
    const prueba = PRUEBAS_ENCLAVAMIENTO.find(p => p.id === id);
    return prueba ? prueba.comprobar(estado) : { ok: false, detalle: 'Prueba desconocida.' };
  }

  /* ---------- diagnóstico y reparación ---------- */
  const ACCIONES_REPARACION = [['sustituir', 'Sustituir'], ['reparar', 'Reparar'], ['ajustar', 'Ajustar'], ['limpiar', 'Limpiar'], ['recalibrar', 'Recalibrar']];

  /**
   * Aplica la solución elegida por el alumno al equipo elegido. El alumno no sabe qué avería hay: se prueba contra las activas que
   * afectan a ese tag. Devuelve { resuelta, intentadas, mensaje }.
   */
  function aplicarSolucion(sim, { accion, tag }) {
    const motor = sim && sim.averias;
    if (!motor || typeof motor.reparar !== 'function') return { resuelta: false, intentadas: 0, mensaje: 'El motor de averías no está cargado.' };
    const candidatas = (motor.activas() || []).filter(a => (a.tags || a.equipos || []).includes(tag));
    if (!candidatas.length) return { resuelta: false, intentadas: 0, mensaje: `No se detecta ninguna avería en ${tag}: no se cambia nada.` };
    let resuelta = false, motivo = '';
    for (const a of candidatas) { const r = motor.reparar(a.instancia, { accion, tag }); if (r === true || (r && (r.ok === true || r.resuelta))) resuelta = true; else if (r && r.motivo) motivo = r.motivo; }
    return { resuelta, intentadas: candidatas.length, mensaje: resuelta ? `${accion} en ${tag}: avería resuelta.` : `${accion} en ${tag}: no era la solución${motivo ? ' (' + motivo + ')' : ''}; se anota el intento.` };
  }

  /* ---------- parte con DOM ---------- */
  function descargarCsv(texto, nombre) {
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' }));
    enlace.download = nombre; document.body.appendChild(enlace); enlace.click(); enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
  }

  /** Dibuja las hojas en `contenedor`. contexto: { sim(), registro }. */
  function crearHojas(contenedor, contexto) {
    const registro = contexto.registro, lazos = lazosCalibrables();
    contenedor.innerHTML = `
      <section class="hoja" aria-labelledby="h-calibracion"><h3 id="h-calibracion">Calibración de lazos 4-20 mA</h3>
        <p>Con la sonda en un patrón (baño o simulador de temperatura), mide los mA en serie y anota lo que muestra el SCADA.</p>
        <div class="fila-form">
          <label>Lazo <select class="cal-lazo">${lazos.map(l => `<option value="${l.tag}">${l.tag} · ${l.descripcion}</option>`).join('')}</select></label>
          <label>Patrón <input class="cal-patron" type="number" step="any"><span class="cal-unidad"></span></label>
          <label>mA medidos <input class="cal-ma" type="number" step="0.01"></label>
          <label>Valor en el SCADA <input class="cal-scada" type="number" step="any"></label>
          <button type="button" class="cal-anotar">Evaluar y anotar</button>
        </div><p class="cal-resultado" aria-live="polite"></p></section>
      <section class="hoja" aria-labelledby="h-enclavamientos"><h3 id="h-enclavamientos">Pruebas de enclavamientos</h3>
        <ul class="lista-pruebas">${PRUEBAS_ENCLAVAMIENTO.map(p => `<li data-id="${p.id}"><b>${p.nombre}</b><br><small>${p.condicion} Esperado: ${p.esperado}</small>
          <button type="button" class="enc-comprobar">Comprobar</button> <span class="enc-resultado" aria-live="polite"></span></li>`).join('')}</ul></section>
      <section class="hoja" aria-labelledby="h-diagnostico"><h3 id="h-diagnostico">Diagnóstico y reparación</h3>
        <p>Cuando creas saber dónde está el fallo, indica el equipo y la acción. Si te equivocas, queda anotado.</p>
        <div class="fila-form">
          <label>Equipo <select class="dia-tag">${layout.EQUIPOS.map(e => `<option value="${e.tag}">${e.tag} · ${e.nombre}</option>`).join('')}</select></label>
          <label>Acción <select class="dia-accion">${ACCIONES_REPARACION.map(a => `<option value="${a[0]}">${a[1]}</option>`).join('')}</select></label>
          <label>Causa que has encontrado <input class="dia-causa" type="text" placeholder="p. ej. fusible fundido por cortocircuito en el lazo de TT-102"></label>
          <button type="button" class="dia-aplicar">Aplicar y anotar</button></div><p class="dia-resultado" aria-live="polite"></p></section>
      <section class="hoja" aria-labelledby="h-registro"><h3 id="h-registro">Registro de actuaciones</h3>
        <div class="fila-form"><button type="button" class="reg-csv">Descargar CSV</button> <button type="button" class="reg-limpiar">Vaciar</button></div>
        <ol class="registro-lista" aria-live="polite"></ol></section>`;
    const q = s => contenedor.querySelector(s);

    const lazoActual = () => lazos.find(l => l.tag === q('.cal-lazo').value);
    q('.cal-lazo').addEventListener('change', () => { q('.cal-unidad').textContent = ` ${lazoActual().unidad}`; });
    q('.cal-unidad').textContent = ` ${lazoActual().unidad}`;
    q('.cal-anotar').addEventListener('click', () => {
      const l = lazoActual(), patron = parseFloat(q('.cal-patron').value), mA = parseFloat(q('.cal-ma').value), valorScada = parseFloat(q('.cal-scada').value);
      if ([patron, mA, valorScada].some(Number.isNaN)) { q('.cal-resultado').textContent = 'Rellena el patrón, los mA y el valor del SCADA.'; return; }
      const r = evaluarLazo({ patron, mA, valorScada, rango: l.rango });
      q('.cal-resultado').textContent = `${r.ok ? '✔' : '✘'} Esperado ${r.mAEsperado.toFixed(2).replace('.', ',')} mA (error ${r.errorMa.toFixed(2).replace('.', ',')} mA, ${r.errorMaPct.toFixed(2).replace('.', ',')} % del fondo de escala). ${TEXTO_DIAGNOSTICO_LAZO[r.diagnostico]}`;
      registro.anotar('calibracion', `${l.tag}: patrón ${patron} ${l.unidad}, ${mA} mA, SCADA ${valorScada} → ${r.ok ? 'correcto' : r.diagnostico}`, { tag: l.tag, patron, mA, valorScada, diagnostico: r.diagnostico });
    });
    contenedor.querySelectorAll('.enc-comprobar').forEach(boton => boton.addEventListener('click', () => {
      const li = boton.closest('li'), id = li.dataset.id, r = evaluarEnclavamiento(id, contexto.sim().estado());
      li.querySelector('.enc-resultado').textContent = `${r.ok ? '✔' : '✘'} ${r.detalle}`;
      registro.anotar('enclavamiento', `${id}: ${r.ok ? 'superada' : 'no superada'}. ${r.detalle}`, { id, ok: r.ok });
    }));
    q('.dia-aplicar').addEventListener('click', () => {
      const tag = q('.dia-tag').value, accion = q('.dia-accion').value, r = aplicarSolucion(contexto.sim(), { accion, tag });
      q('.dia-resultado').textContent = `${r.resuelta ? '✔' : '✘'} ${r.mensaje}`;
      registro.anotar('diagnostico', `${accion} ${tag}: ${r.resuelta ? 'resuelta' : 'sin efecto'}${q('.dia-causa').value ? ' · causa: ' + q('.dia-causa').value : ''}`, { tag, accion, resuelta: r.resuelta });
    });
    q('.reg-csv').addEventListener('click', () => descargarCsv(registro.aCsv(), 'registro_htst.csv'));
    q('.reg-limpiar').addEventListener('click', () => { registro.limpiar(); pintarRegistro(); });
    function pintarRegistro() {
      q('.registro-lista').innerHTML = registro.entradas().slice().reverse().map(e => `<li><time>${e.tiempoS} s</time> <b>${e.tipo}</b> ${e.texto.replace(/</g, '&lt;')}</li>`).join('') || '<li>Todavía no has anotado nada.</li>';
    }
    pintarRegistro();
    setInterval(pintarRegistro, 1000);
  }

  const api = { TIPOS_REGISTRO, crearRegistro, registroACsv, PUNTOS_CALIBRACION_PCT, TOLERANCIA_FONDO_ESCALA_PCT, lazosCalibrables, mAEsperado, evaluarLazo,
    TEXTO_DIAGNOSTICO_LAZO, PRUEBAS_ENCLAVAMIENTO, evaluarEnclavamiento, ACCIONES_REPARACION, aplicarSolucion, crearHojas };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstHojas = api;
})();
