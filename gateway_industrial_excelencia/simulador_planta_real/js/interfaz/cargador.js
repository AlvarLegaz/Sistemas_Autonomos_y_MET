// Cargador de scripts de la planta real: las páginas (index.html y visor3d.html) solo incluyen este archivo; él carga, en orden, el código compartido de
// simulador_pct23 (desde /simulador/js/...), el modelo, el 3D del diseñador y la interfaz. Un módulo que falte NO rompe la página: queda anotado en `faltan`
// (así la interfaz se puede usar mientras el modelo o el 3D están en construcción, y avisa de lo que no está). Va fuera del espacio PCT a propósito:
// es lo primero que se carga, antes de que exista PCT.
(function () {
  const COMPARTIDO = [   // simulador_pct23 (ruta absoluta: la misma en local con servir_local.py y en el aula)
    '/simulador/js/utilidades/modulos.js', '/simulador/js/utilidades/matematicas.js', '/simulador/js/configuracion/constantes_fisicas.js', '/simulador/js/interfaz/dom.js', '/simulador/js/interfaz/pulsacion_larga.js',
    '/simulador/js/interfaz/scada/canvas.js', '/simulador/js/interfaz/scada/objeto_scada.js', '/simulador/js/interfaz/scada/etiqueta.js', '/simulador/js/interfaz/scada/valvula.js',
    '/simulador/js/interfaz/scada/sensor.js', '/simulador/js/interfaz/scada/tuberia.js',
    '/simulador/js/interfaz/visor3d/especificaciones.js', '/simulador/js/interfaz/visor3d/lecturas.js', '/simulador/js/interfaz/visor3d/controles_orbita.js', '/simulador/js/interfaz/visor3d/visor3d.js',
  ];
  const MODELO = [      // PROGRAMADOR-MODELO (propios, rutas relativas), en el orden de sus dependencias
    'js/layout.js', 'js/configuracion/constantes.js', 'js/plc/calidad_senal.js', 'js/modelo/estado.js', 'js/modelo/fisica_termica.js', 'js/modelo/fisica_hidraulica.js',
    'js/modelo/instrumentos.js', 'js/plc/alarmas.js', 'js/plc/programa.js', 'js/averias/catalogo.js', 'js/averias/motor.js', 'js/modelo/medidas.js', 'js/modelo/simulacion.js',
  ];
  const DISENO = [      // DISEÑADOR (js/visor3d_htst/), en el orden de sus dependencias: efectos antes que la base; escena_planta al final
    'js/visor3d_htst/kit.js', 'js/visor3d_htst/efectos_averias.js', 'js/visor3d_htst/puertos.js', 'js/visor3d_htst/base_equipo.js', 'js/visor3d_htst/equipos_proceso.js',
    'js/visor3d_htst/tuberias.js', 'js/visor3d_htst/instrumentos.js', 'js/visor3d_htst/armario.js', 'js/visor3d_htst/cargador_modelos.js', 'js/visor3d_htst/como_funciona.js', 'js/visor3d_htst/interiores.js', 'js/visor3d_htst/entorno_planta.js', 'js/visor3d_htst/escena_planta.js',
  ];
  const INTERFAZ = [    // PROGRAMADOR-INTERFAZ
    'js/interfaz/niveles.js', 'js/interfaz/textos_ayuda.js', 'js/interfaz/puntos_medida.js', 'js/interfaz/multimetro.js', 'js/interfaz/osciloscopio.js', 'js/interfaz/hoja_registro.js',
    'js/interfaz/panel_profesor.js', 'js/interfaz/grafica_htst.js', 'js/scada2d/leyenda.js', 'js/scada2d/componentes/intercambiador_basico.js', 'js/scada2d/esquema_htst.js', 'js/scada2d/diagrama_fuerza.js', 'js/scada2d/diagrama_mando.js', 'js/interfaz/visor_htst.js', 'js/interfaz/ayuda_htst.js',
    'js/interfaz/franja_alarmas.js', 'js/interfaz/panel_manual.js', 'js/interfaz/panel_lecturas.js',
  ];

  function cargarScript(ruta) {
    return new Promise(resolver => {
      const s = document.createElement('script');
      s.src = ruta; s.async = false;
      s.onload = () => resolver(true);
      s.onerror = () => resolver(false);
      document.head.appendChild(s);
    });
  }

  /** Carga una lista en orden. `obligatorios` (de COMPARTIDO e INTERFAZ) hacen fallar si faltan; el resto solo se anota. */
  async function cargarLista(lista, faltan) {
    for (const ruta of lista) { if (!(await cargarScript(ruta))) faltan.push(ruta); }
  }

  /** Carga todo (o solo lo necesario para el visor: sin la interfaz de la página). Devuelve { faltan }. */
  async function cargarTodo({ conInterfaz = true } = {}) {
    const faltan = [];
    await cargarLista(COMPARTIDO, faltan);
    await cargarLista(MODELO, faltan);
    await cargarLista(DISENO, faltan);
    await cargarLista(conInterfaz ? INTERFAZ : ['js/interfaz/niveles.js', 'js/interfaz/textos_ayuda.js', 'js/interfaz/visor_htst.js'], faltan);
    return { faltan };
  }

  window.HTST_CARGADOR = { COMPARTIDO, MODELO, DISENO, INTERFAZ, cargarScript, cargarTodo };
})();
