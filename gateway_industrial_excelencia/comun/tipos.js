// Tipos del contrato común de simulación (versión 1). El texto con la semántica está en comun/CONTRATO.md; aquí solo los tipos JSDoc
// (los comprueba el editor) y las listas cerradas como constantes congeladas. Doble export: module.exports en Node, PCT.contratoTipos en el navegador.
// Lo mantiene el ARQUITECTO: no se cambia sin cambiar CONTRATO.md.
(function () {
  'use strict';

  // ---------------------------------------------------------------- tipos ----

  /** @typedef {'planta_real'|'fotovoltaica'|'maqueta'|'uxs'} IdSimulador */
  /** @typedef {'alumno'|'profesor'|'guion'|'sistema'} Origen */

  /**
   * @typedef {Object} Orden
   * @property {string} tipo        ruta de la función antigua (FV: 'protecciones.abrir'; HTST: 'arrancar') o 'averias.*'
   * @property {string} [destino]   tag de layout.js
   * @property {Object<string, *>} [valores]
   * @property {Origen} origen
   */

  /**
   * @typedef {Object} Resultado
   * @property {boolean} ok
   * @property {string} [motivo]   código de MOTIVOS (solo con ok:false)
   * @property {string} [texto]    para el alumno
   * @property {string} [aviso]    maniobra peligrosa hecha igualmente
   * @property {Object} [datos]    respuesta propia de la operación (p. ej. { pasos }, { instancia }, { correcta })
   */

  /**
   * @typedef {Object} EsquemaValor
   * @property {'numero'|'entero'|'booleano'|'texto'|'opcion'} tipo
   * @property {number} [min]
   * @property {number} [max]
   * @property {Array<string|number|boolean>} [opciones]
   * @property {string} [unidad]
   * @property {true} [nulo]       admite null
   * @property {true} [opcional]
   * @property {*} [defecto]       solo en los parámetros de una avería
   */

  /**
   * @typedef {Object} DescripcionOrden
   * @property {string} tipo
   * @property {string} texto
   * @property {string[]} [destinos]
   * @property {Object<string, EsquemaValor>} [valores]
   * @property {Orden} ejemplo
   */

  /**
   * @typedef {Object} PuntoMedida
   * @property {string} id
   * @property {string} instrumento   de INSTRUMENTOS
   * @property {string[]} magnitudes
   * @property {string} texto
   * @property {string} equipo        tag de layout.js
   * @property {string} [grupo]
   */

  /**
   * @typedef {Object} PeticionMedida
   * @property {string} instrumento
   * @property {string} magnitud
   * @property {string} [a]           punta roja / punto (multímetro, osciloscopio)
   * @property {string} [b]           punta negra (FV; la HTST la ignora: mide contra masa)
   * @property {string} [conductor]   pinza
   * @property {string} [elemento]    megóhmetro, trazadorIV, termografía, termómetro, manómetro
   * @property {{ puntos?: number }} [opciones]
   */

  /**
   * @typedef {Object} Medida
   * @property {boolean} valida
   * @property {number} [valor]       Infinity = «OL» (y datos.ol = true); falta en magnitudes compuestas
   * @property {string} [unidad]
   * @property {string} texto
   * @property {string} [motivo]      código de MOTIVOS (solo con valida:false)
   * @property {Object} [datos]
   */

  /** @typedef {{ min: (number|null), max: (number|null), unidad: string }} Rango  null = sin límite */

  /**
   * @typedef {Object} MedidaClave
   * @property {PeticionMedida} peticion
   * @property {PeticionMedida} [referencia]   la lectura es la diferencia con esta otra
   * @property {Orden[]} [preparar]
   * @property {Rango} esperadoSano
   * @property {Rango} esperadoAveria
   * @property {string} texto
   */

  /**
   * @typedef {Object} Firma
   * @property {string} sintoma
   * @property {Escenario} escenario
   * @property {number} esperaS
   * @property {MedidaClave[]} medidasClave
   * @property {[string, string, string]} pistas
   * @property {string} explicacion
   * @property {string[]} distractores
   */

  /**
   * @typedef {Object} Averia
   * @property {string} id
   * @property {string} titulo
   * @property {string} [descripcion]
   * @property {string[]} equipos
   * @property {1|2|3} dificultad
   * @property {string[]} sintomas
   * @property {Object<string, EsquemaValor>} parametros
   * @property {{ texto: string, accion: string, tag: (string|null) }} solucion
   * @property {Firma} [firma]
   */

  /**
   * @typedef {Object} AveriaActiva
   * @property {string} instancia   FV: el id; HTST: 'I1', 'I2'…
   * @property {string} id
   * @property {string[]} tags
   * @property {Object<string, *>} parametros
   * @property {number} desdePaso
   */

  /**
   * @typedef {Object} Criterio
   * @property {*} [igual]
   * @property {number} [min]
   * @property {number} [max]
   * @property {string} [unidad]
   */

  /**
   * @typedef {Object} Objetivo
   * @property {string} texto
   * @property {{ tipo: 'estado', ruta: string[], criterio: Criterio } | { tipo: 'medida', peticion: PeticionMedida, criterio: Criterio }} comprobar
   */

  /**
   * @typedef {Object} Escenario
   * @property {IdSimulador} simulador
   * @property {1} versionContrato
   * @property {string} id                 [a-z0-9_]{3,40}
   * @property {string} titulo
   * @property {string} [descripcion]
   * @property {Object<string, *>} condiciones   solo opciones de construcción (FV: diaAnio, horaSolar, nubosidad; HTST: valvulasManuales)
   * @property {Orden[]} ordenesIniciales
   * @property {number} [esperaS]
   * @property {Objetivo[]} [objetivos]
   */

  /**
   * @typedef {Object} Registro
   * @property {IdSimulador} simulador
   * @property {1} versionContrato
   * @property {number} semilla
   * @property {Escenario|null} escenario
   * @property {number} pasoFijoS
   * @property {number} pasos
   * @property {Array<{ paso: number, orden: Orden }>} ordenes
   */

  /**
   * @typedef {Object} Instantanea
   * @property {IdSimulador} simulador
   * @property {1} versionContrato
   * @property {number} pasoFijoS
   * @property {number} semilla
   * @property {Escenario|null} escenario
   * @property {number} pasos
   * @property {number} restoS
   * @property {Object} datos      opaco; sobrevive a JSON sin cambios
   */

  /**
   * @typedef {Object} EventoSim
   * @property {'orden'|'orden_rechazada'|'alarma'|'disparo'|'averia'|'medida'|'reinicio'|'restauracion'} tipo
   * @property {number} paso
   * @property {number} tS
   * @property {Orden} [orden]          orden, orden_rechazada
   * @property {Resultado} [resultado]  orden, orden_rechazada
   * @property {string} [codigo]        alarma
   * @property {string} [tag]           alarma, disparo
   * @property {string} [nivel]         alarma: NIVELES_ALARMA
   * @property {string} [texto]         alarma
   * @property {boolean} [activa]       alarma
   * @property {string} [causa]         disparo
   * @property {boolean} [activo]       disparo
   * @property {string} [accion]        averia: ACCIONES_EVENTO_AVERIA
   * @property {string} [id]            averia
   * @property {string} [instancia]     averia
   * @property {string[]} [tags]        averia
   * @property {PeticionMedida} [peticion]  medida
   * @property {Medida} [medida]        medida
   * @property {number} [semilla]       reinicio
   * @property {Escenario|null} [escenario] reinicio
   * @property {number} [pasos]         restauracion
   */

  /**
   * @typedef {Object} Simulacion
   * @property {IdSimulador} id
   * @property {1} versionContrato
   * @property {number} pasoFijoS
   * @property {(dtS: number) => Resultado} avanzar
   * @property {(n: number) => Resultado} avanzarPasos
   * @property {() => { pasos: number, tS: number, restoS: number }} tiempo
   * @property {() => Object} estado                       congelado en profundidad
   * @property {(orden: Orden) => Resultado} ejecutar
   * @property {() => DescripcionOrden[]} ordenesDisponibles
   * @property {() => PuntoMedida[]} puntos
   * @property {(peticion: PeticionMedida) => Medida} medir
   * @property {{ catalogo: () => Averia[], activas: () => AveriaActiva[] }} averias
   * @property {(fn: (e: EventoSim) => void) => (() => void)} suscribir
   * @property {() => Instantanea} instantanea
   * @property {(x: Instantanea) => Resultado} restaurar
   * @property {() => Registro} registro
   * @property {(opciones?: { semilla?: number, escenario?: Escenario }) => Resultado} reiniciar
   * @property {() => Object} [antigua]                    transitorio: la API antigua por encima de ejecutar
   */

  /** @typedef {(opciones: { semilla: number, escenario?: Escenario }) => Simulacion} FabricaSimulacion */

  /**
   * @typedef {Object} EventoAprendizaje
   * @property {string} id              [A-Za-z0-9_-]{1,40}, único en la sesión
   * @property {'inicio'|'acciono'|'midio'|'pidio_pista'|'entrego'|'completo'|'abandono'} verbo
   * @property {{ simulador: IdSimulador, reto?: number, escenario?: string, elemento?: string }} objeto
   * @property {{ nota?: number, acierto?: (0|0.5|1), duracionS?: number, valor?: number, unidad?: string, texto?: string }} [resultado]
   * @property {{ sesion: string, intento: number, tSimS: number }} contexto
   * @property {string} marca           ISO 8601 UTC
   */

  // ------------------------------------------------------------ constantes ----

  const congelar = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) congelar(v); } return o; };

  const VERSION_CONTRATO = 1;
  const SIMULADORES = ['planta_real', 'fotovoltaica', 'maqueta', 'uxs'];
  const ORIGENES = ['alumno', 'profesor', 'guion', 'sistema'];

  // Decisión 5 del plan (13-11-2026): la FV pasa de 1 s a 2 s por el coste en el iPad (R12). Firmas, escenarios y esperaS van en segundos; con 2 s, avanzar(1) da 0 pasos.
  const PASO_FIJO_S = { fotovoltaica: 2, planta_real: 0.1 };
  const DT_MAX_S = 3600;
  const EPS_PASO_S = 1e-9;
  const PASOS_MAX_POR_LLAMADA = 36000;

  const MOTIVOS = [
    // tiempo
    'dt_invalido', 'dt_excesivo', 'pasos_invalidos', 'reentrada',
    // órdenes
    'orden_invalida', 'orden_desconocida', 'destino_desconocido', 'valores_invalidos', 'no_permitida',
    // averías
    'averia_desconocida', 'averia_incompatible', 'instancia_desconocida', 'codigo_invalido',
    // medidas
    'peticion_invalida', 'instrumento_desconocido', 'magnitud_invalida', 'punto_desconocido', 'con_tension', 'requiere_maniobra', 'sin_referencia',
    // instantáneas, reinicio y creación
    'instantanea_invalida', 'simulador_incompatible', 'version_incompatible', 'paso_incompatible', 'opciones_invalidas', 'escenario_invalido',
  ];

  const TIPOS_EVENTO_SIM = ['orden', 'orden_rechazada', 'alarma', 'disparo', 'averia', 'medida', 'reinicio', 'restauracion'];
  const ACCIONES_EVENTO_AVERIA = ['activada', 'quitada', 'reparada', 'reparacion_fallida', 'retirada_por_maniobra'];
  const NIVELES_ALARMA = ['estado', 'info', 'aviso', 'alarma', 'critica'];
  const ACCIONES_REPARACION = ['rearmar', 'sustituir', 'reparar', 'ajustar', 'limpiar', 'recalibrar', 'despejar'];

  const INSTRUMENTOS = ['multimetro', 'pinza', 'megohmetro', 'trazadorIV', 'termografia', 'osciloscopio', 'termometro', 'manometro'];
  const CAMPOS_TRAZADOR = ['voc', 'isc', 'vmpp', 'impp', 'pmpp', 'factorForma', 'desviacionPct', 'desviacionVocPct', 'desviacionIscPct', 'escalones'];
  const MAGNITUDES_POR_SIMULADOR = {
    fotovoltaica: {
      multimetro: ['tension', 'resistencia', 'continuidad'],
      pinza: ['corriente'],
      megohmetro: ['aislamiento'],
      trazadorIV: ['resumen', 'curva', 'curvaReferencia', ...CAMPOS_TRAZADOR],
      termografia: ['imagen', 'temperatura', 'deltaC'],
    },
    planta_real: {
      multimetro: ['tension', 'corriente', 'resistencia', 'continuidad'],
      osciloscopio: ['formaOnda'],
      termometro: ['temperatura'],
      manometro: ['presion'],
    },
  };
  /** Magnitudes sin `valor` numérico: el resultado va en Medida.datos. */
  const MAGNITUDES_COMPUESTAS = ['curva', 'curvaReferencia', 'imagen', 'formaOnda'];

  const ORDENES_COMUNES = ['averias.activar', 'averias.quitar', 'averias.limpiar', 'averias.reparar'];
  const ORDENES_POR_SIMULADOR = {
    fotovoltaica: ['reloj.poner', 'ambiente.poner', 'ambiente.sombra', 'protecciones.cerrar', 'protecciones.abrir', 'protecciones.rearmar',
      'red.disponible', 'red.tension', 'cargas.poner', 'inversor.modoEasun', 'inversor.encender', 'bateria.socInicial'],
    planta_real: ['arrancar', 'parar', 'consignaTemperaturaC', 'consignaCaudalLh', 'modo', 'pulsador', 'manual', 'paroEmergencia', 'nivelDeposito',
      'controlTemperatura', 'llenarDepositos', 'averias.cargarCodigo'],
  };
  /** Modos de la orden `controlTemperatura` (HTST, CONTRATO.md §4.3) y valores posibles de estado().operador.llenado.final. */
  const MODOS_CONTROL_TEMPERATURA = ['off', 'histeresis', 'pid'];
  const FINALES_LLENADO = ['', 'lleno', 'paro', 'cancelado'];
  /** Forma de una instancia de avería de la HTST (averias.quitar: mal formada → instancia_desconocida; bien formada no activa → no_permitida). */
  const FORMA_INSTANCIA_HTST = '^I\\d+$';
  /** Unidades de Medida.unidad que no son del SI de uso común (trazador I-V de la FV, CONTRATO.md §5.2). */
  const UNIDADES_ESPECIALES = ['p.u.', 'escalones'];
  const SESION_DESCONOCIDA = 'sin_sesion';
  const REGISTRO_SESION_MAX_CARACTERES = 1024 * 1024;
  const REGISTROS_SESION_MAX_POR_ALUMNO = 50;
  /** Claves admitidas en Escenario.condiciones (opciones de construcción). */
  const CONDICIONES_POR_SIMULADOR = { fotovoltaica: ['diaAnio', 'horaSolar', 'nubosidad'], planta_real: ['valvulasManuales'] };

  // Eventos de aprendizaje y API del aula
  const VERBOS = ['inicio', 'acciono', 'midio', 'pidio_pista', 'entrego', 'completo', 'abandono'];
  const VERBOS_SOLO_SERVIDOR = ['entrego'];
  const VERBOS_XAPI = {
    inicio: 'http://adlnet.gov/expapi/verbs/initialized',
    acciono: 'http://adlnet.gov/expapi/verbs/interacted',
    midio: 'http://adlnet.gov/expapi/verbs/interacted',
    pidio_pista: 'http://adlnet.gov/expapi/verbs/asked',
    entrego: 'http://adlnet.gov/expapi/verbs/answered',
    completo: 'http://adlnet.gov/expapi/verbs/completed',
    abandono: 'https://w3id.org/xapi/adl/verbs/abandoned',
  };
  const EVENTOS_MAX_POR_LOTE = 50;
  const EVENTO_MAX_CARACTERES = 1000;
  const LOTE_MAX_CARACTERES = 24000;
  const EVENTOS_MAX_GUARDADOS_POR_ALUMNO = 20000;
  const TEXTO_MAX_CARACTERES = 120;

  // Presentación (CONTRATO.md §12; manda comun/UX_IDENTIDAD.md: estos nombres son los de su §1)
  const VARIABLES_IDENTIDAD = ['--pol-naranja', '--pol-naranja-texto', '--pol-naranja-suave', '--pol-sobre-naranja', '--pol-gris-oscuro', '--pol-gris',
    '--pol-gris-claro', '--pol-blanco', '--pol-titulo', '--pol-texto', '--pol-texto-suave', '--pol-borde', '--pol-borde-fuerte', '--pol-foco',
    '--pol-fuente', '--pol-mono', '--pol-radio-boton', '--pol-radio-panel', '--pol-sombra'];
  const VARIABLES_ESTADO = ['--estado-servicio', '--estado-aviso', '--estado-alarma', '--estado-parado'];
  const NARANJA_POLITECNICO = '#F68B11';
  const TEXTO_SOBRE_NARANJA = '#212121';        // el blanco sobre el naranja no cumple el contraste WCAG
  const SIMBOLOS_PERMITIDOS = ['⚠', '✔', '✕', '✖', '✘'];   // ⚠ ✔ ✕ ✖ ✘ (dentro del rango U+2600–U+27BF que C45 prohíbe; ★ y ♪ siguen prohibidos)
  // C43: radios > 4px admitidos. Selectores: píldoras de estado (guía §5) y la barra del aula (decisión 7 del usuario: manda el contrato). Archivos: donde vive la barra.
  const EXCEPCIONES_RADIO = { selectores: ['.etiqueta', '#aula-barra', '#aula-barra button'], archivos: ['aula_pct23/templates/barra_simulador.html'],
    circulares: ['50%'] };
  // C42: sombras admitidas además de none, var(--pol-sombra) y las sutiles (≤ 3px de desenfoque, ≤ 0,12 de opacidad): la marca de alarma (indicador de estado).
  const SOMBRAS_PERMITIDAS = ['inset 0 -4px 0 var(--error)', 'inset 0 -4px 0 var(--estado-alarma)'];
  const FUENTE = 'Raleway, "Segoe UI", Roboto, Arial, sans-serif';
  const COPYRIGHT = '© 2026 Álvar Legaz Aparicio · Todos los derechos reservados.';
  const RADIO_MAX_BOTON_PX = 2;
  const RADIO_MAX_PANEL_PX = 4;

  const api = congelar({
    VERSION_CONTRATO, SIMULADORES, ORIGENES, PASO_FIJO_S, DT_MAX_S, EPS_PASO_S, PASOS_MAX_POR_LLAMADA, MOTIVOS, TIPOS_EVENTO_SIM, ACCIONES_EVENTO_AVERIA,
    NIVELES_ALARMA, ACCIONES_REPARACION, INSTRUMENTOS, CAMPOS_TRAZADOR, MAGNITUDES_POR_SIMULADOR, MAGNITUDES_COMPUESTAS, ORDENES_COMUNES, ORDENES_POR_SIMULADOR,
    CONDICIONES_POR_SIMULADOR, MODOS_CONTROL_TEMPERATURA, FINALES_LLENADO, FORMA_INSTANCIA_HTST, UNIDADES_ESPECIALES, SESION_DESCONOCIDA,
    REGISTRO_SESION_MAX_CARACTERES, REGISTROS_SESION_MAX_POR_ALUMNO, VERBOS, VERBOS_SOLO_SERVIDOR, VERBOS_XAPI, EVENTOS_MAX_POR_LOTE, EVENTO_MAX_CARACTERES, LOTE_MAX_CARACTERES,
    EVENTOS_MAX_GUARDADOS_POR_ALUMNO, TEXTO_MAX_CARACTERES,
    VARIABLES_IDENTIDAD, VARIABLES_ESTADO, NARANJA_POLITECNICO, TEXTO_SOBRE_NARANJA, SIMBOLOS_PERMITIDOS, EXCEPCIONES_RADIO, SOMBRAS_PERMITIDAS, FUENTE, COPYRIGHT, RADIO_MAX_BOTON_PX, RADIO_MAX_PANEL_PX,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); P.contratoTipos = api; }
})();
