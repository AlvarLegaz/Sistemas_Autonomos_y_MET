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
  assert.equal(d.tipo, 'aviso'); assert.match(d.texto, /Manual/);
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
  assert.deepEqual(lleno.ordenes, [['XV-101', null], ['XV-302', null]]);         // en automático se quita el forzado
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
  assert.match(simple.textoEstado(e, true), /Manual · en marcha · tanque 60 % · agua caliente 100 % · sin alarmas/);
  const a = Object.assign({}, e, { alarmas: [{ nivel: 'alarma', tag: 'TT-103', texto: 'Temperatura baja' }] });
  assert.match(simple.textoEstado(a, false), /detenida .* 1 alarma: TT-103 Temperatura baja/);
  assert.match(simple.textoEstado(Object.assign({}, e, { plc: { paro: true } }), true), /PARO DE EMERGENCIA/);
});

test('reloj con horas, minutos y segundos', () => { assert.equal(simple.formatoReloj(3725.9), '01:02:05'); assert.equal(simple.formatoReloj(), '00:00:00'); });
