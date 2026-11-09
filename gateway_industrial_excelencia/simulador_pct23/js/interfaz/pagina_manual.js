(function () {
  const panel = PCT.panelManual;
  panel.iniciarPanelManual(panel.crearEstadoManual());
  PCT.barraOperacion.iniciarBarra({ alCambiarVelocidad: panel.ponerVelocidad });
  PCT.bucle.iniciarBucle(panel.alPaso);
  PCT.ayuda.iniciarAyuda('manual', panel.estadoActual);
})();
