import { describe, expect, it } from 'vitest';
import { ExportacionFormato } from './enums/exportacion-formato.enum.js';
import { renderExportacion, safeSpreadsheetCell } from './exportacion-archivo.js';

const data = {
  columnas: ['Matrícula', 'Nombre', 'Observación'],
  filas: [{ Matrícula: '00123', Nombre: 'José Ñacato', Observación: '=HYPERLINK("x")' }],
};
const meta = { periodo: 'Período académico', filtros: {}, fecha_corte: new Date('2026-10-12T18:00:00Z') };

describe('renderExportacion', () => {
  it('conserva encabezados, ceros iniciales, Unicode y neutraliza fórmulas en CSV', async () => {
    const output = await renderExportacion(ExportacionFormato.CSV, data, meta);
    const text = output.toString('utf8');
    expect(text).toContain('Matrícula');
    expect(text).toContain('"00123"');
    expect(text).toContain('José Ñacato');
    expect(text).toContain("'=HYPERLINK");
  });

  it('genera un XLSX y neutraliza texto que Excel podría ejecutar como fórmula', async () => {
    const output = await renderExportacion(ExportacionFormato.XLSX, data, meta);
    expect(output.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(safeSpreadsheetCell('00123')).toBe('00123');
    expect(safeSpreadsheetCell('=HYPERLINK("x")')).toBe("'=HYPERLINK(\"x\")");
    expect(safeSpreadsheetCell('  =HYPERLINK("x")')).toBe("'  =HYPERLINK(\"x\")");
    expect(safeSpreadsheetCell('\n+SUM(A1:A2)')).toBe("'\n+SUM(A1:A2)");
  });

  it('genera un PDF válido incluso cuando el reporte no tiene filas', async () => {
    const output = await renderExportacion(ExportacionFormato.PDF, { columnas: ['Matrícula', 'Nombre'], filas: [] }, meta);
    expect(output.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(output.length).toBeGreaterThan(500);
  });
});
