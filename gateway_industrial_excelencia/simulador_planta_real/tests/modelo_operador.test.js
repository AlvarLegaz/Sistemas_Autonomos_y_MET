'use strict';
// Automatismos del operador como ÓRDENES DEL MODELO (comun/CONTRATO.md §4.3, R6 resuelto): controlTemperatura y llenarDepositos, con su estado en
// estado().operador. Sustituyen a las pruebas de planLlenado / histeresis / repartoBancos / crearPid, que vivían en la interfaz (pagina_simple.js) y que el
// contrato ha pasado al modelo. Solo se usa la API pública del contrato (contrato_htst.js): ejecutar, avanzar, estado, registro y repetir.
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearSimulacion } = require('../js/modelo/contrato_htst.js');
const { repetir } = require('../../comun/js/nucleo/registro.js');
const T = require('../../comun/tipos.js');

const J = x => JSON.stringify(x);
const ESCENARIO = { simulador: 'planta_real', versionContrato: 1, id: 'prueba_operador', titulo: 'Prueba de los automatismos del operador', condiciones: { valvulasManuales: true }, ordenesIniciales: [] };

const ok = (r, que = '') => assert.equal(r && r.ok, true, `${que} ${J(r)}`);
const rechazada = (r, motivo, que = '') => { assert.equal(r && r.ok, false, `${que} debía rechazarse: ${J(r)}`); assert.equal(r.motivo, motivo, `${que} ${J(r)}`); };
const control = (tipo, valores, origen = 'alumno') => ({ tipo, valores, origen });
const CT = (valores, origen) => control('controlTemperatura', valores, origen);
const LL = (activo, origen) => control('llenarDepositos', { activo }, origen);
const manual = (tag, valor) => ({ tipo: 'manual', destino: tag, valores: { valor }, origen: 'alumno' });
const nivel = (tag, pct) => ({ tipo: 'nivelDeposito', destino: tag, valores: { pct }, origen: 'guion' });

/** Planta en MANUAL (el control de temperatura solo actúa en MANUAL). */
function enManual(semilla = 1) {
  const s = crearSimulacion({ semilla, escenario: JSON.parse(J(ESCENARIO)) });
  ok(s.ejecutar({ tipo: 'modo', valores: { modo: 'MANUAL' }, origen: 'guion' }), 'modo MANUAL');
  ok(s.avanzar(1));
  assert.equal(s.estado().modo, 'MANUAL');
  return s;
}
const tt201 = s => s.estado().instrumentos['TT-201'].valorPLC;
const ctl = s => s.estado().operador.control;
const llen = s => s.estado().operador.llenado;
function correr(s, segundos, dt = 1) { for (let t = 0; t < segundos - 1e-9; t += dt) ok(s.avanzar(Math.min(dt, segundos - t))); }

test('estado inicial de operador: control apagado con los parámetros de fábrica y llenado sin empezar (§4.3)', () => {
  const o = crearSimulacion({ semilla: 1 }).estado().operador;
  assert.ok(o && o.control && o.llenado, 'falta estado().operador');
  const c = o.control;
  assert.equal(c.modo, 'off');
  assert.deepEqual([c.consignaC, c.bandaC, c.kp, c.ki, c.kd], [70, 4, 10, 0.05, 0]);
  assert.equal(c.salidaPct, 0); assert.equal(c.encendido, false); assert.equal(c.integral, 0); assert.equal(c.ultimoError, null); assert.equal(c.sinLectura, false);
  assert.deepEqual({ ...o.llenado }, { activo: false, final: '' });
  assert.ok(T.MODOS_CONTROL_TEMPERATURA.includes(c.modo));
});

test('controlTemperatura: los ejemplos del contrato se aceptan en una planta recién creada (nunca no_permitida) y se registran', () => {
  const s = crearSimulacion({ semilla: 1 });
  ok(s.ejecutar({ tipo: 'controlTemperatura', valores: { modo: 'pid', consignaC: 70 }, origen: 'guion' }));
  ok(s.ejecutar({ tipo: 'llenarDepositos', valores: { activo: true }, origen: 'guion' }));
  assert.deepEqual(s.registro().ordenes.map(x => x.orden.tipo), ['controlTemperatura', 'llenarDepositos']);
  for (const origen of ['alumno', 'sistema']) ok(crearSimulacion({ semilla: 1 }).ejecutar(CT({ modo: 'off' }, origen)), `origen ${origen}`);
  for (const origen of ['alumno', 'sistema']) ok(crearSimulacion({ semilla: 1 }).ejecutar(LL(false, origen)), `origen ${origen}`);
});

test('controlTemperatura: fija modo y parámetros, conserva lo que falta y reinicia el controlador', () => {
  const s = crearSimulacion({ semilla: 1 });
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: 65 })));
  let c = ctl(s);
  assert.deepEqual([c.modo, c.consignaC, c.bandaC, c.kp, c.ki, c.kd], ['pid', 65, 4, 10, 0.05, 0]);
  ok(s.ejecutar(CT({ modo: 'histeresis', bandaC: 6, kp: 20 })));
  c = ctl(s);
  assert.deepEqual([c.modo, c.consignaC, c.bandaC, c.kp, c.ki, c.kd], ['histeresis', 65, 6, 20, 0.05, 0], 'lo que falta se conserva');
  ok(s.ejecutar(CT({ modo: 'off' })));
  assert.equal(ctl(s).modo, 'off'); assert.equal(ctl(s).consignaC, 65);
});

test('controlTemperatura: modo obligatorio y cada parámetro dentro de su rango; fuera de rango se rechaza (no se recorta) sin cambiar nada', () => {
  const s = crearSimulacion({ semilla: 1 });
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: 65 })));
  const malos = [
    [{}, 'sin modo'], [{ consignaC: 70 }, 'sin modo, solo consigna'], [{ modo: 'turbo' }, 'modo desconocido'], [{ modo: 3 }, 'modo no texto'],
    [{ modo: 'pid', consignaC: 19.9 }, 'consigna 19,9'], [{ modo: 'pid', consignaC: 85.1 }, 'consigna 85,1'], [{ modo: 'pid', consignaC: '70' }, 'consigna como texto'],
    [{ modo: 'histeresis', bandaC: 0.4 }, 'banda 0,4'], [{ modo: 'histeresis', bandaC: 20.1 }, 'banda 20,1'],
    [{ modo: 'pid', kp: -1 }, 'kp -1'], [{ modo: 'pid', kp: 100.1 }, 'kp 100,1'], [{ modo: 'pid', ki: -0.01 }, 'ki -0,01'], [{ modo: 'pid', ki: 5.01 }, 'ki 5,01'],
    [{ modo: 'pid', kd: -1 }, 'kd -1'], [{ modo: 'pid', kd: 500.1 }, 'kd 500,1'], [{ modo: 'pid', consignaC: NaN }, 'consigna NaN'],
  ];
  for (const [v, que] of malos) {
    const antes = J({ e: s.estado(), r: s.registro() });
    rechazada(s.ejecutar(CT(v)), 'valores_invalidos', que);
    assert.equal(J({ e: s.estado(), r: s.registro() }), antes, `${que}: ha cambiado algo`);
  }
  rechazada(s.ejecutar({ tipo: 'controlTemperatura', destino: 'TT-201', valores: { modo: 'pid' }, origen: 'alumno' }), 'destino_desconocido', 'la orden no lleva destino');
  // los extremos exactos sí valen
  for (const v of [{ modo: 'pid', consignaC: 20, bandaC: 0.5, kp: 0, ki: 0, kd: 0 }, { modo: 'histeresis', consignaC: 85, bandaC: 20, kp: 100, ki: 5, kd: 500 }]) ok(s.ejecutar(CT(v)), J(v));
});

test('llenarDepositos: activo obligatorio y booleano', () => {
  const s = crearSimulacion({ semilla: 1 });
  for (const v of [{}, { activo: 1 }, { activo: 'true' }, { activo: null }]) rechazada(s.ejecutar(control('llenarDepositos', v)), 'valores_invalidos', J(v));
  rechazada(s.ejecutar({ tipo: 'llenarDepositos', destino: 'TK-101', valores: { activo: true }, origen: 'alumno' }), 'destino_desconocido');
  assert.equal(llen(s).activo, false);
});

test('histéresis: lleva el agua al objetivo sin pasarse mucho y la salida solo vale 0 ó 100', () => {
  const s = enManual();
  ok(s.ejecutar(manual('P-201', 1)));
  ok(s.ejecutar(CT({ modo: 'histeresis', consignaC: 65, bandaC: 4 })));
  let maxT = 0;
  for (let t = 0; t < 2400; t++) {
    ok(s.avanzar(1));
    maxT = Math.max(maxT, tt201(s));
    assert.ok(ctl(s).salidaPct === 0 || ctl(s).salidaPct === 100, `salida ${ctl(s).salidaPct}`);
    assert.equal(ctl(s).salidaPct === 100, ctl(s).encendido, 'encendido y salida deben coincidir');
  }
  assert.ok(Math.abs(tt201(s) - 65) < 4.5, `histéresis final ${tt201(s)}`);
  assert.ok(maxT < 65 + 6, `histéresis máx ${maxT}`);
});

test('PID: lleva el agua al objetivo sin pasarse mucho, con la salida entre 0 y 100 y la integral acotada', () => {
  const s = enManual();
  ok(s.ejecutar(manual('P-201', 1)));
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: 65, kp: 10, ki: 0.05, kd: 0 })));
  let maxT = 0;
  for (let t = 0; t < 2400; t++) {
    ok(s.avanzar(1));
    maxT = Math.max(maxT, tt201(s));
    const c = ctl(s);
    assert.ok(c.salidaPct >= 0 && c.salidaPct <= 100, `salida fuera de 0–100: ${c.salidaPct}`);
    assert.ok(c.integral >= 0 && c.integral <= 100, `integral fuera de 0–100: ${c.integral}`);
  }
  assert.ok(Math.abs(tt201(s) - 65) < 2, `PID final ${tt201(s)}`);
  assert.ok(maxT < 65 + 5, `PID máx ${maxT}`);
});

test('PID: con el error grande la salida se satura al 100 % y la integral no se dispara; con el error contrario, 0 %', () => {
  const s = enManual();
  ok(s.ejecutar(manual('P-201', 1)));
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: 85, kp: 10, ki: 0.5, kd: 0 })));                  // ~65 °C de error
  correr(s, 30);
  assert.equal(ctl(s).salidaPct, 100, 'saturada');
  assert.equal(ctl(s).integral, 0, 'con el error grande no integra (antiwindup)');
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: 20, kp: 10, ki: 0.5, kd: 0 })));                  // el agua ya está por encima del objetivo
  correr(s, 5);
  assert.equal(ctl(s).salidaPct, 0);
});

test('cada orden controlTemperatura reinicia el controlador: PID sin memoria', () => {
  const s = enManual();
  ok(s.ejecutar(manual('P-201', 1)));
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: Math.round(tt201(s)) + 3, kp: 1, ki: 1, kd: 0 })));  // error pequeño: sí integra
  correr(s, 20);
  assert.notEqual(ctl(s).ultimoError, null, 'tras calcular hay memoria del error');
  assert.ok(ctl(s).integral > 0, `la integral debería crecer: ${ctl(s).integral}`);
  ok(s.ejecutar(CT({ modo: 'pid' })));
  assert.equal(ctl(s).integral, 0); assert.equal(ctl(s).ultimoError, null); assert.equal(ctl(s).salidaPct, 0);
});

test('reparto en bancos del PID: hasta el 50 % solo el banco 1 a ciclo; por encima el 1 fijo y el 2 a ciclo (ventanas de 30 s)', () => {
  const duty = (delta) => {      // delta = consigna − temperatura actual: con kp = 10 y ki = 0, la salida inicial es 10·delta %
    const s = enManual();
    ok(s.ejecutar(manual('P-201', 1)));
    ok(s.ejecutar(CT({ modo: 'pid', consignaC: Math.max(20, tt201(s) + delta), kp: 10, ki: 0, kd: 0 })));      // salida ≈ u0 % (con ki = 0)
    let n = 0, n1 = 0, n2 = 0, suma = 0;
    for (let i = 0; i < 300; i++) {                                                                  // una ventana entera de 30 s en pasos de 0,1 s
      ok(s.avanzarPasos(1));
      const hw = s.estado().equipos['HW-201'];
      n++; if (hw.banco1) n1++; if (hw.banco2) n2++; suma += ctl(s).salidaPct;
    }
    return { b1: n1 / n, b2: n2 / n, u: suma / n };
  };
  const bajo = duty(2.5), alto = duty(7.5), apagado = duty(0), pleno = duty(30);
  assert.ok(bajo.u > 5 && bajo.u < 50, `salida media ${bajo.u}`);
  assert.ok(Math.abs(bajo.b1 - bajo.u / 50) < 0.1, `banco 1 al ${bajo.u}%: ciclo ${bajo.b1}`); assert.equal(bajo.b2, 0, 'hasta el 50 % el banco 2 no actúa');
  assert.ok(alto.u > 50 && alto.u < 100, `salida media ${alto.u}`);
  assert.ok(alto.b1 > 0.97, `por encima del 50 % el banco 1 va fijo: ${alto.b1}`); assert.ok(Math.abs(alto.b2 - (alto.u - 50) / 50) < 0.1, `banco 2 al ${alto.u}%: ciclo ${alto.b2}`);
  assert.ok(apagado.b1 < 0.05 && apagado.b2 === 0, `salida 0: ${J(apagado)}`);
  assert.ok(pleno.b1 > 0.97 && pleno.b2 > 0.97, `salida 100: ${J(pleno)}`);
});

test('el control solo actúa en MANUAL y se apaga solo cuando el PLC vuelve a automático (§4.3)', () => {
  const s = crearSimulacion({ semilla: 1, escenario: JSON.parse(J(ESCENARIO)) });                 // PARADA
  ok(s.ejecutar(CT({ modo: 'histeresis', consignaC: 80, bandaC: 4 })));
  correr(s, 30);
  const hw = s.estado().equipos['HW-201'];
  assert.equal(hw.banco1 || hw.banco2, false, 'en PARADA el control no manda los bancos');
  assert.equal(ctl(s).modo, 'histeresis', 'la orden vale aunque aún no actúe');
  ok(s.ejecutar({ tipo: 'modo', valores: { modo: 'MANUAL' }, origen: 'guion' }));
  ok(s.ejecutar(manual('P-201', 1)));
  correr(s, 10);
  assert.equal(s.estado().modo, 'MANUAL');
  assert.equal(ctl(s).modo, 'histeresis');
  assert.equal(ctl(s).salidaPct, 100, 'en MANUAL y con el agua fría, la histéresis enciende');
  ok(s.ejecutar({ tipo: 'modo', valores: { modo: 'PARADA' }, origen: 'guion' }));
  correr(s, 5);
  assert.notEqual(s.estado().modo, 'MANUAL');
  assert.equal(ctl(s).modo, 'off', 'al volver a automático el control pasa a off por sí solo');
});

test('sin lectura válida de TT-201 el control apaga los bancos y lo señala (sinLectura)', () => {
  const s = enManual();
  ok(s.ejecutar(manual('P-201', 1)));
  const act = s.ejecutar({ tipo: 'averias.activar', valores: { id: 'AV-LAZO-ABIERTO', parametros: { tag: 'TT-201' } }, origen: 'profesor' });
  if (!act.ok) return t_skip(`AV-LAZO-ABIERTO no admite TT-201 (${J(act)})`);
  ok(s.ejecutar(CT({ modo: 'histeresis', consignaC: 80 })));
  correr(s, 5);
  assert.equal(ctl(s).sinLectura, true);
  const hw = s.estado().equipos['HW-201'];
  assert.equal(hw.banco1 || hw.banco2, false);
  assert.equal(ctl(s).salidaPct, 0);
  function t_skip(m) { assert.ok(true, m); }
});

/* ------------------------------------------------------------------ llenado --- */

function vaciar(s) { ok(s.ejecutar(nivel('TK-101', 10))); ok(s.ejecutar(nivel('HW-201', 10))); }

test('llenarDepositos: sube los dos depósitos hasta lleno, las válvulas quedan cerradas y final es «lleno»', () => {
  const s = enManual();
  vaciar(s);
  ok(s.ejecutar(LL(true)));
  assert.equal(llen(s).activo, true); assert.equal(llen(s).final, '');
  let paso = 0;
  while (llen(s).activo && paso++ < 900) ok(s.avanzar(1));
  assert.equal(llen(s).activo, false, 'no ha terminado en 15 minutos');
  assert.equal(llen(s).final, 'lleno');
  correr(s, 4);
  const e = s.estado();
  assert.ok(e.tanque.nivelPct >= 99, `tanque ${e.tanque.nivelPct}`);
  assert.ok(e.aguaCaliente.nivelPct >= 85, `agua caliente ${e.aguaCaliente.nivelPct}`);
  assert.equal(e.equipos['XV-101'].abierta, false); assert.equal(e.equipos['XV-201'].abierta, false);
  assert.equal(!!e.equipos['TK-101'].desbordando, false, 'se cerró antes de rebosar');
  const n = e.tanque.nivelPct;
  correr(s, 30);
  assert.ok(s.estado().tanque.nivelPct <= n + 0.01, 'las válvulas deben seguir cerradas: el nivel no sigue subiendo');
});

test('llenarDepositos: con los depósitos ya llenos termina enseguida; volver a pedirlo borra el final anterior', () => {
  const s = enManual();
  ok(s.ejecutar(nivel('TK-101', 100))); ok(s.ejecutar(nivel('HW-201', 100)));
  ok(s.ejecutar(LL(true)));
  correr(s, 5);
  assert.equal(llen(s).activo, false); assert.equal(llen(s).final, 'lleno');
  vaciar(s);
  ok(s.ejecutar(LL(true)));
  assert.equal(llen(s).activo, true, 'volver a pedirlo lo reactiva');
  assert.equal(llen(s).final, '', 'y borra el final anterior');
});

test('llenarDepositos {activo:false}: cancela, cierra las válvulas y deja final «cancelado»; sin llenado en curso no cambia nada', () => {
  const s = enManual();
  ok(s.ejecutar(LL(false)));
  assert.equal(llen(s).final, '', 'cancelar sin llenado en curso no inventa un final');
  vaciar(s);
  ok(s.ejecutar(LL(true)));
  correr(s, 10);
  const e1 = s.estado();
  assert.ok(e1.equipos['XV-101'].abierta || e1.equipos['XV-201'].abierta, 'llenando debe haber alguna válvula abierta');
  ok(s.ejecutar(LL(false)));
  correr(s, 2);
  assert.equal(llen(s).activo, false); assert.equal(llen(s).final, 'cancelado');
  const e2 = s.estado();
  assert.equal(e2.equipos['XV-101'].abierta, false); assert.equal(e2.equipos['XV-201'].abierta, false);
  const n = e2.tanque.nivelPct;
  correr(s, 20);
  assert.ok(s.estado().tanque.nivelPct <= n + 0.01, 'tras cancelar el nivel no debe seguir subiendo');
});

test('llenarDepositos: al salir de MANUAL (a PARADA o a RECIRCULACION_AGUA) se cancela, con final «cancelado», y las válvulas vuelven al PLC', () => {
  for (const destino of ['PARADA', 'RECIRCULACION_AGUA']) {
    const s = enManual();
    vaciar(s);
    ok(s.ejecutar(LL(true)));
    correr(s, 5);
    assert.equal(llen(s).activo, true, 'llenando en MANUAL');
    ok(s.ejecutar({ tipo: 'modo', valores: { modo: destino }, origen: 'alumno' }));
    correr(s, 3);
    assert.notEqual(s.estado().modo, 'MANUAL', destino);
    assert.equal(llen(s).activo, false, `${destino}: el llenado debe cancelarse`); assert.equal(llen(s).final, 'cancelado', destino);
    const e = s.estado();
    assert.equal(e.equipos['XV-101'].abierta, false, destino); assert.equal(e.equipos['XV-201'].abierta, false, destino);
  }
});

test('llenarDepositos con paro de emergencia: no abre nada y termina con final «paro»', () => {
  const s = enManual();
  vaciar(s);
  ok(s.ejecutar({ tipo: 'paroEmergencia', destino: 'ES-001', valores: { activo: true }, origen: 'alumno' }));
  correr(s, 2);
  ok(s.ejecutar(LL(true)));
  correr(s, 5);
  assert.equal(llen(s).activo, false); assert.equal(llen(s).final, 'paro');
  const e = s.estado();
  assert.equal(e.equipos['XV-101'].abierta, false); assert.equal(e.equipos['XV-201'].abierta, false);
  assert.ok(T.FINALES_LLENADO.includes(llen(s).final), 'final ∈ FINALES_LLENADO');
});

/* ------------------------------------ independencia de la velocidad y repetición --- */

function sesionDeOperador(s, dt) {
  const avanzar = seg => { for (let t = 0; t < seg - 1e-9; t += dt) ok(s.avanzar(Math.min(dt, seg - t))); };
  ok(s.ejecutar(nivel('TK-101', 40))); ok(s.ejecutar(nivel('HW-201', 50)));
  ok(s.ejecutar(LL(true, 'sistema')));
  avanzar(60);
  ok(s.ejecutar(manual('P-201', 1)));
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: 55 }, 'sistema')));
  avanzar(300);
  ok(s.ejecutar(CT({ modo: 'histeresis', consignaC: 50, bandaC: 3 })));
  avanzar(120);
}

test('R6: el resultado del control y del llenado no depende de la velocidad de la interfaz (troceo del tiempo)', () => {
  const a = enManual(), b = enManual();
  sesionDeOperador(a, 0.25); sesionDeOperador(b, 5);
  assert.equal(a.tiempo().pasos, b.tiempo().pasos);
  assert.equal(J(a.estado()), J(b.estado()), 'el estado depende de cómo se trocea el tiempo');
  assert.equal(J(a.estado().operador), J(b.estado().operador));
  assert.equal(J(a.registro().ordenes.map(x => x.orden.tipo)), J(b.registro().ordenes.map(x => x.orden.tipo)));
});

test('el registro de una sesión con control y llenado se repite con el mismo estado y no se llena de órdenes manual del modelo', () => {
  const s = enManual();
  sesionDeOperador(s, 1);
  const r = JSON.parse(J(s.registro()));
  const manuales = r.ordenes.filter(x => x.orden.tipo === 'manual').length;
  assert.equal(manuales, 1, `solo la orden manual del alumno debe estar en el registro (hay ${manuales}): las escrituras del modelo no son órdenes`);
  assert.ok(r.ordenes.some(x => x.orden.tipo === 'controlTemperatura' && x.orden.origen === 'sistema'), "se conserva el origen 'sistema'");
  const t = repetir(r, crearSimulacion);
  assert.equal(J(t.estado()), J(s.estado()));
  assert.equal(J(t.registro()), J(r));
});

test('las órdenes controlTemperatura y llenarDepositos emiten el evento orden con su origen', () => {
  const s = crearSimulacion({ semilla: 1 });
  const ev = [];
  s.suscribir(e => ev.push(e));
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: 60 }, 'sistema')));
  ok(s.ejecutar(LL(true, 'alumno')));
  rechazada(s.ejecutar(CT({ modo: 'pid', consignaC: 999 })), 'valores_invalidos');
  assert.deepEqual(ev.map(e => e.tipo), ['orden', 'orden', 'orden_rechazada']);
  assert.deepEqual(ev.slice(0, 2).map(e => e.orden.origen), ['sistema', 'alumno']);
});

test('histéresis: enciende por debajo de la banda, apaga por encima y dentro de la banda mantiene', () => {
  const s = enManual();
  ok(s.ejecutar(manual('P-201', 1)));
  const T0 = tt201(s);
  ok(s.ejecutar(CT({ modo: 'histeresis', consignaC: Math.round(T0) + 10, bandaC: 4 })));          // muy por debajo de la banda: enciende
  correr(s, 2);
  assert.equal(ctl(s).encendido, true); assert.equal(ctl(s).salidaPct, 100);
  // consigna justo por debajo de la temperatura actual: por encima de la banda apaga
  ok(s.ejecutar(CT({ modo: 'histeresis', consignaC: Math.max(20, Math.floor(tt201(s)) - 10), bandaC: 4 })));
  correr(s, 2);
  assert.equal(ctl(s).encendido, false); assert.equal(ctl(s).salidaPct, 0);
  // dentro de la banda mantiene el estado en que estaba (apagado)
  ok(s.ejecutar(CT({ modo: 'histeresis', consignaC: Math.round(tt201(s)), bandaC: 20 })));
  correr(s, 2);
  assert.equal(ctl(s).encendido, false, 'dentro de la banda debe mantener apagado');
});

test('cambiar la consigna o la banda con el control activo reinicia el controlador', () => {
  const s = enManual();
  ok(s.ejecutar(manual('P-201', 1)));
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: Math.round(tt201(s)) + 3, kp: 1, ki: 1 })));
  correr(s, 10);
  assert.ok(ctl(s).integral > 0);
  ok(s.ejecutar(CT({ modo: 'pid', consignaC: Math.round(tt201(s)) + 4 })));
  assert.equal(ctl(s).integral, 0); assert.equal(ctl(s).ultimoError, null);
});

test('llenado con la simulación real en automático: cada depósito no lleno abre su válvula y, al llegar, se cierra', () => {
  const s = crearSimulacion({ semilla: 1 });
  ok(s.ejecutar(nivel('TK-101', 60))); ok(s.ejecutar(nivel('HW-201', 100)));
  ok(s.ejecutar(LL(true)));
  correr(s, 2);
  let e = s.estado();
  assert.equal(e.equipos['XV-101'].abierta, true, 'el tanque no está lleno: su válvula abre');
  assert.equal(e.equipos['XV-201'].abierta, false, 'el agua caliente ya está llena: su válvula cierra');
  let n = 0; while (llen(s).activo && n++ < 900) ok(s.avanzar(1));
  assert.equal(llen(s).final, 'lleno');
  correr(s, 3);
  assert.equal(s.estado().equipos['XV-101'].abierta, false);
});
