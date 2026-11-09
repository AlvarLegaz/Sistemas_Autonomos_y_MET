(function () {
  const formatoNumero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

  const $ = id => document.getElementById(id);
  function ponerTexto(id, texto) { $(id).textContent = texto; }
  function ponerClase(id, clase) { $(id).className = clase; }
  function marcarEncendido(id, encendido) { $(id).classList.toggle('on', !!encendido); }

  function formatearEntero(valor) { return formatoNumero.format(valor); }
  function formatearDecimal(valor) { return valor.toFixed(1).replace('.', ','); }
  function formatearTiempo(segundos) {
    const dos = n => String(Math.floor(n)).padStart(2, '0');
    return `${dos(segundos / 3600)}:${dos(segundos % 3600 / 60)}:${dos(segundos % 60)}`;
  }

  PCT.dom = {
    $, ponerTexto, ponerClase, marcarEncendido,
    formatearEntero, formatearDecimal, formatearTiempo,
  };
})();
