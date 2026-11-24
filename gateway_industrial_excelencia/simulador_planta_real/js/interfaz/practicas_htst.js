// Prácticas guiadas de mantenimiento de la planta real HTST (lógica pura, sin DOM; se prueba con node:test en tests/interfaz_practicas.test.js).
// Misma estructura que las del simulador fotovoltaico: una práctica es una ORDEN DE TRABAJO con pasos que el alumno cumple con el multímetro y con las maniobras de la planta.
// El guion NO mide por él: lee el registro de actuaciones (las medidas que el alumno anota con «Medir y anotar») y el estado de la planta, y solo avanza cuando la medida es la
// pedida y su valor es el que corresponde. Tipos de paso:
//   'medida'    { instrumento: 'multimetro', modo: 'V' | 'mA' | 'ohm' | 'presion' | 'temperatura', puntos: [punto…] (alternativas), rango?: { min, max, abs? }, extra?(entrada, medir) → texto de fallo }
//   'accion'    { cumple(estado) → boolean }  (estado de la planta: modo, equipos…)
//   'respuesta' { pregunta, opciones: [texto], correcta: índice, siFalla }
// Examen: la misma práctica sin pistas, sin pasos y sin ✓; mide libremente, contesta y entrega. Nota 50 % medidas y maniobras + 50 % respuestas; cada maniobra peligrosa resta 1,5.
(function () {
  const enNode = typeof require !== 'undefined';
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const enRango = (v, r) => typeof v === 'number' && !Number.isNaN(v) && v >= r.min && v <= r.max;
  const PUNTOS_NOTA = { pista: 0.4, fallo: 0.2, peligro: 1.5 };
  const SIM = 'planta_real';

  /* ---------- pasos ---------- */
  const medida = (modo, punto, titulo, rango, porQue, pistas, extra) => ({ tipo: 'medida', instrumento: 'multimetro', modo, puntos: [[punto]], rango: Object.assign({ abs: true }, rango), titulo, porQue, pistas, extra });
  const pregunta = (pregunta, opciones, correcta, porQue, pistas, siFalla) => ({ tipo: 'respuesta', pregunta, titulo: pregunta, opciones, correcta, porQue, pistas, siFalla });
  const accion = (titulo, cumple, porQue, pistas) => ({ tipo: 'accion', titulo, cumple, porQue, pistas });
  /** «La lectura es claramente menor que la del gemelo»: el gemelo se mide en vivo, así vale a cualquier hora. */
  const menosQue = (modo, gemelo, margen, que) => (e, medir) => { const l = medir && medir(gemelo, modo); return l && num(l.valor) && l.valor - Math.abs(e.valor) >= margen ? '' : que; };

  const PRACTICAS = [
    {
      id: 'H1', titulo: 'Control todo o nada del calentador', nivel: 'Preventivo', duracionMin: 15, averia: null,
      orden: 'Revisión del calentador de agua HW-201. En modo MANUAL, el PLC mantiene el agua a 60 °C conectando y desconectando los dos bancos de resistencias con un control todo o nada con histéresis (banda de 4 °C). Comprueba con el multímetro cómo trabajan los contactores KM-201 y KM-202. Arranca la simulación (Iniciar) y sube la velocidad (5× o 20×) para ver el ciclo.',
      pasos: [
        medida('V', 'KM-201:BOBINA', 'Con el MULTÍMETRO (V), mide la bobina del contactor KM-201 mientras el banco 1 está conectado.', { min: 20, max: 28 }, 'Una bobina con 24 V atrae el contactor: el banco de resistencias está conectado y el agua se calienta.',
          ['Abre la pestaña Instrumentos y elige el multímetro.', 'Función Tensión (V) y punto «KM-201 · bobina».', 'Pulsa «Medir y anotar»: debe marcar unos 24 V (si marca 0 V, espera a que el agua baje y vuelva a conectar).']),
        medida('V', 'KM-201:CARGA', 'Mide ahora la salida de potencia de KM-201 (hacia las resistencias).', { min: 350, max: 440 }, 'Con el contactor cerrado, las resistencias reciben la tensión de potencia (400 V): coincide con los 24 V de la bobina.',
          ['Es el mismo contactor, pero el lado de potencia.', 'Punto «KM-201 · carga», función Tensión (V).', 'Debe marcar unos 400 V.']),
        medida('V', 'KM-202:BOBINA', 'Mide la bobina del segundo contactor, KM-202 (banco 2).', { min: 20, max: 28 }, 'Mientras el agua está por debajo de la consigna, los dos bancos conectan a la vez: los dos contactores tienen 24 V.',
          ['Es el contactor del banco 2.', 'Punto «KM-202 · bobina».', 'Debe marcar unos 24 V.']),
        medida('V', 'KM-201:BOBINA', 'Deja correr la simulación hasta que el agua llegue a la consigna y el calentador se desconecte, y vuelve a medir la bobina de KM-201: debe estar a 0 V.', { min: 0, max: 2 }, 'Al llegar a la consigna el PLC desconecta el contactor (bobina a 0 V): el calentador se apaga hasta que el agua baje la banda de histéresis.',
          ['El agua tarda unos minutos de simulación en subir unos grados.', 'Pulsa Iniciar y usa 5× o 20×; mira TT-201 en el esquema.', 'Cuando el calentador se desconecte (TT-201 en torno a 62 °C), mide otra vez «KM-201 · bobina»: 0 V.']),
        pregunta('¿Qué tipo de control es éste?', ['Todo o nada con histéresis', 'Proporcional (PID)', 'Control en cascada'], 0, 'El contactor solo tiene dos estados: conectado o desconectado. Es un control todo o nada, y la histéresis evita que conmute sin parar.',
          ['Mira cuántos estados tiene el contactor.', 'Solo conectado o desconectado.', 'Es todo o nada con histéresis.'], 'El contactor solo conecta o desconecta (no modula la potencia): es todo o nada.'),
        pregunta('¿Para qué sirve la banda de histéresis?', ['Evita conectar y desconectar los contactores continuamente', 'Hace que el agua llegue antes', 'Protege la bomba P-201'], 0, 'Sin banda, el agua rondaría la consigna y los contactores conmutarían cada pocos segundos: se desgastarían. La histéresis alarga los ciclos.',
          ['Piensa en el desgaste del contactor.', 'Sin banda, conmutaría constantemente.', 'Evita conmutaciones continuas.'], 'La banda no calienta más deprisa ni protege la bomba: evita las conmutaciones constantes.'),
      ],
      conclusion: 'Parte de revisión: calentador HW-201 con control todo o nada con histéresis sobre TT-201 (consigna 60 °C, banda 4 °C). KM-201 y KM-202 conectan juntos (bobina 24 V, potencia 400 V) por debajo de la banda y desconectan (bobina 0 V) al superar la consigna en media banda (≈ 62 °C). Sin anomalías.',
    },
    {
      id: 'H2', titulo: 'Bomba P-101 y variador', nivel: 'Correctivo', duracionMin: 25, averia: 'AV-FILTRO-OBSTRUIDO',
      orden: 'Aviso del operador: «La bomba de alimentación P-101 mueve menos leche de la normal y no hay ninguna avería evidente». Localiza si el problema está en el filtro, en la bomba o en el variador, y deja la planta segura para intervenir.',
      pasos: [
        medida('presion', 'FLT-101:PRESION-ANTES', 'Con el MULTÍMETRO (función Presión), mide la presión ANTES del colador FLT-101.', { min: 0.3, max: 0.5 }, 'La presión de entrada es normal (≈ 0,4 bar): la aspiración desde el tanque está bien.',
          ['Abre Instrumentos y elige el multímetro.', 'Función Presión (bar), punto «FLT-101 · presión antes».', 'Debe marcar unos 0,4 bar.']),
        medida('presion', 'FLT-101:PRESION-DESPUES', 'Mide ahora la presión DESPUÉS del colador.', { min: 0, max: 0.35 }, 'Después del colador hay claramente menos presión que antes: el colador está frenando el paso de la leche (pérdida de carga).',
          ['Es el otro punto del colador.', 'Punto «FLT-101 · presión después».', 'Debe salir bastante menos que antes (unos 0,2 bar).'],
          menosQue('presion', 'FLT-101:PRESION-ANTES', 0.08, 'La presión después del colador no es claramente menor que antes: repasa los dos puntos.')),
        medida('temperatura', 'VFD-101:DISIPADOR', 'Descarta el variador: mide la temperatura del disipador de VFD-101.', { min: 25, max: 70 }, 'El disipador está a temperatura normal (< 70 °C): el variador no se está sobrecalentando, no es el problema.',
          ['Función Temperatura (°C).', 'Punto «VFD-101 · disipador».', 'Un variador sobrecalentado pasaría de 90 °C.']),
        medida('V', 'VFD-101:VENTILADOR', 'Mide la alimentación del ventilador del variador.', { min: 20, max: 28 }, 'El ventilador tiene sus 24 V: el variador se enfría bien.',
          ['Función Tensión (V).', 'Punto «VFD-101 · ventilador».', 'Debe marcar unos 24 V.']),
        pregunta('¿Cuál es la causa?', ['Colador FLT-101 obstruido', 'Variador VFD-101 sobrecalentado', 'Bomba P-101 averiada', 'Placa del intercambiador perforada'], 0, 'Hay mucha pérdida de carga en el colador, y el variador y su ventilador están bien: el colador está obstruido. Se limpia o se sustituye.',
          ['La caída de presión está en un punto concreto.', 'Antes y después del colador hay mucha diferencia.', 'Es el colador de aspiración FLT-101.'], 'El variador está frío y el ventilador funciona; la pérdida de presión está en el colador.'),
        accion('SEGURIDAD: antes de abrir el colador, pon la planta en modo PARADA.', e => e.modo === 'PARADA', 'No se abre un colador con la bomba en marcha: la leche caliente saldría a presión. Primero se para la planta y luego se interviene.',
          ['Parar la planta antes de intervenir.', 'Cambia el modo de funcionamiento.', 'Elige PARADA en el selector de modo.']),
      ],
      conclusion: 'Parte de avería: colador de aspiración FLT-101 obstruido. Presión antes ≈ 0,4 bar y después ≈ 0,2 bar; variador VFD-101 sano (disipador ≈ 46 °C, ventilador a 24 V). Planta en PARADA para intervenir. Reparación: limpiar o sustituir el colador y comprobar la presión de nuevo.',
    },
    {
      id: 'H3', titulo: 'Lazos 4-20 mA y sensores', nivel: 'Correctivo', duracionMin: 25, averia: 'AV-PT100-ABIERTA',
      orden: 'Aviso: «La temperatura de TT-103 (el termómetro legal) da un valor imposible y el PLC no se fía de él». Localiza si el fallo es del cable (lazo), del sensor o del transmisor midiendo en el lazo 4-20 mA.',
      pasos: [
        medida('mA', 'TT-102:LAZO', 'Con el MULTÍMETRO (función mA), mide el lazo de un sensor sano de la misma familia: TT-102.', { min: 10, max: 18 }, 'Un lazo sano trabaja dentro de 4-20 mA, en este caso unos 14 mA: es la referencia con la que comparar.',
          ['Abre Instrumentos y elige el multímetro.', 'Función Corriente (mA) y punto «TT-102 · lazo».', 'Debe marcar entre 10 y 18 mA.']),
        medida('mA', 'TT-103:LAZO', 'Mide ahora el lazo del sensor sospechoso, TT-103.', { min: 21, max: 22.5 }, 'Más de 21 mA es sobreescala (NAMUR NE43): el transmisor indica un fallo del sensor, no una temperatura real.',
          ['Es el mismo tipo de punto, otro sensor.', 'Punto «TT-103 · lazo», función mA.', 'Debe marcar más de 21 mA.']),
        medida('ohm', 'TT-103:PT100', 'Mide la resistencia de la sonda Pt100 de TT-103 (desconectada del lazo).', { min: 1e5, max: Infinity }, 'La Pt100 debería tener unos 129 Ω a la temperatura de pasteurización. «OL» (circuito abierto) significa que la sonda está cortada.',
          ['La sonda se mide en ohmios y sin tensión.', 'Función Resistencia (Ω), punto «TT-103 · Pt100».', 'Marca OL (circuito abierto).']),
        pregunta('¿Qué indica una corriente de lazo por encima de 21 mA?', ['Sobreescala: sensor abierto o fallo del transmisor', 'Una temperatura de 120 °C real', 'Un lazo sano'], 0, 'Por encima de 21 mA el transmisor avisa de un fallo (sobreescala); por debajo de 3,6 mA indica un hilo roto.',
          ['Mira los límites del lazo.', 'Los lazos sanos están entre 4 y 20 mA.', 'Es una sobreescala por fallo.'], 'Un lazo no pasa de 20 mA de forma normal: lo que supera 21 mA es un fallo.'),
        pregunta('¿Cuál es la causa?', ['Sonda Pt100 de TT-103 abierta', 'Lazo de TT-103 cortado (hilo roto)', 'Deriva de calibración', 'Fuente de 24 V caída'], 0, 'El lazo da 21,5 mA y la sonda marca OL: la Pt100 está abierta. Si el hilo estuviera roto, el lazo marcaría 0 mA.',
          ['Compara lo que dio el lazo con lo que dio la sonda.', 'Un hilo roto daría 0 mA, no 21,5.', 'Es la sonda Pt100 abierta.'], 'Un hilo roto daría 0 mA y una deriva no cambia tanto el lazo: aquí la sonda está abierta.'),
        pregunta('¿Qué hace el PLC con la señal de TT-103 en este caso?', ['La marca como defectuosa y no se fía de su valor', 'Sigue usándola como si fuera válida', 'La sube automáticamente a 4 mA'], 0, 'El PLC evalúa la calidad de cada entrada (NAMUR): una señal en sobreescala se marca mala y no se usa para pasteurizar.',
          ['Piensa en la seguridad del producto.', 'No se puede fiar de un valor imposible.', 'La marca como mala.'], 'Un valor en sobreescala no es fiable: el PLC lo marca como defectuoso.'),
      ],
      conclusion: 'Parte de avería: sonda Pt100 de TT-103 abierta. Lazo de TT-103 en sobreescala (≈ 21,5 mA, alarma A102) frente a los ≈ 14 mA del lazo sano de TT-102; Pt100 en circuito abierto (OL). Reparación: comprobar el cableado y sustituir la sonda, y recalibrar el lazo.',
    },
  ];

  /* ---------- preparación del escenario (la usan la página y las pruebas) ---------- */
  const correr = (sim, segundos, dt = 5) => { for (let t = 0; t < segundos; t += dt) sim.paso(dt); };
  /** Planta sana y parada: quita las averías (reiniciar() NO las quita) y vuelve al comienzo. */
  function restaurar(sim) {
    for (const i of sim.averias.activas().slice()) sim.averias.quitar(i.instancia);
    sim.reiniciar();
  }
  /** Deja la planta en las condiciones de la práctica (con su avería oculta, si la tiene). */
  function preparar(sim, practica) {
    restaurar(sim);
    if (practica.id === 'H1') {
      sim.ordenes.modo('MANUAL'); sim.paso(1);
      sim.ordenes.nivelDeposito('HW-201', 100);
      sim.ordenes.manual('P-201', 1);
      sim.ordenes.controlTemperatura({ modo: 'histeresis', consignaC: 60, bandaC: 4 });
      for (let t = 0; t < 1800 && !(sim.estado().aguaCaliente.temperaturaC >= 52); t += 5) sim.paso(5);
    } else {
      sim.ordenes.arrancar();
      for (let t = 0; t < 3000 && sim.estado().modo !== 'PRODUCCION'; t += 10) sim.paso(10);
      sim.paso(120);
      if (practica.averia) { sim.averias.inyectar(practica.averia, practica.id === 'H3' ? { tag: 'TT-103' } : {}); correr(sim, 120); }
    }
  }

  /* ---------- el registro de actuaciones visto como cuaderno de medidas ---------- */
  /** Entradas de medida del registro (HTST: { n, tipo: 'medida', texto, datos }) con la forma de cuaderno que entiende el guion. `desde` = n a partir del cual cuentan. */
  function aEntradas(entradas, desde = 0) {
    return entradas.filter(e => e.tipo === 'medida' && e.n > desde && e.datos && e.datos.instrumento).map(e => {
      const d = e.datos, punto = d.punto || d.puntoA || '';
      return { id: e.n, hora: `${Math.round(e.tiempoS || 0)} s`, instrumento: d.instrumento, modo: d.funcion || d.modo || '', puntos: punto ? [punto] : [], valor: num(d.valor) ? d.valor : null,
        texto: d.texto || '', peligro: false, valida: !/^ERR/i.test(d.texto || '') };
    });
  }
  /** Cuaderno para el guion a partir del registro de la página: solo cuenta lo anotado desde que empezó la práctica. */
  function cuadernoDeRegistro(registro) {
    let desde = 0;
    return { marcar() { const l = registro.entradas(); desde = l.length ? l[l.length - 1].n : 0; }, lista: () => aEntradas(registro.entradas(), desde), limpiar() { this.marcar(); } };
  }

  /* ---------- guion ---------- */
  const claveCasa = (a, b) => [...a].map(String).sort().join('|') === [...b].map(String).sort().join('|');
  function entradaCasa(e, p) {
    if (!e || e.instrumento !== p.instrumento || (p.modo && e.modo !== p.modo)) return false;
    return (p.puntos || []).some(alt => (alt instanceof RegExp ? (e.puntos || []).length === 1 && alt.test(e.puntos[0]) : claveCasa(alt, e.puntos || [])));
  }
  function mirarMedida(p, lista, medir) {
    const cand = lista.filter(e => entradaCasa(e, p));
    if (!cand.length) return { ok: false, falta: true };
    let ultimoFallo = '';
    for (const e of cand.slice().reverse()) {
      if (e.valida === false) { ultimoFallo = 'Esa medida no es válida. Corrígela y repítela.'; continue; }
      if (p.rango) {
        const crudo = e.valor === null && /OL|abierto/i.test(e.texto || '') ? Infinity : e.valor, v = p.rango.abs && num(crudo) ? Math.abs(crudo) : crudo;
        if (!enRango(v, p.rango)) { ultimoFallo = `Has medido ${e.texto || 'otro valor'}, pero no es el esperado en este punto. Repasa la función del multímetro y el punto elegido.`; continue; }
      }
      const extra = p.extra ? p.extra(e, medir) : '';
      if (extra) { ultimoFallo = extra; continue; }
      return { ok: true };
    }
    return { ok: false, texto: ultimoFallo };
  }

  /**
   * Crea el guion de una práctica. ctx: { sim() , cuaderno, medir?(punto, modo) → { valor } (medida en vivo para las comprobaciones «menos que el gemelo») }.
   * Misma API que la de la fotovoltaica: pasoActual, indice, evaluar, responder, pista, nivelPista, anotarPeligro, nota, resumen, completados, ultimoMensaje.
   */
  function crearGuion(practica, ctx) {
    let indice = 0, pistas = 0, fallos = 0, nPeligros = 0, nivelPista = 0, ultimoMensaje = '', completados = [];
    const lista = () => (ctx.cuaderno ? ctx.cuaderno.lista() : []);
    const g = {
      practica,
      get indice() { return indice; }, get hecho() { return indice >= practica.pasos.length; }, get pistasUsadas() { return pistas; }, get fallos() { return fallos; },
      get peligros() { return nPeligros; }, get completados() { return completados.slice(); }, get ultimoMensaje() { return ultimoMensaje; },
      pasoActual() { return indice < practica.pasos.length ? practica.pasos[indice] : null; },
      evaluar() {
        let avanzo = false, mensaje = '';
        while (indice < practica.pasos.length) {
          const p = practica.pasos[indice];
          if (p.tipo === 'respuesta') break;
          let ok = false;
          if (p.tipo === 'medida') {
            const r = mirarMedida(p, lista(), ctx.medir);
            if (r.ok) ok = true; else if (r.texto && r.texto !== ultimoMensaje) { fallos++; mensaje = r.texto; ultimoMensaje = r.texto; }
          } else if (p.tipo === 'accion') ok = !!p.cumple(ctx.sim().estado());
          if (!ok) break;
          completados.push({ id: indice, porQue: p.porQue }); indice++; nivelPista = 0; avanzo = true; ultimoMensaje = '';
        }
        return { avanzo, mensaje };
      },
      responder(k) {
        const p = g.pasoActual();
        if (!p || p.tipo !== 'respuesta') return { ok: false, mensaje: '' };
        if (Number(k) === p.correcta) { completados.push({ id: indice, porQue: p.porQue }); indice++; nivelPista = 0; ultimoMensaje = ''; g.evaluar(); return { ok: true, mensaje: p.porQue }; }
        fallos++; ultimoMensaje = p.siFalla || 'No es esa. Vuelve a mirar tus medidas.'; return { ok: false, mensaje: ultimoMensaje };
      },
      pista() {
        const p = g.pasoActual(); if (!p) return '';
        const lv = Math.min(nivelPista, (p.pistas || []).length - 1);
        if (nivelPista < (p.pistas || []).length) { nivelPista++; pistas++; }
        return (p.pistas || [])[lv] || '';
      },
      nivelPista: () => nivelPista,
      anotarPeligro(texto) { nPeligros++; ultimoMensaje = texto || ultimoMensaje; },
      nota() { return Math.max(0, Math.min(10, +(10 - pistas * PUNTOS_NOTA.pista - fallos * PUNTOS_NOTA.fallo - nPeligros * PUNTOS_NOTA.peligro).toFixed(1))); },
      resumen() { return { id: practica.id, titulo: practica.titulo, nota: g.nota(), pasos: practica.pasos.length, pistas, fallos, peligros: nPeligros, conclusion: practica.conclusion }; },
    };
    return g;
  }

  /** Corrige un EXAMEN (ver la fotovoltaica): medidas y maniobras en cualquier orden + respuestas de una vez. ctx: { sim(), cuaderno, medir, respuestas, peligros, intento }. */
  function evaluarExamen(practica, ctx) {
    const lista = ctx.cuaderno ? ctx.cuaderno.lista() : [], estado = ctx.sim().estado();
    let hechas = 0, totalM = 0, acertadas = 0, totalR = 0;
    const pasos = [];
    practica.pasos.forEach((p, k) => {
      let ok;
      if (p.tipo === 'respuesta') { totalR++; ok = Number((ctx.respuestas || {})[k]) === p.correcta; if (ok) acertadas++; }
      else { totalM++; ok = p.tipo === 'accion' ? !!p.cumple(estado) : mirarMedida(p, lista, ctx.medir).ok; if (ok) hechas++; }
      pasos.push({ paso: k + 1, tipo: p.tipo, ok: !!ok });
    });
    const peligros = ctx.peligros || 0;
    const base = 10 * (0.5 * (totalM ? hechas / totalM : 1) + 0.5 * (totalR ? acertadas / totalR : 1));
    const nota = Math.max(0, Math.min(10, +(base - PUNTOS_NOTA.peligro * peligros).toFixed(1)));
    const corto = (t, n) => String(t == null ? '' : t).slice(0, n);
    const detPasos = pasos.map((x, k) => Object.assign({}, x, { titulo: corto(practica.pasos[k].titulo, 140) }));
    const detRespuestas = [];
    practica.pasos.forEach((p, k) => {
      if (p.tipo !== 'respuesta') return;
      const e = (ctx.respuestas || {})[k], dada = e === undefined || e === null ? null : Number(e);
      detRespuestas.push({ pregunta: corto(p.pregunta, 140), elegida: dada === null ? '' : corto(p.opciones[dada], 120), correcta: corto(p.opciones[p.correcta], 120), ok: dada === p.correcta });
    });
    const detCuaderno = lista.slice(-25).map(e => ({ hora: corto(e.hora, 20), instrumento: e.instrumento, modo: e.modo || '', puntos: (e.puntos || []).slice(0, 2).join(' ↔ '), texto: corto(e.texto, 80), valida: e.valida !== false, peligro: !!e.peligro }));
    return { nota, medidas: { hechas, total: totalM }, respuestas: { acertadas, total: totalR }, peligros,
      detalle: { practica: practica.id, titulo: practica.titulo, nota, intento: ctx.intento || 1, resumenMedidas: `${hechas} de ${totalM}`, resumenRespuestas: `${acertadas} de ${totalR}`, peligros,
        pasos: detPasos, respuestas: detRespuestas, cuaderno: detCuaderno } };
  }

  /* ---------- icono de la operación ---------- */
  function icono(paso) {
    if (!paso) return { glifo: '', etiqueta: '', clase: '' };
    if (paso.tipo === 'respuesta') return { glifo: '?', etiqueta: 'Pregunta', clase: 'pregunta' };
    if (paso.tipo === 'accion') return { glifo: '⏻', etiqueta: 'Maniobra de seguridad', clase: 'accion' };
    const m = { V: ['V', 'Multímetro en tensión'], mA: ['mA', 'Multímetro en corriente de lazo'], ohm: ['Ω', 'Multímetro en resistencia'], continuidad: ['Ω', 'Multímetro en continuidad'], presion: ['bar', 'Multímetro en presión'], temperatura: ['°C', 'Multímetro en temperatura'] }[paso.modo];
    return { glifo: m ? m[0] : 'V', etiqueta: m ? m[1] : 'Multímetro', clase: 'multimetro' };
  }

  /* ---------- informe descargable (alumno) ---------- */
  const escH = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const notaTxt = n => (typeof n === 'number' ? n.toFixed(1).replace('.', ',') : '—');
  /** Informe HTML autónomo (se imprime o se guarda como PDF). Mientras queden intentos (`cerrado` false) NO enseña las respuestas correctas ni los pasos pedidos. */
  function informeHtml(info) {
    const d = info.detalle || {}, cerrado = !!info.cerrado;
    const filasResp = (d.respuestas || []).map(r => `<tr><td>${escH(r.pregunta)}</td><td>${escH(r.elegida || 'Sin contestar')}</td>${cerrado ? `<td>${escH(r.correcta)}</td><td class="${r.ok ? 'ok' : 'mal'}">${r.ok ? '✓ Correcta' : '✗ Incorrecta'}</td>` : ''}</tr>`).join('');
    const filasMed = (d.cuaderno || []).map(e => `<tr><td>${escH(e.hora)}</td><td>Multímetro ${escH(e.modo)}</td><td>${escH(e.puntos)}</td><td>${escH(e.texto)}</td></tr>`).join('');
    const filasPasos = (d.pasos || []).filter(x => x.titulo).map(x => `<tr><td>${x.paso || ''}</td><td>${escH(x.titulo)}</td><td class="${x.ok ? 'ok' : 'mal'}">${x.ok ? '✓' : '✗'}</td></tr>`).join('');
    const resumen = [info.tipo === 'Examen' ? ['Medidas y maniobras pedidas', d.resumenMedidas] : null, info.tipo === 'Examen' ? ['Respuestas acertadas', d.resumenRespuestas] : null,
      d.pistas !== undefined ? ['Pistas usadas', d.pistas] : null, d.fallos !== undefined ? ['Respuestas o medidas erróneas', d.fallos] : null, ['Maniobras peligrosas', d.peligros || 0]].filter(Boolean);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Informe · ${escH(d.titulo || info.titulo || 'Práctica')}</title>
<style>body{font:16px/1.45 system-ui,sans-serif;margin:24px auto;max-width:820px;padding:0 16px;color:#1b1b1b}h1{margin:0 0 4px;font-size:1.4rem}h2{margin:22px 0 6px;font-size:1.1rem;border-bottom:2px solid #d0d0d0}.meta{color:#555;margin:0 0 12px}.nota{font-size:2rem;font-weight:700;margin:8px 0}table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f1f1}.ok{color:#1b6e2d;font-weight:700}.mal{color:#a01818;font-weight:700}ul{padding-left:20px}footer{margin-top:28px;font-size:.8rem;color:#666}@media print{body{margin:0}}</style></head><body>
<h1>Informe de ${info.tipo === 'Examen' ? 'examen' : 'práctica'} · ${escH(d.titulo || info.titulo || '')}</h1>
<p class="meta">${info.alumno ? `Alumno: <b>${escH(info.alumno)}</b> · ` : ''}${escH(info.fecha || '')}${info.intento ? ` · Intento ${info.intento}${info.intentosMax ? ' de ' + info.intentosMax : ''}` : ''} · Planta real HTST · CIFP Politécnico de Cartagena</p>
<p class="nota">Nota: ${notaTxt(d.nota)} / 10</p>
<ul>${resumen.map(([k, v]) => `<li>${escH(k)}: <b>${escH(v)}</b></li>`).join('')}</ul>
${filasResp ? `<h2>Respuestas</h2><table><thead><tr><th>Pregunta</th><th>Tu respuesta</th>${cerrado ? '<th>Respuesta correcta</th><th>Resultado</th>' : ''}</tr></thead><tbody>${filasResp}</tbody></table>${cerrado ? '' : '<p class="meta">Las respuestas correctas se mostrarán cuando termines todos tus intentos.</p>'}` : ''}
${filasMed ? `<h2>Medidas realizadas (registro)</h2><table><thead><tr><th>Tiempo</th><th>Instrumento</th><th>Punto</th><th>Lectura</th></tr></thead><tbody>${filasMed}</tbody></table>` : ''}
${cerrado && filasPasos ? `<h2>Pasos pedidos</h2><table><thead><tr><th>N.º</th><th>Qué se pedía</th><th></th></tr></thead><tbody>${filasPasos}</tbody></table>` : ''}
${cerrado && d.conclusion ? `<h2>Parte de mantenimiento</h2><p>${escH(d.conclusion)}</p>` : ''}
<footer>© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.</footer></body></html>`;
  }
  const nombreInforme = (tipo, id, fecha) => `informe_${tipo === 'Examen' ? 'examen' : 'practica'}_${id}_${String(fecha || '').replace(/[^0-9-]/g, '').slice(0, 10) || 'hoy'}.html`;
  const porId = id => PRACTICAS.find(p => p.id === id) || null;

  const api = { SIM, PRACTICAS, PUNTOS_NOTA, preparar, restaurar, aEntradas, cuadernoDeRegistro, crearGuion, evaluarExamen, informeHtml, nombreInforme, porId, icono, entradaCasa, mirarMedida };
  void enNode;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).htstPracticas = api;
})();
