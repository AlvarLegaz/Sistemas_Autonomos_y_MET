/* Piezas comunes de la interfaz: velocidad, menú «Más» y pestañas de la columna lateral. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);

  /* ----- velocidad: botones segmentados sobre el select que usa el motor ----- */
  const sel = $('sim-velocidad');
  if (sel) {
    const botones = Array.from(document.querySelectorAll('.velocidad button'));
    const sinc = () => botones.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === sel.value)));
    botones.forEach(b => b.addEventListener('click', () => { sel.value = b.dataset.v; sel.dispatchEvent(new Event('change')); sinc(); }));
    sel.addEventListener('change', sinc);
    sinc();
  }

  /* ----- menú «Más»: se cierra al elegir una opción o al pulsar fuera ----- */
  const mas = document.querySelector('.mas');
  if (mas) {
    mas.addEventListener('click', e => { if (e.target.closest('button')) mas.open = false; });
    document.addEventListener('click', e => { if (!mas.contains(e.target)) mas.open = false; });
  }

  /* ----- pestañas: la primera es la que viene marcada; el resto son opcionales ----- */
  const tabs = Array.from(document.querySelectorAll('.pestanas [role="tab"]'));
  const mostrar = tab => tabs.forEach(t => {
    const sel = t === tab;
    t.setAttribute('aria-selected', String(sel));
    $(t.getAttribute('aria-controls')).hidden = !sel;
  });
  tabs.forEach(t => t.addEventListener('click', () => mostrar(t)));
  if (tabs.length) mostrar(tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0]);
})();
