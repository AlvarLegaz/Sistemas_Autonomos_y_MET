// Cargador de scripts del simulador fotovoltaico: las páginas (index.html y visor3d.html) solo incluyen este archivo; él carga, en orden, el código compartido de simulador_pct23
// (desde /simulador/js/...), el modelo, el 3D, la documentación eléctrica y la interfaz. Un módulo que falte NO rompe la página: queda anotado en `faltan` (así la interfaz se
// puede usar mientras el modelo o el 3D están en construcción, y avisa de lo que no está). Va fuera del espacio PCT a propósito: es lo primero que se carga.
// Las listas son por agente. El MODELO y el 3D pueden mantener su propio orden de carga con un índice (js/modelo/indice.js → window.FV_MODELO = ['js/…', …];
// js/visor3d_fv/indice.js → window.FV_DISENO3D = ['js/…', …]); si el índice no existe se usa la lista fija de aquí.
(function () {
  const COMPARTIDO = [   // simulador_pct23 (ruta absoluta: la misma en local con servir_local.py y en el aula)
    '/simulador/js/utilidades/modulos.js', '/simulador/js/utilidades/matematicas.js', '/simulador/js/configuracion/constantes_fisicas.js', '/simulador/js/interfaz/dom.js',
    '/simulador/js/interfaz/scada/canvas.js', '/simulador/js/interfaz/scada/objeto_scada.js', '/simulador/js/interfaz/scada/etiqueta.js', '/simulador/js/interfaz/scada/valvula.js',
    '/simulador/js/interfaz/scada/sensor.js', '/simulador/js/interfaz/scada/tuberia.js',
    '/simulador/js/interfaz/visor3d/especificaciones.js', '/simulador/js/interfaz/visor3d/lecturas.js', '/simulador/js/interfaz/visor3d/controles_orbita.js', '/simulador/js/interfaz/visor3d/visor3d.js',
  ];
  const MODELO = [      // AGENTE-MODELO (rutas relativas), en el orden de sus dependencias; simulacion.js siempre al final
    'js/layout.js', 'js/configuracion/constantes.js', 'js/modelo/sol.js', 'js/modelo/panel.js', 'js/modelo/cadena.js', 'js/modelo/seguidor.js', 'js/modelo/bateria.js',
    'js/modelo/inversor_easun.js', 'js/modelo/inversor_zcs.js', 'js/modelo/protecciones.js', 'js/modelo/red_cargas.js', 'js/averias/catalogo.js', 'js/averias/motor.js',
    'js/modelo/medidas.js', 'js/modelo/simulacion.js',
  ];
  const DISENO3D = [    // AGENTE-3D (js/visor3d_fv/), en el orden de sus dependencias; escena_planta al final
    'js/visor3d_fv/kit.js', 'js/visor3d_fv/efectos_averias.js', 'js/visor3d_fv/base_fv.js', 'js/visor3d_fv/disposicion.js', 'js/visor3d_fv/paneles.js', 'js/visor3d_fv/escena_planta.js',
  ];
  const DOCUMENTACION = [   // AGENTE DE DOCUMENTACIÓN ELÉCTRICA: fichas y diagramas (solo los usan las ventanas de Unifilar y Cableado y las fichas)
    'js/interfaz/textos_ayuda.js',
  ];
  const INTERFAZ = [    // AGENTE-INTERFAZ
    'js/interfaz/formato_fv.js', 'js/scada2d/esquema_fv.js', 'js/interfaz/ayuda_fv.js', 'js/interfaz/grafica_fv.js', 'js/interfaz/panel_revision.js', 'js/interfaz/panel_lecturas.js',
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

  /** Carga una lista en orden; lo que no se pueda cargar se anota en `faltan`. */
  async function cargarLista(lista, faltan) {
    for (const ruta of lista) { if (!(await cargarScript(ruta))) faltan.push(ruta); }
  }
  /** Lista de un agente: la de su índice si existe (window[clave] tras cargarlo) y, si no, la fija. */
  async function listaDe(indice, clave, fija) {
    if (await cargarScript(indice) && Array.isArray(window[clave]) && window[clave].length) return window[clave];
    return fija;
  }

  /** Carga todo. `conInterfaz`: los módulos de la página; `conDiseno3d`: el 3D (lo pide visor3d.html); `conDocumentacion`: textos y diagramas. Devuelve { faltan }. */
  async function cargarTodo({ conInterfaz = true, conDiseno3d = false, conDocumentacion = true } = {}) {
    const faltan = [];
    await cargarLista(COMPARTIDO, faltan);
    await cargarLista(await listaDe('js/modelo/indice.js', 'FV_MODELO', MODELO), faltan);
    if (conDiseno3d) await cargarLista(await listaDe('js/visor3d_fv/indice.js', 'FV_DISENO3D', DISENO3D), faltan);
    if (conDocumentacion) await cargarLista(DOCUMENTACION, faltan);
    if (conInterfaz) await cargarLista(INTERFAZ, faltan);
    else await cargarLista(['js/interfaz/formato_fv.js'], faltan);
    return { faltan };
  }

  window.FV_CARGADOR = { COMPARTIDO, MODELO, DISENO3D, DOCUMENTACION, INTERFAZ, cargarScript, cargarTodo };
})();
