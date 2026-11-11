'use strict';
// Coherencia del catálogo y barrido de las 16 averías: cada una produce sus síntomas y se resuelve con su solución.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const { CATALOGO } = require('../js/averias/catalogo.js');
const { TEXTOS } = require('../js/plc/alarmas.js');
const { PUNTOS } = require('../js/modelo/medidas.js');
const { crearSimulacion, plantaEnProduccion, conCodigo, media } = require('./modelo_ayuda.js');

const ACCIONES = ['sustituir', 'reparar', 'ajustar', 'limpiar', 'recalibrar'];
const EFECTOS_3D = ['resaltar_rojo', 'cable_cortado', 'goteo', 'led_apagado', 'contactos_cerrados'];
const sust = (texto, tag) => texto.replace('{tag}', tag);
const tagsPosibles = a => (a.parametros.tag ? a.parametros.tag.opciones : a.equipos);

test('catálogo: 16 averías con identificador único y todos los campos del esquema', () => {
  assert.equal(CATALOGO.length, 16);
  assert.equal(new Set(CATALOGO.map(a => a.id)).size, 16);
  for (const a of CATALOGO) {
    for (const campo of ['id', 'nombre', 'capa', 'equipos', 'dificultad', 'parametros', 'efectos', 'sintomasScada', 'sintomas3d', 'diagnostico', 'solucion', 'alarmasEsperadas', 'pistas']) assert.ok(campo in a, `${a.id}: falta ${campo}`);
    assert.ok([1, 2, 3].includes(a.dificultad)); assert.ok(a.sintomasScada.length > 0, a.id); assert.ok(a.diagnostico.length > 0, a.id);
    assert.ok(ACCIONES.includes(a.solucion.accion), a.id); assert.ok(a.pistas.length > 0, a.id);
  }
});

test('catálogo: los equipos, las alarmas, los efectos 3D y los puntos de medida del diagnóstico existen', () => {
  const tags = new Set(layout.EQUIPOS.map(e => e.tag)), puntos = new Set(PUNTOS.map(p => p.id));
  for (const a of CATALOGO) {
    for (const t of a.equipos) assert.ok(tags.has(t), `${a.id}: equipo ${t}`);
    for (const c of a.alarmasEsperadas) assert.ok(TEXTOS[c], `${a.id}: alarma ${c}`);
    for (const t of tagsPosibles(a)) {
      assert.ok(tags.has(t), `${a.id}: tag ${t}`);
      for (const s of a.sintomas3d) { assert.ok(EFECTOS_3D.includes(s.efecto), `${a.id}: ${s.efecto}`); assert.ok(tags.has(sust(s.tag, t)), `${a.id}: 3D ${s.tag}`); }
      for (const d of a.diagnostico) assert.ok(puntos.has(sust(d.punto, t)), `${a.id}: punto de medida ${sust(d.punto, t)}`);
    }
    if (a.solucion.tag) assert.ok(tags.has(a.solucion.tag), `${a.id}: solución en ${a.solucion.tag}`);
    for (const p of Object.values(a.parametros)) assert.ok(p.tipo === 'opcion' ? p.opciones.includes(p.defecto) : p.defecto >= p.min && p.defecto <= p.max, a.id);
  }
});

// ---- barrido: síntomas y solución de cada avería ----
const rearmar = (sim, esperaS = 0) => { sim.paso(esperaS); sim.ordenes.pulsador('PB-001'); sim.paso(3); };
const ai = (sim, tag) => sim.estado().instrumentos[tag];
const fdv = sim => sim.estado().equipos['FDV-101'].posicion;

const ESCENARIOS = {
  'AV-LAZO-ABIERTO': { desde: 'produccion', parametros: { tag: 'TT-103' }, espera: 20, solucion: { accion: 'reparar', tag: 'TT-103' },
    sintomas(s) { assert.equal(ai(s, 'TT-103').mA, 0); assert.equal(ai(s, 'TT-103').calidad, 'ABIERTO'); assert.ok(conCodigo(s, 'A101', 'TT-103')); assert.equal(fdv(s), 'DESVIO'); },
    curada(s) { s.paso(5); assert.ok(ai(s, 'TT-103').mA > 4); assert.equal(conCodigo(s, 'A101'), false); } },
  'AV-PT100-ABIERTA': { desde: 'produccion', parametros: { tag: 'TT-103' }, espera: 20, solucion: { accion: 'sustituir', tag: 'TT-103' },
    sintomas(s) { assert.ok(ai(s, 'TT-103').mA > 21); assert.ok(conCodigo(s, 'A102', 'TT-103')); assert.equal(fdv(s), 'DESVIO'); },
    curada(s) { s.paso(5); assert.ok(ai(s, 'TT-103').mA < 21); assert.equal(conCodigo(s, 'A102'), false); } },
  'AV-PT100-CORTO': { desde: 'produccion', parametros: { tag: 'TT-103' }, espera: 20, solucion: { accion: 'sustituir', tag: 'TT-103' },
    sintomas(s) { assert.ok(ai(s, 'TT-103').mA < 3.6); assert.ok(conCodigo(s, 'A102', 'TT-103')); assert.equal(fdv(s), 'DESVIO'); },
    curada(s) { s.paso(5); assert.ok(ai(s, 'TT-103').mA > 4); assert.equal(conCodigo(s, 'A102'), false); } },
  'AV-DERIVA-TT103': { desde: 'produccion', parametros: { offsetC: 3 }, espera: 900, solucion: { accion: 'recalibrar', tag: 'TT-103' },
    sintomas(s) {                                                                    // sin alarma, pero el producto sale sin pasteurizar
      const e = s.estado(); assert.equal(s.alarmas().length, 0); assert.equal(e.modo, 'PRODUCCION'); assert.equal(fdv(s), 'AVANCE');
      assert.ok(ai(s, 'TT-103').valorPLC >= 72.5 && e.proceso.temperaturas.salidaTubo < 72, `real ${e.proceso.temperaturas.salidaTubo.toFixed(2)}`);
      assert.equal(e.proceso.pasteurizadoReal, false); assert.ok(e.contadores.noConformeL > 10);
      const t102 = e.proceso.temperaturas.trasRegeneracion, t103 = e.proceso.temperaturas.salidaTubo;
      assert.ok(t103 - t102 < 10, 'el balance de temperaturas delata la deriva');
    },
    curada(s) { s.paso(900); assert.equal(s.estado().proceso.pasteurizadoReal, true); } },
  'AV-RUIDO-4-20': { desde: 'produccion', parametros: { tag: 'FT-101', amplitudMA: 8 }, espera: 0, solucion: { accion: 'reparar', tag: 'FT-101' },
    sintomas(s) {
      const mA = [], cal = new Set(); let a102 = false;
      for (let t = 0; t < 120; t++) { s.paso(1); mA.push(ai(s, 'FT-101').mA); cal.add(ai(s, 'FT-101').calidad); if (conCodigo(s, 'A102', 'FT-101')) a102 = true; }
      assert.ok(Math.max(...mA) - Math.min(...mA) > 6); assert.ok(a102, 'A102 intermitente'); assert.ok(cal.has('RUIDO'));
      assert.ok(Math.abs(media(mA) - 14.6) < 2.5, 'la media del multímetro parece normal');
    },
    curada(s) { s.paso(10); assert.ok(Math.abs(ai(s, 'FT-101').mA - 14.6) < 0.5); assert.equal(conCodigo(s, 'A102'), false); } },
  'AV-FUSIBLE-F201': { desde: 'produccion', parametros: {}, espera: 5, solucion: { accion: 'sustituir', tag: 'F-201' }, rearme: true,
    sintomas(s) { for (const t of ['TT-101', 'TT-103', 'FT-101']) assert.equal(ai(s, t).mA, 0); assert.ok(conCodigo(s, 'A140')); assert.equal(s.estado().plc.paro, true); assert.equal(fdv(s), 'DESVIO'); },
    curada(s) { assert.ok(ai(s, 'TT-103').mA > 4); assert.equal(conCodigo(s, 'A140'), false); assert.equal(s.estado().plc.paro, false); } },
  'AV-FUENTE-24V': { desde: 'produccion', parametros: {}, espera: 5, solucion: { accion: 'sustituir', tag: 'PS-001' }, rearme: true,
    sintomas(s) { assert.ok(ai(s, 'TT-103').mA > 21); assert.ok(conCodigo(s, 'A140')); assert.equal(s.estado().plc.paro, true); assert.equal(s.estado().equipos['PS-001'].tensionV, 18); },
    curada(s) { assert.ok(ai(s, 'TT-103').mA < 21); assert.equal(conCodigo(s, 'A140'), false); } },
  'AV-KM-PEGADO': { desde: 'produccion', parametros: { tag: 'KM-201' }, espera: 0, solucion: { accion: 'sustituir', tag: 'KM-201' },
    sintomas(s) {                                                                    // se para la planta y el calentador sigue alimentado
      s.ordenes.parar(); s.paso(30);
      const e = s.estado(), t0 = e.proceso.temperaturas.aguaCaliente;
      assert.equal(e.salidasPLC.DO['KM-201'], 0); assert.equal(e.equipos['KM-201'].cerrado, true); assert.ok(conCodigo(s, 'A130', 'KM-201'));
      s.paso(300); assert.ok(s.estado().proceso.temperaturas.aguaCaliente > t0 + 10, 'la temperatura sube sin control');
      s.paso(600); assert.equal(s.estado().equipos['TSH-101'].abierto, true); assert.ok(conCodigo(s, 'A170'));
    },
    curada(s) { s.paso(5); assert.equal(s.estado().equipos['KM-201'].cerrado, false); assert.equal(conCodigo(s, 'A130'), false); } },
  'AV-KM-NO-CIERRA': { desde: 'inicio', parametros: { tag: 'KM-102' }, espera: 120, solucion: { accion: 'sustituir', tag: 'KM-102' },
    sintomas(s) { assert.ok(conCodigo(s, 'A130', 'KM-102')); assert.equal(s.estado().equipos['P-102'].marcha, false); assert.ok(s.estado().proceso.temperaturas.aguaCaliente < 30, 'la temperatura no sube'); },
    curada(s) { s.paso(60); assert.equal(s.estado().equipos['P-102'].marcha, true); assert.equal(conCodigo(s, 'A130'), false); } },
  'AV-BOBINA-ABIERTA': { desde: 'inicio', parametros: {}, espera: 60, solucion: { accion: 'sustituir', tag: 'SV-101' }, rearme: true, rearrancar: true,
    sintomas(s) { assert.ok(conCodigo(s, 'A120', 'FDV-101')); assert.equal(s.estado().plc.paro, true); assert.notEqual(fdv(s), 'AVANCE'); assert.equal(s.estado().equipos['SV-101'].bobinaOhm, Infinity); },
    curada(s) { s.paso(180); assert.equal(conCodigo(s, 'A120'), false); assert.equal(fdv(s), 'AVANCE'); } },
  'AV-FDV-ATASCADA': { desde: 'inicio-antes', parametros: {}, espera: 10, solucion: { accion: 'reparar', tag: 'FDV-101' }, rearme: true,
    sintomas(s) { s.ordenes.arrancar(); s.paso(10); assert.ok(conCodigo(s, 'A120', 'FDV-101')); assert.equal(s.estado().plc.paro, true); assert.equal(s.estado().salidasPLC.DO['P-101'], 0); assert.equal(fdv(s), 'AVANCE'); },
    curada(s) { s.paso(5); assert.equal(conCodigo(s, 'A120'), false); assert.equal(s.estado().plc.paro, false); } },
  'AV-AIRE-BAJO': { desde: 'inicio', parametros: {}, espera: 120, solucion: { accion: 'reparar', tag: 'FRL-101' },
    sintomas(s) { assert.ok(conCodigo(s, 'A160', 'PSL-201')); assert.equal(s.senales().DI['PSL-201'], 0); assert.equal(fdv(s), 'DESVIO'); assert.equal(s.estado().salidasPLC.DO['SV-101'], 0); assert.notEqual(s.estado().modo, 'PRODUCCION'); },
    curada(s) { s.paso(120); assert.equal(conCodigo(s, 'A160'), false); assert.equal(fdv(s), 'AVANCE'); } },
  'AV-VFD-SOBRETEMP': { desde: 'inicio', parametros: {}, espera: 400, solucion: { accion: 'limpiar', tag: 'VFD-101' }, rearme: true, esperaRearme: 400,
    sintomas(s) { const e = s.estado(); assert.ok(conCodigo(s, 'A150', 'VFD-101')); assert.equal(e.equipos['P-101'].fallo, true); assert.ok(e.equipos['P-101'].temperaturaDisipadorC >= 80); assert.ok(e.proceso.caudalLh < 5); },
    curada(s) { assert.equal(conCodigo(s, 'A150'), false); assert.equal(s.estado().equipos['P-101'].fallo, false); } },
  'AV-PLACA-FUGA': { desde: 'inicio', parametros: {}, espera: 120, solucion: { accion: 'sustituir', tag: 'HX-101' },
    sintomas(s) { const P = s.estado().proceso.presiones; assert.ok(conCodigo(s, 'A110', 'HX-101')); assert.ok(P.pasteurizadoBar - P.crudoBar < 0.07); assert.notEqual(fdv(s), 'AVANCE'); assert.notEqual(s.estado().modo, 'PRODUCCION'); },
    curada(s) { s.paso(120); assert.equal(conCodigo(s, 'A110'), false); assert.equal(fdv(s), 'AVANCE'); } },
  'AV-FILTRO-OBSTRUIDO': { desde: 'inicio', parametros: {}, espera: 60, solucion: { accion: 'limpiar', tag: 'FLT-101' },
    sintomas(s) { const e = s.estado(); assert.ok(e.proceso.caudalLh < 1300, `${e.proceso.caudalLh.toFixed(0)} L/h`); assert.ok(e.equipos['P-101'].velocidadPct > 70); assert.ok(e.proceso.presiones.crudoBar < 1.1); },
    curada(s) { s.paso(30); assert.ok(s.estado().proceso.caudalLh > 1900); } },
  'AV-TSH-DISPARADO': { desde: 'inicio', parametros: {}, espera: 30, solucion: { accion: 'sustituir', tag: 'TSH-101' }, rearme: true,
    sintomas(s) { assert.ok(conCodigo(s, 'A170', 'TSH-101')); assert.equal(s.estado().plc.paro, true); s.paso(60); assert.ok(s.estado().proceso.temperaturas.aguaCaliente < 21); assert.equal(s.estado().equipos['TSH-101'].abierto, true); },
    curada(s) { assert.equal(conCodigo(s, 'A170'), false); assert.equal(s.estado().plc.paro, false); } },
};

test('hay un escenario por cada avería del catálogo', () => {
  assert.deepEqual(Object.keys(ESCENARIOS).sort(), CATALOGO.map(a => a.id).sort());
});

for (const [id, esc] of Object.entries(ESCENARIOS)) {
  test(`${id}: produce sus síntomas, se diagnostica y se resuelve con su solución`, () => {
    let sim;
    if (esc.desde === 'produccion') sim = plantaEnProduccion();
    else { sim = crearSimulacion(); if (esc.desde === 'inicio') sim.ordenes.arrancar(); }
    const instancia = sim.averias.inyectar(id, esc.parametros);
    assert.ok(instancia, sim.averias.ultimoMotivoRechazo());
    sim.paso(esc.espera);
    esc.sintomas(sim);
    assert.equal(sim.estado().averiasActivas.length, 1);                              // la avería aparece en el estado para el 3D
    // La solución equivocada no la quita; la correcta sí
    const mal = sim.averias.reparar(instancia, { accion: 'ajustar', tag: 'QE-001' });
    assert.equal(mal.ok, false); assert.equal(sim.averias.activas().length, 1);
    const bien = sim.averias.reparar(instancia, esc.solucion);
    assert.equal(bien.ok, true, JSON.stringify(bien));
    assert.equal(sim.averias.activas().length, 0);
    if (esc.rearme) { sim.paso(esc.esperaRearme || 5); sim.ordenes.pulsador('PB-001'); sim.paso(3); }
    if (esc.rearrancar) sim.ordenes.arrancar();
    esc.curada(sim);
  });
}
