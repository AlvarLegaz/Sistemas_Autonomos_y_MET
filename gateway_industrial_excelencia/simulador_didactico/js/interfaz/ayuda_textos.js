/* Textos de la ayuda: datos puros, sin DOM. Los textos del manual están copiados del simulador original. */
(function () {
  const lista = arr => '<ul>' + arr.map(x => '<li>' + x + '</li>').join('') + '</ul>';

  const ELEMENTOS = {
    N1: { titulo: 'N1 · Bomba de alimentación (feed unit)', etiqueta: 'Bomba peristáltica',
      queEs: 'Impulsa el producto desde el tanque elegido por SOL2 hacia el intercambiador de placas. Su velocidad se ajusta en la consola (en la ' +
          'maqueta, por PWM) y se enciende y apaga aparte.',
      enSimulador: 'Acción en J7 OUT08, sentido de giro en OUT06 y velocidad por PWM (PWMOut1). Si N1 gira en sentido inverso, el modelo no mueve ' +
          'producto.', paginas: 'p. 8 y 17' },
    N2: { titulo: 'N2 · Bomba de agua caliente (heat unit)', etiqueta: 'Bomba peristáltica',
      queEs: 'Hace circular el agua caliente del depósito con calefactor por la sección de calentamiento del intercambiador. El manual la ' +
          'describe con ajuste de velocidad manual o todo/nada.',
      enSimulador: 'Acción en J7 OUT07, sentido de giro en OUT05 y velocidad por PWM (PWMOut2). Sin N2 el producto casi no se calienta.', paginas:
          'p. 8 y 14' },
    SOL1: { titulo: 'SOL1 · Válvula solenoide de tres vías', etiqueta: 'Electroválvula',
      queEs: 'Está después del tubo de residencia. En posición normal deja pasar el producto hacia el resto del proceso y la salida. Si el ' +
          'producto no está a la temperatura correcta se rechaza: el producto sale por la toma de desvío y vuelve al tanque de alimentación.',
      enSimulador: 'Relé K3. Activa = producto desviado: se ilumina la rama de DIVERTED PRODUCT y se apaga la de producto acabado. El volumen ' +
          'desviado vuelve al tanque.', paginas: 'p. 8 y 16' },
    SOL2: { titulo: 'SOL2 · Selección del tanque de alimentación', etiqueta: 'Electroválvula',
      queEs: 'Elige de qué tanque aspira la bomba N1: el A o el B.',
      enSimulador: 'Relé K4. En reposo alimenta desde A; activa, desde B. El manual no detalla el sentido físico exacto, así que esta ' +
          'correspondencia es una convención del simulador.', paginas: 'p. 8 y 16' },
    SOL3: { titulo: 'SOL3 · Agua de refrigeración del producto', etiqueta: 'Electroválvula',
      queEs: 'Abre o corta el paso del agua fría al intercambiador de enfriamiento. Es la última etapa de enfriamiento del producto antes de la salida.',
      enSimulador: 'Relé K5. Abierta: el producto sale más frío (T3) y se cuenta agua enviada a desagüe.', paginas: 'p. 9 y 16' },
    SOL4: { titulo: 'SOL4 · Llenado del tanque A', etiqueta: 'Electroválvula',
      queEs: 'Válvula solenoide de llenado del tanque de alimentación A.', enSimulador: 'Relé K6. Abierta, el tanque A se rellena en el modelo.', paginas:
          'p. 8 y 16' },
    SOL5: { titulo: 'SOL5 · Llenado del tanque B', etiqueta: 'Electroválvula',
      queEs: 'Válvula solenoide de llenado del tanque de alimentación B.', enSimulador: 'Relé K7. Abierta, el tanque B se rellena en el modelo.', paginas:
          'p. 8 y 16' },
    T1: { titulo: 'T1 · Salida del tubo de residencia', etiqueta: 'Sensor de temperatura',
      queEs: 'Mide el producto a la salida del tubo de residencia, justo antes de SOL1. Es la temperatura que decide si el producto se acepta o ' +
          'se desvía. Rango del sensor: 0-150 °C.',
      enSimulador: 'Es la variable que mantiene la secuencia automática en producción.', paginas: 'p. 9' },
    T2: { titulo: 'T2 · Temperatura del agua caliente', etiqueta: 'Sensor de temperatura',
      queEs: 'Mide el agua del depósito con calefactor (heat unit). Rango del sensor: 0-150 °C.', enSimulador:
          'Baja cuando el producto circula por el intercambiador, porque se lleva calor del agua (más caudal, más bajada). Si T2 pasa del umbral ' +
          'del modelo salta el corte térmico simulado.', paginas: 'p. 9' },
    T3: { titulo: 'T3 · Producto a la salida', etiqueta: 'Sensor de temperatura',
      queEs: 'Mide el producto ya enfriado, antes de salir como producto acabado.', enSimulador: 'Depende de SOL3: con refrigeración sale más frío.', paginas:
          'p. 9' },
    T4: { titulo: 'T4 · Salida de alimentación', etiqueta: 'Sensor de temperatura',
      queEs: 'Mide el producto a la salida de la sección de alimentación, antes del filtro, de F1 y del tubo de residencia.', enSimulador:
          'Va un poco por delante de T1: el producto lo alcanza antes de recorrer el tubo de residencia, que añade el retraso. Con la planta ' +
          'parada vuelve a la temperatura ambiente.', paginas: 'p. 9' },
    T5: { titulo: 'T5 · Sonda en el calentamiento', etiqueta: 'Sensor de temperatura',
      queEs: 'Sonda auxiliar de temperatura. El manual dice que puede colocarse en cualquiera de los conectores; aquí está conectada a la sección ' +
          'de calentamiento del intercambiador.',
      enSimulador: 'Lee el producto a mitad de camino entre la entrada y T4 (supuesto del simulador): sube por delante de T1 y vuelve a la ' +
          'temperatura ambiente con la planta parada.', paginas: 'p. 9' },
    F1: { titulo: 'F1 · Sensor de caudal', etiqueta: 'Sensor de caudal',
      queEs: 'Sensor de caudal tipo turbina instalado en la corriente de alimentación. Mide el caudal a la entrada del tubo de residencia. Un ' +
          'filtro en línea anterior evita que entre suciedad.',
      enSimulador: 'Muestra el caudal que mueve N1 (ml/min).', paginas: 'p. 9' },
    L1: { titulo: 'L1 · Sensor de nivel del tanque A', etiqueta: 'Sensor de nivel',
      queEs: 'Sensor de presión conectado al tanque A que da una medida directa del nivel, de 0 a 250 mm.', enSimulador:
          'Baja cuando N1 consume del tanque A y sube con SOL4.', paginas: 'p. 9' },
    LL: { titulo: 'LL · Flotador de nivel bajo (tanque B)', etiqueta: 'Interruptor de nivel',
      queEs: 'Interruptor de flotador que detecta el nivel bajo en el tanque B.', enSimulador:
          'Se activa cuando el tanque B queda al 20 % o menos, que es la altura a la que está dibujado.', paginas: 'p. 9' },
    HL: { titulo: 'HL · Flotador de nivel alto (tanque B)', etiqueta: 'Interruptor de nivel',
      queEs: 'Interruptor de flotador que detecta el nivel alto en el tanque B. Se puede ajustar la altura deslizando su soporte por el casquillo ' +
          'de la base del tanque.', enSimulador: 'Se activa cuando el tanque B llega al 80 % o más, que es la altura a la que está dibujado.', paginas:
          'p. 10' },
    HLC: { titulo: 'Nivel alto del depósito de calefacción', etiqueta: 'Interruptor de nivel',
      queEs: 'Indicador de nivel del depósito de agua caliente (heat unit).', enSimulador: 'En el simulador no está modelado: permanece apagado.', paginas:
          'p. 8' },
    LVL: { titulo: 'LVL · Interruptor de nivel del depósito caliente', etiqueta: 'Interruptor de nivel',
      queEs: 'Interruptor de nivel del depósito de agua caliente. Protege al calefactor: si el nivel es bajo la consola enciende la alarma de ' +
          'nivel bajo.', enSimulador: 'En el simulador no está modelado: permanece apagado.', paginas: 'p. 8 y 15' },
    TERM: { titulo: 'STAT · Termostato del depósito caliente', etiqueta: 'Protección',
      queEs: 'Termostato del tanque de agua caliente. Si hay sobretemperatura corta el calefactor y la consola lo indica con el piloto OVER TEMP.',
      enSimulador: 'Salta (corte térmico simulado) cuando T2 llega a 91 °C: desconecta la resistencia y el agua se enfría despacio. Se rearma por ' +
          'debajo de 70 °C y hay que volver a conectar la resistencia a mano.', paginas: 'p. 8 y 15' },
    RES: { titulo: 'Resistencia de calefacción (PWR)', etiqueta: 'Calefactor',
      queEs: 'Elemento calefactor del depósito de agua caliente. La consola tiene un ajuste de potencia y un indicador en kW. En la maqueta son ' +
          'dos resistencias de 120 V en serie, alimentadas a 230 V.',
      enSimulador: 'OUT03 la conecta; su potencia se reparte por ráfagas de 50 ciclos de red (50 % = 25 ciclos de cada 50).', paginas: 'p. 8 y 15' },
    HEAT: { titulo: 'HEAT UNIT · Depósito de agua caliente', etiqueta: 'Depósito',
      queEs: 'Depósito de agua caliente con elemento calefactor eléctrico (la resistencia), bomba de agua N2, termostato (STAT) e interruptor de ' +
          'nivel (LVL). Su agua caliente circula por la sección de calentamiento del intercambiador y calienta el producto. Si el nivel es bajo o ' +
          'hay sobretemperatura, la protección corta el calefactor.', enSimulador: 'Su temperatura es T2. El simulador lo supone siempre lleno: ' +
          'el interruptor de nivel no se modela. Se regula con la potencia de la resistencia y se mueve con N2.', paginas: 'p. 8 y 15' },
    TANKA: { titulo: 'Tanque de alimentación A', etiqueta: 'Depósito',
      queEs: 'Tanque de producto con válvula de llenado SOL4 y sensor de nivel L1.', enSimulador: 'Se elige como origen con SOL2 en reposo.', paginas:
          'p. 8' },
    TANKB: { titulo: 'Tanque de alimentación B', etiqueta: 'Depósito',
      queEs: 'Tanque de producto con válvula de llenado SOL5 e interruptores de nivel alto (HL) y bajo (LL).', enSimulador:
          'Se elige como origen activando SOL2.', paginas: 'p. 8' },
    V1: { titulo: 'V1 · Válvula de control de caudal del agua fría', etiqueta: 'Válvula manual',
      queEs: 'Regula el caudal del agua fría que llega a SOL3 para la refrigeración.', enSimulador:
          'Solo dibujo: no tiene efecto hidráulico en el modelo.', paginas: 'p. 9' },
    PRV1: { titulo: 'PRV1 · Válvula reductora de presión', etiqueta: 'Válvula manual',
      queEs: 'Reduce la presión del suministro de agua fría.', enSimulador: 'Solo dibujo: sin efecto en el modelo.', paginas: 'p. 9' },
    V2: { titulo: 'V2 · Válvula manual', etiqueta: 'Válvula manual',
      queEs: 'Válvula manual del circuito de alimentación entre los tanques. El manual no detalla su función.', enSimulador:
          'Solo dibujo: sin efecto en el modelo.', paginas: 'p. 12 (diagrama)' },
    V3: { titulo: 'V3 · Válvula manual', etiqueta: 'Válvula manual',
      queEs: 'Válvula manual situada junto al tanque B. El manual no detalla su función.', enSimulador:
          'En el modo manual, clic para abrirla: vacía el tanque B (unos 600 ml/min, supuesto didáctico). En los otros modos es solo dibujo.', paginas:
          'p. 12 (diagrama)' },
    FILTER: { titulo: 'FILTER · Filtro en línea', etiqueta: 'Filtro',
      queEs: 'Filtro anterior a F1 que previene la entrada de suciedad en el tubo de residencia.', enSimulador:
          'Solo dibujo: no se simula obstrucción.', paginas: 'p. 9' },
    HOLDING: { titulo: 'HOLDING TUBE · Tubo de residencia', etiqueta: 'Tubería con aislamiento',
      queEs: 'Tubo aislado donde el producto se mantiene a la temperatura de proceso durante un tiempo. Es el tiempo muerto de la planta. Tras ' +
          'él, T1 mide la temperatura y SOL1 decide si el producto sigue o se rechaza.', enSimulador:
          'El modelo lo aproxima con una inercia, no con un retardo de transporte.', paginas: 'p. 8' },
    REGEN: { titulo: 'Regeneración / precalentamiento', etiqueta: 'Intercambiador de placas',
      queEs: 'Primera etapa del intercambiador: el producto que entra se precalienta con el calor del producto caliente que ya pasó el tubo de ' +
          'residencia, y así se ahorra energía.', enSimulador: 'Se modela como una recuperación de calor aproximada.', paginas: 'p. 8' },
    CALENT: { titulo: 'Calentamiento', etiqueta: 'Intercambiador de placas',
      queEs: 'Etapa donde el agua caliente de N2 calienta el producto hasta la temperatura de proceso.', enSimulador:
          'La ganancia térmica depende de N2, del caudal y de la potencia del calefactor.', paginas: 'p. 8' },
    ENFRIA: { titulo: 'Enfriamiento', etiqueta: 'Intercambiador de placas',
      queEs: 'Última etapa: el agua fría de SOL3 enfría el producto lo más posible antes de la salida.', enSimulador:
          'Con SOL3 cerrada casi no enfría.', paginas: 'p. 8' },
    DESVIO: { titulo: 'DIVERTED PRODUCT · Producto rechazado', etiqueta: 'Salida de SOL1',
      queEs: 'Por aquí sale el producto que SOL1 rechaza por no estar a temperatura. Según el manual vuelve al tanque de alimentación.', enSimulador:
          'Se ilumina solo cuando SOL1 está activa y N1 en marcha.', paginas: 'p. 8' },
    FINAL: { titulo: 'FINISHED PRODUCT · Producto acabado', etiqueta: 'Salida',
      queEs: 'Salida del producto que ya ha pasado el tratamiento térmico y se ha enfriado.', enSimulador:
          'Se ilumina con SOL1 sin activar y N1 en marcha.', paginas: 'p. 8' },
    DRAIN: { titulo: 'TO DRAIN · Desagüe', etiqueta: 'Salida',
      queEs: 'Salida del agua de refrigeración, que va al desagüe.', enSimulador: 'El contador de agua a desagüe sube con SOL3 abierta.', paginas:
          'p. 12 (diagrama)' },
    COLD: { titulo: 'COLD WATER · Suministro de agua fría', etiqueta: 'Entrada',
      queEs: 'Entrada de agua fría de la red, con PRV1, V1 y SOL3 en su recorrido.', enSimulador: 'Sin límite de agua en el modelo.', paginas: 'p. 9' },
    TUBO_N1: { titulo: 'Tubería de producto', etiqueta: 'Circuito',
      queEs: 'Recorrido del producto desde el tanque, por la bomba N1, el intercambiador, el filtro, F1 y el tubo de residencia hasta SOL1.', enSimulador:
          'Se ilumina en azul con N1 en marcha.', paginas: 'p. 12 (diagrama)' },
    TUBO_N2: { titulo: 'Circuito de agua caliente', etiqueta: 'Circuito',
      queEs: 'Recorrido del agua caliente: sale del depósito, la impulsa N2 por la sección de calentamiento y vuelve al depósito.', enSimulador:
          'Se ilumina en naranja con N2 en marcha.', paginas: 'p. 12 (diagrama)' },
    TUBO_FRIO: { titulo: 'Circuito de agua fría', etiqueta: 'Circuito',
      queEs: 'Agua fría de la red que pasa por SOL3, enfría el producto y se va al desagüe.', enSimulador:
          'Se ilumina en verde azulado con SOL3 abierta.', paginas: 'p. 12 (diagrama)' },
    TUBO: { titulo: 'Tubería', etiqueta: 'Conducto', queEs: 'Conducto del esquema de la planta.', enSimulador:
        'Se ilumina cuando circula fluido por él.', paginas: 'p. 12 (diagrama)' },
  };

  const ETIQUETA_POR_TEXTO = { 'N1': 'N1', 'N2': 'N2', 'SOL1': 'SOL1', 'SOL2': 'SOL2', 'SOL3': 'SOL3', 'SOL4': 'SOL4', 'SOL5': 'SOL5',
    'T1': 'T1', 'T2': 'T2', 'T3': 'T3', 'T4': 'T4', 'T5': 'T5', 'F1': 'F1', 'L1': 'L1', 'LL': 'LL', 'V1': 'V1', 'V2': 'V2', 'V3': 'V3',
    'PRV1': 'PRV1', 'FILTER': 'FILTER', 'HOLDING TUBE': 'HOLDING', 'HEAT UNIT': 'HEAT', 'RES': 'RES', 'LVL': 'LVL',
    'TERM': 'TERM', 'A': 'TANKA', 'B': 'TANKB', 'DIVERTED PRODUCT': 'DESVIO', 'FINISHED PRODUCT': 'FINAL', 'TO DRAIN': 'DRAIN',
    'COLD WATER': 'COLD', 'REGENERACIÓN': 'REGEN', 'CALENTAMIENTO': 'CALENT', 'ENFRIAMIENTO': 'ENFRIA', 'DESVÍO': 'SOL1' };
  const ETIQUETA_POR_ID = { 'c-HL': 'HL', 'c-LL': 'LL', 'c-HLC': 'HLC', 'c-LVLC': 'LVL', 'c-TERM': 'TERM', 'c-PWR': 'RES', 'g-PWR': 'RES',
    'v-PWR': 'RES', 'resistencia': 'RES', 'v-QD': 'DESVIO', 'v-QF': 'FINAL', 'nivel-A': 'TANKA', 'nivel-B': 'TANKB', 'v-F1': 'F1', 'v-L1': 'L1' };


  const GUIA_COMUN = [
    ['Qué es esto', '<p>Un <b>gemelo digital didáctico</b> de la planta de proceso Armfield PCT23: una pasteurización en miniatura. El líquido ' +
        'sale de un tanque (A o B), lo impulsa la bomba N1, se calienta en el intercambiador de placas con agua caliente, pasa por el tubo de ' +
        'residencia y, si está a temperatura, sale como producto acabado tras enfriarse. Si no, SOL1 lo rechaza y vuelve al tanque.</p><p>Es una ' +
        '<b>simulación aproximada</b>: no está calibrada ni conectada a equipos reales. Lo que viene del manual se indica con su página; las ' +
        'consignas, ganancias y tiempos son supuestos de este simulador.</p>'],
    ['Cómo leer el esquema', lista([
      '<b>Azul</b>: circula producto. <b>Naranja</b>: agua caliente (circuito de N2). <b>Verde azulado</b>: agua fría de refrigeración. ' +
          '<b>Gris</b>: sin circulación.',
      'Los círculos T1-T5, F1 y L1 muestran el valor medido (temperaturas, caudal y nivel del tanque A). HL, LL, LVL y TERM son los interruptores ' +
          'de nivel y el termostato; se ponen en rojo cuando saltan.',
      'Tras el tubo de residencia, SOL1 reparte: sin activar sale el producto acabado, activa se ilumina la salida de desvío y se apaga la otra.',
      '<b>Contadores de producto</b>: junto a DIVERTED PRODUCT y FINISHED PRODUCT se ve la cantidad (ml) que ha pasado por cada salida. Miden ' +
          'siempre que circula producto: suman en el desvío cuando SOL1 está activada y en el producto acabado cuando no lo está.',
      '<b>Clic derecho</b> (o mantener pulsado 3 s en pantallas táctiles) sobre cualquier elemento del esquema (o sobre un control de las pestañas) para saber qué es, qué hace y su ' +
          'estado ahora.',
      'La <b>barra de operación</b> siempre está a la vista: ahí están Iniciar, Pausar y las paradas, la velocidad de la simulación (1×, 5×, 20×) y ' +
          'el menú «Más». Bajo el esquema hay pestañas con los controles o ajustes, las lecturas y el registro.',
    ])],
  ];
  const GUIA_MANUAL = [
    ['Modo manual: qué haces tú', '<p>Gobiernas cada actuador a mano, como en la consola de la planta. Nada se mueve solo salvo la física del proceso.</p>'],
    ['Barra de operación', lista([
      '<b>Iniciar / Pausar</b>: la simulación solo avanza el tiempo mientras está en marcha. Puedes cambiar actuadores en pausa.',
      '<b>Velocidad</b>: 1×, 5× o 20× el tiempo real. <b>Reiniciar</b> devuelve toda la planta al estado inicial (depósitos vacíos).',
      'Bajo el esquema hay tres pestañas: <b>Controles</b> (depósitos de alimentación y cerrar electroválvulas), <b>Lecturas</b> ' +
          '(caudal, tanques y producto) y <b>Registro</b>.',
    ])],
    ['Bombas peristálticas', lista([
      '<b>Heat unit (N2)</b>: circula el agua caliente por el intercambiador. <b>Feed unit (N1)</b>: mueve el producto. Cada una se enciende y ' +
          'apaga pulsando su símbolo en el esquema (J7 OUT07 y OUT08).',
      '<b>Sentido de giro</b>: el botón de cada bomba, en el panel de controles del esquema, alterna la salida entre 0 y 1 (OUT05 para heat unit, OUT06 para feed unit). En el ' +
          'simulador, 0 es el sentido de proceso y 1 el inverso, en el que N1 no mueve producto. Cuál es el valor «adelante» real está sin ' +
          'confirmar.',
      '<b>Velocidad (PWM)</b>: deslizador del panel de controles del esquema, en porcentaje de la velocidad de la bomba. Si N1 está al 0 % no hay caudal aunque esté encendida.',
    ])],
    ['Calefacción', lista([
      'Se enciende y apaga pulsando el círculo RES del esquema (OUT03), y la <b>potencia</b> se ajusta en el panel de controles. Las dos resistencias de 120 V van en serie (una de 230 V) y se ' +
          'regulan por <b>ráfagas de 50 ciclos de red</b>: 100 % son 50 ciclos de 50, 50 % son 25.',
      'Solo calienta si está en ON <b>y</b> la potencia es mayor que 0. T2 sube despacio (el agua tarda minutos). Si T2 pasa de 91 °C salta el ' +
          'termostato y corta el calefactor.',
    ])],
    ['Electroválvulas', lista([
      '<b>SOL1</b>: desvío del producto (activa = rechazo, el producto vuelve al tanque). <b>SOL2</b>: elige el tanque de origen (reposo = A, activa = B).',
      '<b>SOL3</b>: agua fría de refrigeración. <b>SOL4</b> y <b>SOL5</b>: llenado de los tanques A y B. <b>V3</b> (clic en el esquema): válvula ' +
          'manual; abierta, vacía el tanque B.',
      'Se accionan pulsando su símbolo en el esquema; en la pestaña Controles, <b>Cerrar electroválvulas</b> cierra SOL1-SOL5 de una vez.',
    ])],
    ['Depósitos de alimentación', lista([
      'Cada tanque (A y B) tiene un deslizador de <b>porcentaje de llenado</b> sobre su capacidad (2400 ml en el modelo). Con la simulación ' +
          'parada o en pausa lo ajustas y el nivel cambia al instante.',
      '<b>Con la simulación en marcha el deslizador se bloquea</b>: el nivel ya no se ajusta a mano, solo se vacía con N1 y se rellena con SOL4 / ' +
          'SOL5. Verás L1 (nivel del tanque A en mm) y los flotadores HL y LL (tanque B) reaccionar.',
      'Un tanque vacío detiene a N1 y provoca la alarma de «sin producto en origen».',
    ])],
    ['Botones de parada', lista([
      '<b>Parar todo</b> (en la barra de operación): apaga ' +
          'todas las salidas, pero las temperaturas y los niveles no vuelven al instante a su valor inicial.',
    ])],
    ['Una prueba sencilla', lista([
      'Llena el tanque A con SOL4, enciende N1, N2, SOL3 y la resistencia y pulsa <b>Iniciar</b>: observa cómo T2 sube y, un poco después, T1 y T3.',
      'Activa <b>SOL1</b>: el producto pasa a la salida de desvío y el contador de producto acabado deja de subir.',
      'Cierra <b>SOL3</b>: T3 sube porque el producto ya no se enfría.',
      'Cambia a <b>sentido 1</b> en N1: el caudal F1 cae a 0.',
    ])],
  ];


  const GUIA_AUTOMATICO = [
    ['Modo automático: qué hace la planta', '<p>Ejecuta sola la secuencia típica de pasteurización que describe el manual (p. 8): <b>arranque, ' +
        'precalentamiento, producción, lavado y parada</b>. Tú eliges la configuración antes de empezar y supervisas.</p>'],
    ['Las fases', lista([
      '<b>Arranque</b>: pone en marcha N2 y el calefactor y elige el tanque de origen.',
      '<b>Precalentamiento</b>: arranca N1 con SOL1 activa, de modo que el producto recircula al tanque mientras se calienta, y abre SOL3 (agua ' +
          'fría) para que la refrigeración ya esté estable cuando salga producto. Pasa a producción cuando T1 se mantiene en la banda de la ' +
          'consigna durante 30 s.',
      '<b>Producción</b>: mantiene SOL3 (refrigeración) abierta y regula el calefactor según el modo elegido. SOL1 desvía el producto en cuanto ' +
          'T1 baja de la consigna menos 2 °C, y solo lo deja salir de nuevo cuando T1 se mantiene en banda durante 30 s seguidos (así no abre y ' +
          'cierra en cada oscilación). Por defecto sigue hasta que el tanque de origen se agota, o hasta que pulses <b>Terminar producción</b>. ' +
          'Si quieres una cantidad concreta, fija la <b>producción de referencia</b>: no puede superar lo que hay en el tanque y el panel muestra ' +
          'el progreso. El manual no fija cuánto producto procesar, por eso la referencia es opcional.',
      '<b>Lavado</b>: recircula agua caliente con SOL1 activa durante 2 minutos simulados (simplificado: el manual no detalla el lavado y el ' +
          'modelo no tiene otro fluido de limpieza).',
      '<b>Parada</b>: apaga calefactor y bombas; N2 sigue hasta que T2 baja de 45 °C. Luego la secuencia queda <b>finalizada</b>.',
    ])],
    ['Modos de regulación del calefactor', null],
    ['Por qué cambia de fase', lista([
      '<b>Arranque → precalentamiento</b>: a los 5 s, con N2 y el calefactor en marcha.',
      '<b>Precalentamiento → producción</b>: cuando T1 lleva 30 s seguidos a la consigna menos 1 °C o más.',
      '<b>Producción → lavado</b>: cuando alcanzas la <b>producción de referencia</b>, cuando el <b>tanque de origen se agota</b> o cuando pulsas ' +
          '<b>Terminar producción</b>. Hasta entonces la producción sigue; un tanque poco lleno la acorta.',
      '<b>Lavado → parada</b>: tras 2 minutos simulados de lavado. <b>Parada → finalizada</b>: cuando T2 baja de 45 °C.',
      'La <b>pista de fases</b> de la barra de operación muestra en qué fase está la planta (se llena la actual, en rojo si hay una alarma) y debajo ' +
          'el <b>motivo del último cambio de fase</b>; el registro lo anota con su hora.',
    ])],
    ['Parámetros', lista([
      '<b>Producción de referencia</b> (ml): cuánto producto acabado quieres; el máximo es lo que hay en el tanque de origen.',
      '<b>Llenado</b> de los tanques A y B (en %, solo con la secuencia parada; en marcha el deslizador solo muestra el nivel, que va bajando). ' +
          'El tanque que no es el de origen empieza vacío; al cambiar de origen, el nuevo recibe el llenado del anterior, <b>modo de ' +
          'regulación</b>, <b>tanque de origen</b> (A o B).',
      '<b>T1 del producto</b>: la consigna en los modos de T1, cascada y lazos múltiples, y en todos los modos la mínima para no desviar el producto.',
      'Según el modo aparecen además la <b>consigna de T2</b>, la <b>histéresis de T2</b> (solo en todo/nada: la resistencia se conecta al máximo por debajo de consigna - histéresis y se desconecta por encima de consigna + histéresis), la <b>potencia</b> fija, el <b>caudal PWM de N1</b> o la <b>consigna de caudal F1</b>.',
      'La línea bajo los deslizadores avisa si con esa configuración el modelo no llegaría a la temperatura pedida; en ese caso salta la alarma ' +
          'de precalentamiento.',
      'La configuración se bloquea mientras la secuencia está en curso.',
    ])],
    ['Botones', lista([
      '<b>Iniciar secuencia</b>, <b>Pausar / Reanudar</b> (congela el tiempo), <b>Parada ordenada</b> y <b>Emergencia</b> están siempre en la ' +
          'barra. En <b>Más</b>: <b>Terminar producción</b> (pasa al lavado cuando tú decidas), <b>Saltar fase</b> y <b>Reiniciar planta</b>.',
      '<b>Parada ordenada</b>: va a la fase de parada y apaga con orden. <b>Emergencia</b>: apaga todo al instante.',
      '<b>Reconocer alarma</b>: tras una alarma pasa a parada ordenada (tras emergencia vuelve a reposo). <b>Reiniciar planta</b>: devuelve todo ' +
          'al estado inicial.',
    ])],
    ['Alarmas con acción correctiva', lista([
      '<b>Tanque vacío o casi vacío</b>: rellenar con SOL4 (A) o SOL5 (B), o cambiar de origen.',
      '<b>Corte térmico</b> (T2 por encima de 91 °C): esperar a que baje y repetir el arranque.',
      '<b>T1 no alcanza la consigna</b> en 20 min: bajar la consigna o el caudal; el modelo no llega a esa temperatura.',
      'Cada alarma corta el calefactor y recircula el producto antes de esperar a que la reconozcas.',
    ])],
    ['Gráfica y registro', lista([
      'En la pestaña Gráficas, la primera gráfica muestra T1 (azul), T2 (naranja) y T3 (verde azulado). La línea gris discontinua es la consigna de T1 y la naranja, la de T2 ' +
          'cuando el modo la usa.',
      'Los botones de la leyenda muestran una sola serie o señal, con la escala ajustada; «Todas» vuelve a la vista completa. La segunda gráfica muestra la potencia efectiva de la resistencia (0-100 %) y, debajo, cuándo están activas N1, N2 y SOL1 a SOL5.',
      'El registro anota cada cambio de fase, los desvíos de SOL1 y las alarmas con su hora simulada.',
    ])],
  ];

  const GUIA_DEMOSTRACION = [
    ['Modo demostración: qué hace', '<p>Tú solo marcas la <b>temperatura de pasteurización</b> (la temperatura del producto a la salida del tubo ' +
        'de residencia, T1) el <b>tanque de origen</b> con su <b>llenado</b>, y pulsas <b>Iniciar secuencia</b>. La planta ejecuta sola todo el ' +
        'proceso y se para al terminar.</p>'],
    ['Qué decide la planta por ti', lista([
      '<b>Caudal de N1</b>: el mayor (hasta el 50 %) con el que el modelo llega a esa temperatura. Cuanto más alta es la temperatura, menos caudal.',
      '<b>Regulación del calefactor</b>: por defecto en cascada (T1 fija la consigna de T2 y T2 la potencia). En el selector <b>Regulación</b> puedes elegir <b>Todo o nada sobre T2</b>: la resistencia se conecta y desconecta al máximo según la consigna de T2 y su histéresis, y entonces eliges tú la <b>histéresis</b>, la <b>consigna de T2</b> y el <b>caudal de N1</b>.',
      '<b>Producción</b>: por defecto sigue hasta agotar el tanque de origen. Puedes fijar una <b>producción de referencia</b> (ml) menor; nunca ' +
          'puede superar lo que hay en el tanque. También puedes cortarla antes con <b>Terminar producción</b>.',
      'También eliges el <b>tanque de origen</b> (A o B) y <b>cuánto lo llenas</b> (en %). El otro tanque queda vacío. El dibujo de los ' +
          'depósitos, L1 y los flotadores HL y LL siguen esos niveles, y el tanque elegido es el que se consume.',
      '<b>Fases</b>: arranque, precalentamiento (el producto recircula con SOL1 activa), producción (SOL1 desvía si T1 baja de la consigna), ' +
          'lavado y parada.',
    ])],
    ['Botones', lista([
      '<b>Iniciar secuencia</b>, <b>Pausar / Reanudar</b>, <b>Parada ordenada</b> y <b>Emergencia</b> (apaga todo al instante). Tras una alarma, ' +
          '<b>Reconocer alarma</b>. En <b>Más</b>: <b>Terminar producción</b> y <b>Reiniciar planta</b>.',
      '<b>Velocidad</b>: empieza en 1× (tiempo real). Súbela a 5× o 20× para ver la secuencia completa en pocos minutos.',
    ])],
    ['Límites', '<p>El rango de temperatura llega hasta donde el modelo es capaz (unos 65 °C). La temperatura y los tiempos son los de una ' +
        '<b>simulación didáctica</b>: no son valores del fabricante. Para ajustar todo (modo de regulación, consignas, tanque, caudal) usa el ' +
        'modo automático.</p>'],
  ];

  const GUIA_INICIO = [
    ['Los dos modos', lista(['<b>Modo manual</b>: tú gobiernas cada bomba, válvula y el calefactor desde el esquema y los paneles.',
      '<b>Modo automático</b>: la planta ejecuta sola la secuencia de pasteurización y tú la supervisas; puedes elegir cómo se regula el calefactor.'])],
    ['En cualquier modo', '<p>Pulsa el botón <b>? Ayuda</b> para ver la guía de esa pantalla, y haz <b>clic derecho</b> (o mantén pulsado 3 s en pantallas táctiles) sobre cualquier elemento ' +
        'del esquema para saber qué es.</p>'],
  ];

  const GUIA_SUPUESTOS = ['Qué viene del manual y qué no', '<p>Del <b>manual</b>: la descripción de la planta y su secuencia típica, los sensores ' +
      'y sus rangos (T 0-150 °C, nivel 0-250 mm), las protecciones del calefactor (termostato y nivel), la elección de tanque con SOL2, el ' +
      'rechazo del producto con SOL1 y los modos de operación que cita (manual, ON/OFF, lazos simples, cascada y múltiples).</p><p><b>No lo dice ' +
      'el manual</b> y es supuesto de este simulador: todas las consignas, las ganancias de los lazos, los tiempos de estabilización, la banda de ' +
      'desvío, los coeficientes térmicos del modelo (incluido el calor que el producto le quita al agua caliente), el lavado, los canales de la ' +
      'placa y el valor «adelante» del sentido de giro.</p>'];

  const api = { ELEMENTOS, ETIQUETA_POR_TEXTO, ETIQUETA_POR_ID, GUIA_COMUN, GUIA_MANUAL, GUIA_AUTOMATICO, GUIA_DEMOSTRACION, GUIA_INICIO,
      GUIA_SUPUESTOS,
          lista };
  if (typeof module !== 'undefined') module.exports = api; else PCT.ayudaTextos = api;
})();
