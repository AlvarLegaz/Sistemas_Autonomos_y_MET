// Cuaderno de medidas del alumno: cada medida que hace con un instrumento (multímetro, pinza, megóhmetro, trazador de curvas, cámara termográfica) se apunta sola
// con la hora simulada, el instrumento, los puntos y el valor. El alumno puede añadirle una nota, marcarla como evidencia de su diagnóstico y borrarla.
// Sin DOM: se prueba con node:test (tests/interfaz_instrumentos.test.js). Lo dibuja panel_instrumentos.js y lo lee la hoja de diagnóstico.
(function () {
  const INSTRUMENTOS = { multimetro: 'Multímetro', pinza: 'Pinza', megohmetro: 'Megóhmetro', trazadorIV: 'Trazador I-V', termografia: 'Cámara térmica' };
  const MAX_MEDIDAS = 200, MAX_NOTA = 160;

  /** Firma de una medida: mismo instrumento, modo y puntos (sin importar el orden de las puntas) → misma firma. Sirve para no repetir y para comparar con las medidas clave. */
  function firma(m) {
    const puntos = (m.puntos || []).map(String).slice().sort().join('|');
    return `${m.instrumento}${m.modo ? ':' + m.modo : ''}:${puntos}`;
  }

  /**
   * Crea un cuaderno vacío. API: anadir(medida) → entrada | null, anotar(id, texto), marcar(id, bool), borrar(id), limpiar(), lista(), evidencias(), total, alCambiar(fn).
   * medida: { t /* s simulados *\/, hora /* texto «21 jun · 09:30» *\/, instrumento, modo, modoTexto, puntos: [ids], valor, unidad, texto, peligro?, valida? }.
   * `total` cuenta TODAS las medidas hechas (también las borradas): es lo que se envía al aula como número de medidas.
   */
  function crearCuaderno() {
    let entradas = [], siguiente = 1, total = 0;
    const oyentes = [];
    const avisar = () => { for (const f of oyentes) { try { f(); } catch (error) { /* un oyente roto no impide medir */ } } };
    const buscar = id => entradas.find(e => e.id === Number(id)) || null;
    return {
      anadir(m) {
        if (!m || !m.instrumento) return null;
        const f = firma(m), ultima = entradas[entradas.length - 1];
        // la misma medida repetida sin moverse (misma firma y mismo texto) no llena el cuaderno: se actualiza la hora
        if (ultima && ultima.firma === f && ultima.texto === m.texto) { ultima.t = m.t; ultima.hora = m.hora; avisar(); return ultima; }
        const e = { id: siguiente++, t: Number.isFinite(m.t) ? m.t : 0, hora: m.hora || '—', instrumento: m.instrumento, modo: m.modo || '', puntos: (m.puntos || []).map(String), valor: Number.isFinite(m.valor) ? m.valor : null,
          unidad: m.unidad || '', texto: String(m.texto || ''), peligro: !!m.peligro, valida: m.valida !== false && !m.peligro, modoTexto: m.modoTexto || '', nota: '', evidencia: false, firma: f };
        entradas.push(e); total++;
        if (entradas.length > MAX_MEDIDAS) entradas = entradas.slice(entradas.length - MAX_MEDIDAS);
        avisar(); return e;
      },
      anotar(id, texto) { const e = buscar(id); if (!e) return false; e.nota = String(texto || '').slice(0, MAX_NOTA); avisar(); return true; },
      marcar(id, si) { const e = buscar(id); if (!e) return false; e.evidencia = !!si; avisar(); return true; },
      borrar(id) { const n = entradas.length; entradas = entradas.filter(e => e.id !== Number(id)); if (entradas.length !== n) avisar(); return entradas.length !== n; },
      limpiar() { entradas = []; total = 0; siguiente = 1; avisar(); },
      lista: () => entradas.slice(),
      evidencias: () => entradas.filter(e => e.evidencia),
      get total() { return total; },
      alCambiar(fn) { oyentes.push(fn); },
    };
  }

  /** Línea de texto de una entrada: «09:30 · Multímetro V⎓ · F-101.1 ↔ F-101.2 · 36,2 V». */
  function textoEntrada(e) {
    const hora = String(e.hora || '').split('·').pop().trim();
    return [hora, `${INSTRUMENTOS[e.instrumento] || e.instrumento}${e.modoTexto || e.modo ? ' ' + (e.modoTexto || e.modo) : ''}`, (e.puntos || []).join(' ↔ '), e.texto].filter(Boolean).join(' · ');
  }

  const api = { INSTRUMENTOS, MAX_MEDIDAS, MAX_NOTA, firma, crearCuaderno, textoEntrada };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvCuaderno = api;
})();
