// Pantalla sencilla de la planta real: qué hace un clic izquierdo, cómo se llenan los dos depósitos y el texto de estado. Se prueba la parte pura de pagina_simple.js
// y, con la simulación real, que el llenado sube los dos niveles y cierra cada válvula al llegar.
const test = require('node:test');
const assert = require('node:assert/strict');
const simple = require('../js/interfaz/pagina_simple.js');
const { crearSimulacion } = require('../js/modelo/simulacion.js');
const layout = require('../js/layout.js');

const enManual = () => { const sim = crearSimulacion({ semilla: 1 }); sim.ordenes.modo('MANUAL'); sim.paso(0.5); sim.paso(0.5); return sim; };

test('el nombre de la fábrica y de la estación está en el contrato', () => {
  assert.equal(layout.PLANTA.fabrica, 'Lácteos Politécnico');
  assert.match(layout.PLANTA.estacion, /EP-01/);
});

test('clic izquierdo: en automático un actuador no se acciona y avisa de pasar a Manual', () => {
  const sim = crearSimulacion({ semilla: 1 }); sim.paso(0.5);
  const d = simple.decidirClic('P-102', sim.estado());
  assert.equal(d.tipo, 'aviso'); assert.match(d.texto, /Revisión \(modo manual\)/);
});

test('clic izquierdo: en Manual alterna la orden de una bomba y la válvula de desvío se acciona por su piloto SV-101', () => {
  const sim = enManual();
  assert.deepEqual(simple.decidirClic('P-102', sim.estado()), { tipo: 'orden', tag: 'P-102', valor: 1 });
  sim.ordenes.manual('P-102', 1); sim.paso(0.5); sim.paso(0.5);
  assert.deepEqual(simple.decidirClic('P-102', sim.estado()), { tipo: 'orden', tag: 'P-102', valor: 0 });
  assert.equal(simple.decidirClic('FDV-101', sim.estado()).tag === undefined || simple.decidirClic('FDV-101', sim.estado()).tag === 'SV-101', true);
});

test('clic izquierdo: lo peligroso pide confirmación y lo bloqueado dice el motivo', () => {
  const sim = enManual();
  const vaciar = simple.decidirClic('XV-102', sim.estado());
  assert.equal(vaciar.tipo, 'confirmar'); assert.equal(vaciar.valor, 1); assert.match(vaciar.texto, /vaciar/);
  const calentar = simple.decidirClic('KM-201', sim.estado());                 // sin P-102 en marcha las resistencias están protegidas
  assert.equal(calentar.tipo, 'bloqueado'); assert.match(calentar.texto, /P-102/);
});

test('clic izquierdo: la velocidad se cambia en el panel; los instrumentos y la seta tienen su propia respuesta', () => {
  const sim = enManual();
  assert.equal(simple.decidirClic('VFD-101', sim.estado()).tipo, 'aviso');
  assert.equal(simple.decidirClic('TT-101', sim.estado()).tipo, 'info');
  assert.equal(simple.decidirClic('ES-001', sim.estado()).tipo, 'seta');
  assert.equal(simple.decidirClic('PB-001', sim.estado()).tipo, 'pulsador');
  assert.equal(simple.decidirClic('TSH-101', sim.estado()).tipo, 'pulsador');
  sim.ordenes.paroEmergencia(true); sim.paso(0.5); sim.paso(0.5);
  assert.equal(simple.decidirClic('ES-001', sim.estado()).tipo, 'liberar-seta');
});

test('llenado: abre la válvula de cada depósito que no está lleno y cierra la del que sí', () => {
  const plan = simple.planLlenado({ tanque: { nivelPct: 60 }, aguaCaliente: { nivelPct: 100 }, plc: {} }, true);
  assert.deepEqual(plan.ordenes, [['XV-101', 1], ['XV-302', 0]]);
  assert.equal(plan.terminado, false);
  const lleno = simple.planLlenado({ tanque: { nivelPct: 99.5 }, aguaCaliente: { nivelPct: 100 }, plc: {} }, false);
  assert.deepEqual(lleno.ordenes, [['XV-101', 0], ['XV-302', 0]]);               // las electroválvulas son manuales: se cierran y el PLC no las vuelve a abrir
  assert.equal(lleno.terminado, true);
});

test('llenado: con el paro de emergencia no abre nada y se da por terminado', () => {
  const plan = simple.planLlenado({ tanque: { nivelPct: 10 }, aguaCaliente: { nivelPct: 10 }, plc: { paro: true } }, true);
  assert.deepEqual(plan.ordenes, [['XV-101', 0], ['XV-302', 0]]);
  assert.equal(plan.terminado, true); assert.equal(plan.paro, true);
});

function llenarConLaSimulacion(sim, segundos) {
  let terminado = false;
  for (let t = 0; t < segundos && !terminado; t += 0.25) {
    const plan = simple.planLlenado(sim.estado(), sim.estado().modo === 'MANUAL');
    for (const [tag, valor] of plan.ordenes) sim.ordenes.manual(tag, valor);
    terminado = plan.terminado;
    sim.paso(0.25);
  }
  return terminado;
}

test('llenado con la simulación real en Manual: los dos depósitos suben hasta lleno y las válvulas quedan cerradas', () => {
  const sim = enManual();
  sim.ordenes.manual('XV-102', 1); sim.ordenes.manual('XV-303', 1);              // se vacían los dos
  for (let i = 0; i < 240; i++) sim.paso(0.5);                                   // 2 minutos: el tanque baja ~40 % y el agua caliente ~35 %
  sim.ordenes.manual('XV-102', 0); sim.ordenes.manual('XV-303', 0); sim.paso(0.5); sim.paso(0.5);
  const e0 = sim.estado(); assert.ok(e0.tanque.nivelPct < 60 && e0.aguaCaliente.nivelPct < 80, `vaciado: ${e0.tanque.nivelPct} / ${e0.aguaCaliente.nivelPct}`);
  assert.equal(llenarConLaSimulacion(sim, 600), true);
  for (let i = 0; i < 4; i++) sim.paso(0.5);
  const e = sim.estado();
  assert.ok(e.tanque.nivelPct >= simple.LLENO_PCT && e.aguaCaliente.nivelPct >= simple.LLENO_PCT, `niveles ${e.tanque.nivelPct} / ${e.aguaCaliente.nivelPct}`);
  assert.equal(e.equipos['XV-101'].abierta, false); assert.equal(e.equipos['XV-302'].abierta, false);
  assert.equal(!!e.equipos['TK-101'].desbordando, false);                          // se cerró antes de rebosar
});

test('llenado con la simulación real en automático: cierra el forzado al llegar y el PLC vuelve a mandar', () => {
  const sim = crearSimulacion({ semilla: 1 }); sim.paso(0.5);
  sim.ordenes.manual('XV-303', 1); for (let i = 0; i < 40; i++) sim.paso(0.5); sim.ordenes.manual('XV-303', null);
  assert.equal(llenarConLaSimulacion(sim, 900), true);
  const e = sim.estado(); assert.ok(e.aguaCaliente.nivelPct >= simple.LLENO_PCT);
});

test('texto de estado: modo, niveles y la alarma más grave; el paro de emergencia manda sobre todo', () => {
  const e = { modo: 'MANUAL', tanque: { nivelPct: 60.2 }, aguaCaliente: { nivelPct: 100 }, alarmas: [], plc: {} };
  assert.match(simple.textoEstado(e, true), /Revisión \(modo manual\) · en marcha · tanque 60 % · agua caliente 100 % · sin alarmas/);
  const a = Object.assign({}, e, { alarmas: [{ nivel: 'alarma', tag: 'TT-103', texto: 'Temperatura baja' }] });
  assert.match(simple.textoEstado(a, false), /detenida .* 1 alarma: TT-103 Temperatura baja/);
  assert.match(simple.textoEstado(Object.assign({}, e, { plc: { paro: true } }), true), /PARO DE EMERGENCIA/);
});

test('nivelDeposito fija el nivel de cada depósito, lo reflejan los instrumentos y el valor no válido se ignora', () => {
  const sim = crearSimulacion({ semilla: 1 }); sim.paso(0.5);
  sim.ordenes.nivelDeposito('tanque', 30); sim.ordenes.nivelDeposito('aguaCaliente', 5); sim.paso(0.5); sim.paso(0.5);
  const e = sim.estado();
  assert.ok(Math.abs(e.tanque.nivelPct - 30) < 2, `tanque ${e.tanque.nivelPct}`);
  assert.ok(e.aguaCaliente.nivelPct < 15, `agua ${e.aguaCaliente.nivelPct}`);
  assert.equal(e.instrumentos['LSL-301'].nivel, 0);                                // por debajo del nivel bajo: el interruptor abre
  sim.ordenes.nivelDeposito('tanque', 'mucho'); sim.ordenes.nivelDeposito('tanque', 250); sim.paso(0.5);
  assert.ok(sim.estado().tanque.nivelPct <= 100);
});

test('los dos modos de la pantalla se llaman Normal y Revisión (en el contrato, para cambiarlos en un sitio)', () => {
  assert.deepEqual(layout.PLANTA.modos, { normal: 'Normal', manual: 'Revisión' });
  assert.match(simple.textoEstado({ modo: 'PRODUCCION', tanque: { nivelPct: 80 }, aguaCaliente: { nivelPct: 90 }, alarmas: [], plc: {} }, true), /^Normal · Producción · en marcha/);
});

test('caldera: enciende P-102 y los dos bancos si nada lo impide, y si ya está encendida la apaga', () => {
  const sim = enManual();
  const plan = simple.planCaldera(sim.estado());
  assert.equal(plan.accion, 'encender'); assert.deepEqual(plan.ordenes, [['P-102', 1], ['KM-201', 1], ['KM-202', 1]]); assert.match(plan.peligro, /30 kW/);
  for (const [tag, valor] of plan.ordenes) sim.ordenes.manual(tag, valor);
  for (let i = 0; i < 20; i++) sim.paso(0.5);
  const e = sim.estado(); assert.equal(e.equipos['KM-201'].cerrado, true); assert.equal(e.equipos['KM-202'].cerrado, true); assert.ok(e.equipos['HW-101'].potenciaKW >= 60);
  const apagar = simple.planCaldera(e); assert.equal(apagar.accion, 'apagar'); assert.deepEqual(apagar.ordenes, [['KM-201', 0], ['KM-202', 0]]);
});

test('caldera: con poco nivel de agua no se enciende y dice por qué', () => {
  const sim = enManual(); sim.ordenes.nivelDeposito('aguaCaliente', 5); sim.paso(0.5); sim.paso(0.5);
  const plan = simple.planCaldera(sim.estado());
  assert.equal(plan.accion, 'bloqueado'); assert.match(plan.texto, /nivel bajo/);
});

test('niveles de partida: Normal con los dos depósitos llenos y Revisión con los dos vacíos', () => {
  assert.deepEqual(simple.NIVELES_INICIALES.normal, { tanque: 100, aguaCaliente: 100 });
  assert.deepEqual(simple.NIVELES_INICIALES.revision, { tanque: 0, aguaCaliente: 0 });
  const sim = crearSimulacion({ semilla: 1 });
  for (const [cual, pct] of Object.entries(simple.NIVELES_INICIALES.revision)) sim.ordenes.nivelDeposito(cual, pct);
  sim.ordenes.modo('MANUAL'); sim.paso(0.5); sim.paso(0.5);
  const e = sim.estado(); assert.equal(Math.round(e.tanque.nivelPct), 0); assert.equal(Math.round(e.aguaCaliente.nivelPct), 0);
});

test('electroválvulas manuales: se accionan con el clic también en modo Normal y el PLC no las gobierna', () => {
  const sim = crearSimulacion({ semilla: 1, valvulasManuales: true }); sim.paso(0.5);
  assert.deepEqual(simple.decidirClic('XV-301', sim.estado()), { tipo: 'orden', tag: 'XV-301', valor: 1 });          // en Normal, sin pasar a Revisión
  assert.equal(simple.decidirClic('P-102', sim.estado()).tipo, 'aviso');                                             // el resto de actuadores sigue pidiendo Revisión
  sim.ordenes.nivelDeposito('tanque', 40); sim.ordenes.nivelDeposito('aguaCaliente', 60); sim.ordenes.arrancar();
  for (let i = 0; i < 120; i++) sim.paso(1);
  const e = sim.estado();
  assert.equal(e.equipos['XV-101'].abierta, false); assert.equal(e.equipos['XV-302'].abierta, false); assert.equal(e.equipos['XV-301'].abierta, false);   // sin reposición ni agua fría automáticas
  assert.ok(e.tanque.nivelPct <= 40.5, `el tanque no sube sin reposición (en recirculación el agua vuelve a él): ${e.tanque.nivelPct}`);
  sim.ordenes.manual('XV-301', 1); sim.paso(1); sim.paso(1);
  assert.equal(sim.estado().equipos['XV-301'].abierta, true);                                                        // y a mano sí se abre
});

test('reloj con horas, minutos y segundos', () => { assert.equal(simple.formatoReloj(3725.9), '01:02:05'); assert.equal(simple.formatoReloj(), '00:00:00'); });
