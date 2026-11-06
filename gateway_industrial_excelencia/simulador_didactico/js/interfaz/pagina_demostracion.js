(function () {
  const panel = PCT.panelAutomatico;
  panel.iniciarPanelAutomatico(true);
  PCT.barraOperacion.iniciarBarra({ alCambiarVelocidad: panel.ponerVelocidad });
  PCT.bucle.iniciarBucle(panel.alPaso);
  PCT.ayuda.iniciarAyuda('demostracion', panel.estadoActual);
})();
