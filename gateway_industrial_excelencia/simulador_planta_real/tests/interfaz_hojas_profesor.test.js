'use strict';
// Pruebas de la interfaz de la planta real: registro, calibración de lazos, enclavamientos, diagnóstico, panel del profesor y carga de códigos.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const layout = require('../js/layout.js');
const hojas = require('../js/interfaz/hoja_registro.js');
const profe = require('../js/interfaz/panel_profesor.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');

test('el registro numera, guarda el tiempo y exporta CSV con ; y comillas escapadas', () => {
  let t = 12.34;
  const r = hojas.crearRegistro(() => t);
  r.anotar('medida', 'F-001:SALIDA = 0 V', { v: 0 });
  t = 30; r.anotar('diagnostico', 'Dice "fusible"; fundido', {});
  const e = r.entradas();
  assert.deepEqual(e.map(x => x.n), [1, 2]);
  assert.equal(e[0].tiempoS, 12.3);
  const csv = r.aCsv().split('\n');
  assert.equal(csv[0], 'n;tiempo_s;tipo;texto;datos');
  assert.match(csv[2], /"Dice ""fusible""; fundido"/);
  r.limpiar();
  assert.equal(r.entradas().length, 0);
});

test('calibración: un lazo correcto, uno con deriva, hilo roto, sobreescala y fallo de escalado', () => {
  const rango = [0, 100];
  const ok = hojas.evaluarLazo({ patron: 50, mA: 12, valorScada: 50, rango });
  assert.equal(ok.ok, true); assert.ok(Math.abs(ok.mAEsperado - 12) < 1e-9);
  assert.equal(hojas.evaluarLazo({ patron: 50, mA: 12.4, valorScada: 52.5, rango }).diagnostico, 'transmisor_o_sonda');
  assert.equal(hojas.evaluarLazo({ patron: 50, mA: 0, valorScada: 0, rango }).diagnostico, 'hilo_roto');
  assert.equal(hojas.evaluarLazo({ patron: 50, mA: 21.5, valorScada: 100, rango }).diagnostico, 'sobreescala');
  assert.equal(hojas.evaluarLazo({ patron: 50, mA: 12, valorScada: 60, rango }).diagnostico, 'escalado_o_entrada_plc');
  assert.equal(hojas.mAEsperado(100, [0, 100]), 20);
});

test('se pueden calibrar los lazos analógicos del contrato, con su rango', () => {
  const lazos = hojas.lazosCalibrables(layout);
  assert.equal(lazos.length, 10);                                                          // 9 de la AI-1 + LT-101 y TT-106 en la AI-2
  assert.ok(lazos.every(l => Array.isArray(l.rango) && l.unidad));
});

test('pruebas de enclavamientos con el modelo real: paro de emergencia y fallo de TT-103 llevan a desvío', () => {
  const sim = crearSimulacion({ semilla: 1 });
  sim.ordenes.modo('PRODUCCION'); sim.ordenes.arrancar();
  for (let i = 0; i < 6000; i++) sim.paso(0.5);
  assert.equal(sim.estado().equipos['FDV-101'].posicion, 'AVANCE', 'la planta debe estar produciendo antes de la prueba');
  assert.equal(hojas.evaluarEnclavamiento('ES-001', sim.estado()).ok, false);          // todavía no se ha pulsado la seta
  assert.equal(hojas.evaluarEnclavamiento('TT-103', sim.estado()).ok, false);
  sim.averias.inyectar('AV-LAZO-ABIERTO', { tag: 'TT-103' });
  for (let i = 0; i < 40; i++) sim.paso(0.5);
  const r = hojas.evaluarEnclavamiento('TT-103', sim.estado());
  assert.equal(r.ok, true, r.detalle);
  assert.equal(sim.estado().equipos['FDV-101'].posicion, 'DESVIO');
  assert.equal(hojas.evaluarEnclavamiento('NO-EXISTE', sim.estado()).ok, false);
});

test('diagnóstico con el motor real: la acción correcta en el equipo correcto resuelve; la equivocada solo se anota', () => {
  const sim = crearSimulacion({ semilla: 1 });
  const id = sim.averias.inyectar('AV-FUSIBLE-F201');
  assert.ok(id);
  assert.match(hojas.aplicarSolucion(sim, { accion: 'sustituir', tag: 'TT-103' }).mensaje, /No se detecta ninguna avería en TT-103/);
  const mala = hojas.aplicarSolucion(sim, { accion: 'limpiar', tag: 'F-001' });
  assert.equal(mala.resuelta, false); assert.equal(mala.intentadas, 1);
  assert.equal(sim.averias.activas()[0].intentos, 1);                                   // el intento queda anotado en el motor
  const buena = hojas.aplicarSolucion(sim, { accion: 'sustituir', tag: 'F-001' });
  assert.equal(buena.resuelta, true);
  assert.equal(sim.averias.activas().length, 0);
  assert.match(hojas.aplicarSolucion({}, { accion: 'sustituir', tag: 'F-001' }).mensaje, /no está cargado/);
});

test('el panel del profesor: solo con la marca del aula, o ?profesor=1 únicamente en local', () => {
  assert.equal(profe.esProfesor({ globalProfesor: true, hostname: '192.168.99.120', search: '' }), true);
  assert.equal(profe.esProfesor({ globalProfesor: false, hostname: '192.168.99.120', search: '?profesor=1' }), false);   // en el aula la dirección no vale
  assert.equal(profe.esProfesor({ globalProfesor: false, hostname: 'localhost', search: '?profesor=1' }), true);
  assert.equal(profe.esProfesor({ globalProfesor: false, hostname: 'localhost', search: '' }), false);
  assert.equal(profe.esProfesor({}), false);
});

test('enlace y código de avería: se generan, se leen de la dirección y se cargan en otra simulación', () => {
  const origen = crearSimulacion({ semilla: 1 });
  origen.averias.inyectar('AV-PT100-ABIERTA', { tag: 'TT-102' });
  const codigo = origen.averias.codigo();
  assert.match(codigo, /^HTST-/);
  const enlace = profe.enlaceAveria('https://aula/planta-real/?x=1#y', codigo);
  assert.equal(enlace, `https://aula/planta-real/?averia=${encodeURIComponent(codigo)}`);
  assert.equal(profe.codigoDeDireccion(new URL(enlace).search), codigo);
  assert.equal(profe.codigoDeDireccion(''), null);
  const destino = crearSimulacion({ semilla: 1 });
  assert.equal(profe.cargarCodigo(destino, codigo).ok, true);
  assert.equal(destino.averias.activas()[0].id, 'AV-PT100-ABIERTA');
  const mal = profe.cargarCodigo(destino, 'HTST-zzzz');
  assert.equal(mal.ok, false); assert.match(mal.mensaje, /Código no válido/);
  assert.equal(profe.cargarCodigo({}, codigo).ok, false);
});

test('el catálogo se agrupa por capa y ordena por dificultad', () => {
  const grupos = profe.agruparPorCapa(crearSimulacion({ semilla: 1 }).averias.listar());
  assert.ok(grupos.length >= 5);
  assert.equal(grupos.flatMap(g => g.averias).length, 16);
  for (const g of grupos) { const d = g.averias.map(a => a.dificultad); assert.deepEqual(d, d.slice().sort((x, y) => x - y)); }
  assert.match(profe.dificultadTexto(3), /difícil/);
  assert.equal(profe.nombreCapa('lazo'), 'Lazos 4-20 mA');
});
