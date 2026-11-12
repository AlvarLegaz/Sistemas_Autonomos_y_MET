// Franja de alarmas de la planta real HTST: siempre visible bajo la barra de mando, con contador, la alarma más grave, su hora y «Reconocer».
// Criterios (ISA-18.2 / EEMUA 191, revisión UX): el nivel se distingue por FORMA además de color, se ordena por prioridad y luego por antigüedad,
// las alarmas nuevas parpadean hasta que se reconocen y los lectores de pantalla solo reciben un anuncio cuando CAMBIA el conjunto de alarmas
// (nunca un aria-live sobre una lista que se reescribe cada fracción de segundo).
(function () {
  /** critica ▲ (rojo) · alarma ◆ (naranja) · aviso ● (azul) · estado ■ (gris, solo informa). */
  const NIVELES = {
    critica: { prioridad: 0, simbolo: '▲', nombre: 'crítica' },
    alarma: { prioridad: 1, simbolo: '◆', nombre: 'alarma' },
    aviso: { prioridad: 2, simbolo: '●', nombre: 'aviso' },
    estado: { prioridad: 3, simbolo: '■', nombre: 'estado' },
  };
  const nivelDe = a => (NIVELES[a && a.nivel] ? a.nivel : 'alarma');
  const formatoReloj = s => { const t = Math.floor(s || 0); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':'); };

  /** Alarmas ordenadas: primero la más grave y, a igual gravedad, la más antigua. Cada una: { clave, codigo, tag, texto, desdeS, nivel, simbolo, hora }. */
  function ordenarAlarmas(alarmas) {
    return (alarmas || []).map(a => {
      const nivel = nivelDe(a);
      return { clave: `${a.codigo}:${a.tag}`, codigo: a.codigo, tag: a.tag, texto: `${a.codigo} · ${a.tag} · ${a.texto}`, desdeS: a.desdeS, nivel, simbolo: NIVELES[nivel].simbolo, hora: formatoReloj(a.desdeS) };
    }).sort((x, y) => NIVELES[x.nivel].prioridad - NIVELES[y.nivel].prioridad || x.desdeS - y.desdeS);
  }

  /** Lo que muestra la franja: nivel más grave, contador (sin contar las de «estado»), alarma principal y si queda alguna sin reconocer. */
  function resumenFranja(alarmas, reconocidas = new Set()) {
    const lista = Array.isArray(alarmas) && alarmas.length && alarmas[0].clave ? alarmas : ordenarAlarmas(alarmas);
    const reales = lista.filter(a => a.nivel !== 'estado');
    const principal = reales[0] || lista[0] || null;
    const porNivel = { critica: 0, alarma: 0, aviso: 0 };
    for (const a of reales) if (porNivel[a.nivel] !== undefined) porNivel[a.nivel] += 1;
    return {
      nivel: principal ? principal.nivel : 'ok', contador: reales.length, principal, resto: reales.slice(1), porNivel,
      sinReconocer: reales.some(a => !reconocidas.has(a.clave)),
      texto: !principal ? 'Sin alarmas' : reales.length > 1 ? `${principal.texto}  (y ${reales.length - 1} más)` : principal.texto,
      anuncio: !principal ? '' : `${NIVELES[principal.nivel].nombre}: ${principal.texto}`,
    };
  }
  /** Claves de las alarmas que acaban de aparecer respecto a las ya vistas (para anunciarlas una sola vez). */
  const nuevasAlarmas = (lista, vistas) => lista.filter(a => !vistas.has(a.clave));

  /* ---------- DOM ---------- */
  const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** Monta la franja en `contenedor`. opciones: { alVerLista(), alReconocer(claves) }. Devuelve { actualizar(alarmas) }. */
  function crearFranja(contenedor, opciones = {}) {
    contenedor.className = 'franja'; contenedor.setAttribute('data-nivel', 'ok');
    contenedor.innerHTML = '<span class="simbolo" aria-hidden="true">✔</span><span class="contador"></span><span class="texto"></span><span class="hora"></span>' +
      '<button type="button" class="franja-mas" aria-expanded="false" hidden></button><button type="button" class="franja-reconocer">Reconocer</button><button type="button" class="franja-lista">Ver alarmas</button>';
    // Desplegable con el resto de alarmas (la más grave sigue en la franja): así 16 alarmas no se convierten en un «y 15 más» inservible.
    const desplegable = document.createElement('ul'); desplegable.className = 'franja-desplegable'; desplegable.hidden = true; desplegable.setAttribute('aria-label', 'Resto de alarmas activas');
    // Un solo anuncio para lectores de pantalla, fuera del flujo visual; solo cambia cuando aparece una alarma nueva.
    const anuncio = document.createElement('div'); anuncio.className = 'solo-lectores'; anuncio.setAttribute('aria-live', 'polite'); anuncio.setAttribute('role', 'status');
    const anuncioCritico = document.createElement('div'); anuncioCritico.className = 'solo-lectores'; anuncioCritico.setAttribute('role', 'alert');
    contenedor.append(anuncio, anuncioCritico, desplegable);
    const q = s => contenedor.querySelector(s);
    const botonRec = q('.franja-reconocer');
    let reconocidas = new Set(), vistas = new Set(), actual = [], firma = '';
    botonRec.addEventListener('click', () => { reconocidas = new Set(actual.filter(a => a.nivel !== 'estado').map(a => a.clave)); if (opciones.alReconocer) opciones.alReconocer([...reconocidas]); pintar(); });
    q('.franja-lista').addEventListener('click', () => { if (opciones.alVerLista) opciones.alVerLista(); });
    const botonMas = q('.franja-mas');
    const cerrarDesplegable = () => { desplegable.hidden = true; botonMas.setAttribute('aria-expanded', 'false'); };
    botonMas.addEventListener('click', () => { const abrir = desplegable.hidden; desplegable.hidden = !abrir; botonMas.setAttribute('aria-expanded', String(abrir)); });
    contenedor.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !desplegable.hidden) { ev.stopPropagation(); cerrarDesplegable(); botonMas.focus(); } });
    document.addEventListener('click', ev => { if (!desplegable.hidden && !contenedor.contains(ev.target)) cerrarDesplegable(); });

    function pintar() {
      const r = resumenFranja(actual, reconocidas);
      contenedor.setAttribute('data-nivel', r.nivel);
      contenedor.classList.toggle('sin-reconocer', r.sinReconocer);
      q('.simbolo').textContent = r.principal ? r.principal.simbolo : '✔';
      q('.contador').textContent = r.contador ? `${r.contador} ${r.contador === 1 ? 'ALARMA' : 'ALARMAS'}` : 'SIN ALARMAS';
      q('.texto').textContent = r.principal ? r.principal.texto : 'La planta funciona sin alarmas.';
      const resto = r.resto || [];
      botonMas.hidden = resto.length === 0;
      botonMas.textContent = `+${resto.length} más ▾`;
      botonMas.title = `▲ ${r.porNivel.critica} críticas · ◆ ${r.porNivel.alarma} alarmas · ● ${r.porNivel.aviso} avisos`;
      desplegable.innerHTML = resto.map(a => `<li class="nivel-${a.nivel}"><span class="simbolo" aria-hidden="true">${a.simbolo}</span><span class="texto-alarma">${escapar(a.texto)}</span><span class="hora">desde ${a.hora}</span></li>`).join('');
      if (!resto.length) cerrarDesplegable();
      q('.hora').textContent = r.principal ? `desde ${r.principal.hora}` : '';
      botonRec.hidden = !r.sinReconocer; botonRec.disabled = !r.sinReconocer;
    }
    function actualizar(alarmas) {
      const lista = ordenarAlarmas(alarmas), nueva = lista.map(a => a.clave).join('|');
      actual = lista;
      reconocidas = new Set([...reconocidas].filter(c => lista.some(a => a.clave === c)));          // lo que ya no está activo deja de estar reconocido
      if (nueva !== firma) {                                                                          // solo si cambió el conjunto de alarmas
        firma = nueva;
        const nuevas = nuevasAlarmas(lista, vistas).filter(a => a.nivel !== 'estado');
        vistas = new Set(lista.map(a => a.clave));
        if (nuevas.length) { const hay = nuevas.some(a => a.nivel === 'critica'); (hay ? anuncioCritico : anuncio).textContent = `Nueva ${NIVELES[nuevas[0].nivel].nombre}: ${nuevas[0].texto}`; }
        pintar();
      }
    }
    pintar();
    return { actualizar, reconocidas: () => new Set(reconocidas) };
  }

  const api = { NIVELES, ordenarAlarmas, resumenFranja, nuevasAlarmas, formatoReloj, crearFranja, escapar };
  if (typeof module !== 'undefined') module.exports = api; else PCT.htstFranjaAlarmas = api;
})();
