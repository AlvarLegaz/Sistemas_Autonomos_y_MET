// Motor de averías: guarda las averías activas y las aplica entre las capas de la simulación (ARQUITECTURA.md §4 y §6.2).
//   proceso → instrumentos [+ avería de sensor/lazo] → PLC → salidas → actuadores [+ avería de actuador/potencia] → proceso [+ fugas, obstrucciones]
// El profesor las inyecta y quita; el alumno las "repara" con una acción (sustituir, limpiar…) sobre un equipo, y solo la correcta la quita.
(function () {
  const layout = typeof require !== 'undefined' ? require('../layout.js') : PCT.htstLayout;
  const { CONSTANTES: C } = typeof require !== 'undefined' ? require('../configuracion/constantes.js') : PCT.htstConstantes;
  const calidad = typeof require !== 'undefined' ? require('../plc/calidad_senal.js') : PCT.htstCalidadSenal;
  const { CATALOGO } = typeof require !== 'undefined' ? require('./catalogo.js') : PCT.htstCatalogo;

  const sustituir = (texto, valores) => (typeof texto === 'string' ? texto.replace(/\{(\w+)\}/g, (m, k) => (valores[k] != null ? valores[k] : m)) : texto);
  const limitar = (v, min, max) => Math.max(min, Math.min(max, v));
  const CAPAS_DE_LAZO = ['sensor', 'lazo'];
  const hex = texto => Array.from(encodeURIComponent(texto)).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const deHex = h => decodeURIComponent(h.match(/../g).map(p => String.fromCharCode(parseInt(p, 16))).join(''));
  const suma = texto => Array.from(texto).reduce((s, c) => (s + c.charCodeAt(0)) % 256, 0).toString(16).padStart(2, '0');

  function crearMotorAverias(catalogo = CATALOGO, { semilla = 1 } = {}) {
    const instancias = [];
    let contador = 0, ahoraS = 0, ultimoRechazo = null;

    const buscarAveria = id => catalogo.find(a => a.id === id) || null;
    const buscarInstancia = (id, tag) => instancias.find(i => i.id === id && (tag == null || i.tags.includes(tag))) || null;

    /** Valida y completa los parámetros de una avería: numéricos limitados al rango, opciones dentro de la lista. */
    function resolverParametros(averia, dados = {}) {
      const valores = {};
      for (const [nombre, def] of Object.entries(averia.parametros || {})) {
        const v = dados[nombre] !== undefined ? dados[nombre] : def.defecto;
        if (def.tipo === 'opcion') {
          if (!def.opciones.includes(v)) return { ok: false, motivo: `El parámetro ${nombre} debe ser uno de: ${def.opciones.join(', ')}` };
          valores[nombre] = v;
        } else {
          if (typeof v !== 'number' || Number.isNaN(v)) return { ok: false, motivo: `El parámetro ${nombre} debe ser un número` };
          valores[nombre] = limitar(v, def.min, def.max);
        }
      }
      return { ok: true, valores };
    }

    const tagsDe = (averia, valores) => (valores.tag ? [valores.tag] : averia.equipos.slice());

    function puedeInyectar(id, parametros) {
      const averia = buscarAveria(id);
      if (!averia) return { ok: false, motivo: `No existe la avería ${id}` };
      const r = resolverParametros(averia, parametros);
      if (!r.ok) return r;
      const tags = tagsDe(averia, r.valores);
      for (const otra of instancias) {
        const dOtra = buscarAveria(otra.id);
        if (otra.id === id && otra.tags.some(t => tags.includes(t))) return { ok: false, motivo: `${id} ya está activa en ${otra.tags.join(', ')}` };
        if (CAPAS_DE_LAZO.includes(averia.capa) && CAPAS_DE_LAZO.includes(dOtra.capa) && otra.tags.some(t => tags.includes(t))) {
          return { ok: false, motivo: `El lazo ${tags[0]} ya tiene una avería (${otra.id}): dos a la vez serían incoherentes` };
        }
        if (averia.capa === 'alimentacion' && dOtra.capa === 'alimentacion') return { ok: false, motivo: `Ya hay una avería de alimentación (${otra.id})` };
      }
      return { ok: true, averia, valores: r.valores, tags };
    }

    /** Inyecta una avería. Devuelve el id de la instancia, o null si es incoherente con otra activa (ver ultimoMotivoRechazo). */
    function inyectar(id, parametros) {
      const p = puedeInyectar(id, parametros);
      if (!p.ok) { ultimoRechazo = p.motivo; return null; }
      ultimoRechazo = null;
      const instancia = `I${++contador}`;
      instancias.push({ instancia, id, tags: p.tags, parametros: p.valores, desdeS: ahoraS, intentos: [] });
      return instancia;
    }

    function quitar(instancia) {
      const i = instancias.findIndex(x => x.instancia === instancia);
      if (i < 0) return false;
      instancias.splice(i, 1);
      return true;
    }

    /** El alumno ejecuta la solución. Si la acción y el equipo son los correctos, la avería desaparece; si no, se anota el intento. */
    function reparar(instancia, { accion, tag } = {}) {
      const inst = instancias.find(x => x.instancia === instancia);
      if (!inst) return { ok: false, motivo: 'No existe esa avería' };
      const averia = buscarAveria(inst.id);
      const tagCorrecto = averia.solucion.tag ? [averia.solucion.tag] : inst.tags;
      const correcta = accion === averia.solucion.accion && tagCorrecto.includes(tag);
      inst.intentos.push({ accion, tag, correcta, tS: ahoraS });
      if (correcta) { quitar(instancia); return { ok: true, texto: averia.solucion.texto }; }
      return { ok: false, motivo: accion === averia.solucion.accion ? `${tag} no es el equipo averiado` : 'Esa acción no resuelve esta avería', intentos: inst.intentos.length };
    }

    const activas = () => instancias.map(i => ({ instancia: i.instancia, id: i.id, tags: i.tags.slice(), parametros: Object.assign({}, i.parametros),
      vidaS: ahoraS - i.desdeS, intentos: i.intentos.length, intentosDetalle: i.intentos.slice() }));

    const listar = () => catalogo.map(a => Object.assign({}, a, { activa: instancias.some(i => i.id === a.id) }));
    const hay = (id, tag) => !!buscarInstancia(id, tag);
    const parametrosDe = (id, tag) => { const i = buscarInstancia(id, tag); return i ? i.parametros : null; };

    // ---------- ganchos que usa la simulación ----------

    /** Sensor / lazo: dado el valor real del proceso y los mA que daría un lazo sano, devuelve los mA reales y la calidad. */
    function alLeerInstrumento(tag, valorProceso, tS, mABase) {
      const senal = layout.senal(tag).find(s => s.tipo === 'AI');
      const [min, max] = senal ? senal.rango : [0, 100];
      let mA = mABase, cal = 'OK';
      for (const inst of instancias) {
        if (!inst.tags.includes(tag)) continue;
        switch (inst.id) {
          case 'AV-LAZO-ABIERTO': mA = 0; cal = 'ABIERTO'; break;
          case 'AV-PT100-ABIERTA': mA = 21.5; cal = 'CORTO'; break;           // burnout hacia arriba: el PLC lo ve como sobreescala (A102)
          case 'AV-PT100-CORTO': mA = 3.55; cal = 'CORTO'; break;             // el transmisor da su lectura mínima; el PLC lo clasifica como corto de sonda (A102)
          case 'AV-DERIVA-TT103': mA = layout.aMilisamperios(valorProceso + inst.parametros.offsetC, min, max); cal = 'DERIVA'; break;
          case 'AV-RUIDO-4-20': {
            const canal = layout.SENALES.findIndex(s => s.tag === tag);
            mA = limitar(mABase + inst.parametros.amplitudMA * calidad.ruido(semilla, tS, canal), 0, 24); cal = 'RUIDO'; break;
          }
          default: break;
        }
      }
      return { mA, calidad: cal };
    }

    /** Actuador / potencia: dada la orden del PLC a un equipo (0/1), devuelve lo que hace de verdad. */
    function alAccionarSalida(tag, ordenPLC) {
      for (const inst of instancias) {
        if (!inst.tags.includes(tag)) continue;
        if (inst.id === 'AV-KM-PEGADO') return 1;            // contactos soldados: conduce siempre
        if (inst.id === 'AV-KM-NO-CIERRA') return 0;         // no cierra nunca
        if (inst.id === 'AV-BOBINA-ABIERTA') return 0;       // la bobina no se energiza
      }
      return ordenPLC ? 1 : 0;
    }

    /** Proceso: fugas, obstrucciones, aire, ventilador, vástago atascado y falso contacto. Idempotente: lo que no está averiado se deja normal. */
    function alCalcularProceso(estado) {
      const eq = estado.equipos;
      const p = (id, nombre, normal) => { const i = instancias.find(x => x.id === id); return i ? i.parametros[nombre] : normal; };
      eq['HX-101'].fugaPlaca01 = p('AV-PLACA-FUGA', 'fuga01', 0);
      eq['FLT-101'].obstruccion01 = p('AV-FILTRO-OBSTRUIDO', 'obstruccion01', 0);
      eq['FRL-501'].presionBar = p('AV-AIRE-BAJO', 'presionBar', C.aire.presionNominalBar);
      eq['P-101'].ventiladorOK = !hay('AV-VFD-SOBRETEMP');
      eq['FDV-101'].atascada = hay('AV-FDV-ATASCADA');
      eq['TSH-201'].falsoContacto = hay('AV-TSH-DISPARADO');
      for (const tag of ['KM-203', 'KM-201', 'KM-202']) eq[tag].pegado = hay('AV-KM-PEGADO', tag);
    }

    /** Alimentación: tensión de la fuente y estado del fusible F-001 (el que alimenta los lazos y las entradas digitales). */
    function alimentacion() {
      if (hay('AV-FUENTE-24V')) return { v24: C.electrico.tensionFuenteDegradadaV, fusibleF201: true };
      if (hay('AV-FUSIBLE-F201')) return { v24: C.electrico.tension24V, fusibleF201: false };
      return { v24: C.electrico.tension24V, fusibleF201: true };
    }

    // ---------- compartir una avería sin servidor ----------

    /** Código de las averías activas, p. ej. 'HTST-5b5b22...' (hexadecimal + 2 caracteres de control). */
    function codigo() {
      const cuerpo = hex(JSON.stringify(instancias.map(i => [i.id, i.parametros])));
      return `HTST-${cuerpo}${suma(cuerpo)}`;
    }

    /** Carga las averías de un código (sustituye a las activas). Devuelve { ok, instancias } o { ok: false, motivo }. */
    function desdeCodigo(texto) {
      const m = /^HTST-([0-9a-f]*)([0-9a-f]{2})$/i.exec(String(texto || '').trim());
      if (!m || suma(m[1]) !== m[2].toLowerCase()) return { ok: false, motivo: 'Código no válido' };
      let lista;
      try { lista = JSON.parse(deHex(m[1])); } catch (e) { return { ok: false, motivo: 'Código no válido' }; }
      // Cada elemento debe ser [id de avería, parámetros]: se comprueba todo ANTES de tocar las averías activas.
      const bienFormado = e => Array.isArray(e) && typeof e[0] === 'string' && (e[1] === undefined || (e[1] !== null && typeof e[1] === 'object' && !Array.isArray(e[1])));
      if (!Array.isArray(lista) || !lista.every(bienFormado)) return { ok: false, motivo: 'Código no válido' };
      const previas = instancias.splice(0, instancias.length);
      const creadas = [];
      try {
        for (const [id, parametros] of lista) {
          const r = inyectar(id, parametros);
          if (r === null) { instancias.splice(0, instancias.length, ...previas); return { ok: false, motivo: ultimoRechazo }; }
          creadas.push(r);
        }
      } catch (error) {
        instancias.splice(0, instancias.length, ...previas);       // ante cualquier fallo se conservan las averías que había
        return { ok: false, motivo: 'Código no válido' };
      }
      return { ok: true, instancias: creadas };
    }

    return { listar, inyectar, quitar, reparar, activas, puedeInyectar, hay, parametrosDe, reloj: tS => { ahoraS = tS; },
      ultimoMotivoRechazo: () => ultimoRechazo, alLeerInstrumento, alAccionarSalida, alCalcularProceso, alimentacion, codigo, desdeCodigo, buscarAveria,
      resolverTags: (id, parametros) => { const a = buscarAveria(id); const r = a && resolverParametros(a, parametros); return r && r.ok ? tagsDe(a, r.valores) : null; }, sustituirTags: sustituir };
  }

  const api = { crearMotorAverias, CATALOGO };
  if (typeof module !== 'undefined') module.exports = api; else { window.PCT = window.PCT || {}; PCT.htstAverias = api; }
})();
