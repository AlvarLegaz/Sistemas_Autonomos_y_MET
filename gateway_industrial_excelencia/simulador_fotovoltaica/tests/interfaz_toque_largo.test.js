// Pulsación larga (iPad) para abrir la ficha: lógica pura con temporizador inyectable.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/interfaz/toque_largo_fv.js');
const PL = require('../../simulador_pct23/js/interfaz/pulsacion_larga.js');

function reloj() {
  let ahora = 0, n = 0; const pend = new Map();
  return { programar: (fn, ms) => { const id = ++n; pend.set(id, { fn, en: ahora + ms }); return id; }, anular: id => pend.delete(id),
    avanzar(ms) { ahora += ms; for (const [id, t] of [...pend]) if (t.en <= ahora) { pend.delete(id); t.fn(); } }, pendientes: () => pend.size };
}
const montar = (extra = {}) => {
  const r = reloj(), ev = { abrir: [], empezar: [], cancelar: 0 };
  const n = T.crearToqueLargo(Object.assign({ programar: r.programar, anular: r.anular, alCumplir: d => ev.abrir.push(d), alEmpezar: d => ev.empezar.push(d), alCancelar: () => { ev.cancelar++; } }, extra));
  return { r, ev, n };
};

test('la duración es de 3 s y el umbral de 10 px (los de la pulsación larga compartida)', () => { assert.equal(PL.DURACION_MS, 3000); assert.equal(PL.UMBRAL_PX, 10); });

test('con el ratón no se activa; con el dedo y con el lápiz sí', () => {
  const { n, r } = montar();
  assert.equal(n.abajo({ pointerType: 'mouse', x: 0, y: 0, dato: 'QS-101' }), false); assert.equal(r.pendientes(), 0);
  assert.equal(n.abajo({ pointerType: 'touch', x: 0, y: 0, dato: 'QS-101' }), true); n.cancelar();
  assert.equal(n.abajo({ pointerType: 'pen', x: 0, y: 0, dato: 'QS-101' }), true);
});

test('mantener 3 s abre la ficha una vez y el clic al soltar se suprime', () => {
  const { n, r, ev } = montar();
  n.abajo({ pointerType: 'touch', x: 50, y: 50, dato: 'INV-101' }); r.avanzar(2900); assert.deepEqual(ev.abrir, []);
  r.avanzar(200); assert.deepEqual(ev.abrir, ['INV-101']);
  assert.equal(n.arriba(), true); assert.equal(n.consumirSupresion(), true); assert.equal(n.consumirSupresion(), false);       // solo se suprime un clic
  r.avanzar(5000); assert.equal(ev.abrir.length, 1);
});

test('un toque corto no abre la ficha y su clic sigue accionando el equipo', () => {
  const { n, r, ev } = montar();
  n.abajo({ pointerType: 'touch', x: 10, y: 10, dato: 'QS-101' }); r.avanzar(300);
  assert.equal(n.arriba(), false); assert.equal(n.consumirSupresion(), false); assert.deepEqual(ev.abrir, []); assert.equal(ev.cancelar, 1);
  r.avanzar(5000); assert.deepEqual(ev.abrir, []);
});

test('si el dedo se mueve más de 10 px se cancela; menos de 10 px no', () => {
  let a = montar();
  a.n.abajo({ pointerType: 'touch', x: 100, y: 100, dato: 'F-101' }); a.n.mover({ x: 105, y: 104 }); a.r.avanzar(3100); assert.deepEqual(a.ev.abrir, ['F-101']);
  a = montar();
  a.n.abajo({ pointerType: 'touch', x: 100, y: 100, dato: 'F-101' }); a.n.mover({ x: 100, y: 115 }); a.r.avanzar(3500); assert.deepEqual(a.ev.abrir, []); assert.equal(a.n.arriba(), false);
});

test('feedback: alEmpezar al poner el dedo y alCancelar al soltar o mover antes de tiempo (el anillo desaparece)', () => {
  const { n, r, ev } = montar();
  n.abajo({ pointerType: 'touch', x: 0, y: 0, dato: 'BAT-101' }); assert.deepEqual(ev.empezar, ['BAT-101']);
  n.arriba(); assert.equal(ev.cancelar, 1);
  n.abajo({ pointerType: 'touch', x: 0, y: 0, dato: 'BAT-101' }); n.cancelar(); assert.equal(ev.cancelar, 2); r.avanzar(4000); assert.deepEqual(ev.abrir, []);
});

test('una pulsación nueva reinicia la cuenta y no deja dos temporizadores', () => {
  const { n, r, ev } = montar();
  n.abajo({ pointerType: 'touch', x: 0, y: 0, dato: 'A' }); r.avanzar(2000); n.abajo({ pointerType: 'touch', x: 0, y: 0, dato: 'B' }); assert.equal(r.pendientes(), 1);
  r.avanzar(1500); assert.deepEqual(ev.abrir, []); r.avanzar(1600); assert.deepEqual(ev.abrir, ['B']);
});

test('la ayuda de la página menciona la pulsación larga de 3 s y el cargador la carga', () => {
  const fs = require('node:fs'), path = require('node:path'), base = path.join(__dirname, '..', 'js', 'interfaz');
  assert.match(fs.readFileSync(path.join(base, 'pagina_simple.js'), 'utf8'), /mantén 3 s/);
  const car = fs.readFileSync(path.join(base, 'cargador.js'), 'utf8'); assert.match(car, /pulsacion_larga\.js/); assert.match(car, /toque_largo_fv\.js/);
  assert.match(fs.readFileSync(path.join(base, 'ventana_diagrama.js'), 'utf8'), /pulsacion_larga\.js/);
});
