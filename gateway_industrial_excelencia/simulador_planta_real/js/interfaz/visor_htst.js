// Integración de la planta real con el visor 3D de simulador_pct23 (visor3d.js): registra el modelo «HTST», adapta la escena del diseñador a la interfaz
// que espera el visor y calcula las lecturas de las etiquetas. La escena en sí (js/visor3d_htst/) es del diseñador; aquí no se dibuja nada.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const textos = typeof require !== 'undefined' ? require('./textos_ayuda.js') : PCT.htstTextosAyuda;
  const comoFunciona = typeof require !== 'undefined' ? require('../visor3d_htst/como_funciona.js') : PCT.htstComoFunciona;
  const niveles = typeof require !== 'undefined' ? require('./niveles.js') : PCT.htstNiveles;
  /** Nivel de la página (o de la ventana aparte): el nivel 1 reduce las etiquetas y la lista de piezas a los 7 equipos del recorrido de la leche, con nombres sencillos. */
  const nivel = () => (niveles ? niveles.nivelActual() : 3);

  // Etiquetas que se ven sobre la planta (las demás piezas se eligen en la lista del panel o con un clic): así no se amontonan 40 rótulos.
  const CON_ETIQUETA = new Set(['TK-101', 'P-101', 'P-102', 'P-103', 'HX-101', 'HT-101', 'FDV-101', 'SV-101', 'HW-101', 'TT-101', 'TT-102', 'TT-103', 'TT-104', 'TT-105',
    'FT-101', 'PT-101', 'PT-102', 'LT-101', 'F-201', 'PS-001', 'VFD-101', 'QE-001', 'FRL-101']);
  const sinEtiqueta = id => id.startsWith('TUBO_') || !CON_ETIQUETA.has(id) || (nivel() === 1 && !niveles.visibleEnNivel(id, 1));
  const nombreEtiqueta = id => (nivel() === 1 && niveles.nombreSencillo(id)) || id;
  const visibleEnLista = id => nivel() !== 1 || niveles.visibleEnNivel(id, 1);

  const decimal = (v, c = 1) => v.toFixed(c).replace('.', ',');

  /**
   * Lecturas del visor a partir del estado (contrato v1): sensores[id] = { valor, texto, alarma } para lo analógico y { activo, texto } para lo demás.
   * El visor muestra `texto` en la etiqueta y colorea según alarma/activo.
   */
  function lecturasHtst(estado) {
    const sensores = {};
    if (estado) {
      for (const s of layout.SENALES.filter(x => x.tipo === 'AI')) {
        const i = (estado.instrumentos && estado.instrumentos[s.tag]) || {}, mal = !!i.calidad && i.calidad !== 'OK';
        sensores[s.tag] = { valor: typeof i.valorPLC === 'number' ? i.valorPLC : 0, texto: mal ? `⚠ ${i.calidad}` : typeof i.valorPLC === 'number' ? `${decimal(i.valorPLC, s.unidad === 'L/h' ? 0 : 1)} ${s.unidad}` : '—', alarma: mal };
      }
      const q = tag => (estado.equipos && estado.equipos[tag]) || {};
      for (const tag of ['P-101', 'P-102', 'P-103']) sensores[tag] = { activo: !!q(tag).marcha, texto: q(tag).marcha ? '●' : '○' };
      const fdv = q('FDV-101').posicion;
      sensores['FDV-101'] = { valor: fdv === 'AVANCE' ? 1 : 0, activo: fdv === 'AVANCE', alarma: false, texto: fdv === 'AVANCE' ? 'AVANCE' : fdv === 'MOVIENDO' ? '…' : 'DESVÍO' };
      sensores['F-201'] = { valor: q('F-201').fundido ? 0 : 1, activo: !q('F-201').fundido, alarma: !!q('F-201').fundido, texto: q('F-201').fundido ? 'FUNDIDO' : 'OK' };
      sensores['PS-001'] = { valor: q('PS-001').ok === false ? 0 : 1, activo: q('PS-001').ok !== false, alarma: q('PS-001').ok === false, texto: q('PS-001').ok === false ? 'FALLO' : '24 V' };
    }
    return { fraccion: 0, alturaLiquidoCm: 0, volumenMl: 0, presionFondoPa: 0, temperaturaAguaC: null, sensores };
  }

  /**
   * Adapta la escena del diseñador al contrato del visor. Acepta dos formas del diseñador: un módulo con crearEscena(THREE, clave) (ya compatible) o con
   * crear(THREE, estado) → { grupo, elementos, actualizar(estado, lecturas), liberar } (contrato de layout.js).
   */
  function adaptarEscena(modulo) {
    if (modulo.crearEscena) return modulo;
    return {
      crearEscena(THREE) {
        const parte = modulo.crear(THREE);
        const raiz = new THREE.Group(); raiz.add(parte.grupo);
        let contorno = null;
        const resaltar = id => {
          if (contorno) { raiz.remove(contorno); contorno.geometry.dispose(); contorno = null; }
          if (!id || !parte.elementos[id]) return;
          raiz.updateMatrixWorld(true);
          contorno = new THREE.Box3Helper(new THREE.Box3().setFromObject(parte.elementos[id].grupo).expandByScalar(2), 0xf68b11); raiz.add(contorno);
        };
        const mallasSeleccionables = () => { const l = []; Object.values(parte.elementos).forEach(e => e.grupo.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && o.userData.id) l.push(o); })); return l; };
        return { raiz, elementos: parte.elementos, actualizar: (lecturas, estado) => { if (estado) parte.actualizar(estado, lecturas); }, resaltar, ponerCorte() {}, ponerTapa() {},
          mallasSeleccionables, liberar() { parte.liberar(); if (contorno) contorno.geometry.dispose(); }, sombras: false,
          vistaInicial: { azimut: 0.3, elevacion: 0.55, distancia: 430, minimo: 90, maximo: 760, objetivo: { x: 60, y: 40, z: 0 } } };
      },
    };
  }

  /** Fichas de ayuda del panel con el texto «Cómo funciona» añadido a los equipos que se abren por dentro (al pulsarlos en el 3D). */
  function ayudasConComoFunciona() {
    const ayudas = textos.construirElementos();
    if (comoFunciona) for (const tag of comoFunciona.TAGS_CON_INTERIOR) if (ayudas[tag]) ayudas[tag].queEs = `${ayudas[tag].queEs} Cómo funciona (se abre por dentro al pulsarlo): ${comoFunciona.textoComoFunciona(tag)}`;
    return ayudas;
  }

  /** Fichas del nivel 1 en el formato del panel del visor: título sencillo, qué es y qué hace. */
  function ayudasNivel1() {
    const ayudas = {};
    for (const tag of niveles.EQUIPOS_NIVEL_1) { const f = niveles.fichaSencilla(tag); ayudas[tag] = { titulo: f.nombre, etiqueta: `Código: ${tag}`, queEs: f.queEs, enSimulador: f.queHace }; }
    return ayudas;
  }

  const RESUMEN = 'Pasteurizador HTST completo sobre su patín, con el armario eléctrico. Sigue el estado del SCADA y muestra las averías que el profesor provoque. Pulsa una pieza para ver qué es; las medidas y los tamaños son típicos e ilustrativos.';
  const RESUMEN_NIVEL_1 = 'La leche va del tanque al intercambiador, espera en el tubo y la válvula de desvío decide si sale o vuelve al tanque. Pulsa una pieza para saber qué es y qué hace.';

  /** Registra el modelo y la escena en el visor de simulador_pct23. Devuelve false si el visor o la escena del diseñador no están cargados. */
  function registrar() {
    if (!PCT.visor3dEspecificaciones) return false;
    PCT.visor3dRutaThree = '/simulador/js/vendor/three.js';       // Three.js es el de simulador_pct23 (misma ruta en local y en el aula)
    PCT.visor3dEspecificaciones.MODELOS.HTST = {
      escena: 'htst', panel: 'planta', pesada: true, titulo: 'Planta real HTST de leche',
      captadores: [], conexiones: [], lecturas: lecturasHtst, observaciones: () => ({}), sinEtiqueta, nombreEtiqueta, visibleEnLista,
    };
    // Lo que depende del nivel se calcula al pedirlo (el nivel puede cambiar con el visor ya registrado)
    Object.defineProperty(PCT.visor3dEspecificaciones.MODELOS.HTST, 'ayudas', { enumerable: true, get: () => (nivel() === 1 ? ayudasNivel1() : ayudasConComoFunciona()) });
    Object.defineProperty(PCT.visor3dEspecificaciones.MODELOS.HTST, 'resumen', { enumerable: true, get: () => (nivel() === 1 ? RESUMEN_NIVEL_1 : RESUMEN) });
    PCT.visor3dEscenas = PCT.visor3dEscenas || {};
    if (PCT.htstEscenaPlanta) { PCT.visor3dEscenas.htst = adaptarEscena(PCT.htstEscenaPlanta); return true; }
    return false;
  }

  const api = { CON_ETIQUETA, sinEtiqueta, nombreEtiqueta, visibleEnLista, ayudasNivel1, lecturasHtst, adaptarEscena, registrar };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstVisor = api;
})();
