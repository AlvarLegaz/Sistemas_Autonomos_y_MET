'use strict';
// Prueba de contrato (C1–C37) contra la fábrica real de la fotovoltaica (CONTRATO.md §1).
const { probarFabricaReal } = require('./contrato.js');

probarFabricaReal('fotovoltaica', 'simulador_fotovoltaica/js/modelo/contrato_fv.js');
