// Compara con la ejecución real el simulador ORIGINAL y el simulador con el MODELO AJUSTADO (carpeta ../modelo).
// Copia simulador_pct23/js a una carpeta temporal, pone encima los archivos ajustados y ejecuta linea_base.js con ambos.
// Uso (desde esta carpeta): node probar_modelo.js [csv]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const aqui = __dirname;
const csv = process.argv[2] || path.join(aqui, '../datos/sinoptico_pct23_2026-11-27-12-47-50.csv');
const simulador = path.join(aqui, '../../simulador_pct23');
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'gemelo_ajustado_'));
fs.cpSync(path.join(simulador, 'js'), path.join(temporal, 'js'), { recursive: true });
fs.cpSync(path.join(aqui, '../modelo/js'), path.join(temporal, 'js'), { recursive: true });

for (const [nombre, carpeta] of [['Simulador original', simulador], ['Modelo ajustado', temporal]]) {
  const salida = execFileSync(process.execPath, [path.join(aqui, 'linea_base.js'), csv, carpeta], { encoding: 'utf8' });
  console.log(`${nombre}: ${salida.trim().split('\n').pop()}`);
}
fs.rmSync(temporal, { recursive: true, force: true });
