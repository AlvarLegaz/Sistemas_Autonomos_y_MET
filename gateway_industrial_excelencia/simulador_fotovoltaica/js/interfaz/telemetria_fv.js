// Telemetría del modo Diagnóstico hacia el aula (comun/CONTRATO.md §8): eventos de aprendizaje en lotes (POST /api/eventos) y registro de la sesión (POST /api/registro_sesion).
// Sin DOM propio: recibe de fuera el csrf, el fetch y el sendBeacon (así se prueba con node:test). Sin aula (modo local: no hay #aula-barra ni csrf) no envía NADA y no da errores.
// Los eventos van en lotes cada pocos segundos y al cerrar la página (sendBeacon). El servidor descarta lo inválido sin tumbar el lote y no duplica por (sesión, id).
// El evento `entrego` NO se envía desde aquí: lo genera el servidor al recibir POST /api/reto/resultado (que lleva el campo `sesion` de esta misma sesión).
(function () {
  const SIM = 'fotovoltaica';
  const MAX_LOTE = 40, MAX_CARACTERES_LOTE = 20000, MAX_COLA = 600, INTERVALO_MS = 5000, REGISTRO_MAX_CARACTERES = 1048576, REGISTRO_MARGEN = 16384, TEXTO_MAX = 120;
  const VERBOS = ['inicio', 'acciono', 'midio', 'pidio_pista', 'completo', 'abandono'];     // 'entrego' lo pone el servidor
  const FORM = 'application/x-www-form-urlencoded';
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const recortar = v => String(v == null ? '' : v).slice(0, TEXTO_MAX);
  const cuerpo = campos => Object.entries(campos).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

  /** Identificador de sesión: [A-Za-z0-9_-]{8,64}; lo genera la página al cargar. */
  function idSesion(azar = Math.random) {
    let s = 's';
    while (s.length < 17) s += Math.floor(azar() * 36).toString(36);
    return s;
  }

  /**
   * Crea la telemetría. opc: { csrf() → texto | null (sin aula), enviar (fetch), baliza (navigator.sendBeacon ya enlazado), ahora() → Date, azar, simulador, sesion,
   * intervaloMs, programar (setInterval) }. API: activo(), sesion, evento(verbo, datos), vaciar({ final }), enviarRegistro(registro), alCerrar(fn), iniciar(), cerrar(), pendientes().
   * datos del evento: { reto (entero), escenario, elemento, intento, tSimS, resultado: { nota, acierto, duracionS, valor, unidad, texto } }.
   */
  function crear(opc = {}) {
    const csrf = opc.csrf || (() => null), azar = opc.azar || Math.random, ahora = opc.ahora || (() => new Date()), simulador = opc.simulador || SIM;
    const sesion = opc.sesion || idSesion(azar);
    const cierres = [];
    let cola = [], contador = 0, temporizador = null, cerrada = false;
    const activo = () => { try { const t = csrf(); return typeof t === 'string' && t !== ''; } catch (error) { return false; } };
    const enviar = opc.enviar || (typeof fetch === 'function' ? (...a) => fetch(...a) : null);
    const baliza = opc.baliza || (typeof navigator !== 'undefined' && navigator && typeof navigator.sendBeacon === 'function' ? (u, c) => navigator.sendBeacon(u, c) : null);

    function evento(verbo, datos = {}) {
      if (!VERBOS.includes(verbo) || !activo()) return false;
      const objeto = { simulador };
      if (Number.isInteger(datos.reto)) objeto.reto = datos.reto;
      if (datos.escenario) objeto.escenario = recortar(datos.escenario);
      if (datos.elemento) objeto.elemento = recortar(datos.elemento);
      const e = { id: `${verbo}_${(++contador).toString(36)}_${Math.floor(azar() * 1679616).toString(36)}`.slice(0, 40), verbo, objeto,
        contexto: { sesion, intento: Math.max(1, Math.min(999, Math.round(datos.intento) || 1)), tSimS: num(datos.tSimS) ? Math.max(0, Math.min(1e7, datos.tSimS)) : 0 }, marca: ahora().toISOString() };
      const r = datos.resultado;
      if (r && typeof r === 'object') {
        const res = {};
        if (num(r.nota)) res.nota = Math.max(0, Math.min(10, r.nota));
        if (r.acierto === 0 || r.acierto === 0.5 || r.acierto === 1) res.acierto = r.acierto;
        if (num(r.duracionS)) res.duracionS = Math.max(0, Math.min(86400, r.duracionS));
        if (num(r.valor)) res.valor = r.valor;
        if (r.unidad) res.unidad = recortar(r.unidad);
        if (r.texto) res.texto = recortar(r.texto);
        if (Object.keys(res).length) e.resultado = res;
      }
      cola.push(e);
      if (cola.length > MAX_COLA) cola = cola.slice(cola.length - MAX_COLA);
      return true;
    }

    /** Saca de la cola el siguiente lote (hasta MAX_LOTE eventos y MAX_CARACTERES_LOTE caracteres). */
    function siguienteLote() {
      const lote = []; let largo = 2;
      while (cola.length && lote.length < MAX_LOTE) {
        const t = JSON.stringify(cola[0]).length + 1;
        if (lote.length && largo + t > MAX_CARACTERES_LOTE) break;
        largo += t; lote.push(cola.shift());
      }
      return lote;
    }
    /** Envía lo pendiente. `final`: la página se cierra → sendBeacon (sin esperar respuesta). Un fallo de red devuelve el lote a la cola; el servidor no duplica por id. */
    async function vaciar({ final = false } = {}) {
      if (!activo()) { cola = []; return; }
      const token = csrf();
      while (cola.length) {
        const lote = siguienteLote(); if (!lote.length) break;
        const texto = cuerpo({ csrf: token, eventos: JSON.stringify(lote) });
        if (final && baliza) {
          let ok = false; try { ok = baliza('/api/eventos', new Blob([texto], { type: FORM })); } catch (error) { ok = false; }
          if (!ok) { cola = lote.concat(cola); return; }
        } else if (enviar) {
          try { await enviar('/api/eventos', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': FORM, Accept: 'application/json' }, body: texto }); }
          catch (error) { cola = lote.concat(cola).slice(0, MAX_COLA); return; }
        } else return;
      }
    }
    /** Sube el registro de la simulación (objeto o texto JSON) UNA vez con su límite de 1 MB. → true si se envió; false si no hay aula, no hay registro o pasa del límite. */
    async function enviarRegistro(registro) {
      if (!activo() || !registro || !enviar) return false;
      let texto; try { texto = typeof registro === 'string' ? registro : JSON.stringify(registro); } catch (error) { return false; }
      if (!texto || texto.length > REGISTRO_MAX_CARACTERES) return false;
      const c = cuerpo({ csrf: csrf(), sesion, simulador, registro: texto });
      if (c.length > REGISTRO_MAX_CARACTERES + REGISTRO_MARGEN) return false;
      try { const r = await enviar('/api/registro_sesion', { method: 'POST', credentials: 'same-origin', keepalive: c.length < 60000, headers: { 'Content-Type': FORM, Accept: 'application/json' }, body: c }); return !!(r && r.ok); }
      catch (error) { return false; }
    }
    const alCerrar = fn => { if (typeof fn === 'function') cierres.push(fn); };
    function iniciar() {
      if (temporizador !== null || !activo()) return;
      const programar = opc.programar || (typeof setInterval === 'function' ? setInterval : null);
      if (programar) temporizador = programar(() => { vaciar().catch(() => {}); }, opc.intervaloMs || INTERVALO_MS);
      if (opc.programar === undefined && typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('pagehide', () => cerrar());
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') vaciar({ final: true }).catch(() => {}); });
      }
    }
    /** La página se cierra: se avisa a quien quiera anotar algo (p. ej. «abandono» del reto en curso) y se envía lo pendiente con sendBeacon. */
    function cerrar() {
      if (cerrada) return; cerrada = true;
      for (const f of cierres) { try { f(); } catch (error) { /* un aviso roto no impide enviar */ } }
      vaciar({ final: true }).catch(() => {});
      cerrada = false;      // si la página se recupera (bfcache) vuelve a funcionar
    }
    return { activo, sesion, simulador, evento, vaciar, enviarRegistro, alCerrar, iniciar, cerrar, pendientes: () => cola.length };
  }

  const api = { SIM, VERBOS, MAX_LOTE, MAX_CARACTERES_LOTE, INTERVALO_MS, REGISTRO_MAX_CARACTERES, idSesion, crear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') (window.PCT = window.PCT || {}).fvTelemetria = api;
})();
