// Visor 3D de depósitos: ventana con la escena, etiquetas sobre cada captador y un panel con su estado en vivo.
// Three.js (js/vendor/three.js, 1,3 MB) se carga solo la primera vez que se abre el visor.
(function () {
  const { MODELOS, GEOMETRIA } = PCT.visor3dEspecificaciones;
  const ELEMENTOS_AYUDA = () => PCT.ayudaTextos.ELEMENTOS;
  const { lecturasModelo } = PCT.visor3dLecturas;
  const { ControlesOrbita } = PCT.controlesOrbita;
  const RUTA_THREE = 'js/vendor/three.js';
  const decimal = (valor, cifras = 1) => valor.toFixed(cifras).replace('.', ',');

  let modal = null, estadoUI = null;
  let carga = null;       // promesa de la carga de Three.js
  let sesion = null;      // { THREE, renderer, camara, escena, controles, clave, ... } mientras el visor está abierto

  function cargarThree() {
    if (window.THREE) return Promise.resolve();
    if (!carga) {
      carga = new Promise((resolver, rechazar) => {
        const script = document.createElement('script');
        script.src = RUTA_THREE;
        script.onload = resolver;
        script.onerror = () => { carga = null; rechazar(new Error('No se pudo cargar Three.js')); };
        document.head.appendChild(script);
      });
    }
    return carga;
  }

  /* ---------- ventana ---------- */
  function crearModal() {
    if (modal) return;
    modal = document.createElement('div');
    modal.id = 'visor3d'; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-label', 'Modelo 3D del depósito');
    modal.innerHTML =
      '<div class="v3d-caja">' +
        '<header><h3 class="v3d-titulo"></h3><div class="v3d-botones">' +
          '<button type="button" data-vista="transparente" aria-pressed="true">Transparente</button>' +
          '<button type="button" data-vista="corte" aria-pressed="false">Corte</button>' +
          '<button type="button" data-opcion="etiquetas" aria-pressed="true">Etiquetas</button>' +
          '<button type="button" data-opcion="tapa" aria-pressed="true">Tapa</button>' +
          '<button type="button" data-accion="reiniciar">Vista inicial</button>' +
        '</div><button type="button" class="v3d-cerrar" aria-label="Cerrar (Esc)" title="Cerrar (Esc)">×</button></header>' +
        '<div class="v3d-cuerpo"><div class="v3d-escena"><canvas></canvas><div class="v3d-etiquetas"></div>' +
          '<p class="v3d-aviso" hidden></p><p class="v3d-pista">Arrastra para girar · rueda o pellizco para acercar · doble clic: vista inicial · pulsa un captador para ver su estado</p></div>' +
        '<aside class="v3d-panel" aria-live="polite"></aside></div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.querySelector('.v3d-cerrar').addEventListener('click', cerrar);
    modal.addEventListener('mousedown', e => { if (e.target === modal) cerrar(); });
    modal.querySelector('.v3d-botones').addEventListener('click', alPulsarBoton);
    modal.querySelector('.v3d-panel').addEventListener('click', alPulsarPanel);
    modal.querySelector('.v3d-etiquetas').addEventListener('click', alPulsarPanel);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) { e.stopImmediatePropagation(); cerrar(); } }, true);
  }

  function alPulsarBoton(evento) {
    const boton = evento.target.closest('button');
    if (!boton || !sesion) return;
    const { vista, opcion, accion } = boton.dataset;
    if (vista) {
      modal.querySelectorAll('[data-vista]').forEach(b => b.setAttribute('aria-pressed', String(b === boton)));
      sesion.escena.ponerCorte(vista === 'corte');
    } else if (opcion) {
      const activo = boton.getAttribute('aria-pressed') !== 'true';
      boton.setAttribute('aria-pressed', String(activo));
      if (opcion === 'etiquetas') modal.querySelector('.v3d-etiquetas').hidden = !activo;
      if (opcion === 'tapa') sesion.escena.ponerTapa(activo);
    } else if (accion === 'reiniciar') {
      sesion.controles.reiniciar();
    }
  }

  function avisar(texto) {
    const aviso = modal.querySelector('.v3d-aviso');
    aviso.textContent = texto; aviso.hidden = !texto;
  }

  /* ---------- panel de información ---------- */
  const claseEstado = sensor => (sensor.alarma ? 'alarma' : sensor.activo === undefined ? 'neutro' : sensor.activo ? 'ok' : 'apagado');

  function filaDato(titulo, texto) { return texto ? `<h4>${titulo}</h4><p>${texto}</p>` : ''; }

  function construirPanel(clave, seleccion) {
    const modelo = MODELOS[clave];
    const panel = modal.querySelector('.v3d-panel');
    if (modelo.escena === 'planta') { construirPanelPlanta(panel, modelo, seleccion); return; }
    const deposito = !modelo.escena, conjunto = modelo.escena === 'bomba' ? 'la bomba' : 'el intercambiador';
    if (!seleccion) {
      panel.innerHTML = `<h4>${modelo.titulo}</h4><p>${modelo.resumen}</p>` +
        (deposito ? `<p class="v3d-datos">Ø ${decimal(GEOMETRIA.diametroCm * 10, 0)} mm × ${decimal(GEOMETRIA.alturaCm * 10, 0)} mm · altura útil ${decimal(GEOMETRIA.alturaUtilCm * 10, 0)} mm</p>` +
          '<p class="v3d-datos" data-vivo="resumen"></p>' : '') + '<h4>Captadores y conexiones</h4><ul class="v3d-lista">' +
        [...modelo.captadores, ...modelo.conexiones].map(e => `<li><button type="button" data-id="${e.id}"><i data-vivo-punto="${e.id}"></i>${e.nombre}</button></li>`).join('') +
        '</ul><p class="v3d-nota">' + (deposito ? 'Las medidas del depósito (Ø 155 × 285 mm) son un dato tuyo; la posición de los captadores dentro es orientativa.' :
          (modelo.escena === 'bomba' ? 'Modelo ilustrativo de una bomba peristáltica de rodillos: el manual no da sus medidas.' : 'Modelo ilustrativo: el manual no da las medidas del intercambiador ni la distribución de sus placas.')) + '</p>';
      return;
    }
    const e = [...modelo.captadores, ...modelo.conexiones].find(x => x.id === seleccion);
    const esCaptador = !!e.queMide;
    panel.innerHTML = `<button type="button" class="v3d-volver" data-id="">← ${deposito ? 'Todo el depósito' : modelo.escena === 'bomba' ? 'Toda la bomba' : 'Todo el intercambiador'}</button>` +
      `<h4>${e.nombre}</h4>` + (esCaptador ? '<p class="v3d-estado" data-vivo="estado"></p>' : '') +
      (esCaptador ? filaDato('Qué mide', e.queMide) + filaDato('Para qué sirve', e.uso) + filaDato('Señal', e.senal) +
        (e.alturaCm !== undefined ? filaDato('Posición', `a ${decimal(e.alturaCm * 10, 0)} mm del fondo (orientativa)`) : '') + '<div data-vivo="extra"></div>' + filaDato('Nota', e.nota)
        : filaDato('Qué es', e.detalle) + filaDato('Sentido', e.tipo === 'entrada' ? (deposito ? 'Entra fluido al depósito' : `Entra fluido a ${conjunto}`) : (deposito ? 'Sale fluido del depósito' : `Sale fluido de ${conjunto}`)));
  }

  // En la planta completa cada pieza se describe con el texto de ayuda del simulador (el mismo del clic derecho).
  const PIEZAS_SIN_ETIQUETA = id => id.startsWith('TUBO_') || ['LVL', 'HLC', 'HL', 'LL', 'TERM', 'RES', 'L1', 'T2'].includes(id);
  function construirPanelPlanta(panel, modelo, seleccion) {
    const ayudas = ELEMENTOS_AYUDA();
    if (!seleccion) {
      const ids = Object.keys(sesion.escena.elementos).filter(id => !id.startsWith('TUBO_'));
      panel.innerHTML = `<h4>${modelo.titulo}</h4><p>${modelo.resumen}</p><h4>Piezas</h4><ul class="v3d-lista">` +
        ids.map(id => `<li><button type="button" data-id="${id}">${(ayudas[sesion.escena.elementos[id].ayuda] || {}).titulo || id}</button></li>`).join('') +
        '</ul><p class="v3d-nota">Modelo ilustrativo: el manual no da las distancias entre equipos; la disposición sigue el diagrama.</p>';
      return;
    }
    const el = sesion.escena.elementos[seleccion], a = ayudas[el.ayuda] || {};
    panel.innerHTML = '<button type="button" class="v3d-volver" data-id="">← Toda la planta</button>' +
      `<h4>${a.titulo || seleccion}</h4>` + filaDato('Qué es', a.queEs) + filaDato('En el simulador', a.enSimulador) +
      (a.modelo3d ? `<button type="button" class="v3d-volver" data-abrir="${a.modelo3d}" data-foco="${a.foco3d || ''}">Ver su modelo 3D detallado ▸</button>` : '') +
      (a.paginas ? `<p class="v3d-nota">Manual de la PCT23, ${a.paginas}.</p>` : '');
  }

  function actualizarPanel(lecturas, seleccion) {
    const panel = modal.querySelector('.v3d-panel');
    const modelo = MODELOS[sesion.clave];
    const poner = (selector, texto) => { const el = panel.querySelector(selector); if (el && el.textContent !== texto) el.textContent = texto; };
    if (!seleccion) {
      if (!modelo.escena) poner('[data-vivo="resumen"]', `Llenado: ${decimal(lecturas.fraccion * 100, 0)} % · ${Math.round(lecturas.volumenMl)} ml · líquido a ${decimal(lecturas.alturaLiquidoCm * 10, 0)} mm`);
      for (const c of modelo.captadores) {
        const punto = panel.querySelector(`[data-vivo-punto="${c.id}"]`);
        if (punto) punto.className = 'v3d-punto ' + claseEstado(lecturas.sensores[c.id]);
      }
      return;
    }
    const sensor = lecturas.sensores[seleccion];
    if (!sensor) return;
    const estado = panel.querySelector('[data-vivo="estado"]');
    if (estado) { estado.className = 'v3d-estado ' + claseEstado(sensor); if (estado.textContent !== sensor.texto) estado.textContent = sensor.texto; }
    if (seleccion === 'L1') {
      poner('[data-vivo="extra"]', `Si fuera de presión hidrostática: ${decimal(lecturas.presionFondoPa / 1000, 2)} kPa en el fondo (ρ·g·h, solo informativo).`);
    }
  }

  /* ---------- etiquetas sobre el modelo ---------- */
  function etiquetaCorta(e) { const [corta, resto] = e.nombre.split(' · '); return resto || e.nombre.length <= 14 ? corta : e.id; }

  function crearEtiquetas(clave, escena) {
    const contenedor = modal.querySelector('.v3d-etiquetas');
    contenedor.innerHTML = '';
    const etiquetas = {};
    const modelo = MODELOS[clave];
    const piezas = modelo.escena === 'planta' ? Object.keys(escena.elementos).filter(id => !PIEZAS_SIN_ETIQUETA(id)).map(id => ({ id, nombre: id })) : [...modelo.captadores, ...modelo.conexiones];
    for (const e of piezas) {
      const boton = document.createElement('button');
      boton.type = 'button'; boton.className = 'v3d-etq'; boton.dataset.id = e.id;
      boton.innerHTML = `<b>${etiquetaCorta(e)}</b><span></span>`;
      contenedor.appendChild(boton);
      etiquetas[e.id] = { boton, valor: boton.querySelector('span') };
    }
    return etiquetas;
  }

  function colocarEtiquetas() {
    const { THREE, camara, escena, etiquetas, renderer } = sesion;
    const ancho = renderer.domElement.clientWidth, alto = renderer.domElement.clientHeight;
    const punto = new THREE.Vector3();
    const puestas = [];
    for (const id of Object.keys(etiquetas)) {
      punto.copy(escena.elementos[id].ancla).project(camara);
      const e = etiquetas[id];
      e.boton.style.visibility = punto.z < 1 ? 'visible' : 'hidden';
      if (punto.z < 1) puestas.push({ e, x: (punto.x * 0.5 + 0.5) * ancho, y: (-punto.y * 0.5 + 0.5) * alto });
    }
    // Etiquetas que caerían una sobre otra: se apilan hacia abajo para que todas se puedan pulsar.
    const ALTO_ETIQUETA = 26, ANCHO_MINIMO = 90;
    puestas.sort((a, b) => a.y - b.y);
    puestas.forEach((p, i) => {
      for (let j = 0; j < i; j++) {
        const q = puestas[j];
        if (Math.abs(p.x - q.x) < ANCHO_MINIMO && Math.abs(p.y - q.y) < ALTO_ETIQUETA) { p.y = q.y + ALTO_ETIQUETA; j = -1; }
      }
    });
    for (const p of puestas) p.e.boton.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  function textoCorto(sensor) {
    if (!sensor) return '';
    if (sensor.valor !== undefined) return sensor.texto;
    return sensor.activo ? '●' : '○';
  }

  /* ---------- selección ---------- */
  function seleccionar(id) {
    if (!sesion) return;
    sesion.seleccion = id || null;
    sesion.escena.resaltar(id);
    construirPanel(sesion.clave, sesion.seleccion);
    for (const [clave, e] of Object.entries(sesion.etiquetas)) e.boton.classList.toggle('activa', clave === id);
  }

  function alPulsarEscena(evento) {
    if (!sesion || sesion.controles.seArrastro()) return;
    const lienzo = sesion.renderer.domElement, caja = lienzo.getBoundingClientRect();
    sesion.raton.set(((evento.clientX - caja.left) / caja.width) * 2 - 1, -((evento.clientY - caja.top) / caja.height) * 2 + 1);
    sesion.rayo.setFromCamera(sesion.raton, sesion.camara);
    const golpes = sesion.rayo.intersectObjects(sesion.seleccionables, false);
    const golpe = golpes.find(g => !g.object.userData.fondo) || golpes[0];
    seleccionar(golpe ? golpe.object.userData.id : null);
  }

  /* ---------- bucle de dibujo ---------- */
  function ajustarTamano() {
    if (!sesion) return;
    const contenedor = modal.querySelector('.v3d-escena');
    const ancho = contenedor.clientWidth, alto = contenedor.clientHeight;
    if (!ancho || !alto) return;
    sesion.renderer.setSize(ancho, alto, false);
    sesion.camara.aspect = ancho / alto;
    sesion.camara.updateProjectionMatrix();
  }

  // Modo lento: si el navegador dibuja por software o la gráfica no da más de ~11 fps, se baja la resolución interna y los fotogramas por segundo
  // para que el navegador no se cuelgue. Se activa solo (detectando la GPU al abrir, o midiendo el tiempo entre dibujos).
  const MS_PLANTA = 33, MS_LENTO = 70, UMBRAL_LENTO_MS = 90, FOTOGRAMAS_PARA_JUZGAR = 8;
  function activarModoLento(motivo) {
    if (!sesion || sesion.lento) return;
    sesion.lento = true;
    sesion.renderer.setPixelRatio(0.6); ajustarTamano();
    avisar(motivo);
  }
  function vigilarRendimiento(ahora) {
    if (sesion.lento) return;
    if (sesion.ultimoDibujo) {
      sesion.sumaIntervalos = (sesion.sumaIntervalos || 0) + (ahora - sesion.ultimoDibujo); sesion.contados = (sesion.contados || 0) + 1;
      if (sesion.contados >= FOTOGRAMAS_PARA_JUZGAR) {
        if (sesion.sumaIntervalos / sesion.contados > UMBRAL_LENTO_MS) activarModoLento('Tu equipo dibuja el 3D despacio: se ha bajado la calidad para que no se cuelgue. Activa la aceleración por hardware del navegador para verlo fluido.');
        sesion.sumaIntervalos = 0; sesion.contados = 0;
      }
    }
  }
  function fotograma() {
    if (!sesion) return;
    sesion.animacion = requestAnimationFrame(fotograma);
    const ahora = performance.now();
    const minimo = sesion.lento ? MS_LENTO : MODELOS[sesion.clave].escena === 'planta' ? MS_PLANTA : 0;
    if (ahora - (sesion.ultimoDibujo || 0) < minimo) return;
    vigilarRendimiento(ahora);
    sesion.ultimoDibujo = ahora;
    const estado = sesion.obtenerEstado();
    if (estado) {
      const lecturas = lecturasModelo(sesion.clave, estado, PCT.planta.observaciones(estado));
      sesion.escena.actualizar(lecturas, estado, PCT.planta.observaciones(estado));
      actualizarPanel(lecturas, sesion.seleccion);
      for (const [id, e] of Object.entries(sesion.etiquetas)) {
        const texto = textoCorto(lecturas.sensores[id]);
        if (e.valor.textContent !== texto) e.valor.textContent = texto;
        const sensor = lecturas.sensores[id];
        e.boton.dataset.estado = sensor ? claseEstado(sensor) : 'neutro';
      }
    }
    const p = sesion.controles.posicion(), o = sesion.controles.vista.objetivo;
    sesion.camara.position.set(p.x, p.y, p.z);
    sesion.camara.lookAt(o.x, o.y, o.z);
    colocarEtiquetas();
    sesion.renderer.render(sesion.threeEscena, sesion.camara);
  }

  /* ---------- abrir y cerrar ---------- */
  // Planta completa: solo mapeo de tonos (barato). Las sombras se quitaron: duplicaban el coste de dibujo en gráficas integradas.
  function activarSombras(THREE, renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
  }

  const REGEX_SOFTWARE = /swiftshader|llvmpipe|software|basic render|microsoft basic/i;
  /** true si el navegador dibujaría el WebGL por software (sin GPU): se mira con un contexto de prueba antes de crear el real. */
  function gpuPorSoftware() {
    try {
      const gl = document.createElement('canvas').getContext('webgl'), x = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const texto = x ? String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL)) : '';
      if (gl && gl.getExtension('WEBGL_lose_context')) gl.getExtension('WEBGL_lose_context').loseContext();
      return REGEX_SOFTWARE.test(texto);
    } catch (error) { return false; }
  }

  const pausa = () => new Promise(resolver => setTimeout(resolver, 40));   // deja pintar el texto del paso antes del trabajo pesado

  async function iniciarMotor(clave, obtenerEstado, etapa) {
    const THREE = window.THREE;
    const lienzo = modal.querySelector('canvas');
    let renderer;
    const pesada = !!MODELOS[clave].escena && MODELOS[clave].escena === 'planta';       // la planta entera: más ligera
    const porSoftware = gpuPorSoftware();
    etapa('Paso 1 de 3: creando el contexto gráfico (WebGL)…'); await pausa();
    try {
      // En la planta completa, si el navegador solo puede dibujar por software (sin la tarjeta gráfica) se falla enseguida en lugar de colgarse.
      renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: !pesada && !porSoftware, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: pesada });
    } catch (error) {
      avisar(pesada ? 'Tu navegador no puede usar la tarjeta gráfica para el 3D (aceleración por hardware desactivada o gráfica no compatible), y la planta completa es demasiado pesada por software. Actívala en Ajustes → Sistema, o abre un depósito o una bomba suelto, que sí van.'
        : 'Este navegador no puede mostrar gráficos 3D (WebGL no disponible).');
      etapa('No se pudo crear el contexto 3D.'); return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pesada ? 1 : 2));
    renderer.localClippingEnabled = true;
    etapa('Paso 2 de 3: construyendo equipos, tuberías y válvulas…'); await pausa();
    const threeEscena = new THREE.Scene();
    threeEscena.add(new THREE.HemisphereLight(0xdde8f5, 0x1b2330, 1.15));
    const sol = new THREE.DirectionalLight(0xffffff, 1.6); sol.position.set(30, 55, 40); threeEscena.add(sol);
    const contra = new THREE.DirectionalLight(0x8fb4ff, 0.7); contra.position.set(-40, 20, -30); threeEscena.add(contra);
    const modulo = { intercambiador: PCT.visor3dEscenaIntercambiador, bomba: PCT.visor3dEscenaBomba, planta: PCT.planta3d }[MODELOS[clave].escena] || PCT.visor3dEscena;
    const escena = modulo.crearEscena(THREE, clave);
    threeEscena.add(escena.raiz);
    if (escena.sombras) activarSombras(THREE, renderer);
    etapa('Paso 3 de 3: preparando controles y etiquetas…'); await pausa();
    const camara = new THREE.PerspectiveCamera(38, 1, 1, 500);
    const controles = new ControlesOrbita(lienzo, escena.vistaInicial, () => {});
    sesion = { THREE, renderer, camara, threeEscena, escena, controles, clave, obtenerEstado, seleccion: null, animacion: 0,
      raton: new THREE.Vector2(), rayo: new THREE.Raycaster(), seleccionables: escena.mallasSeleccionables(), etiquetas: crearEtiquetas(clave, escena),
      observador: null, alPulsar: alPulsarEscena, lento: false };
    if (porSoftware) activarModoLento('Tu navegador dibuja el 3D por software (sin la tarjeta gráfica): se ha bajado la calidad. Activa la aceleración por hardware en los ajustes del navegador (Ajustes → Sistema).');
    sesion.observador = new ResizeObserver(ajustarTamano); sesion.observador.observe(modal.querySelector('.v3d-escena'));
    lienzo.addEventListener('pointerup', sesion.alPulsar);
    ajustarTamano();
    return true;
  }

  function cerrar() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('v3d-abierto');
    if (!sesion) return;
    cancelAnimationFrame(sesion.animacion);
    sesion.observador.disconnect();
    sesion.renderer.domElement.removeEventListener('pointerup', sesion.alPulsar);
    sesion.controles.liberar();
    sesion.escena.liberar();
    sesion.renderer.dispose();
    sesion = null;
  }

  /** clave: 'TANKA', 'TANKB', 'HEAT', 'EXCH', 'BOMBA_N1', 'BOMBA_N2' o 'PLANTA'; obtenerEstado() devuelve el estado de la planta; foco: id de un captador para seleccionarlo al abrir. */
  async function abrir(clave, obtenerEstado, foco) {
    if (!MODELOS[clave]) return;
    if (sesion) cerrar();
    crearModal();
    modal.querySelector('.v3d-titulo').textContent = `Modelo 3D · ${MODELOS[clave].titulo}`;
    modal.querySelector('.v3d-panel').innerHTML = '<p>Cargando el modelo 3D…</p>';
    modal.querySelectorAll('[data-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vista === 'transparente')));
    modal.querySelectorAll('[data-opcion]').forEach(b => b.setAttribute('aria-pressed', 'true'));
    modal.querySelector('.v3d-etiquetas').hidden = false;
    avisar('');
    modal.dataset.modelo = MODELOS[clave].escena || 'deposito';
    modal.hidden = false; document.body.classList.add('v3d-abierto');
    const panel = modal.querySelector('.v3d-panel');
    const etapa = texto => { panel.innerHTML = `<p>${texto}</p>`; };
    const t0 = performance.now();
    etapa(window.THREE ? 'Preparando el modelo 3D…' : 'Descargando Three.js (la primera vez tarda un poco)…');
    const aviso = setTimeout(() => { if (!window.THREE) etapa('La descarga de Three.js tarda más de lo normal. Comprueba la conexión con el servidor (F12 → Red).'); }, 8000);
    try { await cargarThree(); }
    catch (error) { clearTimeout(aviso); avisar('No se pudo cargar el visor 3D. Comprueba la conexión con el servidor y vuelve a intentarlo.'); return; }
    clearTimeout(aviso);
    if (modal.hidden) return;                       // se cerró mientras cargaba
    const t1 = performance.now();
    try {
      if (!(await iniciarMotor(clave, obtenerEstado || (() => null), etapa))) return;
      if (modal.hidden) { modal.hidden = false; cerrar(); return; }   // se cerró mientras se creaba: se libera todo
      etapa('Primer dibujo (la tarjeta gráfica compila los materiales)…'); await pausa();
      // Compilación asíncrona de los shaders: no bloquea el navegador mientras la tarjeta gráfica trabaja.
      if (sesion.renderer.compileAsync) await sesion.renderer.compileAsync(sesion.threeEscena, sesion.camara);
      if (!sesion) return;
      sesion.escena.ponerCorte(false);
      seleccionar(foco || null);
      fotograma();
    } catch (error) {
      console.error('[visor3d]', error);
      avisar('No se pudo crear la escena 3D: ' + (error && error.message ? error.message : error));
      return;
    }
    console.info(`[visor3d] ${clave}: descarga ${Math.round(t1 - t0)} ms, escena ${Math.round(performance.now() - t1)} ms`);
  }

  function alPulsarPanel(evento) {
    const abrirOtro = evento.target.closest('button[data-abrir]');
    if (abrirOtro) { const { obtenerEstado } = sesion; abrir(abrirOtro.dataset.abrir, obtenerEstado, abrirOtro.dataset.foco || undefined); return; }
    const boton = evento.target.closest('button[data-id]');
    if (boton) seleccionar(boton.dataset.id);
  }

  // Para diagnosticar el rendimiento: llamadas de dibujo, triángulos, memoria y renderizador (consola: PCT.visor3d.info()).
  const info = () => sesion && { render: Object.assign({}, sesion.renderer.info.render), memoria: Object.assign({}, sesion.renderer.info.memory), programas: (sesion.renderer.info.programs || []).length,
    gpu: (() => { const gl = sesion.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : 'desconocido'; })() };
  PCT.visor3d = { abrir, cerrar, estaAbierto: () => !!modal && !modal.hidden, info };
})();
