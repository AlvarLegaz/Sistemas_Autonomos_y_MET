// Textos de ayuda de la instalación fotovoltaica: una ficha por equipo (todos los de EQUIPOS; los paneles y los fusibles gemelos comparten ficha) con qué es, para qué sirve,
// cómo falla y qué síntoma da, qué medir con el multímetro y qué valor esperar, riesgos, y las averías de AVERIAS relacionadas. Lenguaje para grado medio/superior de mantenimiento electrónico.
// TODOS los valores numéricos son SUPUESTOS razonables a partir de las fotos y de los datos típicos de los equipos (ver ../layout.js): no se leyeron las placas de características.
// API (igual que la de la planta real, pero con ficha completa):
//   PCT.fvTextos.fichaDe(tag)        → { tag, titulo, etiqueta, grupo, queEs, paraQue, fallos[], medir[], riesgos[], averias[{id,titulo}] } | null
//   PCT.fvTextos.TAGS                → lista de tags cubiertos (todos los de EQUIPOS)
//   PCT.fvTextos.construirElementos()→ { tag: { titulo, etiqueta, queEs, enSimulador, mantenimiento } } (texto plano; es lo que lee ayuda_fv.js; también disponible como PCT.fvTextosAyuda)
//   PCT.fvTextos.estadoVivo(tag, estado) → texto «Estado ahora» a partir de sim.estado (contrato de ARQUITECTURA.md §3)
//   PCT.fvTextos.GUIA                → [[titulo, html]] guía general de la pantalla
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.fvLayout;

  const AVISO_CC = 'La continua de los paneles NO se puede apagar mientras haya luz: aunque abras el seccionador, el lado de los paneles sigue en tensión (de 100 a 150 V según el campo).';
  const AVISO_ARCO = 'No abras ni enchufes un conector MC4, un fusible o un seccionador con corriente: el arco de continua no se apaga solo (no pasa por cero como en alterna) y puede quemar y soldar los contactos.';

  // Cada ficha: queEs, paraQue, fallos[], medir[], riesgos[], relacionadas[] (ids de AVERIAS además de las que ya tienen ese tag).
  const FICHAS = {
    panel: {
      etiqueta: 'Panel fotovoltaico',
      queEs: 'Módulo de células fotovoltaicas en serie con tres diodos de paso (bypass), uno por cada tercio de las células. Campo A: 6 paneles policristalinos de 250 Wp (Voc 37,5 V, Isc 8,9 A, Vmp 30,5 V, Imp 8,2 A). Campo B: 8 paneles monocristalinos negros half-cut de 400 Wp (Voc 37,1 V, Isc 13,5 A, Vmp 31,0 V, Imp 12,9 A). Datos supuestos.',
      paraQue: 'Convierte la luz en corriente continua. La corriente es casi proporcional a la irradiancia (1000 W/m² da la Isc de la placa) y la tensión baja con el calor: unos −0,3 % por cada grado de la célula. Al calentarse, el panel da menos potencia (−0,35 a −0,43 %/°C).',
      fallos: [
        'Sombra o suciedad sobre una parte: el diodo de ese tercio conduce y el panel pierde un tercio de tensión, pero la potencia cae más de un tercio porque la cadena entera se ve arrastrada. Síntoma: potencia de la cadena muy baja con sol y tensión de cadena menor de lo normal.',
        'Diodo de paso en cortocircuito: ese tercio del panel queda anulado siempre. Síntoma: tensión de la cadena unos 10 V más baja (en un panel de 60 células) con buen sol.',
        'Diodo de paso abierto: con una sombra parcial el diodo no puentea, la corriente de la cadena se ve limitada por el tercio sombreado y aparece un punto caliente peligroso. Síntoma: la sombra más pequeña hunde la producción de toda la cadena.',
        'Punto caliente, microfisuras, caja de conexiones o conectores MC4 deteriorados: pérdida de potencia lenta y calentamiento localizado (se ve con cámara térmica).',
      ],
      medir: [
        'Tensión en vacío Voc del panel (desconectado de la cadena, con sol): unos 33 a 37 V; en un día caluroso baja y en una mañana fría sube por encima del dato de placa.',
        'Corriente de cortocircuito Isc con pinza de continua o el multímetro en la escala de 10 A solo si sabes hacerlo con seguridad: unos 8,9 A (campo A) o 13,5 A (campo B) a 1000 W/m²; a media luz, la mitad.',
        'Diodos de paso: panel desconectado y a oscuras, prueba de diodo entre los bornes de cada diodo de la caja de conexiones: 0,3 a 0,5 V en un sentido y «OL» en el otro. 0 V en los dos sentidos = diodo en corto; «OL» en los dos = diodo abierto.',
      ],
      riesgos: [AVISO_CC, AVISO_ARCO, 'Trabajo en cubierta: arnés, sin pisar los paneles y sin sombras de herramientas que originen puntos calientes.'],
      relacionadas: ['DIODO_BYPASS_PV104', 'DIODO_BYPASS_ABIERTO_PV203', 'SOMBRA_PARAPETO', 'SUCIEDAD_ALTA_A'],
    },
    cadena: {
      etiqueta: 'Cadena de paneles',
      queEs: 'Paneles conectados en serie: las tensiones se suman y la corriente es la del peor panel. Campo A: 3 paneles (Voc ≈ 112 V, Vmpp ≈ 91 V, Imp 8,2 A), dos cadenas en paralelo hacia el EASun, que admite de 60 a 145 V de MPPT. Campo B: 4 paneles (Voc ≈ 148 V, Vmpp ≈ 124 V, Imp 12,9 A), una cadena por cada entrada MPPT del ZCS (90 a 450 V). Datos supuestos.',
      paraQue: 'Subir la tensión a la que trabaja el inversor para que la corriente (y las pérdidas en los cables) sean menores. En el campo A hay que vigilar el máximo de 145 V del EASun: en una mañana fría la Voc sube y no debe pasarlo.',
      fallos: [
        'Cadena abierta (conector MC4 sin enchufar, cable cortado): hay tensión Voc pero ninguna corriente. Síntoma: el inversor ve «una cadena menos», la potencia del campo cae a la mitad y la medida de corriente de esa cadena da 0 A.',
        'Conector con alta resistencia: calienta, pierde potencia y puede fundir el MC4. Síntoma: una cadena rinde menos que su gemela con la misma luz y el conector está caliente.',
        'Fallo de aislamiento a tierra: un cable pelado en la bandeja o un panel con la caja dañada deriva corriente a tierra. Síntoma: el inversor (sobre todo el ZCS) no arranca y avisa de fallo de aislamiento.',
        'Desequilibrio por suciedad o sombras: las dos cadenas de un campo dan potencias distintas.',
      ],
      medir: [
        'Voc de la cadena en la caja, con el seccionador abierto: campo A entre 100 y 115 V; campo B entre 130 y 150 V (con calor, algo menos). Comprueba que el rojo es + y el negro − antes de enchufar nada.',
        'Corriente con pinza amperimétrica de continua en uno de los dos cables: con sol pleno, cerca de Imp (8,2 A en A, 12,9 A en B). Las dos cadenas del mismo campo deben diferir menos de un 5 %.',
        'Aislamiento: con las cadenas desconectadas del inversor y un megóhmetro de 500 a 1000 V, resistencia entre cada polo y tierra: más de 1 MΩ (menos de unos cientos de kΩ da fallo de aislamiento).',
      ],
      riesgos: [AVISO_CC, AVISO_ARCO],
      relacionadas: [],
    },
    caja_cc_a: {
      etiqueta: 'Caja de conexión de continua',
      queEs: 'La caja blanca «HT 8WAY» de la foto, junto al EASun: dentro lleva los fusibles de las cadenas (F-101 y F-102), un seccionador bipolar con palanca roja (QS-101) y un descargador de sobretensiones de continua (SPD-101) con su testigo. El orden de los aparatos es supuesto.',
      paraQue: 'Reunir las dos cadenas del campo A, protegerlas, poder aislar el campo del inversor y desviar a tierra las sobretensiones de origen atmosférico antes de que lleguen al inversor.',
      fallos: [
        'Bornas flojas o mal apretadas: se calientan (puntos calientes que se ven con cámara térmica) y llegan a quemar el aislante. Síntoma: pérdida de potencia y olor a plástico caliente.',
        'Condensación o entrada de agua por los prensaestopas: fugas a tierra y corrosión. Síntoma: fallo de aislamiento intermitente en días húmedos.',
        'Fusible fundido o descargador agotado: ver sus fichas.',
      ],
      medir: [
        'Tensión de cada cadena en las bornas de entrada (antes de los fusibles): unos 100 a 115 V.',
        'Misma tensión después de los fusibles y entre + y − de la salida con el seccionador cerrado. Una diferencia de más de 1 V entre dos puntos unidos por un cable indica una conexión mala.',
        'Estado del testigo del descargador: verde sano, rojo agotado.',
      ],
      riesgos: [AVISO_CC, 'Con el seccionador abierto las bornas de ENTRADA siguen vivas. Abre siempre con el cuadro sin carga y usa pértiga o guantes aislantes.', AVISO_ARCO],
      relacionadas: ['FUSIBLE_F101', 'SPD_DISPARADO_A'],
    },
    fusible: {
      etiqueta: 'Fusible de cadena',
      queEs: 'Fusible cilíndrico gPV (10×38 mm, supuesto 15 A, 1000 V CC) en el polo positivo de cada cadena del campo A: F-101 en STR-101 y F-102 en STR-102 (son gemelos). En la foto van en portafusibles dentro de la caja HT 8WAY.',
      paraQue: 'Proteger los cables y los paneles de una corriente inversa: si una cadena se cortocircuita, las demás cadenas en paralelo le inyectan corriente. Con solo dos cadenas la corriente inversa máxima (≈ la Isc de una cadena) es menor que la que aguanta un panel (unos 15 A), así que aquí el fusible protege poco y se pone por costumbre y por las normas del instalador. Con tres o más cadenas en paralelo sí es imprescindible.',
      fallos: [
        'Fusible fundido (envejecimiento térmico, cortocircuito, mala conexión): esa cadena queda desconectada del resto. Síntoma: el inversor produce la mitad en ese campo y la corriente de esa cadena es 0 A aunque hay tensión en el lado de los paneles.',
        'Portafusible flojo: calienta, el fusible se estropea antes de tiempo o da lecturas intermitentes.',
      ],
      medir: [
        'Con tensión: voltímetro de continua entre los dos extremos del fusible: unos 0 V si está sano; si está fundido aparece la tensión de la cadena (unos 90 a 115 V).',
        'Sin tensión (cadena aislada): continuidad entre extremos: menos de 1 Ω sano; «OL» fundido.',
        'Compara la corriente de las dos cadenas con pinza: una a 0 A y la otra normal indica el fusible o el conector de la que da 0.',
      ],
      riesgos: ['No saques un portafusible con corriente: el arco de continua no se apaga. Abre primero el seccionador QS-101 y mide después.', AVISO_CC],
      relacionadas: ['FUSIBLE_F101'],
    },
    seccionador_cc: {
      etiqueta: 'Seccionador de continua',
      queEs: 'Interruptor-seccionador de corte en carga de continua, bipolar, de 1000 V CC como mínimo, con palanca roja: QS-101 en la caja HT 8WAY del campo A y QS-201 en el campo B (el ZCS lleva además uno integrado en la propia carcasa y se supone otro en la caja auxiliar).',
      paraQue: 'Desconectar los paneles del inversor para el mantenimiento y en una emergencia, con la corriente que circule. Un interruptor de alterna NO sirve: el arco de continua no se extingue.',
      fallos: [
        'Contacto picado o oxidado: aumenta la resistencia, calienta y pierde tensión. Síntoma: tensión menor a la salida que a la entrada con corriente (más de 0,2 V a través de un polo cerrado) y la carcasa caliente.',
        'Palanca atascada o rota y polos que no cierran a la vez: un solo polo cerrado deja el campo en tensión.',
        'Cerrado con una carga mayor de la nominal: arco en el contacto y daño.',
      ],
      medir: [
        'Con el campo iluminado: tensión entre entrada y salida de cada polo: 0 V cerrado y la tensión del campo (100 a 150 V) abierto.',
        'Caída de tensión en un polo cerrado con carga: de unos milivoltios a 50 mV; si pasa de 0,2 V hay que cambiarlo.',
        'Comprueba también la tensión entre cada polo y tierra: debe ser cercana a 0 V en un campo sano (una tensión alta indica fuga a tierra).',
      ],
      riesgos: [AVISO_CC, 'Abrirlo no deja los paneles sin tensión: solo aísla el inversor. Después de abrir, mide y no toques las bornas del lado de los paneles.', AVISO_ARCO],
      relacionadas: [],
    },
    spd_cc: {
      etiqueta: 'Descargador de sobretensiones de continua',
      queEs: 'Protector tipo 2 con varistores de óxido de zinc entre + / − y tierra, en cartucho enchufable con ventana testigo (verde sano, rojo agotado). SPD-101 va en la caja del campo A y SPD-201 en la caja del campo B.',
      paraQue: 'Desviar a tierra las sobretensiones de un rayo cercano o de maniobras antes de que quemen el inversor. Es una protección que se «gasta»: cada sobretensión envejece los varistores.',
      fallos: [
        'Agotado (testigo en rojo): la instalación funciona igual, así que el fallo es silencioso pero deja el inversor desprotegido. Se cambia el cartucho.',
        'Varistor derivado a tierra: un descargador deteriorado puede comportarse como una fuga a tierra. Síntoma: el inversor no arranca por fallo de aislamiento, sobre todo en el campo B (aislamiento bajo en un polo).',
      ],
      medir: [
        'Mira el testigo mecánico o el contacto auxiliar de aviso.',
        'Con el campo aislado y sin tensión: resistencia del cartucho entre cada polo y tierra con un megóhmetro de 500 V: más de 1 MΩ sano; baja resistencia = varistor deteriorado.',
        'Comprueba el cable de tierra del descargador: corto (menos de 0,5 m) y de 6 mm² o más (supuesto).',
      ],
      riesgos: ['No se sustituyen por descargadores de alterna: los de continua llevan la polaridad y el corte del arco pensados para CC.', AVISO_CC],
      relacionadas: ['SPD_DISPARADO_A', 'FALLO_AISLAMIENTO_B'],
    },
    spd_ca: {
      etiqueta: 'Descargador de sobretensiones de alterna',
      queEs: 'Protector tipo 2 de alterna monofásico (L-N-PE) en el cuadro QA-301, con el testigo de color.',
      paraQue: 'Proteger los inversores y las cargas de las sobretensiones de la red o de los rayos lejanos. Se instala después del magnetotérmico general y con un cable de tierra corto.',
      fallos: ['Cartucho agotado (testigo rojo): la protección ya no actúa pero la instalación funciona. Se cambia el cartucho.', 'Cartucho en corto: dispara el diferencial o el magnetotérmico que lo protege.'],
      medir: ['Testigo del cartucho.', 'Sin tensión, resistencia entre L y PE y entre N y PE con megóhmetro: más de 1 MΩ.', 'Tensión de red en el cuadro: 207 a 253 V.'],
      riesgos: ['Corte la red y compruebe ausencia de tensión antes de sacar un cartucho: el cuadro es de 230 V directos.'],
      relacionadas: [],
    },
    inversor_easun: {
      etiqueta: 'Inversor híbrido EASun',
      queEs: 'Inversor-cargador híbrido de 24 V (supuesto: 3 kW de potencia, MPPT de 60 a 145 V, Voc máxima 145 V, cargador de hasta 60 A) con pantalla azul, cuatro pulsadores y los LED AC/INV, CHG y FAULT. Lleva ventilador y un módulo Wi-Fi/RS485 (dongle USB en el lateral). Tres prioridades: solar primero, red primero y batería primero.',
      paraQue: 'Convierte la continua de los paneles en alterna de 230 V para las cargas protegidas (LOAD-302), carga la batería con tres etapas (corriente constante, absorción 28,4 V y flotación 27,2 V) y pasa a la red cuando la batería baja de 21,0 V; vuelve a la batería al subir a 25,0 V.',
      fallos: [
        'Sin batería (QB-101 disparado, BMS cortado): el inversor pierde la referencia de 24 V y puede apagarse o dar fallo. Síntoma: pantalla en negro o aviso de batería no detectada.',
        'Cadena abierta o fusible fundido: solo trabaja con una cadena; la potencia PV es la mitad.',
        'Calentamiento: con las rejillas de la caseta tapadas sube la temperatura y por encima de unos 75 °C reduce potencia («REDUCIDO»).',
        'Sobrecarga de la salida (más de 3 kW): se apaga o pasa a bypass de red.',
        'Pérdida de comunicación (Wi-Fi/RS485): la instalación funciona, pero no se ven los datos en remoto.',
      ],
      medir: [
        'Entrada PV: entre PV+ y PV− unos 60 a 145 V con sol (90 V es lo normal en la cadena a pleno sol); por debajo de 60 V no hay MPPT.',
        'Batería: entre BAT+ y BAT− 24 a 29 V. Compara con la tensión de la pantalla: una diferencia de 0,3 V o más indica caída en cables o bornas flojas.',
        'Salida AC OUT: 230 V ± 10 % entre L y N; N y PE a menos de 2 V.',
        'Corriente de carga con pinza de continua en el cable de la batería: hasta 60 A.',
      ],
      riesgos: ['Los condensadores se quedan cargados: desconecta batería, paneles y red y espera unos cinco minutos antes de abrir.', 'La batería de litio da cientos de amperios si se cortocircuita: no manejes herramientas metálicas sobre las bornas.', AVISO_CC],
      relacionadas: ['QB_DISPARADO', 'BMS_CORTE_BATERIA', 'CELDA_DESEQUILIBRADA', 'VENTILACION_TAPADA', 'COMUNICACION_PERDIDA_EASUN', 'CADENA_ABIERTA_A1', 'FUSIBLE_F101', 'SPD_DISPARADO_A', 'DIFERENCIAL_DISPARADO', 'RED_CAIDA'],
    },
    inversor_zcs: {
      etiqueta: 'Inversor híbrido ZCS Azzurro',
      queEs: 'Inversor conectado a red monofásico (supuesto: 3 kW, dos entradas MPPT de 90 a 450 V con arranque a 100 V, Voc máxima 550 V) con pantalla y tres LED (On-Grid, Off-Grid, Alarma). Trabaja con autoconsumo o vertido y lleva un medidor (MED-201). En esta instalación se supone sin batería. Sus conectores MC4 y la alterna salen por debajo.',
      paraQue: 'Convierte la energía del campo B en alterna de red. Antes de conectar comprueba el aislamiento de los paneles y espera unos 60 s de reconexión; si falta la red (anti-isla) se desconecta enseguida: nunca debe alimentar una red sin tensión.',
      fallos: [
        'Fallo de aislamiento (cable pelado, MC4 sucio, SPD en fuga): el LED de alarma se enciende y no arranca. Síntoma: lectura de aislamiento por debajo del mínimo.',
        'Red caída o fuera de rango (253 V o más): se desconecta por anti-isla y reconecta tras la espera. Con la red alta reduce potencia antes de desconectar.',
        'Cadena abierta o con conector resistivo: una entrada MPPT sin potencia o con potencia baja.',
        'Diodo de paso abierto con sombra: la cadena se hunde y a menudo cae por debajo del arranque de 100 V.',
        'Calor por ventilación tapada: reduce potencia.',
      ],
      medir: [
        'Entrada MPPT: tensión de cada cadena entre 120 y 150 V a pleno sol; si queda por debajo de 100 V no arranca.',
        'Salida AC: 230 V ± 10 % y 50 Hz entre L y N.',
        'Aislamiento con el inversor desconectado y megóhmetro de 500 V: más de 1 MΩ entre cada polo de cada cadena y tierra.',
        'Corriente de vertido con pinza en la fase: potencia en kW dividida entre 230 V.',
      ],
      riesgos: ['Con luz, las bornas PV de entrada están vivas aunque el inversor esté apagado. Abre el seccionador y espera cinco minutos antes de abrir la carcasa.', AVISO_ARCO],
      relacionadas: ['FALLO_AISLAMIENTO_B', 'RED_CAIDA', 'SOBRETENSION_RED', 'DIODO_BYPASS_ABIERTO_PV203', 'CONECTOR_RESISTIVO_B2', 'CADENA_ABIERTA_B1', 'VENTILACION_TAPADA', 'SOMBRA_PARAPETO'],
    },
    magnetotermico_cc: {
      etiqueta: 'Magnetotérmico de continua',
      queEs: 'Interruptor automático bipolar de continua (2P) de la foto, sobre carril DIN junto a los cables gruesos de la batería. Supuesto: 100 a 125 A, de continua y polarizado.',
      paraQue: 'Proteger el cable de la batería contra cortocircuito y sobrecarga y poder aislarla del inversor. Va antes del portafusible.',
      fallos: [
        'Disparado (por cortocircuito, sobrecarga o bornas flojas que calientan): se pierde la batería. Síntoma: el EASun no ve la batería (0 V en BAT+/BAT−) aunque la batería esté llena y la palanca está en posición intermedia.',
        'Bornas flojas: el interruptor se calienta y dispara sin causa de sobrecarga.',
      ],
      medir: [
        'Tensión de la batería en los dos lados del interruptor: unos 25 a 28 V en el lado de la batería y 0 V en el del inversor significa que está abierto o disparado.',
        'Caída de tensión en cada polo cerrado con carga: pocas decenas de mV; más de 0,1 V es una borna floja o un contacto malo.',
      ],
      riesgos: ['Al volver a cerrar con el inversor conectado se puede ver un chispazo: es la precarga de los condensadores. Si el interruptor vuelve a saltar, no insistas: hay un cortocircuito.', 'Una batería de litio puede dar más de 1000 A en un cortocircuito: quítate anillos y relojes.'],
      relacionadas: ['QB_DISPARADO'],
    },
    fusible_bateria: {
      etiqueta: 'Portafusible de la batería',
      queEs: 'Portafusible (de la foto, azul, en el cable positivo) con un fusible de potencia, supuesto de 125 a 150 A, entre el magnetotérmico de continua y la batería.',
      paraQue: 'Es la última protección del cable positivo de la batería: corta un cortocircuito que el magnetotérmico no haya visto y limita la energía que da la batería (el litio no tiene resistencia interna suficiente para limitarla solo).',
      fallos: ['Fundido: se pierde la batería, igual que con QB-101 abierto. Síntoma: 0 V en el lado del inversor, y los 25 a 28 V siguen en el lado de la batería.', 'Portafusible suelto: calienta, tensión baja en el inversor con carga y cables templados.'],
      medir: ['Tensión entre los dos extremos del fusible con carga: menos de 0,1 V sano; la tensión de la batería si está fundido.', 'Sin tensión: continuidad menos de 1 mΩ de extremo a extremo.'],
      riesgos: ['Desconecta antes el magnetotérmico QB-101 y la batería: no se cambia un fusible de potencia con corriente.', 'Nunca puentees el fusible con un cable: es la protección contra incendio.'],
      relacionadas: [],
    },
    bateria: {
      etiqueta: 'Batería LiFePO4',
      queEs: 'Batería de litio-hierro-fosfato de 25,6 V (8 celdas en serie, 3,2 V por celda) y 100 Ah, unos 2,56 kWh, con BMS interno (la de la foto, con etiqueta azul «iBattery-EA-24V-100AH»). Se carga hasta 29,2 V (3,65 V por celda) y el inversor la corta a 21,0 V.',
      paraQue: 'Almacena la energía de los paneles para el uso nocturno o cuando falla la red. El BMS vigila las celdas y abre la batería ante tensión alta o baja, corriente excesiva o temperatura fuera de rango.',
      fallos: [
        'Corte del BMS por baja tensión de celda: la batería queda a 0 V en bornas aunque no esté vacía del todo. Se recupera cargándola con una fuente externa.',
        'Celda desequilibrada: una celda se carga antes que las demás, el BMS corta por celda alta antes de llegar al 100 %, o por celda baja antes del 10 %. Síntoma: la capacidad útil se reduce y la tensión de pack se mueve en poca zona.',
        'Sobrecorriente o temperatura: el BMS abre la batería.',
        'Bornas flojas: caídas de tensión y calentamiento en las bornas.',
      ],
      medir: [
        'Tensión de reposo en bornas (orientativa): unos 26,6 V al 50 %, 27 V al 100 % tras reposar y unos 25,6 V al 10 %; al cargar sube a 28,4 V o más. Una caída brusca de más de 1 V al conectar una carga indica resistencia alta o una celda débil.',
        'Tensión por celda con la app del BMS: dentro de unos 50 mV entre celdas en la zona media; más de 100 mV de diferencia es un desequilibrio.',
        'Corriente con pinza de continua: hasta 100 A de carga o descarga.',
      ],
      riesgos: ['Un cortocircuito en bornas da cientos o miles de amperios: quemaduras, fuego y proyección de metal fundido. Nada metálico sobre la batería ni sobre las bornas.', 'No cargar por debajo de 0 °C ni por encima de unos 45 °C. Cuidado con los objetos acumulados junto a ella en la caseta.'],
      relacionadas: ['QB_DISPARADO'],
    },
    comunicaciones: {
      etiqueta: 'Módulo de comunicaciones',
      queEs: 'Módulo Wi-Fi/RS485 del EASun (el dongle USB que se ve en el lateral). Envía las lecturas del inversor a la nube o a una aplicación del móvil y permite configurarlo.',
      paraQue: 'Ver y registrar la producción, la batería y las alarmas en remoto. No interviene en la conversión de energía.',
      fallos: ['Pérdida de comunicación: la instalación sigue funcionando, solo se pierden los datos remotos. Síntoma: la aplicación muestra el equipo sin conexión o los datos congelados mientras la pantalla del inversor sigue normal.', 'Wi-Fi débil dentro de la caseta metálica (jaula de Faraday), dongle flojo o mal alimentado.'],
      medir: ['Con el multímetro: continuidad de los hilos A y B del RS485 y que no haya cortocircuito entre ellos.', 'Tensión de reposo entre A y B del bus: de unos 0,2 V a 3 V según el equipo (dato supuesto).', 'Mira el LED del módulo y la señal Wi-Fi desde el móvil junto a la caseta.'],
      riesgos: ['Es de baja tensión, pero el dongle va dentro del inversor: no lo saques con el equipo en funcionamiento si el fabricante lo desaconseja.'],
      relacionadas: ['COMUNICACION_PERDIDA_EASUN'],
    },
    medidor: {
      etiqueta: 'Medidor de red',
      queEs: 'Medidor de consumo e inyección del ZCS (con transformador de intensidad o con contador monofásico y comunicación RS485). Mide la potencia que cambia la instalación con la red.',
      paraQue: 'Decir al ZCS cuánto consume el centro para vertir solo el exceso (o limitar a 0) y para contar la energía importada y exportada.',
      fallos: ['Transformador de intensidad al revés: el signo importa/exporta sale invertido. Síntoma: el ZCS parece «consumir» cuando vierte.', 'RS485 cortada: el inversor se queda sin medida y limita o desconecta según su configuración.'],
      medir: ['Tensión de medida: 230 V entre L y N.', 'Corriente con pinza en la fase y compárala con la del medidor: debe coincidir en un 3 %.', 'Continuidad del bus RS485 hasta el ZCS.'],
      riesgos: ['Nunca abras el secundario de un transformador de intensidad con corriente por el primario: aparece una tensión muy alta. Cortocircuita el secundario antes de desconectarlo.'],
      relacionadas: ['RED_CAIDA'],
    },
    cuadro_ca: {
      etiqueta: 'Cuadro de alterna',
      queEs: 'Cuadro estanco de la caseta con tapa transparente y carril DIN. Por la foto: arriba, el diferencial y el magnetotérmico general; en el centro, dos magnetotérmicos (amarillo y negro, marca AEG, supuestos QF-302 y QF-303); abajo, otro magnetotérmico y una toma schuko. Alimenta al EASun, al ZCS, a las cargas y a la toma.',
      paraQue: 'Concentrar y proteger las líneas de alterna de la instalación y repartir la red entre los dos inversores y las cargas.',
      fallos: ['Bornas flojas en peines y magnetotérmicos: calientan y fallan intermitentemente.', 'Falta de tensión en el cuadro: mira primero QF-301 y el diferencial.', 'Humedad o condensación: dispara el diferencial.'],
      medir: ['Tensión de la red a la entrada del cuadro: 207 a 253 V (230 V nominal).', 'Tensión a la salida de cada magnetotérmico: la misma que a la entrada.', 'N-PE menor de 2 V; tierra bien conectada a la caseta metálica.'],
      riesgos: ['Es de 230 V directos: antes de abrir, desconecta el general, bloquéalo y comprueba ausencia de tensión. Mientras esté la red conectada y los inversores en marcha puede haber tensión por los dos lados.', 'El EASun puede alimentar las cargas desde la batería aunque falte la red: puede haber tensión en su salida aunque el general esté abierto.'],
      relacionadas: ['DIFERENCIAL_DISPARADO', 'RED_CAIDA'],
    },
    magnetotermico_general: {
      etiqueta: 'Magnetotérmico general',
      queEs: 'Interruptor automático bipolar de 25 A (supuesto, curva C) que protege toda la entrada del cuadro de alterna.',
      paraQue: 'Cortar ante una sobrecarga o un cortocircuito en cualquier punto del cuadro y permitir desconectarlo entero.',
      fallos: ['Disparado: el cuadro entero sin tensión y los dos inversores sin red. Síntoma: el ZCS pasa a alarma y el EASun trabaja con la batería.', 'Contacto flojo en bornas: se calienta y dispara sin carga elevada.'],
      medir: ['Tensión a la entrada y a la salida: deben ser iguales (230 V).', 'Corriente con pinza: menos de 25 A.', 'Sin tensión: continuidad por polo.'],
      riesgos: ['Rearmar sin buscar la causa. Si vuelve a saltar, hay un cortocircuito o una sobrecarga.'],
      relacionadas: [],
    },
    diferencial: {
      etiqueta: 'Interruptor diferencial',
      queEs: 'Interruptor diferencial de 30 mA, 40 A (supuesto), con botón de test. Compara la corriente de fase y de neutro: si no coinciden hay una fuga a tierra.',
      paraQue: 'Proteger a las personas contra contactos indirectos y limitar el riesgo de incendio por fugas. Los inversores sin transformador pueden dejar fugas de continua o de alta frecuencia: se usa el tipo que pide el fabricante (A, F o B).',
      fallos: ['Disparos sin causa aparente: fugas acumuladas de cargas, humedad en cajas y tomas, neutro puenteado con tierra aguas abajo, o fuga capacitiva de los inversores.', 'Test que no dispara: aparato averiado, hay que cambiarlo.'],
      medir: ['Pulsa el botón de test: debe disparar. Se hace cada pocos meses.', 'Aislamiento de cada línea con megóhmetro de 500 V (con el diferencial abierto y los inversores desconectados): más de 1 MΩ.', 'Mide la corriente de fuga con una pinza de fugas en el conjunto de fase y neutro: menos de 10 mA.'],
      riesgos: ['No lo puentees ni lo cambies por uno de mayor sensibilidad para que no salte: protege vidas.', 'Desconecta los inversores antes de medir aislamiento: el megóhmetro (500 V) los dañaría.'],
      relacionadas: ['DIFERENCIAL_DISPARADO'],
    },
    magnetotermico_easun: {
      etiqueta: 'Magnetotérmico de la línea del EASun',
      queEs: 'Interruptor automático de 16 A (supuesto, curva C), pensado para la línea del EASun: protege la entrada de red y la salida hacia las cargas protegidas y la toma.',
      paraQue: 'Aislar el EASun de la red y proteger los cables de su entrada y de su salida, que son de 2,5 mm².',
      fallos: ['Disparado por sobrecarga (más de 3,5 kW en total) o cortocircuito en una carga: el EASun se queda sin red y las cargas sin tensión, aunque el EASun siga funcionando con batería.', 'Abierto a propósito para aislar.'],
      medir: ['230 V a la entrada y a la salida del magnetotérmico.', 'Corriente con pinza: menos de 16 A.'],
      riesgos: ['Abrirlo no apaga la salida del EASun si este se alimenta de la batería: puede seguir habiendo 230 V aguas abajo. Apaga también el inversor.'],
      relacionadas: [],
    },
    magnetotermico_zcs: {
      etiqueta: 'Magnetotérmico de la línea del ZCS',
      queEs: 'Interruptor automático de 16 A (supuesto, curva C) de la línea de vertido del ZCS, de 4 mm².',
      paraQue: 'Aislar el ZCS de la red y proteger el cable de su salida. Con el magnetotérmico abierto el ZCS lo ve como una falta de red y se desconecta.',
      fallos: ['Disparado: el ZCS pasa a «sin red», se enciende el LED de alarma o Off-Grid y deja de producir. Síntoma: el campo B no produce aunque haya sol y los paneles estén bien.'],
      medir: ['230 V a la entrada y a la salida.', 'Corriente con pinza: menos de 16 A (3 kW son unos 13 A).'],
      riesgos: ['Para aislar el ZCS hay que abrir también su seccionador de continua: abrir solo este interruptor no desconecta la continua de los paneles.'],
      relacionadas: [],
    },
    toma: {
      etiqueta: 'Toma de corriente',
      queEs: 'Base schuko de 16 A del cuadro, alimentada por la salida de cargas protegidas del EASun.',
      paraQue: 'Dar 230 V para conectar un equipo de prueba, un cargador o una herramienta en la caseta. Se alimenta con la fuente que el EASun elija (placas, batería o red).',
      fallos: ['Sin tensión: QF-302 abierto, EASun apagado o en fallo, o cargas protegidas sobrepasadas.', 'Contactos flojos o sucios: calienta la toma.'],
      medir: ['230 V entre fase y neutro (de 207 a 253 V).', 'Fase-tierra unos 230 V y neutro-tierra por debajo de 2 V.', 'Comprueba que el diferencial dispara con el probador de tomas.'],
      riesgos: ['No conectes más de 3 kW en total con LOAD-302: el inversor se sobrecarga.', 'No conectes una toma de prueba sin diferencial.'],
      relacionadas: ['DIFERENCIAL_DISPARADO'],
    },
    red: {
      etiqueta: 'Acometida de red',
      queEs: 'Acometida monofásica del centro, 230 V y 50 Hz, con una tolerancia de ± 10 % (de 207 a 253 V).',
      paraQue: 'Alimentar el centro y el EASun cuando las placas y la batería no bastan, y recibir el vertido del ZCS.',
      fallos: ['Caída de red: el ZCS se desconecta por anti-isla (en menos de unos 2 s) y vuelve tras la espera de 60 s; el EASun pasa a batería y alimenta solo las cargas protegidas.', 'Tensión alta (253 V o más): el ZCS reduce potencia y después desconecta; puede deberse a mucho vertido en la zona.'],
      medir: ['Tensión entre L y N en el cuadro: 207 a 253 V.', 'Frecuencia: 50 Hz ± 1.'],
      riesgos: ['La acometida es de la compañía: no se toca aguas arriba del general.'],
      relacionadas: ['RED_CAIDA', 'SOBRETENSION_RED'],
    },
    carga_centro: {
      etiqueta: 'Consumo del centro',
      queEs: 'Cargas de alterna del centro (aula, iluminación, equipos) que cuelgan de la red y de las que el ZCS consume el autoconsumo. Hay un perfil por defecto con aula de mañana y de tarde y noche baja.',
      paraQue: 'Es lo que determina si la instalación B vierte (si el consumo es menor que la producción) o solo autoconsume.',
      fallos: ['Consumo mayor que la producción: se importa de la red.', 'Cargas con arranque brusco (motores): picos que pueden disparar protecciones.'],
      medir: ['Corriente total con pinza en la fase de entrada: la potencia en W es la corriente por 230 V (con factor de potencia 1).', 'Compara con la potencia que indica el medidor.'],
      riesgos: ['Las cargas del centro están protegidas aguas abajo por sus propios magnetotérmicos y diferenciales.'],
      relacionadas: [],
    },
    carga_protegida: {
      etiqueta: 'Cargas protegidas',
      queEs: 'Cargas conectadas a la salida del EASun (con la toma de corriente): reciben tensión del inversor incluso si falta la red, mientras haya batería o sol.',
      paraQue: 'Mantener en marcha lo esencial durante un corte. Elige la fuente de alimentación el EASun según su modo: solar primero, red primero o batería primero.',
      fallos: ['Más de 3 kW: el EASun se sobrecarga y se apaga o pasa a red.', 'Sin tensión: QF-302 abierto, el EASun apagado o en fallo.', 'Con la batería baja (menos de 21 V) el EASun pasa a la red; sin red ni batería se corta.'],
      medir: ['Tensión de salida del EASun: 230 V ± 5 %.', 'Corriente con pinza y compara con la potencia de la pantalla del EASun.'],
      riesgos: ['Puede haber 230 V aunque el general esté abierto (el EASun genera su propia tensión): apaga el EASun antes de tocar nada.'],
      relacionadas: [],
    },
    caseta: {
      etiqueta: 'Caseta metálica',
      queEs: 'Caseta gris pardo con puerta corredera y rejillas de ventilación en lo alto (visibles en la foto del cuadro), con los inversores, las cajas, la batería y el cuadro dentro. Las canaletas y cintas son «Unex» y «Efapel».',
      paraQue: 'Proteger los equipos de la lluvia y el sol y ventilarlos: los inversores disipan mucho calor y necesitan que entre y salga aire por las rejillas.',
      fallos: ['Rejillas de ventilación tapadas (con objetos, bolsas, suciedad o una tapa que se ha cerrado): los inversores se calientan, reducen potencia («REDUCIDO») y se acortan su vida. Síntoma: temperatura interior alta y potencia que cae a mediodía.', 'Una caseta metálica en una cubierta debe estar puesta a tierra y unida al resto de masas: si no, las derivaciones de los inversores la pueden dejar en tensión.'],
      medir: ['Temperatura del aire dentro con un termómetro: menos de unos 40 °C con calor exterior; de los inversores con una pistola infrarroja: menos de 70 °C.', 'Continuidad entre la caseta y la barra de tierra: menos de 1 Ω.'],
      riesgos: ['Calor y golpes en la cabeza; los equipos de la caseta tienen partes en tensión. No guardes objetos de metal sobre la batería.'],
      relacionadas: ['VENTILACION_TAPADA'],
    },
    bandeja: {
      etiqueta: 'Bandeja de cables',
      queEs: 'Bandeja de rejilla metálica por la que van los cables solares de doble aislamiento (rojo y negro) y los conectores MC4 de los paneles hasta la caseta.',
      paraQue: 'Sujetar y ordenar los cables de las cadenas, protegerlos del sol directo y del pisoteo y llevarlos a la caseta.',
      fallos: ['Cable apoyado en un borde afilado de la rejilla: el aislamiento se deteriora y aparece un fallo de aislamiento a tierra. Síntoma: el ZCS no arranca y se mide poca resistencia de un polo a tierra.', 'Conectores MC4 sueltos o al sol y la lluvia sin sujeción: alta resistencia y calentamiento.'],
      medir: ['Aislamiento de cada cable a la bandeja con megóhmetro: más de 1 MΩ.', 'Continuidad entre los tramos de bandeja para que estén unidos a tierra: menos de 1 Ω.'],
      riesgos: ['Los cables de la bandeja están en tensión mientras haya luz: no los cortes ni los muevas con herramientas metálicas.'],
      relacionadas: ['FALLO_AISLAMIENTO_B', 'CONECTOR_RESISTIVO_B2'],
    },
  };

  // Qué ficha usa cada equipo (por tag o por tipo).
  const FICHA_DE_TAG = { 'CB-101': 'caja_cc_a', 'F-101': 'fusible', 'F-102': 'fusible', 'FB-101': 'fusible_bateria', 'SPD-101': 'spd_cc', 'SPD-201': 'spd_cc', 'SPD-301': 'spd_ca', 'INV-101': 'inversor_easun', 'INV-201': 'inversor_zcs',
    'QF-301': 'magnetotermico_general', 'QF-302': 'magnetotermico_easun', 'QF-303': 'magnetotermico_zcs', 'LOAD-301': 'carga_centro', 'LOAD-302': 'carga_protegida' };
  const FICHA_DE_TIPO = { panel: 'panel', cadena: 'cadena', seccionador_cc: 'seccionador_cc', magnetotermico_cc: 'magnetotermico_cc', bateria: 'bateria', comunicaciones: 'comunicaciones', medidor: 'medidor', cuadro_ca: 'cuadro_ca',
    diferencial: 'diferencial', toma: 'toma', red: 'red', caseta: 'caseta', bandeja: 'bandeja' };
  // Averías relacionadas que no salen del tag de la avería (por ejemplo, el fusible de una cadena o el diodo de un panel de esa cadena).
  const EXTRA = { 'STR-101': ['FUSIBLE_F101'], 'STR-102': ['DIODO_BYPASS_PV104'], 'STR-201': ['DIODO_BYPASS_ABIERTO_PV203', 'FALLO_AISLAMIENTO_B', 'CADENA_ABIERTA_B1'], 'STR-202': ['CONECTOR_RESISTIVO_B2', 'SOMBRA_PARAPETO'], 'F-102': [], 'QS-101': ['FUSIBLE_F101', 'CADENA_ABIERTA_A1'], 'QS-201': ['CADENA_ABIERTA_B1', 'FALLO_AISLAMIENTO_B'] };

  const fichaClave = e => FICHA_DE_TAG[e.tag] || FICHA_DE_TIPO[e.tipo];
  const TAGS = layout.EQUIPOS.map(e => e.tag);

  /** Ficha completa de un equipo (null si el tag no existe). */
  function fichaDe(tag) {
    const e = layout.EQUIPOS.find(x => x.tag === tag); if (!e) return null;
    const clave = fichaClave(e), f = FICHAS[clave]; if (!f) return null;
    const ids = new Set(layout.AVERIAS.filter(a => a.tag === tag).map(a => a.id));
    for (const id of EXTRA[tag] || []) ids.add(id);
    const campoDe = tagAv => { const q = layout.EQUIPOS.find(x => x.tag === tagAv); return q && q.campo; };
    for (const id of f.relacionadas || []) {      // los paneles solo se relacionan con las averías de su campo
      const a = layout.AVERIAS.find(x => x.id === id);
      if (a && (e.tipo !== 'panel' || campoDe(a.tag) === e.campo)) ids.add(id);
    }
    const averias = [...ids].map(id => layout.AVERIAS.find(a => a.id === id)).filter(Boolean).map(a => ({ id: a.id, titulo: a.titulo }));
    return { tag, titulo: `${tag} · ${e.nombre}`, etiqueta: f.etiqueta, grupo: clave, queEs: f.queEs, paraQue: f.paraQue, fallos: f.fallos, medir: f.medir, riesgos: f.riesgos, averias };
  }

  const enumerar = lista => lista.map((x, i) => `(${i + 1}) ${x}`).join(' ');
  /** Fichas con la forma que usa la ayuda de la página principal (ayuda_fv.js): { tag: { titulo, etiqueta, queEs, enSimulador, mantenimiento } } en texto plano.
   *  enSimulador = para qué sirve y cómo falla; mantenimiento = qué medir, riesgos y averías relacionadas. */
  function construirElementos() {
    const salida = {};
    for (const tag of TAGS) {
      const f = fichaDe(tag); if (!f) continue;
      salida[tag] = { titulo: f.titulo, etiqueta: f.etiqueta, queEs: f.queEs, enSimulador: `${f.paraQue} CÓMO FALLA: ${enumerar(f.fallos)}`,
        mantenimiento: `QUÉ MEDIR: ${enumerar(f.medir)} RIESGOS: ${enumerar(f.riesgos)}${f.averias.length ? ` AVERÍAS RELACIONADAS: ${f.averias.map(a => a.titulo).join('; ')}.` : ''}` };
    }
    return salida;
  }

  const dec = (v, c = 1) => (typeof v === 'number' && isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');
  const kw = w => (typeof w === 'number' && isFinite(w) ? (Math.abs(w) >= 1000 ? `${dec(w / 1000, 2)} kW` : `${Math.round(w)} W`) : '—');
  /** Texto de «Estado ahora» de un equipo a partir de sim.estado. */
  function estadoVivo(tag, estado) {
    const e = estado; if (!e) return '';
    const eq = layout.EQUIPOS.find(x => x.tag === tag); if (!eq) return '';
    const cadenas = []; for (const k of ['A', 'B']) for (const c of ((e.campos && e.campos[k] && e.campos[k].cadenas) || [])) cadenas.push(c);
    const prot = e.protecciones && e.protecciones[tag];
    if (prot) return `${prot.estado}${prot.causa ? ' · ' + prot.causa : ''}`;
    if (eq.tipo === 'panel') { for (const c of cadenas) { const p = (c.paneles || []).find(x => x.tag === tag); if (p) return `${kw(p.p)} · ${dec(p.v)} V · célula ${dec(p.tempCelulaC, 0)} °C · sombra ${Math.round((p.sombra01 || 0) * 100)} %${(p.bypass || []).some(Boolean) ? ' · diodo de paso activo' : ''}`; } return ''; }
    if (eq.tipo === 'cadena') { const c = cadenas.find(x => x.id === tag); return c ? `${dec(c.v)} V · ${dec(c.i)} A · ${kw(c.p)} · Voc ${dec(c.voc)} V${c.abierta ? ' · ABIERTA' : ''}` : ''; }
    if (tag === 'INV-101') { const i = e.inversores && e.inversores[tag]; return i ? `${i.estado} · ${String(i.modo || '').replace(/_/g, ' ')} · PV ${kw(i.pvP)} · batería ${kw(i.bateriaP)} · red ${kw(i.redP)} · carga ${kw(i.cargaP)} · ${dec(i.temperaturaC, 0)} °C${i.alarma ? ' · ' + i.alarma : ''}` : ''; }
    if (tag === 'INV-201') { const i = e.inversores && e.inversores[tag]; return i ? `${i.estado} · AC ${kw(i.acP)} · ${dec(i.acV, 0)} V · ${dec(i.acF)} Hz · vertido ${kw(i.vertidoP)} · ${dec(i.temperaturaC, 0)} °C${i.alarma ? ' · ' + i.alarma : ''}` : ''; }
    if (tag === 'BAT-101') { const b = e.bateria; return b ? `SoC ${Math.round((b.soc01 || 0) * 100)} % · ${dec(b.v)} V · ${dec(b.i)} A · BMS ${b.bms} · ${dec(b.temperaturaC, 0)} °C` : ''; }
    if (tag === 'RED-301') { const r = e.red; return r ? `${r.disponible ? 'con tensión' : 'SIN tensión'} · ${dec(r.v)} V · ${dec(r.f, 2)} Hz · ${kw(r.p)}` : ''; }
    if (tag === 'MED-201') { const r = e.red; return r ? `${r.p > 0 ? 'importa' : 'exporta'} ${kw(Math.abs(r.p))} · importada ${dec(r.energiaImportadaWh / 1000, 2)} kWh · exportada ${dec(r.energiaExportadaWh / 1000, 2)} kWh` : ''; }
    if (tag === 'LOAD-301' || tag === 'LOAD-302') { const c = e.cargas && e.cargas[tag]; return c ? `${kw(c.w)}${c.manual ? ' · manual' : ' · perfil automático'}${c.alimentada === false ? ' · SIN alimentar' : ''}` : ''; }
    if (tag === 'COM-101') return (e.averiasActivas || []).includes('COMUNICACION_PERDIDA_EASUN') ? 'sin comunicación' : 'comunicación correcta';
    if (tag === 'CAS-001') { const t = [e.inversores && e.inversores['INV-101'], e.inversores && e.inversores['INV-201']].filter(Boolean).map(i => dec(i.temperaturaC, 0)); return t.length ? `ambiente ${dec(e.ambiente && e.ambiente.temperaturaAmbienteC, 0)} °C · inversores a ${t.join(' y ')} °C` : ''; }
    if (tag === 'CB-101') { const a = e.campos && e.campos.A; return a ? `campo A: ${kw(a.p)} · ${dec(a.v)} V · ${dec(a.i)} A` : ''; }
    if (tag === 'QA-301') { const r = e.red; return r ? `red ${dec(r.v)} V · ${dec(r.f, 2)} Hz` : ''; }
    return '';
  }

  const GUIA = [
    ['Qué estás viendo', '<p>La instalación fotovoltaica de la cubierta del Politécnico: dos campos de paneles (A y B), dos inversores híbridos (EASun con batería y ZCS Azzurro sin batería), el cuadro de alterna y la red. Está pensada para practicar <b>mantenimiento electrónico</b>: continua, protecciones, medidas con el multímetro y averías.</p>'],
    ['Cómo se diagnostica', '<p>Observa los <b>síntomas</b> (potencias, tensiones, alarmas), piensa en el <b>camino de la energía</b> (paneles → fusible → seccionador → inversor → batería → cuadro) y mide donde sospeches. Las fichas de cada equipo te dicen qué medir y qué valor esperar.</p>'],
    ['Antes de tocar nada', '<p>En una instalación real, con luz hay <b>tensión continua en los paneles</b> y no se puede apagar. Se abre el seccionador, se espera a que se descarguen los condensadores, se comprueba la ausencia de tensión y nunca se abre un conector, un fusible o un seccionador de continua con corriente (arco eléctrico). La batería de litio puede dar cientos de amperios en un cortocircuito.</p>'],
    ['Valores supuestos', '<p>Las especificaciones (potencia de los paneles, secciones de los cables, calibres de las protecciones) son <b>supuestos razonables</b> a partir de las fotos, no los datos de las placas de características. El profesor puede corregirlos.</p>'],
  ];

  const api = { FICHAS, FICHA_DE_TAG, FICHA_DE_TIPO, TAGS, fichaDe, construirElementos, estadoVivo, GUIA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvTextos = api; PCT.fvTextosAyuda = api; }   // PCT.fvTextosAyuda: el nombre que busca ayuda_fv.js
})();
