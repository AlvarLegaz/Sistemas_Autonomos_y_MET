(function () {
  var barra = document.getElementById('aula-barra');
  if (!barra || !barra.dataset.uso) return;
  var csrf = barra.querySelector('input[name=csrf]').value;
  var pagina = barra.dataset.pagina || 'index';
  var NOMBRES = {
    'sim-play': 'Iniciar la simulación', 'sim-pause': 'Pausar la simulación', 'sim-reset': 'Reiniciar la planta',
    'sim-stop-all': 'Parar todo',
    'b-iniciar': 'Iniciar la secuencia', 'b-pausa': 'Pausar / reanudar la secuencia', 'b-reset': 'Reiniciar la planta',
    'b-emergencia': 'Parar todo', 'b-parar': 'Parada ordenada', 'b-terminar': 'Terminar producción',
    'b-saltar': 'Saltar fase', 'b-reconocer': 'Reconocer alarma'
  };
  var cola = [];
  var acumulado = 0;
  var visibleDesde = document.visibilityState === 'visible' ? Date.now() : null;

  function enviar(alSalir) {
    if (visibleDesde !== null) { acumulado += Date.now() - visibleDesde; visibleDesde = Date.now(); }
    var segundos = Math.round(acumulado / 1000);
    if (!segundos && !cola.length) return;
    var datos = new FormData();
    datos.append('csrf', csrf);
    datos.append('pagina', pagina);
    datos.append('segundos', String(segundos));
    datos.append('eventos', JSON.stringify(cola.slice(0, 30)));
    acumulado = 0;
    cola = cola.slice(30);
    if (alSalir && navigator.sendBeacon) navigator.sendBeacon('/api/uso', datos);
    else fetch('/api/uso', { method: 'POST', body: datos, credentials: 'same-origin', keepalive: true }).catch(function () {});
  }

  function anotar(texto) { cola.push({ d: texto }); }

  // Clics en botones del simulador y en las válvulas/bombas del esquema.
  document.addEventListener('click', function (e) {
    var el = e.target.closest('button[id], .accion[id]');
    if (!el || el.closest('#aula-barra')) return;
    var id = el.id;
    if (NOMBRES[id]) anotar(NOMBRES[id]);
    else if (/^g-/.test(id)) anotar('Pulsó ' + id.slice(2));
    else anotar('Pulsó ' + id);
  }, true);

  // Deslizadores y selectores: se anota el valor final, una vez que se deja de moverlos.
  var temporizadores = {};
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.id || el.type !== 'range') return;
    clearTimeout(temporizadores[el.id]);
    temporizadores[el.id] = setTimeout(function () { anotar('Ajustó ' + el.id + ' a ' + el.value); }, 900);
  }, true);
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id && el.tagName === 'SELECT') anotar('Cambió ' + el.id + ' a ' + el.value);
  }, true);

  setInterval(function () { enviar(false); }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { enviar(true); visibleDesde = null; } else { visibleDesde = Date.now(); }
  });
  window.addEventListener('pagehide', function () { enviar(true); });
})();
