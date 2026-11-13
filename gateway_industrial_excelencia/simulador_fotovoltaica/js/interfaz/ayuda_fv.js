// Ficha de cada equipo de la instalación fotovoltaica: clic derecho (o la tecla de menú con el equipo enfocado) abre una ventana con qué es, qué hace en el simulador, su estado
// en vivo, qué mirar al mantenerlo y los botones «Ver en 3D» (abre visor3d.html?foco=TAG&solo=1 como ventana aparte) y, en Revisión, el de accionarlo. El clic izquierdo
// ACCIONA (lo atiende la página con `clicIzquierdo`). Accesible: el foco entra en la ficha al abrirla y vuelve al equipo al cerrarla (Esc o ×).
// Si el agente de documentación aporta PCT.fvTextosAyuda (construirElementos / estadoVivo), sus textos mandan sobre los de aquí.
(function () {
  const enNode = typeof require !== 'undefined';
  const layout = enNode ? require('../layout.js') : PCT.fvLayout;
  const E = enNode ? require('../scada2d/esquema_fv.js') : PCT.fvEsquema;
  const F = enNode ? require('./formato_fv.js') : PCT.fvFormato;

  // Qué es, qué hace en el simulador y qué mirar al revisarlo, por tipo de equipo (lenguaje para alumnos de mantenimiento electrónico).
  const POR_TIPO = {
    caseta: ['Caseta metálica de la cubierta con puerta corredera donde están los inversores, la batería, las cajas y el cuadro de alterna. Tiene rejillas de ventilación en lo alto.', 'Si se tapan las rejillas los inversores se calientan y reducen potencia.', 'Rejillas libres, puerta cerrada, sin humedad ni suciedad en los equipos.'],
    bandeja: ['Bandeja de rejilla que lleva los cables rojo y negro de los paneles hasta la caseta, con los conectores MC4.', 'Solo recorre los cables: un cable cortado o un MC4 sin enchufar abre una cadena.', 'Cables sujetos, conectores MC4 bien enchufados, sin cables rozados ni expuestos al sol.'],
    panel: ['Panel fotovoltaico: convierte la luz en corriente continua. Tiene tres subcadenas de células, cada una con su diodo de paso (bypass).', 'Su potencia depende de la irradiancia, de su temperatura (más calor, menos tensión) y de la sombra. Si una subcadena se sombrea, su diodo conduce y el panel pierde un tercio de la tensión.', 'Limpieza, sombras, marco y cristal sin roturas, caja de conexiones y diodos (con el panel a oscuras, midiendo la caída del diodo).'],
    cadena: ['Cadena (string): varios paneles en serie. Las tensiones se suman y la corriente la limita el peor panel.', 'Muestra la tensión, la corriente y la potencia en el punto de máxima potencia. En la gráfica I-V de abajo ves su curva.', 'Tensión en vacío (Voc) con el seccionador abierto y corriente de cortocircuito (Isc): deben ser parecidas entre cadenas iguales.'],
    caja_cc: ['Caja de conexión de continua «HT 8WAY»: reúne los fusibles de cadena, el seccionador y el descargador del campo A.', 'Agrupa las dos cadenas antes de entrar al EASun.', 'Fusibles, seccionador, descargador con testigo y bornas apretadas.'],
    fusible: ['Fusible de continua: protege el cable de la cadena contra sobrecorriente.', 'Si se funde, la cadena queda sin salida. Se repone con «Rearmar» (cambiar fusible) en Revisión.', 'Continuidad con el multímetro y sin tensión; sustituir siempre por uno del mismo valor y tipo gPV.'],
    seccionador_cc: ['Seccionador de continua: permite abrir el campo de paneles para trabajar. En continua no hay paso por cero: un arco no se apaga solo.', 'Abierto, el campo queda sin conexión al inversor. Con clic izquierdo (en Revisión) lo abres o cierras.', 'Abrir siempre en vacío; los paneles siguen dando tensión aunque el seccionador esté abierto.'],
    descargador: ['Descargador de sobretensiones (SPD): desvía a tierra los picos de tensión de los rayos. Tiene un testigo que se pone rojo cuando está agotado.', 'Agotado, la instalación deja de estar protegida (se avisa) pero sigue funcionando. Se sustituye con «Rearmar» en Revisión.', 'Testigo verde, cartucho enchufado y conexión a tierra corta y de buena sección.'],
    inversor_hibrido: ['Inversor híbrido: convierte la continua en alterna con seguimiento del punto de máxima potencia (MPPT) y gestiona la batería y la red.', 'Muestra su estado, sus potencias y temperatura. En Revisión puedes encenderlo o apagarlo con clic izquierdo.', 'Pantalla y LEDs, temperatura, ventilación, apriete de bornas y la alarma que indica.'],
    magnetotermico_cc: ['Magnetotérmico de continua de la batería: protege contra cortocircuitos y sobrecargas del cable de la batería.', 'Si salta, el EASun pierde la batería. Clic izquierdo en Revisión: cerrar, abrir o rearmar.', 'Polaridad (los de continua tienen + y −), calibre adecuado y bornas sin calentamiento.'],
    bateria: ['Batería de litio-ferrofosfato (LiFePO4) de 25,6 V y 100 Ah con BMS (sistema de gestión) que vigila cada celda.', 'Guarda energía: su SoC sube al cargar y baja al descargar. El BMS la corta si una celda baja de 2,5 V o sube de 3,65 V.', 'Tensión de las celdas (equilibrio), temperatura, apriete de bornas y estado del BMS.'],
    comunicaciones: ['Módulo de comunicaciones (Wi-Fi / RS485) del EASun para ver sus datos a distancia.', 'Si falla, el inversor sigue funcionando pero solo se pierde la lectura remota.', 'Luz del módulo, cable RS485 y red Wi-Fi.'],
    medidor: ['Medidor de red del ZCS: mide lo que consume el centro y lo que se vierte.', 'Su lectura decide cuánto produce el ZCS para no inyectar de más.', 'Sentido de las pinzas amperimétricas y fases bien conectadas.'],
    cuadro_ca: ['Cuadro de alterna: reúne la acometida de red, las protecciones y las salidas a los dos inversores y a las cargas.', 'Distribuye la energía de la red, del ZCS y del EASun.', 'Diferencial (botón de prueba), calibres, bornas y estado de las protecciones.'],
    magnetotermico: ['Magnetotérmico de alterna: protege la línea contra sobrecargas y cortocircuitos.', 'Abierto o disparado, corta lo que cuelga de él. Clic izquierdo en Revisión: cerrar, abrir o rearmar.', 'Calibre, curva y temperatura de las bornas.'],
    diferencial: ['Diferencial de 30 mA: corta si detecta una fuga a tierra (protección de las personas).', 'Disparado, la red deja de entrar al cuadro y el ZCS se desconecta por anti-isla.', 'Pulsar el botón de prueba y comprobar que dispara; buscar la fuga si salta solo.'],
    toma: ['Toma de corriente (schuko) de la caseta para herramientas y equipos de medida.', 'Está en el cuadro de alterna; no consume en el simulador.', 'Estado de las bornas y de la tapa.'],
    red: ['Acometida de red del centro: 230 V y 50 Hz.', 'En Revisión puedes cortarla (el ZCS se desconecta por anti-isla) o cambiar su tensión en el panel.', 'Tensión entre fases y tierra, frecuencia y calidad del suministro.'],
    carga: ['Cargas: el consumo que alimenta la instalación.', 'Con perfil automático (aula de mañana y tarde, noche baja) o manual desde el panel de Revisión.', 'Potencia consumida y si están alimentadas.'],
  };
  const TIPOS_BOTON_3D = true;
  const TEXTO_OCULTO = 'En Diagnóstico el estado no se muestra: averígualo midiendo.';

  /** Ficha de un equipo: { titulo, etiqueta, queEs, enSimulador, mantenimiento }. Con PCT.fvTextosAyuda (si existe) mandan sus textos. */
  function fichaDe(tag, externos) {
    const q = layout.EQUIPOS.find(x => x.tag === tag);
    if (!q) return null;
    const t = POR_TIPO[q.tipo] || ['', '', ''];
    const ext = externos && externos[tag] ? externos[tag] : {};
    return { tag, titulo: ext.titulo || `${tag} · ${q.nombre}`, etiqueta: ext.etiqueta || `${layout.CIRCUITOS[layout.circuitoDe(tag)] || 'Instalación'}`, queEs: ext.queEs || t[0], enSimulador: ext.enSimulador || t[1], mantenimiento: ext.mantenimiento || t[2] };
  }

  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /** Cuerpo de la ficha completa de PCT.fvTextos (qué es, para qué sirve, cómo falla, qué medir, riesgos, averías). Los textos son del propio simulador (pueden llevar negritas). */
  function cuerpoRico(f) {
    const lista = (titulo, items, clase) => (items && items.length ? `<h4>${titulo}</h4><ul${clase ? ` class="${clase}"` : ''}>${items.map(i => `<li>${i}</li>`).join('')}</ul>` : '');
    return `<h4>Qué es</h4><p>${f.queEs}</p><h4>Para qué sirve</h4><p>${f.paraQue}</p>${lista('Fallos y síntomas', f.fallos)}${lista('Qué medir', f.medir)}${lista('Riesgos', f.riesgos, 'ficha-riesgo')}${lista('Averías relacionadas', (f.averias || []).map(a => `${esc(a.titulo)} <small>(${esc(a.id)})</small>`))}`;
  }

  /** Texto de «Estado ahora» (lo vivo del equipo). */
  function textoVivo(tag, estado) {
    if (!estado) return '—';
    const base = `${E.estadoEquipo(estado, tag)}`;
    const al = (estado.alarmas || []).filter(a => a.tag === tag).map(a => a.texto);
    return al.length ? `${base}. Alarma: ${al.join('; ')}` : base;
  }

  /** Tag del equipo (data-tag) del elemento pulsado o de alguno de sus padres; null si no es un equipo. */
  function tagDelElemento(nodo, raiz) {
    for (let n = nodo; n && n !== raiz; n = n.parentNode) { if (n.dataset && n.dataset.tag) return n.dataset.tag; }
    return null;
  }
  /** Dirección de la ventana 3D aislada en una pieza (o de toda la instalación sin tag). */
  const urlVisor3d = tag => (tag ? `visor3d.html?foco=${encodeURIComponent(tag)}&solo=1` : 'visor3d.html');

  /**
   * Activa las fichas sobre `svg`. contexto: { sim(), alVer3d(tag), clicIzquierdo(tag, evento), accion(tag) → { texto, ejecutar() } | null, textos (opcional, PCT.fvTextosAyuda) }.
   */
  function iniciarAyuda(svg, contexto) {
    const ext = contexto.textos && contexto.textos.construirElementos ? contexto.textos.construirElementos() : null;
    const ventana = document.createElement('div');
    ventana.id = 'ficha-equipo'; ventana.hidden = true; ventana.setAttribute('role', 'dialog'); ventana.setAttribute('aria-modal', 'true'); ventana.setAttribute('aria-labelledby', 'ficha-titulo');
    ventana.innerHTML = '<header><h3 id="ficha-titulo"></h3><button type="button" class="ficha-cerrar" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header><span class="etiqueta-ficha"></span>' +
      '<div class="ficha-cuerpo"></div><h4>Estado ahora</h4><p class="ficha-vivo"></p><div class="ficha-diag" hidden></div><div class="ficha-mando"></div>' +
      '<div class="ficha-botones"><button type="button" class="ficha-accion" hidden></button><button type="button" class="ficha-3d">Ver en 3D ▸</button></div>';
    document.body.appendChild(ventana);
    let actual = null, temporizador = null, origen = null, accionActual = null;
    const vivo = () => {
      if (!actual || ventana.hidden) return;
      const estado = contexto.sim().estado;
      const oculto = !!(contexto.oculto && contexto.oculto());      // modo Diagnóstico: el estado en vivo delataría la avería
      const texto = oculto ? TEXTO_OCULTO : (ext && contexto.textos.estadoVivo ? contexto.textos.estadoVivo(actual, estado) : null) || textoVivo(actual, estado);
      ventana.querySelector('.ficha-vivo').textContent = texto || '—';
      const dg = ventana.querySelector('.ficha-diag'), D = !enNode && PCT.fvDiagnostico;
      if (D && !oculto && (actual === 'INV-101' || actual === 'INV-201')) { const x = D.diagnosticoInversor(estado, actual); dg.hidden = false; dg.className = `ficha-diag e-${x.nivel}`; dg.innerHTML = `<b>Causa:</b> ${esc(x.causa)}${x.efecto ? `<br><b>Efecto:</b> ${esc(x.efecto)}` : ''}`; } else dg.hidden = true;
      const b = ventana.querySelector('.ficha-accion'), a = contexto.accion ? contexto.accion(actual) : null;
      accionActual = a; b.hidden = !a; if (a) b.textContent = a.texto;
    };
    function cerrar() {
      if (ventana.hidden) return;
      ventana.hidden = true; actual = null; clearInterval(temporizador);
      if (origen && origen.isConnected && origen.focus) origen.focus();
      origen = null;
    }
    function abrir(tag, desde) {
      const f = fichaDe(tag, ext); if (!f) return;
      if (ventana.hidden) origen = desde || document.activeElement;
      actual = tag;
      const rica = contexto.textos && contexto.textos.fichaDe ? contexto.textos.fichaDe(tag) : null;      // la ficha completa de PCT.fvTextos: con listas (síntomas, medidas, riesgos, averías)
      ventana.querySelector('h3').textContent = rica ? rica.titulo : f.titulo; ventana.querySelector('.etiqueta-ficha').textContent = rica ? rica.etiqueta : f.etiqueta;
      ventana.querySelector('.ficha-cuerpo').innerHTML = rica ? cuerpoRico(rica) : `<p>${esc(f.queEs)}</p><h4>En el simulador</h4><p>${esc(f.enSimulador || '—')}</p><h4>Qué mirar al mantenerlo</h4><p>${esc(f.mantenimiento || '—')}</p>`;
      ventana.querySelector('.ficha-cuerpo').scrollTop = 0; ventana.scrollTop = 0;
      ventana.hidden = false; vivo(); clearInterval(temporizador); temporizador = setInterval(vivo, 500);
      ventana.querySelector('.ficha-cerrar').focus();
    }
    ventana.querySelector('.ficha-cerrar').addEventListener('click', cerrar);
    ventana.querySelector('.ficha-3d').addEventListener('click', () => { const t = actual; cerrar(); if (contexto.alVer3d) contexto.alVer3d(t); });
    ventana.querySelector('.ficha-accion').addEventListener('click', () => { if (accionActual) accionActual.ejecutar(); vivo(); });
    const existe = tag => !!layout.EQUIPOS.find(x => x.tag === tag);
    const alPulsar = evento => { const tag = tagDelElemento(evento.target, svg); if (tag && existe(tag)) { evento.preventDefault(); abrir(tag, evento.target.closest ? evento.target.closest('g[data-tag]') : null); } };
    // Con `clicIzquierdo(tag, evento)` el clic izquierdo (y Intro o Espacio) ACCIONA el equipo y solo el clic derecho abre su ficha.
    svg.addEventListener('click', evento => {
      const tag = tagDelElemento(evento.target, svg); if (!tag || !existe(tag)) return;
      if (!contexto.clicIzquierdo) { alPulsar(evento); return; }
      contexto.clicIzquierdo(tag, evento);
    });
    svg.addEventListener('contextmenu', alPulsar);
    if (!enNode && PCT.fvToqueLargo) PCT.fvToqueLargo.activar(svg, { existe, abrir: (tag, g) => abrir(tag, g) });      // iPad: mantener pulsado 3 s = clic derecho
    svg.addEventListener('keydown', evento => {
      const g = evento.target.closest && evento.target.closest('g[data-tag]'); if (!g || !existe(g.dataset.tag)) return;
      if (evento.key === 'ContextMenu' || (evento.key === 'F10' && evento.shiftKey)) { evento.preventDefault(); abrir(g.dataset.tag, g); return; }
      if (evento.key !== 'Enter' && evento.key !== ' ') return;
      evento.preventDefault();
      if (contexto.clicIzquierdo) contexto.clicIzquierdo(g.dataset.tag, evento); else abrir(g.dataset.tag, g);
    });
    document.addEventListener('keydown', e => {
      if (ventana.hidden) return;
      if (e.key === 'Escape') { cerrar(); return; }
      if (e.key === 'Tab') {
        const controles = [...ventana.querySelectorAll('button:not([hidden])')].filter(c => c.offsetParent !== null);
        if (!controles.length) return;
        const primero = controles[0], ultimo = controles[controles.length - 1];
        if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); } else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      }
    });
    return { abrir, cerrar };
  }

  const api = { TEXTO_OCULTO, cuerpoRico, POR_TIPO, TIPOS_BOTON_3D, fichaDe, textoVivo, tagDelElemento, urlVisor3d, iniciarAyuda };
  void F;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvAyuda = api;
})();
