/* Ayuda contextual del simulador PCT23: clic derecho sobre un elemento del esquema
 * (o de una tarjeta de control) y se abre una ventana que explica qué es.
 * Los textos salen del manual de la PCT23; lo que es propio de la simulación se
 * indica aparte, en "En el simulador". Sin red ni dependencias. */
(() => {
  'use strict';

  const D = {
    N1: { t: 'N1 · Bomba de alimentación (feed unit)', tag: 'Bomba peristáltica',
      q: 'Impulsa el producto desde el tanque elegido por SOL2 hacia el intercambiador de placas. Su velocidad se ajusta en la consola (en la maqueta, por PWM) y se enciende y apaga aparte.',
      s: 'Acción en J7 OUT08, sentido de giro en OUT06 y velocidad por PWM (PWMOut1). Si N1 gira en sentido inverso, el modelo no mueve producto.', m: 'p. 8 y 17' },
    N2: { t: 'N2 · Bomba de agua caliente (heat unit)', tag: 'Bomba peristáltica',
      q: 'Hace circular el agua caliente del depósito con calefactor por la sección de calentamiento del intercambiador. El manual la describe con ajuste de velocidad manual o todo/nada.',
      s: 'Acción en J7 OUT07, sentido de giro en OUT05 y velocidad por PWM (PWMOut2). Sin N2 el producto casi no se calienta.', m: 'p. 8 y 14' },
    SOL1: { t: 'SOL1 · Válvula solenoide de tres vías', tag: 'Electroválvula',
      q: 'Está después del tubo de residencia. En posición normal deja pasar el producto hacia el resto del proceso y la salida. Si el producto no está a la temperatura correcta se rechaza: el producto sale por la toma de desvío y vuelve al tanque de alimentación.',
      s: 'Relé K3. Activa = producto desviado: se ilumina la rama de DIVERTED PRODUCT y se apaga la de producto acabado. El volumen desviado vuelve al tanque.', m: 'p. 8 y 16' },
    SOL2: { t: 'SOL2 · Selección del tanque de alimentación', tag: 'Electroválvula',
      q: 'Elige de qué tanque aspira la bomba N1: el A o el B.',
      s: 'Relé K4. En reposo alimenta desde A; activa, desde B. El manual no detalla el sentido físico exacto, así que esta correspondencia es una convención del simulador.', m: 'p. 8 y 16' },
    SOL3: { t: 'SOL3 · Agua de refrigeración del producto', tag: 'Electroválvula',
      q: 'Abre o corta el paso del agua fría al intercambiador de enfriamiento. Es la última etapa de enfriamiento del producto antes de la salida.',
      s: 'Relé K5. Abierta: el producto sale más frío (T3) y se cuenta agua enviada a desagüe.', m: 'p. 9 y 16' },
    SOL4: { t: 'SOL4 · Llenado del tanque A', tag: 'Electroválvula',
      q: 'Válvula solenoide de llenado del tanque de alimentación A.', s: 'Relé K6. Abierta, el tanque A se rellena en el modelo.', m: 'p. 8 y 16' },
    SOL5: { t: 'SOL5 · Llenado del tanque B', tag: 'Electroválvula',
      q: 'Válvula solenoide de llenado del tanque de alimentación B.', s: 'Relé K7. Abierta, el tanque B se rellena en el modelo.', m: 'p. 8 y 16' },
    T1: { t: 'T1 · Salida del tubo de residencia', tag: 'Sensor de temperatura',
      q: 'Mide el producto a la salida del tubo de residencia, justo antes de SOL1. Es la temperatura que decide si el producto se acepta o se desvía. Rango del sensor: 0-150 °C.',
      s: 'Es la variable que mantiene la secuencia automática en producción.', m: 'p. 9' },
    T2: { t: 'T2 · Temperatura del agua caliente', tag: 'Sensor de temperatura',
      q: 'Mide el agua del depósito con calefactor (heat unit). Rango del sensor: 0-150 °C.', s: 'Baja cuando el producto circula por el intercambiador, porque se lleva calor del agua (más caudal, más bajada). Si T2 pasa del umbral del modelo salta el corte térmico simulado.', m: 'p. 9' },
    T3: { t: 'T3 · Producto a la salida', tag: 'Sensor de temperatura',
      q: 'Mide el producto ya enfriado, antes de salir como producto acabado.', s: 'Depende de SOL3: con refrigeración sale más frío.', m: 'p. 9' },
    T4: { t: 'T4 · Salida de alimentación', tag: 'Sensor de temperatura',
      q: 'Mide el producto a la salida de la sección de alimentación, antes del filtro, de F1 y del tubo de residencia.', s: 'Va un poco por delante de T1: el producto lo alcanza antes de recorrer el tubo de residencia, que añade el retraso. Con la planta parada vuelve a la temperatura ambiente.', m: 'p. 9' },
    T5: { t: 'T5 · Sonda en el calentamiento', tag: 'Sensor de temperatura',
      q: 'Sonda auxiliar de temperatura. El manual dice que puede colocarse en cualquiera de los conectores; aquí está conectada a la sección de calentamiento del intercambiador.',
      s: 'Lee el producto a mitad de camino entre la entrada y T4 (supuesto del simulador): sube por delante de T1 y vuelve a la temperatura ambiente con la planta parada.', m: 'p. 9' },
    F1: { t: 'F1 · Sensor de caudal', tag: 'Sensor de caudal',
      q: 'Sensor de caudal tipo turbina instalado en la corriente de alimentación. Mide el caudal a la entrada del tubo de residencia. Un filtro en línea anterior evita que entre suciedad.',
      s: 'Muestra el caudal que mueve N1 (ml/min).', m: 'p. 9' },
    L1: { t: 'L1 · Sensor de nivel del tanque A', tag: 'Sensor de nivel',
      q: 'Sensor de presión conectado al tanque A que da una medida directa del nivel, de 0 a 250 mm.', s: 'Baja cuando N1 consume del tanque A y sube con SOL4.', m: 'p. 9' },
    LL: { t: 'LL · Flotador de nivel bajo (tanque B)', tag: 'Interruptor de nivel',
      q: 'Interruptor de flotador que detecta el nivel bajo en el tanque B.', s: 'Se activa cuando el tanque B queda al 20 % o menos, que es la altura a la que está dibujado.', m: 'p. 9' },
    HL: { t: 'HL · Flotador de nivel alto (tanque B)', tag: 'Interruptor de nivel',
      q: 'Interruptor de flotador que detecta el nivel alto en el tanque B. Se puede ajustar la altura deslizando su soporte por el casquillo de la base del tanque.', s: 'Se activa cuando el tanque B llega al 80 % o más, que es la altura a la que está dibujado.', m: 'p. 10' },
    HLC: { t: 'Nivel alto del depósito de calefacción', tag: 'Interruptor de nivel',
      q: 'Indicador de nivel del depósito de agua caliente (heat unit).', s: 'En el simulador no está modelado: permanece apagado.', m: 'p. 8' },
    LVL: { t: 'LVL · Interruptor de nivel del depósito caliente', tag: 'Interruptor de nivel',
      q: 'Interruptor de nivel del depósito de agua caliente. Protege al calefactor: si el nivel es bajo la consola enciende la alarma de nivel bajo.', s: 'En el simulador no está modelado: permanece apagado.', m: 'p. 8 y 15' },
    TERM: { t: 'STAT · Termostato del depósito caliente', tag: 'Protección',
      q: 'Termostato del tanque de agua caliente. Si hay sobretemperatura corta el calefactor y la consola lo indica con el piloto OVER TEMP.',
      s: 'Salta (corte térmico simulado) cuando T2 llega a 91 °C: desconecta la resistencia y el agua se enfría despacio. Se rearma por debajo de 70 °C y hay que volver a conectar la resistencia a mano.', m: 'p. 8 y 15' },
    RES: { t: 'Resistencia de calefacción (PWR)', tag: 'Calefactor',
      q: 'Elemento calefactor del depósito de agua caliente. La consola tiene un ajuste de potencia y un indicador en kW. En la maqueta son dos resistencias de 120 V en serie, alimentadas a 230 V.',
      s: 'OUT04 la conecta; su potencia se reparte por ráfagas de 50 ciclos de red (50 % = 25 ciclos de cada 50).', m: 'p. 8 y 15' },
    HEAT: { t: 'HEAT UNIT · Depósito de agua caliente', tag: 'Depósito',
      q: 'Depósito de agua caliente con elemento calefactor eléctrico (la resistencia), bomba de agua N2, termostato (STAT) e interruptor de nivel (LVL). Su agua caliente circula por la sección de calentamiento del intercambiador y calienta el producto. Si el nivel es bajo o hay sobretemperatura, la protección corta el calefactor.', s: 'Su temperatura es T2. El simulador lo supone siempre lleno: el interruptor de nivel no se modela. Se regula con la potencia de la resistencia y se mueve con N2.', m: 'p. 8 y 15' },
    TANKA: { t: 'Tanque de alimentación A', tag: 'Depósito',
      q: 'Tanque de producto con válvula de llenado SOL4 y sensor de nivel L1.', s: 'Se elige como origen con SOL2 en reposo.', m: 'p. 8' },
    TANKB: { t: 'Tanque de alimentación B', tag: 'Depósito',
      q: 'Tanque de producto con válvula de llenado SOL5 e interruptores de nivel alto (HL) y bajo (LL).', s: 'Se elige como origen activando SOL2.', m: 'p. 8' },
    V1: { t: 'V1 · Válvula de control de caudal del agua fría', tag: 'Válvula manual',
      q: 'Regula el caudal del agua fría que llega a SOL3 para la refrigeración.', s: 'Solo dibujo: no tiene efecto hidráulico en el modelo.', m: 'p. 9' },
    PRV1: { t: 'PRV1 · Válvula reductora de presión', tag: 'Válvula manual',
      q: 'Reduce la presión del suministro de agua fría.', s: 'Solo dibujo: sin efecto en el modelo.', m: 'p. 9' },
    V2: { t: 'V2 · Válvula manual', tag: 'Válvula manual',
      q: 'Válvula manual del circuito de alimentación entre los tanques. El manual no detalla su función.', s: 'Solo dibujo: sin efecto en el modelo.', m: 'p. 12 (diagrama)' },
    V3: { t: 'V3 · Válvula manual', tag: 'Válvula manual',
      q: 'Válvula manual situada junto al tanque B. El manual no detalla su función.', s: 'En el modo manual, clic para abrirla: vacía el tanque B (unos 600 ml/min, supuesto didáctico). En los otros modos es solo dibujo.', m: 'p. 12 (diagrama)' },
    FILTER: { t: 'FILTER · Filtro en línea', tag: 'Filtro',
      q: 'Filtro anterior a F1 que previene la entrada de suciedad en el tubo de residencia.', s: 'Solo dibujo: no se simula obstrucción.', m: 'p. 9' },
    HOLDING: { t: 'HOLDING TUBE · Tubo de residencia', tag: 'Tubería con aislamiento',
      q: 'Tubo aislado donde el producto se mantiene a la temperatura de proceso durante un tiempo. Es el tiempo muerto de la planta. Tras él, T1 mide la temperatura y SOL1 decide si el producto sigue o se rechaza.', s: 'El modelo lo aproxima con una inercia, no con un retardo de transporte.', m: 'p. 8' },
    REGEN: { t: 'Regeneración / precalentamiento', tag: 'Intercambiador de placas',
      q: 'Primera etapa del intercambiador: el producto que entra se precalienta con el calor del producto caliente que ya pasó el tubo de residencia, y así se ahorra energía.', s: 'Se modela como una recuperación de calor aproximada.', m: 'p. 8' },
    CALENT: { t: 'Calentamiento', tag: 'Intercambiador de placas',
      q: 'Etapa donde el agua caliente de N2 calienta el producto hasta la temperatura de proceso.', s: 'La ganancia térmica depende de N2, del caudal y de la potencia del calefactor.', m: 'p. 8' },
    ENFRIA: { t: 'Enfriamiento', tag: 'Intercambiador de placas',
      q: 'Última etapa: el agua fría de SOL3 enfría el producto lo más posible antes de la salida.', s: 'Con SOL3 cerrada casi no enfría.', m: 'p. 8' },
    DESVIO: { t: 'DIVERTED PRODUCT · Producto rechazado', tag: 'Salida de SOL1',
      q: 'Por aquí sale el producto que SOL1 rechaza por no estar a temperatura. Según el manual vuelve al tanque de alimentación.', s: 'Se ilumina solo cuando SOL1 está activa y N1 en marcha.', m: 'p. 8' },
    FINAL: { t: 'FINISHED PRODUCT · Producto acabado', tag: 'Salida',
      q: 'Salida del producto que ya ha pasado el tratamiento térmico y se ha enfriado.', s: 'Se ilumina con SOL1 sin activar y N1 en marcha.', m: 'p. 8' },
    DRAIN: { t: 'TO DRAIN · Desagüe', tag: 'Salida',
      q: 'Salida del agua de refrigeración, que va al desagüe.', s: 'El contador de agua a desagüe sube con SOL3 abierta.', m: 'p. 12 (diagrama)' },
    COLD: { t: 'COLD WATER · Suministro de agua fría', tag: 'Entrada',
      q: 'Entrada de agua fría de la red, con PRV1, V1 y SOL3 en su recorrido.', s: 'Sin límite de agua en el modelo.', m: 'p. 9' },
    TUBO_N1: { t: 'Tubería de producto', tag: 'Circuito',
      q: 'Recorrido del producto desde el tanque, por la bomba N1, el intercambiador, el filtro, F1 y el tubo de residencia hasta SOL1.', s: 'Se ilumina en azul con N1 en marcha.', m: 'p. 12 (diagrama)' },
    TUBO_N2: { t: 'Circuito de agua caliente', tag: 'Circuito',
      q: 'Recorrido del agua caliente: sale del depósito, la impulsa N2 por la sección de calentamiento y vuelve al depósito.', s: 'Se ilumina en naranja con N2 en marcha.', m: 'p. 12 (diagrama)' },
    TUBO_FRIO: { t: 'Circuito de agua fría', tag: 'Circuito',
      q: 'Agua fría de la red que pasa por SOL3, enfría el producto y se va al desagüe.', s: 'Se ilumina en verde azulado con SOL3 abierta.', m: 'p. 12 (diagrama)' },
    TUBO: { t: 'Tubería', tag: 'Conducto', q: 'Conducto del esquema de la planta.', s: 'Se ilumina cuando circula fluido por él.', m: 'p. 12 (diagrama)' },
  };

  const POR_TEXTO = { 'N1': 'N1', 'N2': 'N2', 'SOL1': 'SOL1', 'SOL2': 'SOL2', 'SOL3': 'SOL3', 'SOL4': 'SOL4', 'SOL5': 'SOL5',
    'T1': 'T1', 'T2': 'T2', 'T3': 'T3', 'T4': 'T4', 'T5': 'T5', 'F1': 'F1', 'L1': 'L1', 'LL': 'LL', 'V1': 'V1', 'V2': 'V2', 'V3': 'V3',
    'PRV1': 'PRV1', 'FILTER': 'FILTER', 'HOLDING TUBE': 'HOLDING', 'HEAT UNIT': 'HEAT', 'RES': 'RES', 'LVL': 'LVL',
    'TERM': 'TERM', 'A': 'TANKA', 'B': 'TANKB', 'DIVERTED PRODUCT': 'DESVIO', 'FINISHED PRODUCT': 'FINAL', 'TO DRAIN': 'DRAIN',
    'COLD WATER': 'COLD', 'REGENERACIÓN': 'REGEN', 'CALENTAMIENTO': 'CALENT', 'ENFRIAMIENTO': 'ENFRIA', 'DESVÍO': 'SOL1' };
  const POR_ID = { 'c-HL': 'HL', 'c-LL': 'LL', 'c-HLC': 'HLC', 'c-LVLC': 'LVL', 'c-TERM': 'TERM', 'c-PWR': 'RES', 'g-PWR': 'RES',
    'v-PWR': 'RES', 'resistencia': 'RES', 'v-QD': 'DESVIO', 'v-QF': 'FINAL', 'nivel-A': 'TANKA', 'nivel-B': 'TANKB', 'v-F1': 'F1', 'v-L1': 'L1' };

  const norm = s => s.replace(/[↑→←\s]+$/g, '').trim().toUpperCase();

  /* ---------- identificar el elemento pulsado ---------- */
  function clave(ev) {
    let el = ev.target;
    // tarjetas del panel de control: id "t-N1", "t-SOL1", "t-RES"...
    const tarjeta = el.closest && el.closest('[id^="t-"]');
    if (tarjeta && !el.closest('svg')) {
      const k = tarjeta.id.slice(2);
      return D[k] ? k : null;
    }
    const svg = el.closest && el.closest('svg');
    if (!svg) return null;

    for (let n = el; n && n !== svg; n = n.parentNode) {
      if (n.id && POR_ID[n.id]) return POR_ID[n.id];
      if (n.id && /^[gv]-/.test(n.id)) {
        const k = n.id.slice(2);
        if (D[k]) return k;
        if (/^T[1-5]$/.test(k)) return k;
      }
      if (n.dataset && n.dataset.salida && D[n.dataset.salida]) return n.dataset.salida;
    }
    // tuberías
    const tubo = el.closest('.tubo');
    if (tubo && tubo.tagName.toLowerCase() === 'path') {
      const d = tubo.dataset;
      if (d.ruta === 'desvio') return 'DESVIO';
      if (d.ruta === 'normal') return 'FINAL';
      if (d.solenoide) return d.solenoide;
      if (d.bomba === 'N2') return 'TUBO_N2';
      if (d.bomba === 'N1') return 'TUBO_N1';
      if (d.circuito) return 'TUBO_FRIO';
      return 'TUBO';
    }
    // cajas (depósitos, secciones del intercambiador): la etiqueta más cercana a la caja
    const CAJAS = ['HEAT', 'TANKA', 'TANKB', 'REGEN', 'CALENT', 'ENFRIA'];
    const claveCaja = rect => {
      const rb = rect.getBBox();
      let mejor = null, dmin = 40;
      for (const t of svg.querySelectorAll('text')) {
        const k = POR_TEXTO[norm(t.textContent)];
        if (!k || !CAJAS.includes(k)) continue;
        const b = t.getBBox();
        const dx = Math.max(rb.x - (b.x + b.width), 0, b.x - (rb.x + rb.width));
        const dy = Math.max(rb.y - (b.y + b.height), 0, b.y - (rb.y + rb.height));
        const dist = Math.hypot(dx, dy);
        if (dist < dmin) { dmin = dist; mejor = k; }
      }
      return mejor;
    };
    if (el.matches && el.matches('rect.caja')) { const k = claveCaja(el); if (k) return k; }
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = pt.matrixTransform(m.inverse());
    // cualquier punto dentro de un depósito o sección (líquido, interior vacío...) explica ese depósito
    for (const rect of svg.querySelectorAll('rect.caja')) {
      const rb = rect.getBBox();
      if (p.x >= rb.x && p.x <= rb.x + rb.width && p.y >= rb.y && p.y <= rb.y + rb.height) {
        const k = claveCaja(rect);
        if (k) return k;
      }
    }
    // resto de formas: la etiqueta más cercana al punto pulsado
    let mejor = null, dmin = 48;
    for (const t of svg.querySelectorAll('text')) {
      const k = POR_TEXTO[norm(t.textContent)];
      if (!k) continue;
      const b = t.getBBox();
      const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width)), dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
      const dist = Math.hypot(dx, dy);
      if (dist < dmin) { dmin = dist; mejor = k; }
    }
    return mejor;
  }

  /* ---------- estado actual ---------- */
  function estadoActual() {
    const w = window;
    const f = (w.simuladorPCT23 && w.simuladorPCT23.estado) || (w.secuenciaPCT23 && w.secuenciaPCT23.estado);
    return f ? f() : null;
  }
  function viva(k) {
    const e = estadoActual(), M = window.PCT23Modelo;
    if (!e || !M) return '';
    const o = M.observaciones(e), c1 = v => v.toFixed(1).replace('.', ',');
    const on = v => (v ? 'sí' : 'no');
    switch (k) {
      case 'N1': return `${e.salidas.N1 ? 'En marcha' : 'Parada'} · PWM ${Math.round(e.consignas.N1V)} % · sentido ${+e.giro.N1} (OUT06) · caudal ${Math.round(o.F1)} ml/min`;
      case 'N2': return `${e.salidas.N2 ? 'En marcha' : 'Parada'} · PWM ${Math.round(e.consignas.N2V)} % · sentido ${+e.giro.N2} (OUT05)`;
      case 'SOL1': return e.salidas.SOL1 ? 'Activa: producto desviado (recircula al tanque)' : 'Sin activar: producto a la salida normal';
      case 'SOL2': return e.salidas.SOL2 ? 'Activa: alimenta desde el tanque B' : 'En reposo: alimenta desde el tanque A';
      case 'SOL3': return e.salidas.SOL3 ? 'Abierta: circula agua fría' : 'Cerrada';
      case 'SOL4': return e.salidas.SOL4 ? 'Abierta: llenando el tanque A' : 'Cerrada';
      case 'SOL5': return e.salidas.SOL5 ? 'Abierta: llenando el tanque B' : 'Cerrada';
      case 'T1': case 'T2': case 'T3': case 'T4': case 'T5': return `${c1(o[k])} °C`;
      case 'F1': return `${Math.round(o.F1)} ml/min`;
      case 'L1': return `${Math.round(o.L1)} mm`;
      case 'LL': return o.LL ? 'Nivel bajo detectado' : 'Nivel por encima del bajo';
      case 'HL': return o.HL ? 'Nivel alto detectado' : 'Nivel por debajo del alto';
      case 'TERM': return o.TERM ? 'Disparado: calefactor cortado' : 'Normal';
      case 'RES': return `${e.salidas.RES ? 'ON' : 'OFF'} · potencia ${c1(e.consignas.R)} % (${Math.round(e.consignas.R * 50 / 100)}/50 ciclos)`;
      case 'HEAT': return `T2 = ${c1(o.T2)} °C · calefactor ${e.salidas.RES ? 'ON ' + c1(e.consignas.R) + ' %' : 'OFF'} · N2 ${e.salidas.N2 ? 'en marcha' : 'parada'}${o.TERM ? ' · TERMOSTATO DISPARADO' : ''}`;
      case 'TANKA': return `${Math.round(M.porcentajeLlenado(e, 'A'))} % · ${Math.round(e.aMl)} ml de ${M.PARAMS.capacidadMl}`;
      case 'TANKB': return `${Math.round(M.porcentajeLlenado(e, 'B'))} % · ${Math.round(e.bMl)} ml de ${M.PARAMS.capacidadMl}`;
      case 'DESVIO': return `${Math.round(e.desviadoMl)} ml recirculados · ${on(e.salidas.SOL1 && e.salidas.N1) === 'sí' ? 'circulando ahora' : 'sin circulación'}`;
      case 'FINAL': return `${Math.round(e.finalMl)} ml de producto acabado`;
      case 'DRAIN': return `${(e.desagueMl / 1000).toFixed(1).replace('.', ',')} L enviados a desagüe`;
      case 'HOLDING': return `T1 a la salida: ${c1(o.T1)} °C`;
      default: return '';
    }
  }


  /* ---------- guía general (botón Ayuda) ---------- */
  const li = arr => '<ul>' + arr.map(x => '<li>' + x + '</li>').join('') + '</ul>';
  const COMUN = [
    ['Qué es esto', '<p>Un <b>gemelo digital didáctico</b> de la planta de proceso Armfield PCT23: una pasteurización en miniatura. El líquido sale de un tanque (A o B), lo impulsa la bomba N1, se calienta en el intercambiador de placas con agua caliente, pasa por el tubo de residencia y, si está a temperatura, sale como producto acabado tras enfriarse. Si no, SOL1 lo rechaza y vuelve al tanque.</p><p>Es una <b>simulación aproximada</b>: no está calibrada ni conectada a equipos reales. Lo que viene del manual se indica con su página; las consignas, ganancias y tiempos son supuestos de este simulador.</p>'],
    ['Cómo leer el esquema', li([
      '<b>Azul</b>: circula producto. <b>Naranja</b>: agua caliente (circuito de N2). <b>Verde azulado</b>: agua fría de refrigeración. <b>Gris</b>: sin circulación.',
      'Los círculos T1-T5, F1 y L1 muestran el valor medido (temperaturas, caudal y nivel del tanque A). HL, LL, LVL y TERM son los interruptores de nivel y el termostato; se ponen en rojo cuando saltan.',
      'Tras el tubo de residencia, SOL1 reparte: sin activar sale el producto acabado, activa se ilumina la salida de desvío y se apaga la otra.',
      '<b>Contadores de producto</b>: junto a DIVERTED PRODUCT y FINISHED PRODUCT se ve la cantidad (ml) que ha pasado por cada salida. Miden siempre que circula producto: suman en el desvío cuando SOL1 está activada y en el producto acabado cuando no lo está.',
      '<b>Clic derecho</b> sobre cualquier elemento del esquema (o sobre un control de la columna de la derecha) para saber qué es, qué hace y su estado ahora.',
      'La <b>barra de arriba</b> siempre está a la vista: ahí están Iniciar, Pausar y las paradas, la velocidad de la simulación (1×, 5×, 20×) y el menú «Más». La columna de la derecha tiene pestañas.',
    ])],
  ];
  const MANUAL = [
    ['Modo manual: qué haces tú', '<p>Gobiernas cada actuador a mano, como en la consola de la planta. Nada se mueve solo salvo la física del proceso.</p>'],
    ['Barra de arriba', li([
      '<b>Iniciar / Pausar</b>: la simulación solo avanza el tiempo mientras está en marcha. Puedes cambiar actuadores en pausa.',
      '<b>Velocidad</b>: 1×, 5× o 20× el tiempo real. <b>Reiniciar</b> devuelve toda la planta al estado inicial (depósitos vacíos).',
      'La columna de la derecha tiene tres pestañas: <b>Controles</b> (bombas, calefacción, electroválvulas y depósitos), <b>Lecturas</b> (caudal, tanques y producto) y <b>Registro</b>.',
    ])],
    ['Bombas peristálticas', li([
      '<b>Heat unit (N2)</b>: circula el agua caliente por el intercambiador. <b>Feed unit (N1)</b>: mueve el producto. Cada una se enciende y apaga con su botón (J7 OUT07 y OUT08).',
      '<b>Sentido de giro</b>: un botón por bomba que alterna la salida entre 0 y 1 (OUT05 para heat unit, OUT06 para feed unit). En el simulador, 0 es el sentido de proceso y 1 el inverso, en el que N1 no mueve producto. Cuál es el valor «adelante» real está sin confirmar.',
      '<b>Velocidad (PWM)</b>: porcentaje de la velocidad de la bomba. Si N1 está al 0 % no hay caudal aunque esté encendida.',
    ])],
    ['Calefacción', li([
      'Interruptor de la resistencia (OUT04) y deslizador de <b>potencia</b>. Las dos resistencias de 120 V van en serie (una de 230 V) y se regulan por <b>ráfagas de 50 ciclos de red</b>: 100 % son 50 ciclos de 50, 50 % son 25.',
      'Solo calienta si está en ON <b>y</b> la potencia es mayor que 0. T2 sube despacio (el agua tarda minutos). Si T2 pasa de 91 °C salta el termostato y corta el calefactor.',
    ])],
    ['Electroválvulas', li([
      '<b>SOL1</b>: desvío del producto (activa = rechazo, el producto vuelve al tanque). <b>SOL2</b>: elige el tanque de origen (reposo = A, activa = B).',
      '<b>SOL3</b>: agua fría de refrigeración. <b>SOL4</b> y <b>SOL5</b>: llenado de los tanques A y B. <b>V3</b> (clic en el esquema): válvula manual; abierta, vacía el tanque B.',
      'También puedes pulsar directamente sobre la válvula o la bomba en el esquema.',
    ])],
    ['Depósitos de alimentación', li([
      'Cada tanque (A y B) tiene un deslizador de <b>porcentaje de llenado</b> sobre su capacidad (2400 ml en el modelo). Con la simulación parada o en pausa lo ajustas y el nivel cambia al instante.',
      '<b>Con la simulación en marcha el deslizador se bloquea</b>: el nivel ya no se ajusta a mano, solo se vacía con N1 y se rellena con SOL4 / SOL5. Verás L1 (nivel del tanque A en mm) y los flotadores HL y LL (tanque B) reaccionar.',
      'Un tanque vacío detiene a N1 y provoca la alarma de «sin producto en origen».',
    ])],
    ['Botones de parada', li([
      '<b>Parar bombas</b>: apaga N1 y N2. <b>Cerrar electroválvulas</b>: cierra SOL1-SOL5. <b>Parar todo</b> (en la barra de arriba): apaga todas las salidas, pero las temperaturas y los niveles no vuelven al instante a su valor inicial.',
    ])],
    ['Una prueba sencilla', li([
      'Llena el tanque A con SOL4, enciende N1, N2, SOL3 y la resistencia y pulsa <b>Iniciar</b>: observa cómo T2 sube y, un poco después, T1 y T3.',
      'Activa <b>SOL1</b>: el producto pasa a la salida de desvío y el contador de producto acabado deja de subir.',
      'Cierra <b>SOL3</b>: T3 sube porque el producto ya no se enfría.',
      'Cambia a <b>sentido 1</b> en N1: el caudal F1 cae a 0.',
    ])],
  ];

  function automatico() {
    const Q = window.PCT23Secuencia;
    const modos = Q ? Q.MODOS : [];
    return [
      ['Modo automático: qué hace la planta', '<p>Ejecuta sola la secuencia típica de pasteurización que describe el manual (p. 8): <b>arranque, precalentamiento, producción, lavado y parada</b>. Tú eliges la configuración antes de empezar y supervisas.</p>'],
      ['Las fases', li([
        '<b>Arranque</b>: pone en marcha N2 y el calefactor y elige el tanque de origen.',
        '<b>Precalentamiento</b>: arranca N1 con SOL1 activa, de modo que el producto recircula al tanque mientras se calienta, y abre SOL3 (agua fría) para que la refrigeración ya esté estable cuando salga producto. Pasa a producción cuando T1 se mantiene en la banda de la consigna durante 30 s.',
        '<b>Producción</b>: mantiene SOL3 (refrigeración) abierta y regula el calefactor según el modo elegido. SOL1 desvía el producto en cuanto T1 baja de la consigna menos 2 °C, y solo lo deja salir de nuevo cuando T1 se mantiene en banda durante 30 s seguidos (así no abre y cierra en cada oscilación). Por defecto sigue hasta que el tanque de origen se agota, o hasta que pulses <b>Terminar producción</b>. Si quieres una cantidad concreta, fija la <b>producción de referencia</b>: no puede superar lo que hay en el tanque y el panel muestra el progreso. El manual no fija cuánto producto procesar, por eso la referencia es opcional.',
        '<b>Lavado</b>: recircula agua caliente con SOL1 activa durante 2 minutos simulados (simplificado: el manual no detalla el lavado y el modelo no tiene otro fluido de limpieza).',
        '<b>Parada</b>: apaga calefactor y bombas; N2 sigue hasta que T2 baja de 45 °C. Luego la secuencia queda <b>finalizada</b>.',
      ])],
      ['Modos de regulación del calefactor', '<p>Son los que cita el manual (operación manual, entradas ON/OFF, lazos simples, cascada y lazos múltiples). Las consignas y las ganancias de los lazos son <b>supuestos</b>: el manual no da valores.</p>' +
        li(modos.map(m => '<b>' + m.nombre + '</b> (manual, ' + m.manual + '): ' + m.detalle))],
      ['Por qué cambia de fase', li([
        '<b>Arranque → precalentamiento</b>: a los 5 s, con N2 y el calefactor en marcha.',
        '<b>Precalentamiento → producción</b>: cuando T1 lleva 30 s seguidos a la consigna menos 1 °C o más.',
        '<b>Producción → lavado</b>: cuando alcanzas la <b>producción de referencia</b>, cuando el <b>tanque de origen se agota</b> o cuando pulsas <b>Terminar producción</b>. Hasta entonces la producción sigue; un tanque poco lleno la acorta.',
        '<b>Lavado → parada</b>: tras 2 minutos simulados de lavado. <b>Parada → finalizada</b>: cuando T2 baja de 45 °C.',
        'La <b>pista de fases</b> de la barra de arriba muestra en qué fase está la planta (se llena la actual, en rojo si hay una alarma) y debajo el <b>motivo del último cambio de fase</b>; el registro lo anota con su hora.',
      ])],
      ['Parámetros', li([
        '<b>Producción de referencia</b> (ml): cuánto producto acabado quieres; el máximo es lo que hay en el tanque de origen.',
        '<b>Llenado</b> de los tanques A y B (en %, solo con la secuencia parada; en marcha el deslizador solo muestra el nivel, que va bajando). El tanque que no es el de origen empieza vacío; al cambiar de origen, el nuevo recibe el llenado del anterior, <b>modo de regulación</b>, <b>tanque de origen</b> (A o B), .',
        '<b>T1 del producto</b>: la consigna en los modos de T1, cascada y lazos múltiples, y en todos los modos la mínima para no desviar el producto.',
        'Según el modo aparecen además la <b>consigna de T2</b>, la <b>potencia</b> fija, el <b>caudal PWM de N1</b> o la <b>consigna de caudal F1</b>.',
        'La línea bajo los deslizadores avisa si con esa configuración el modelo no llegaría a la temperatura pedida; en ese caso salta la alarma de precalentamiento.',
        'La configuración se bloquea mientras la secuencia está en curso.',
      ])],
      ['Botones', li([
        '<b>Iniciar secuencia</b>, <b>Pausar / Reanudar</b> (congela el tiempo), <b>Parada ordenada</b> y <b>Emergencia</b> están siempre en la barra. En <b>Más</b>: <b>Terminar producción</b> (pasa al lavado cuando tú decidas), <b>Saltar fase</b> y <b>Reiniciar planta</b>.',
        '<b>Parada ordenada</b>: va a la fase de parada y apaga con orden. <b>Emergencia</b>: apaga todo al instante.',
        '<b>Reconocer alarma</b>: tras una alarma pasa a parada ordenada (tras emergencia vuelve a reposo). <b>Reiniciar planta</b>: devuelve todo al estado inicial.',
      ])],
      ['Alarmas con acción correctiva', li([
        '<b>Tanque vacío o casi vacío</b>: rellenar con SOL4 (A) o SOL5 (B), o cambiar de origen.',
        '<b>Corte térmico</b> (T2 por encima de 91 °C): esperar a que baje y repetir el arranque.',
        '<b>T1 no alcanza la consigna</b> en 20 min: bajar la consigna o el caudal; el modelo no llega a esa temperatura.',
        'Cada alarma corta el calefactor y recircula el producto antes de esperar a que la reconozcas.',
      ])],
      ['Gráfica y registro', li([
        'La gráfica muestra T1 (azul), T2 (naranja) y T3 (verde azulado). La línea gris discontinua es la consigna de T1 y la naranja, la de T2 cuando el modo la usa.',
        'El registro anota cada cambio de fase, los desvíos de SOL1 y las alarmas con su hora simulada.',
      ])],
    ];
  }
  const SUPUESTOS = ['Qué viene del manual y qué no', '<p>Del <b>manual</b>: la descripción de la planta y su secuencia típica, los sensores y sus rangos (T 0-150 °C, nivel 0-250 mm), las protecciones del calefactor (termostato y nivel), la elección de tanque con SOL2, el rechazo del producto con SOL1 y los modos de operación que cita (manual, ON/OFF, lazos simples, cascada y múltiples).</p><p><b>No lo dice el manual</b> y es supuesto de este simulador: todas las consignas, las ganancias de los lazos, los tiempos de estabilización, la banda de desvío, los coeficientes térmicos del modelo (incluido el calor que el producto le quita al agua caliente), el lavado, los canales de la placa y el valor «adelante» del sentido de giro.</p>'];

  let guia = null;
  function tipoPagina() {
    if (document.body.dataset.demo === '1') return 'demostracion';
    if (document.getElementById('fase-nombre')) return 'automatico';
    if (document.getElementById('sim-play')) return 'manual';
    return 'inicio';
  }
  function abrirGuia() {
    const tipo = tipoPagina();
    let secciones, titulo;
    if (tipo === 'demostracion') {
      titulo = 'Ayuda · modo demostración';
      secciones = COMUN.concat([
        ['Modo demostración: qué hace', '<p>Tú solo marcas la <b>temperatura de pasteurización</b> (la temperatura del producto a la salida del tubo de residencia, T1) el <b>tanque de origen</b> con su <b>llenado</b>, y pulsas <b>Iniciar secuencia</b>. La planta ejecuta sola todo el proceso y se para al terminar.</p>'],
        ['Qué decide la planta por ti', li([
          '<b>Caudal de N1</b>: el mayor (hasta el 50 %) con el que el modelo llega a esa temperatura. Cuanto más alta es la temperatura, menos caudal.',
          '<b>Regulación del calefactor</b>: en cascada (T1 fija la consigna de T2 y T2 la potencia), uno de los modos que cita el manual.',
          '<b>Producción</b>: por defecto sigue hasta agotar el tanque de origen. Puedes fijar una <b>producción de referencia</b> (ml) menor; nunca puede superar lo que hay en el tanque. También puedes cortarla antes con <b>Terminar producción</b>.',
          'También eliges el <b>tanque de origen</b> (A o B) y <b>cuánto lo llenas</b> (en %). El otro tanque queda vacío. El dibujo de los depósitos, L1 y los flotadores HL y LL siguen esos niveles, y el tanque elegido es el que se consume.',
          '<b>Fases</b>: arranque, precalentamiento (el producto recircula con SOL1 activa), producción (SOL1 desvía si T1 baja de la consigna), lavado y parada.',
        ])],
        ['Botones', li([
          '<b>Iniciar secuencia</b>, <b>Pausar / Reanudar</b>, <b>Parada ordenada</b> y <b>Emergencia</b> (apaga todo al instante). Tras una alarma, <b>Reconocer alarma</b>. En <b>Más</b>: <b>Terminar producción</b> y <b>Reiniciar planta</b>.',
          '<b>Velocidad</b>: empieza en 1× (tiempo real). Súbela a 5× o 20× para ver la secuencia completa en pocos minutos.',
        ])],
        ['Límites', '<p>El rango de temperatura llega hasta donde el modelo es capaz (unos 65 °C). La temperatura y los tiempos son los de una <b>simulación didáctica</b>: no son valores del fabricante. Para ajustar todo (modo de regulación, consignas, tanque, caudal) usa el modo automático.</p>'],
        SUPUESTOS]);
    } else if (tipo === 'automatico') { titulo = 'Ayuda · modo automático'; secciones = COMUN.concat(automatico(), [SUPUESTOS]); }
    else if (tipo === 'manual') { titulo = 'Ayuda · modo manual'; secciones = COMUN.concat(MANUAL, [SUPUESTOS]); }
    else {
      titulo = 'Ayuda · simulador de la PCT23';
      secciones = COMUN.slice(0, 1).concat([
        ['Los dos modos', li(['<b>Modo manual</b>: tú gobiernas cada bomba, válvula y el calefactor desde el esquema y los paneles.',
          '<b>Modo automático</b>: la planta ejecuta sola la secuencia de pasteurización y tú la supervisas; puedes elegir cómo se regula el calefactor.'])],
        ['En cualquier modo', '<p>Pulsa el botón <b>? Ayuda</b> para ver la guía de esa pantalla, y haz <b>clic derecho</b> sobre cualquier elemento del esquema para saber qué es.</p>'], SUPUESTOS]);
    }
    guia.querySelector('h3').textContent = titulo;
    guia.querySelector('.cuerpo').innerHTML = secciones.map(s => '<h4>' + s[0] + '</h4>' + s[1]).join('');
    guia.querySelector('.cuerpo').scrollTop = 0;
    cerrar();
    velo.hidden = false;
    guia.hidden = false;
  }
  function montarGuia() {
    guia = document.createElement('div');
    guia.id = 'guia-pct23'; guia.hidden = true; guia.setAttribute('role', 'dialog'); guia.setAttribute('aria-label', 'Guía de ayuda');
    guia.innerHTML = '<header><h3></h3><button type="button" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header><div class="cuerpo"></div><div class="pie">Pulsa la × o Esc para cerrar.</div>';
    document.body.appendChild(guia);
    guia.querySelector('button').addEventListener('click', cerrar);
    const cab = document.querySelector('header');
    if (cab) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'b-ayuda-general'; b.textContent = '? Ayuda';
      b.addEventListener('click', abrirGuia);
      cab.appendChild(b);
    }
  }

  /* ---------- ventana ---------- */
  const css = `
  #ayuda-pct23{position:fixed;z-index:9999;left:50%;top:50%;transform:translate(-50%,-50%);max-height:calc(100vh - 24px);overflow:auto;width:min(420px,calc(100vw - 24px));background:color-mix(in srgb,var(--acento,#1565c0) 5%,var(--panel,#fff));color:var(--texto,#1b1f24);
    border:2px solid var(--acento,#1565c0);border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.3),0 16px 48px rgba(0,0,0,.55);font:14px/1.45 system-ui,sans-serif}
  #ayuda-pct23[hidden]{display:none}
  #ayuda-velo{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.5)}
  #ayuda-velo[hidden]{display:none}
  #ayuda-pct23 header{background:color-mix(in srgb,var(--acento,#1565c0) 20%,transparent);border-radius:10px 10px 0 0;margin-bottom:8px!important}
  #ayuda-pct23 header{display:flex;align-items:flex-start;gap:8px;padding:10px 12px 6px;margin:0}
  #ayuda-pct23 h3{margin:0;font-size:15px;flex:1}
  #ayuda-pct23 .etq{display:inline-block;margin:0 12px 6px;padding:1px 8px;border-radius:999px;border:1px solid var(--borde,#dde1e6);
    color:var(--tenue,#6b7380);font-size:12px}
  #ayuda-pct23 .cuerpo{display:block;max-width:none;margin:0;padding:0 12px 10px}
  #ayuda-pct23 .cuerpo p{margin:0 0 8px}
  #ayuda-pct23 .tit{font-weight:700;font-size:12px;color:var(--tenue,#6b7380);text-transform:uppercase;letter-spacing:.03em;margin:0 0 2px}
  #ayuda-pct23 .viva{padding:6px 8px;border-radius:6px;background:rgba(0,0,0,.28);border:1px solid color-mix(in srgb,var(--acento,#1565c0) 50%,transparent);font-variant-numeric:tabular-nums}
  #ayuda-pct23 .pie{padding:6px 12px;border-top:1px solid var(--borde,#dde1e6);color:var(--tenue,#6b7380);font-size:12px}
  #ayuda-pct23 button{border:1px solid var(--borde,#dde1e6);background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:0;width:32px;height:32px;border-radius:50%;flex:none}
  #ayuda-pct23 button:hover{background:color-mix(in srgb,var(--error,#c62828) 18%,transparent)}

  #guia-pct23{position:fixed;z-index:9999;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,calc(100vw - 24px));max-height:calc(100vh - 24px);
    display:flex;flex-direction:column;background:color-mix(in srgb,var(--acento,#1565c0) 5%,var(--panel,#fff));color:var(--texto,#1b1f24);
    border:2px solid var(--acento,#1565c0);border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.3),0 16px 48px rgba(0,0,0,.55);font:14px/1.5 system-ui,sans-serif}
  #guia-pct23[hidden]{display:none}
  #guia-pct23 header{display:flex;align-items:center;gap:8px;padding:10px 14px;margin:0;background:color-mix(in srgb,var(--acento,#1565c0) 20%,transparent);border-radius:10px 10px 0 0}
  #guia-pct23 h3{margin:0;font-size:17px;flex:1}
  #guia-pct23 .cuerpo{display:block;max-width:none;margin:0;overflow:auto;padding:4px 16px 12px}
  #guia-pct23 h4{margin:14px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--acento,#1565c0)}
  #guia-pct23 p{margin:0 0 8px} #guia-pct23 ul{margin:0 0 6px;padding-left:20px} #guia-pct23 li{margin:3px 0}
  #guia-pct23 .pie{padding:6px 14px;border-top:1px solid var(--borde,#dde1e6);color:var(--tenue,#6b7380);font-size:12px}
  #guia-pct23 button{border:1px solid var(--borde,#dde1e6);background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:0;width:32px;height:32px;border-radius:50%;flex:none}
  #guia-pct23 button:hover{background:color-mix(in srgb,var(--error,#c62828) 18%,transparent)}
  #b-ayuda-general{border:1px solid var(--acento,#1565c0);background:transparent;color:var(--acento,#1565c0);border-radius:999px;padding:3px 12px;font:600 13px system-ui,sans-serif;cursor:pointer;margin-left:auto}
  #b-ayuda-general:hover{background:color-mix(in srgb,var(--acento,#1565c0) 14%,transparent)}
  `;
  let caja = null, velo = null, actual = null, temporizador = null;

  function montar() {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    caja = document.createElement('div');
    caja.id = 'ayuda-pct23'; caja.hidden = true; caja.setAttribute('role', 'dialog'); caja.setAttribute('aria-label', 'Ayuda del elemento');
    caja.innerHTML = '<header><h3></h3><button type="button" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header><span class="etq"></span>' +
      '<div class="cuerpo"><p class="q"></p><div class="tit">En el simulador</div><p class="s"></p>' +
      '<div class="tit">Estado ahora</div><p class="viva"></p></div><div class="pie"></div>';
    velo = document.createElement('div'); velo.id = 'ayuda-velo'; velo.hidden = true;
    document.body.appendChild(velo);
    document.body.appendChild(caja);
    montarGuia();
    caja.querySelector('button').addEventListener('click', cerrar);
  }
  function cerrar() { if (caja) { caja.hidden = true; velo.hidden = true; if (guia) guia.hidden = true; } actual = null; clearInterval(temporizador); }
  function refrescar() { if (actual && !caja.hidden) caja.querySelector('.viva').textContent = viva(actual) || '—'; }

  function abrir(k) {
    const d = D[k];
    actual = k;
    caja.querySelector('h3').textContent = d.t;
    caja.querySelector('.etq').textContent = d.tag;
    caja.querySelector('.q').textContent = d.q;
    caja.querySelector('.s').textContent = d.s;
    caja.querySelector('.pie').textContent = `Fuente: manual de la PCT23, ${d.m}. Pulsa la × o Esc para cerrar.`;
    velo.hidden = false;
    caja.hidden = false;
    refrescar();
    // siempre centrada en la pantalla (posicion fija por CSS), no junto al puntero
    clearInterval(temporizador); temporizador = setInterval(refrescar, 500);
  }

  function iniciar() {
    montar();
    document.addEventListener('contextmenu', ev => {
      if (caja.contains(ev.target) || guia.contains(ev.target)) return;
      const k = clave(ev);
      if (!k || !D[k]) { cerrar(); return; }    // fuera de los elementos: menú normal del navegador
      ev.preventDefault();
      abrir(k);
    });
    document.addEventListener('mousedown', ev => { if ((!caja.hidden || !guia.hidden) && !caja.contains(ev.target) && !guia.contains(ev.target) && ev.button === 0) cerrar(); });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape') cerrar(); });
    const lienzo = document.querySelector('.lienzo');
    if (lienzo && !document.getElementById('ayuda-pista')) {
      const p = document.createElement('p');
      p.id = 'ayuda-pista'; p.className = 'pie-sim';
      p.textContent = 'Clic derecho sobre cualquier elemento del esquema (bombas, válvulas, sensores, depósitos…) para ver qué es.';
      lienzo.insertAdjacentElement('afterend', p);
    }
    window.PCT23Ayuda = { clave, abrir, cerrar, abrirGuia, D };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
