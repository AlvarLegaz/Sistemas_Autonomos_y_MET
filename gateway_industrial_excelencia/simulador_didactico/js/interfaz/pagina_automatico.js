(function () {
  const panel = PCT.panelAutomatico;
  panel.iniciarPanelAutomatico(false);
  PCT.barraOperacion.iniciarBarra({ alCambiarVelocidad: panel.ponerVelocidad });
  PCT.bucle.iniciarBucle(panel.alPaso);
  PCT.ayuda.iniciarAyuda('automatico', panel.estadoActual);
})();
