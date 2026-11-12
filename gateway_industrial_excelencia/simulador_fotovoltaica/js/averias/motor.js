// Motor de averías: guarda cuáles están activas (con sus parámetros) y avisa a la simulación para que aplique o retire los efectos
// que no son un estado «de memoria» (p. ej. un fusible fundido o un disparo). Los efectos continuos (cadena abierta, diodo, ventilación…)
// los lee la física directamente con hay(id).
(function () {
  const { CATALOGO } = typeof require !== 'undefined' ? require('./catalogo.js') : window.PCT.fv.catalogoAverias;

  function crearMotorAverias(catalogo = CATALOGO) {
    const activas = new Map();                         // id → parámetros
    const oyentes = [];
    const buscar = id => catalogo.find(a => a.id === id) || null;
    const m = {};
    m.oyente = fn => oyentes.push(fn);
    const avisar = (evento, id) => oyentes.forEach(fn => fn(evento, id));

    function resolver(av, dados = {}) {
      const p = {};
      for (const [k, def] of Object.entries(av.parametros || {})) {
        const v = typeof dados[k] === 'number' && Number.isFinite(dados[k]) ? dados[k] : def.defecto;
        p[k] = Math.max(def.min, Math.min(def.max, v));
      }
      return p;
    }
    m.activar = function (id, parametros) {
      const av = buscar(id); if (!av) return false;
      const nueva = !activas.has(id);
      activas.set(id, resolver(av, parametros));
      if (nueva) avisar('activar', id);
      return true;
    };
    m.desactivar = function (id) {
      if (!activas.has(id)) return false;
      activas.delete(id); avisar('desactivar', id); return true;
    };
    m.limpiar = function () { for (const id of Array.from(activas.keys())) m.desactivar(id); };
    m.hay = id => activas.has(id);
    m.activas = () => Array.from(activas.keys());
    m.parametro = (id, nombre, defecto) => { const p = activas.get(id); return p && nombre in p ? p[nombre] : defecto; };
    m.catalogo = catalogo;
    return m;
  }

  const api = { crearMotorAverias };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { const P = (window.PCT = window.PCT || {}); (P.fv = P.fv || {}).motorAverias = api; }
})();
