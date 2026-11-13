'use strict';
// Prueba de contrato (C1–C37) contra la fábrica real de la planta real HTST (CONTRATO.md §1).
const { probarFabricaReal } = require('./contrato.js');

probarFabricaReal('planta_real', 'simulador_planta_real/js/modelo/contrato_htst.js');
