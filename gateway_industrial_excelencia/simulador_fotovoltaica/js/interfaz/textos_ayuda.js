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

  const AVISO_CC = 'Con luz, la continua de los paneles NO se puede apagar: con el seccionador abierto, el lado de los paneles sigue en tensión (100 a 150 V según el campo).';
  const AVISO_ARCO = 'No abras ni enchufes un MC4, un fusible o un seccionador con corriente: el arco de continua no se apaga solo (no pasa por cero) y quema y suelda los contactos.';

  // Cada ficha: queEs, paraQue, fallos[], medir[], riesgos[], relacionadas[] (ids de AVERIAS además de las que ya tienen ese tag).
  const FICHAS = {
    panel: {
      etiqueta: 'Panel fotovoltaico',
      queEs: 'Módulo de células fotovoltaicas en serie con tres diodos de paso (bypass), uno por cada tercio de las células. Campo A: 6 paneles policristalinos de 250 Wp (Voc 37,5 V, Isc 8,9 A, Vmp 30,5 V, Imp 8,2 A). Campo B: 8 paneles monocristalinos negros half-cut de 400 Wp (Voc 37,1 V, Isc 13,5 A, Vmp 31,0 V, Imp 12,9 A). Datos supuestos.',
      paraQue: 'Convierte la luz en corriente continua. La corriente es casi proporcional a la irradiancia (a 1000 W/m², la Isc de placa). Con el calor bajan la tensión (≈ −0,3 %/°C de célula) y la potencia (−0,35 a −0,43 %/°C).',
      fallos: [
        'Sombra o suciedad parcial: conduce el diodo de ese tercio y el panel pierde un tercio de tensión; la potencia cae más porque arrastra a la cadena. Síntoma: cadena con poca potencia y tensión baja con sol.',
        'Diodo de paso en corto: ese tercio queda anulado siempre. Síntoma: cadena unos 10 V más baja con buen sol (panel de 60 células).',
        'Diodo de paso abierto: con sombra parcial no puentea, el tercio sombreado limita la corriente de la cadena y aparece un punto caliente. Síntoma: una sombra pequeña hunde toda la cadena.',
        'Punto caliente, microfisuras, caja de conexiones o MC4 dañados: pérdida lenta de potencia y calor localizado (se ve con cámara térmica).',
      ],
      medir: [
        'Voc del panel (desconectado, con sol): 33 a 37 V. Con calor baja; en una mañana fría supera el dato de placa.',
        'Isc con pinza de continua (o con el multímetro en 10 A, solo si sabes hacerlo con seguridad): 8,9 A (campo A) o 13,5 A (campo B) a 1000 W/m²; a media luz, la mitad.',
        'Diodos de paso (panel desconectado y a oscuras), prueba de diodo en la caja de conexiones: 0,3 a 0,5 V en un sentido y «OL» en el otro. 0 V en ambos = en corto; «OL» en ambos = abierto.',
      ],
      riesgos: [AVISO_CC, AVISO_ARCO, 'Trabajo en cubierta: arnés, sin pisar los paneles ni dejar herramientas que den sombra.'],
      relacionadas: ['DIODO_BYPASS_PV104', 'DIODO_BYPASS_ABIERTO_PV203', 'SOMBRA_PARAPETO', 'SUCIEDAD_ALTA_A'],
    },
    cadena: {
      etiqueta: 'Cadena de paneles',
      queEs: 'Paneles en serie: las tensiones se suman y la corriente es la del peor panel. Campo A: 3 paneles (Voc ≈ 112 V, Vmpp ≈ 91 V, Imp 8,2 A), dos cadenas en paralelo al EASun (MPPT de 60 a 145 V). Campo B: 4 paneles (Voc ≈ 148 V, Vmpp ≈ 124 V, Imp 12,9 A), una cadena por entrada MPPT del ZCS (90 a 450 V). Datos supuestos.',
      paraQue: 'Subir la tensión de trabajo para reducir la corriente y las pérdidas en los cables. En el campo A, vigila el máximo de 145 V del EASun: en una mañana fría la Voc sube.',
      fallos: [
        'Cadena abierta (MC4 sin enchufar, cable cortado): hay Voc pero no corriente. Síntoma: el campo da la mitad y esa cadena marca 0 A.',
        'Conector con alta resistencia: calienta, pierde potencia y puede fundir el MC4. Síntoma: rinde menos que su gemela y el conector está caliente.',
        'Fallo de aislamiento: un cable pelado o la caja de un panel dañada derivan a tierra. Síntoma: el inversor (sobre todo el ZCS) no arranca y avisa de aislamiento.',
        'Desequilibrio por suciedad o sombras: las dos cadenas de un campo dan potencias distintas.',
      ],
      medir: [
        'Voc de la cadena en la caja, seccionador abierto: campo A 100 a 115 V; campo B 130 a 150 V (con calor, algo menos). Comprueba que el rojo es + y el negro − antes de enchufar.',
        'Corriente con pinza de continua en un cable: a pleno sol, cerca de Imp (8,2 A en A, 12,9 A en B). Las cadenas de un mismo campo, menos de un 5 % de diferencia.',
        'Aislamiento (cadenas desconectadas del inversor, megóhmetro de 500 a 1000 V) entre cada polo y tierra: más de 1 MΩ (unos cientos de kΩ = fallo de aislamiento).',
      ],
      riesgos: [AVISO_CC, AVISO_ARCO],
      relacionadas: [],
    },
    caja_cc_a: {
      etiqueta: 'Caja de conexión de continua',
      queEs: 'Caja blanca «HT 8WAY» junto al EASun: fusibles de cadena (F-101 y F-102), seccionador bipolar de palanca roja (QS-101) y descargador de continua (SPD-101) con testigo. El orden de los aparatos es supuesto.',
      paraQue: 'Reúne y protege las dos cadenas del campo A, permite aislarlo del inversor y desvía a tierra las sobretensiones atmosféricas.',
      fallos: [
        'Bornas flojas: se calientan (se ve con cámara térmica) y llegan a quemar el aislante. Síntoma: pérdida de potencia y olor a plástico caliente.',
        'Condensación o agua por los prensaestopas: fugas a tierra y corrosión. Síntoma: fallo de aislamiento intermitente en días húmedos.',
        'Fusible fundido o descargador agotado: ver sus fichas.',
      ],
      medir: [
        'Tensión de cada cadena en las bornas de entrada (antes de los fusibles): unos 100 a 115 V.',
        'La misma tensión tras los fusibles y en la salida con el seccionador cerrado. Más de 1 V entre dos puntos unidos por un cable = mala conexión.',
        'Estado del testigo del descargador: verde sano, rojo agotado.',
      ],
      riesgos: [AVISO_CC, 'Con el seccionador abierto, las bornas de ENTRADA siguen vivas. Abre sin carga y con guantes aislantes o pértiga.', AVISO_ARCO],
      relacionadas: ['FUSIBLE_F101', 'SPD_DISPARADO_A'],
    },
    fusible: {
      etiqueta: 'Fusible de cadena',
      queEs: 'Fusible cilíndrico gPV (10×38 mm, supuesto 15 A, 1000 V CC) en el positivo de cada cadena del campo A: F-101 en STR-101 y F-102 en STR-102 (gemelos), en portafusibles dentro de la caja HT 8WAY.',
      paraQue: 'Protege cables y paneles de la corriente inversa: si una cadena se cortocircuita, las otras en paralelo le inyectan corriente. Con dos cadenas esa corriente (≈ Isc de una cadena) no llega a lo que aguanta un panel (unos 15 A): aquí protege poco. Con tres o más cadenas en paralelo es imprescindible.',
      fallos: [
        'Fundido (envejecimiento térmico, cortocircuito, mala conexión): la cadena queda desconectada. Síntoma: el campo produce la mitad y esa cadena da 0 A aunque hay tensión en el lado de los paneles.',
        'Portafusible flojo: calienta, envejece el fusible o da lecturas intermitentes.',
      ],
      medir: [
        'Con tensión, V⎓ entre los extremos del fusible: ≈ 0 V sano; fundido, la tensión de la cadena (90 a 115 V).',
        'Sin tensión (cadena aislada): continuidad entre extremos: menos de 1 Ω sano; «OL» fundido.',
        'Compara las dos cadenas con la pinza: si una da 0 A y la otra es normal, mira el fusible o el conector de la que da 0.',
      ],
      riesgos: ['No saques un portafusible con corriente: el arco de continua no se apaga. Abre antes QS-101 y mide.', AVISO_CC],
      relacionadas: ['FUSIBLE_F101'],
    },
    seccionador_cc: {
      etiqueta: 'Seccionador de continua',
      queEs: 'Interruptor-seccionador bipolar de continua con corte en carga, de 1000 V CC como mínimo y palanca roja: QS-101 en la caja HT 8WAY (campo A) y QS-201 en el campo B (el ZCS lleva otro integrado).',
      paraQue: 'Desconecta los paneles del inversor para mantenimiento o emergencia, con la corriente que circule. Uno de alterna NO sirve: el arco de continua no se extingue.',
      fallos: [
        'Contacto picado u oxidado: más resistencia, calor y caída de tensión. Síntoma: más de 0,2 V en un polo cerrado con corriente y carcasa caliente.',
        'Palanca atascada o polos que no cierran a la vez: un polo cerrado deja el campo en tensión.',
        'Cerrado con una carga mayor de la nominal: arco en el contacto y daño.',
      ],
      medir: [
        'Con luz, tensión entre entrada y salida de cada polo: 0 V cerrado; la del campo (100 a 150 V) abierto.',
        'Caída en un polo cerrado con carga: de pocos mV a 50 mV; más de 0,2 V, cámbialo.',
        'Tensión de cada polo a tierra: cerca de 0 V en un campo sano; alta = fuga a tierra.',
      ],
      riesgos: [AVISO_CC, 'Abrirlo solo aísla el inversor: los paneles siguen en tensión. No toques las bornas del lado de los paneles.', AVISO_ARCO],
      relacionadas: [],
    },
    spd_cc: {
      etiqueta: 'Descargador de sobretensiones de continua',
      queEs: 'Protector tipo 2 con varistores de óxido de zinc entre + / − y tierra, en cartucho enchufable con testigo (verde sano, rojo agotado). SPD-101 en la caja del campo A y SPD-201 en la del campo B.',
      paraQue: 'Desvía a tierra las sobretensiones de rayos cercanos o maniobras antes de que quemen el inversor. Se «gasta»: cada sobretensión envejece los varistores.',
      fallos: [
        'Agotado (testigo rojo): todo sigue funcionando, pero el inversor queda desprotegido. Se cambia el cartucho.',
        'Varistor derivado: el descargador actúa como una fuga a tierra. Síntoma: el inversor no arranca por aislamiento, sobre todo en el campo B (un polo bajo).',
      ],
      medir: [
        'Mira el testigo mecánico o el contacto auxiliar de aviso.',
        'Campo aislado y sin tensión, megóhmetro de 500 V entre cada polo y tierra: más de 1 MΩ sano; baja = varistor deteriorado.',
        'Cable de tierra del descargador: menos de 0,5 m y 6 mm² o más (supuesto).',
      ],
      riesgos: ['No lo cambies por uno de alterna: el de continua está pensado para la polaridad y el arco de CC.', AVISO_CC],
      relacionadas: ['SPD_DISPARADO_A', 'FALLO_AISLAMIENTO_B'],
    },
    spd_ca: {
      etiqueta: 'Descargador de sobretensiones de alterna',
      queEs: 'Protector tipo 2 de alterna monofásico (L-N-PE) en el cuadro QA-301, con el testigo de color.',
      paraQue: 'Protege inversores y cargas de las sobretensiones de la red o de rayos lejanos. Va tras el magnetotérmico general, con cable de tierra corto.',
      fallos: ['Cartucho agotado (testigo rojo): la protección ya no actúa pero la instalación funciona. Se cambia el cartucho.', 'Cartucho en corto: dispara el diferencial o el magnetotérmico que lo protege.'],
      medir: ['Testigo del cartucho.', 'Sin tensión, resistencia entre L y PE y entre N y PE con megóhmetro: más de 1 MΩ.', 'Tensión de red en el cuadro: 207 a 253 V.'],
      riesgos: ['Corta la red y comprueba ausencia de tensión antes de sacar un cartucho: son 230 V directos.'],
      relacionadas: [],
    },
    inversor_easun: {
      etiqueta: 'Inversor híbrido EASun',
      queEs: 'Inversor-cargador híbrido de 24 V (supuesto: 3 kW, MPPT de 60 a 145 V, Voc máxima 145 V, carga hasta 60 A) con pantalla azul, cuatro pulsadores y LED AC/INV, CHG y FAULT. Ventilador y módulo Wi-Fi/RS485 (dongle USB). Prioridades: solar, red o batería primero.',
      paraQue: 'Da 230 V de alterna a las cargas protegidas (LOAD-302) desde los paneles y carga la batería en tres etapas (corriente constante, absorción 28,4 V, flotación 27,2 V). Pasa a red si la batería baja de 21,0 V y vuelve al llegar a 25,0 V.',
      fallos: [
        'Sin batería (QB-101 disparado, BMS cortado): pierde la referencia de 24 V y se apaga o da fallo. Síntoma: pantalla en negro o batería no detectada.',
        'Cadena abierta o fusible fundido: solo trabaja con una cadena; la potencia PV es la mitad.',
        'Calor: con las rejillas tapadas, por encima de unos 75 °C reduce potencia («REDUCIDO»).',
        'Sobrecarga de la salida (más de 3 kW): se apaga o pasa a bypass de red.',
        'Sin comunicación (Wi-Fi/RS485): todo funciona, pero no hay datos en remoto.',
      ],
      medir: [
        'Entrada PV (PV+ / PV−): 60 a 145 V con sol (≈ 90 V a pleno sol); por debajo de 60 V no hay MPPT.',
        'Batería (BAT+ / BAT−): 24 a 29 V. Si difiere 0,3 V o más de la pantalla: caída en cables o bornas flojas.',
        'Salida AC OUT: 230 V ± 10 % entre L y N; N y PE a menos de 2 V.',
        'Corriente de carga con pinza de continua en el cable de la batería: hasta 60 A.',
      ],
      riesgos: ['Los condensadores quedan cargados: desconecta batería, paneles y red y espera cinco minutos antes de abrir.', 'La batería de litio da cientos de amperios en cortocircuito: nada de herramientas metálicas sobre las bornas.', AVISO_CC],
      relacionadas: ['QB_DISPARADO', 'BMS_CORTE_BATERIA', 'CELDA_DESEQUILIBRADA', 'VENTILACION_TAPADA', 'COMUNICACION_PERDIDA_EASUN', 'CADENA_ABIERTA_A1', 'FUSIBLE_F101', 'SPD_DISPARADO_A', 'DIFERENCIAL_DISPARADO', 'RED_CAIDA'],
    },
    inversor_zcs: {
      etiqueta: 'Inversor híbrido ZCS Azzurro',
      queEs: 'Inversor de red monofásico (supuesto: 3 kW, dos MPPT de 90 a 450 V, arranque a 100 V, Voc máxima 550 V) con pantalla y LED On-Grid, Off-Grid y Alarma. Autoconsumo o vertido con medidor (MED-201); aquí, sin batería. MC4 y alterna salen por debajo.',
      paraQue: 'Pasa la energía del campo B a la red. Antes de conectar mide el aislamiento y espera 60 s; si falta la red se desconecta (anti-isla): nunca alimenta una red sin tensión.',
      fallos: [
        'Fallo de aislamiento (cable pelado, MC4 sucio, SPD en fuga): LED de alarma y no arranca. Aislamiento por debajo del mínimo.',
        'Red caída o alta (253 V o más): se desconecta por anti-isla y reconecta tras la espera. Con red alta, antes reduce potencia.',
        'Cadena abierta o con conector resistivo: una entrada MPPT sin potencia o con potencia baja.',
        'Diodo de paso abierto con sombra: la cadena se hunde, a menudo por debajo de los 100 V de arranque.',
        'Calor por ventilación tapada: reduce potencia.',
      ],
      medir: [
        'Entrada MPPT: 120 a 150 V por cadena a pleno sol; por debajo de 100 V no arranca.',
        'Salida AC: 230 V ± 10 % y 50 Hz entre L y N.',
        'Aislamiento (inversor desconectado, megóhmetro de 500 V): más de 1 MΩ de cada polo a tierra.',
        'Corriente de vertido con pinza en la fase: potencia en kW dividida entre 230 V.',
      ],
      riesgos: ['Con luz, las bornas PV están vivas aunque el inversor esté apagado. Abre el seccionador y espera cinco minutos antes de abrir.', AVISO_ARCO],
      relacionadas: ['FALLO_AISLAMIENTO_B', 'RED_CAIDA', 'SOBRETENSION_RED', 'DIODO_BYPASS_ABIERTO_PV203', 'CONECTOR_RESISTIVO_B2', 'CADENA_ABIERTA_B1', 'VENTILACION_TAPADA', 'SOMBRA_PARAPETO'],
    },
    magnetotermico_cc: {
      etiqueta: 'Magnetotérmico de continua',
      queEs: 'Interruptor automático bipolar de continua (2P), en carril DIN junto a los cables de la batería. Supuesto: 100 a 125 A, polarizado.',
      paraQue: 'Protege el cable de la batería contra cortocircuito y sobrecarga y permite aislarla del inversor. Va antes del portafusible.',
      fallos: [
        'Disparado (cortocircuito, sobrecarga o bornas flojas): se pierde la batería. Síntoma: 0 V en BAT+/BAT− del EASun aunque esté llena; palanca en posición intermedia.',
        'Bornas flojas: el interruptor se calienta y dispara sin causa de sobrecarga.',
      ],
      medir: [
        'Tensión a ambos lados: 25 a 28 V en el de la batería y 0 V en el del inversor = abierto o disparado.',
        'Caída por polo cerrado con carga: decenas de mV; más de 0,1 V = borna floja o mal contacto.',
      ],
      riesgos: ['Al cerrar con el inversor conectado puede saltar un chispazo (precarga de condensadores). Si vuelve a disparar, no insistas: hay un cortocircuito.', 'Una batería de litio puede dar más de 1000 A en un cortocircuito: quítate anillos y relojes.'],
      relacionadas: ['QB_DISPARADO'],
    },
    fusible_bateria: {
      etiqueta: 'Portafusible de la batería',
      queEs: 'Portafusible azul en el positivo, con fusible de potencia (supuesto 125 a 150 A), entre el magnetotérmico de continua y la batería.',
      paraQue: 'Última protección del positivo de la batería: corta un cortocircuito que no vea el magnetotérmico (el litio, con su baja resistencia interna, no lo limita solo).',
      fallos: ['Fundido: se pierde la batería, como con QB-101 abierto. Síntoma: 0 V en el lado del inversor y 25 a 28 V en el de la batería.', 'Portafusible suelto: calienta, tensión baja en el inversor con carga y cables templados.'],
      medir: ['Tensión entre los dos extremos del fusible con carga: menos de 0,1 V sano; la tensión de la batería si está fundido.', 'Sin tensión: continuidad menos de 1 mΩ de extremo a extremo.'],
      riesgos: ['Desconecta antes el magnetotérmico QB-101 y la batería: no se cambia un fusible de potencia con corriente.', 'Nunca puentees el fusible con un cable: es la protección contra incendio.'],
      relacionadas: [],
    },
    bateria: {
      etiqueta: 'Batería LiFePO4',
      queEs: 'Batería LiFePO4 de 25,6 V (8 celdas de 3,2 V en serie) y 100 Ah (≈ 2,56 kWh), con BMS interno («iBattery-EA-24V-100AH»). Carga hasta 29,2 V (3,65 V por celda); el inversor la corta a 21,0 V.',
      paraQue: 'Guarda energía para la noche o un corte de red. El BMS vigila las celdas y la desconecta por tensión alta o baja, sobrecorriente o temperatura.',
      fallos: [
        'Corte del BMS por celda baja: 0 V en bornas aunque no esté vacía. Se recupera con una fuente externa.',
        'Celda desequilibrada: el BMS corta por celda alta antes del 100 % o por celda baja antes del 10 %. Síntoma: menos capacidad útil.',
        'Sobrecorriente o temperatura: el BMS abre la batería.',
        'Bornas flojas: caídas de tensión y calentamiento en las bornas.',
      ],
      medir: [
        'Reposo en bornas (orientativo): 25,6 V al 10 %, 26,6 V al 50 %, 27 V al 100 %; cargando, 28,4 V o más. Si cae más de 1 V al conectar carga: resistencia alta o celda débil.',
        'Tensión por celda (app del BMS): ±50 mV en la zona media; más de 100 mV = desequilibrio.',
        'Corriente con pinza de continua: hasta 100 A de carga o descarga.',
      ],
      riesgos: ['Un cortocircuito en bornas da cientos o miles de amperios: quemaduras, fuego y metal fundido. Nada metálico sobre la batería.', 'No cargar por debajo de 0 °C ni por encima de 45 °C. Nada acumulado junto a ella.'],
      relacionadas: ['QB_DISPARADO'],
    },
    comunicaciones: {
      etiqueta: 'Módulo de comunicaciones',
      queEs: 'Módulo Wi-Fi/RS485 del EASun (dongle USB del lateral). Envía las lecturas a la nube o al móvil y permite configurar el inversor.',
      paraQue: 'Ver y registrar la producción, la batería y las alarmas en remoto. No interviene en la conversión de energía.',
      fallos: ['Pérdida de comunicación: todo funciona, pero sin datos remotos. Síntoma: la app ve el equipo sin conexión o congelado y la pantalla del inversor va bien.', 'Wi-Fi débil en la caseta metálica (jaula de Faraday), dongle flojo o mal alimentado.'],
      medir: ['Con el multímetro: continuidad de los hilos A y B del RS485 y que no haya cortocircuito entre ellos.', 'Tensión de reposo entre A y B del bus: de unos 0,2 V a 3 V según el equipo (dato supuesto).', 'Mira el LED del módulo y la señal Wi-Fi desde el móvil junto a la caseta.'],
      riesgos: ['Es de baja tensión, pero va en el inversor: no lo saques en marcha si el fabricante lo desaconseja.'],
      relacionadas: ['COMUNICACION_PERDIDA_EASUN'],
    },
    medidor: {
      etiqueta: 'Medidor de red',
      queEs: 'Medidor de consumo e inyección del ZCS (transformador de intensidad o contador monofásico con RS485). Mide la potencia que se intercambia con la red.',
      paraQue: 'Dice al ZCS cuánto consume el centro para verter solo el exceso (o nada) y cuenta la energía importada y exportada.',
      fallos: ['Transformador de intensidad al revés: el signo importa/exporta sale invertido. Síntoma: el ZCS parece «consumir» cuando vierte.', 'RS485 cortada: el inversor se queda sin medida y limita o desconecta según su configuración.'],
      medir: ['Tensión de medida: 230 V entre L y N.', 'Corriente con pinza en la fase y compárala con la del medidor: debe coincidir en un 3 %.', 'Continuidad del bus RS485 hasta el ZCS.'],
      riesgos: ['Nunca abras el secundario de un transformador de intensidad con corriente en el primario: da una tensión muy alta. Cortocircuítalo antes.'],
      relacionadas: ['RED_CAIDA'],
    },
    cuadro_ca: {
      etiqueta: 'Cuadro de alterna',
      queEs: 'Cuadro estanco con tapa transparente y carril DIN. Arriba, diferencial y general; en el centro, dos magnetotérmicos AEG (supuestos QF-302 y QF-303); abajo, otro magnetotérmico y una schuko. Alimenta EASun, ZCS, cargas y toma.',
      paraQue: 'Reúne y protege las líneas de alterna y reparte la red entre los dos inversores y las cargas.',
      fallos: ['Bornas flojas en peines y magnetotérmicos: calientan y fallan intermitentemente.', 'Falta de tensión en el cuadro: mira primero QF-301 y el diferencial.', 'Humedad o condensación: dispara el diferencial.'],
      medir: ['Tensión de la red a la entrada del cuadro: 207 a 253 V (230 V nominal).', 'Tensión a la salida de cada magnetotérmico: la misma que a la entrada.', 'N-PE menor de 2 V; tierra bien conectada a la caseta metálica.'],
      riesgos: ['230 V directos: antes de abrir, desconecta el general, bloquéalo y comprueba ausencia de tensión. Con red e inversores en marcha puede haber tensión por los dos lados.', 'El EASun alimenta las cargas desde la batería sin red: puede haber tensión en su salida con el general abierto.'],
      relacionadas: ['DIFERENCIAL_DISPARADO', 'RED_CAIDA'],
    },
    magnetotermico_general: {
      etiqueta: 'Magnetotérmico general',
      queEs: 'Interruptor automático bipolar de 25 A (supuesto, curva C) que protege toda la entrada del cuadro de alterna.',
      paraQue: 'Corta ante sobrecarga o cortocircuito en cualquier punto del cuadro y permite desconectarlo entero.',
      fallos: ['Disparado: cuadro sin tensión e inversores sin red. Síntoma: el ZCS en alarma y el EASun con batería.', 'Contacto flojo en bornas: se calienta y dispara sin carga elevada.'],
      medir: ['Tensión a la entrada y a la salida: deben ser iguales (230 V).', 'Corriente con pinza: menos de 25 A.', 'Sin tensión: continuidad por polo.'],
      riesgos: ['No rearmes sin buscar la causa: si vuelve a saltar, hay cortocircuito o sobrecarga.'],
      relacionadas: [],
    },
    diferencial: {
      etiqueta: 'Interruptor diferencial',
      queEs: 'Diferencial de 30 mA y 40 A (supuesto) con botón de test. Compara fase y neutro: si no coinciden, hay fuga a tierra.',
      paraQue: 'Protege a las personas de contactos indirectos y limita el riesgo de incendio. Los inversores sin transformador pueden fugar continua o alta frecuencia: usa el tipo que pida el fabricante (A, F o B).',
      fallos: ['Disparos sin causa aparente: fugas sumadas de cargas, humedad, neutro unido a tierra aguas abajo o fuga capacitiva de los inversores.', 'Test que no dispara: aparato averiado, hay que cambiarlo.'],
      medir: ['Pulsa el botón de test: debe disparar. Se hace cada pocos meses.', 'Aislamiento por línea, megóhmetro de 500 V (diferencial abierto, inversores desconectados): más de 1 MΩ.', 'Fuga con pinza de fugas abrazando fase y neutro: menos de 10 mA.'],
      riesgos: ['No lo puentees ni lo cambies por uno menos sensible: protege vidas.', 'Desconecta los inversores antes de medir aislamiento: el megóhmetro (500 V) los dañaría.'],
      relacionadas: ['DIFERENCIAL_DISPARADO'],
    },
    magnetotermico_easun: {
      etiqueta: 'Magnetotérmico de la línea del EASun',
      queEs: 'Automático de 16 A (supuesto, curva C) de la línea del EASun: protege su entrada de red y la salida a las cargas protegidas y la toma.',
      paraQue: 'Aislar el EASun de la red y proteger los cables de su entrada y de su salida, que son de 2,5 mm².',
      fallos: ['Disparado por sobrecarga (más de 3,5 kW) o cortocircuito en una carga: el EASun se queda sin red y sigue con batería.', 'Abierto a propósito para aislar.'],
      medir: ['230 V a la entrada y a la salida del magnetotérmico.', 'Corriente con pinza: menos de 16 A.'],
      riesgos: ['Abrirlo no apaga la salida del EASun si tira de batería: puede haber 230 V aguas abajo. Apaga también el inversor.'],
      relacionadas: [],
    },
    magnetotermico_zcs: {
      etiqueta: 'Magnetotérmico de la línea del ZCS',
      queEs: 'Interruptor automático de 16 A (supuesto, curva C) de la línea de vertido del ZCS, de 4 mm².',
      paraQue: 'Aísla el ZCS de la red y protege su cable de salida. Abierto, el ZCS lo ve como falta de red y se desconecta.',
      fallos: ['Disparado: el ZCS pasa a «sin red» (LED de alarma u Off-Grid) y deja de producir. Síntoma: el campo B no produce aunque haya sol.'],
      medir: ['230 V a la entrada y a la salida.', 'Corriente con pinza: menos de 16 A (3 kW son unos 13 A).'],
      riesgos: ['Para aislar el ZCS abre también su seccionador de continua: este interruptor no corta la continua.'],
      relacionadas: [],
    },
    toma: {
      etiqueta: 'Toma de corriente',
      queEs: 'Base schuko de 16 A del cuadro, alimentada por la salida de cargas protegidas del EASun.',
      paraQue: 'Da 230 V para equipos de prueba, cargadores o herramientas. La alimenta el EASun desde placas, batería o red.',
      fallos: ['Sin tensión: QF-302 abierto, EASun apagado o en fallo, o cargas protegidas sobrepasadas.', 'Contactos flojos o sucios: calienta la toma.'],
      medir: ['230 V entre fase y neutro (de 207 a 253 V).', 'Fase-tierra unos 230 V y neutro-tierra por debajo de 2 V.', 'Comprueba que el diferencial dispara con el probador de tomas.'],
      riesgos: ['No conectes más de 3 kW en total con LOAD-302: el inversor se sobrecarga.', 'No conectes una toma de prueba sin diferencial.'],
      relacionadas: ['DIFERENCIAL_DISPARADO'],
    },
    red: {
      etiqueta: 'Acometida de red',
      queEs: 'Acometida monofásica del centro, 230 V y 50 Hz, con una tolerancia de ± 10 % (de 207 a 253 V).',
      paraQue: 'Alimenta el centro y el EASun cuando placas y batería no bastan, y recibe el vertido del ZCS.',
      fallos: ['Caída de red: el ZCS se desconecta por anti-isla (menos de 2 s) y vuelve tras 60 s; el EASun pasa a batería con solo las cargas protegidas.', 'Tensión alta (253 V o más): el ZCS reduce potencia y luego desconecta; suele deberse a mucho vertido en la zona.'],
      medir: ['Tensión entre L y N en el cuadro: 207 a 253 V.', 'Frecuencia: 50 Hz ± 1.'],
      riesgos: ['La acometida es de la compañía: no se toca aguas arriba del general.'],
      relacionadas: ['RED_CAIDA', 'SOBRETENSION_RED'],
    },
    carga_centro: {
      etiqueta: 'Consumo del centro',
      queEs: 'Cargas de alterna del centro (aula, iluminación, equipos) alimentadas por la red y el autoconsumo del ZCS. Perfil por defecto: aula de mañana y tarde, noche baja.',
      paraQue: 'Decide si el campo B vierte (consumo menor que la producción) o solo autoconsume.',
      fallos: ['Consumo mayor que la producción: se importa de la red.', 'Cargas con arranque brusco (motores): picos que pueden disparar protecciones.'],
      medir: ['Corriente con pinza en la fase de entrada: potencia (W) ≈ corriente × 230 V (factor de potencia 1).', 'Compara con la potencia que indica el medidor.'],
      riesgos: ['Las cargas del centro están protegidas aguas abajo por sus propios magnetotérmicos y diferenciales.'],
      relacionadas: [],
    },
    carga_protegida: {
      etiqueta: 'Cargas protegidas',
      queEs: 'Cargas en la salida del EASun (con la toma): tienen tensión aunque falte la red, mientras haya batería o sol.',
      paraQue: 'Mantienen lo esencial durante un corte. El EASun elige la fuente según su modo: solar, red o batería primero.',
      fallos: ['Más de 3 kW: el EASun se sobrecarga y se apaga o pasa a red.', 'Sin tensión: QF-302 abierto, el EASun apagado o en fallo.', 'Con la batería baja (menos de 21 V) el EASun pasa a la red; sin red ni batería se corta.'],
      medir: ['Tensión de salida del EASun: 230 V ± 5 %.', 'Corriente con pinza y compara con la potencia de la pantalla del EASun.'],
      riesgos: ['Puede haber 230 V con el general abierto (el EASun genera su tensión): apágalo antes de tocar.'],
      relacionadas: [],
    },
    caseta: {
      etiqueta: 'Caseta metálica',
      queEs: 'Caseta metálica con puerta corredera y rejillas de ventilación en lo alto. Dentro: inversores, cajas, batería y cuadro. Canaletas «Unex» y «Efapel».',
      paraQue: 'Protege los equipos de lluvia y sol y los ventila: los inversores disipan mucho calor y necesitan aire por las rejillas.',
      fallos: ['Rejillas tapadas (objetos, bolsas, suciedad): los inversores se calientan, reducen potencia («REDUCIDO») y duran menos. Síntoma: caseta caliente y potencia que cae a mediodía.', 'Caseta sin tierra ni unión a las masas: una derivación de los inversores la puede dejar en tensión.'],
      medir: ['Aire interior: menos de 40 °C con calor fuera. Inversores (pistola infrarroja): menos de 70 °C.', 'Continuidad entre la caseta y la barra de tierra: menos de 1 Ω.'],
      riesgos: ['Calor, golpes en la cabeza y partes en tensión. Nada de metal sobre la batería.'],
      relacionadas: ['VENTILACION_TAPADA'],
    },
    bandeja: {
      etiqueta: 'Bandeja de cables',
      queEs: 'Bandeja de rejilla metálica que lleva los cables solares de doble aislamiento (rojo y negro) y los MC4 hasta la caseta.',
      paraQue: 'Sujeta y ordena los cables de las cadenas y los protege del sol y de pisadas hasta la caseta.',
      fallos: ['Cable rozando un borde afilado: se daña el aislamiento y aparece fuga a tierra. Síntoma: el ZCS no arranca y un polo da poca resistencia a tierra.', 'Conectores MC4 sueltos o al sol y la lluvia sin sujeción: alta resistencia y calentamiento.'],
      medir: ['Aislamiento de cada cable a la bandeja con megóhmetro: más de 1 MΩ.', 'Continuidad entre tramos de bandeja (unidos a tierra): menos de 1 Ω.'],
      riesgos: ['Con luz, los cables están en tensión: no los cortes ni los muevas con herramientas metálicas.'],
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
    if (prot) {
      const est = (eq.tipo === 'fusible' || eq.tipo === 'descargador') && prot.estado === 'CERRADO' ? 'SANO' : prot.estado;      // un fusible o un cartucho sano no está «cerrado»
      return `${est}${prot.causa ? ' · ' + prot.causa : ''}`;
    }
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
    ['Qué estás viendo', '<p>La instalación de la cubierta del Politécnico: campos A y B, inversores EASun (con batería) y ZCS Azzurro (sin batería), cuadro de alterna y red. Para practicar <b>mantenimiento electrónico</b>: continua, protecciones, medidas y averías.</p>'],
    ['Cómo se diagnostica', '<p>Mira los <b>síntomas</b> (potencias, tensiones, alarmas), sigue el <b>camino de la energía</b> (paneles → fusible → seccionador → inversor → batería → cuadro) y mide donde sospeches. Cada ficha dice qué medir y qué valor esperar.</p>'],
    ['Antes de tocar nada', '<p>Con luz hay <b>tensión continua en los paneles</b> y no se puede apagar. Abre el seccionador, espera a que se descarguen los condensadores y comprueba ausencia de tensión. Nunca abras un conector, fusible o seccionador de continua con corriente (arco). La batería de litio da cientos de amperios en cortocircuito.</p>'],
    ['Valores supuestos', '<p>Potencias, secciones y calibres son <b>supuestos</b> a partir de las fotos, no datos de placa. El profesor puede corregirlos.</p>'],
  ];

  const api = { FICHAS, FICHA_DE_TAG, FICHA_DE_TIPO, TAGS, fichaDe, construirElementos, estadoVivo, GUIA };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else { window.PCT = window.PCT || {}; PCT.fvTextos = api; PCT.fvTextosAyuda = api; }   // PCT.fvTextosAyuda: el nombre que busca ayuda_fv.js
})();
