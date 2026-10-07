import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseStudentsXlsx } from './estudiantes-excel.parser.js';

const columns = ['email', 'nombres', 'apellidos', 'cedula', 'matricula', 'carrera', 'nivel', 'condicion_ingreso', 'requisito_pendiente'];

async function workbookBuffer(values: unknown[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Estudiantes');
  sheet.addRow(columns);
  sheet.addRow(values);
  return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}

describe('parseStudentsXlsx', () => {
  it('acepta una fila regular conservando cédula/matrícula como texto', async () => {
    const parsed = await parseStudentsXlsx(await workbookBuffer(['persona@live.uleam.edu.ec', 'Ana', 'Pérez', '0102030400', '00125', 'Sistemas', 8, 'REGULAR', null]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toMatchObject([{ email: 'persona@live.uleam.edu.ec', cedula: '0102030400', matricula: '00125', nivel: 8, requisito_pendiente: null }]);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reporta dominio, nivel y requisito condicionado por fila y columna', async () => {
    const parsed = await parseStudentsXlsx(await workbookBuffer(['persona@uleam.edu.ec', 'Ana', 'Pérez', '0102030400', '00125', 'Sistemas', 0, 'CONDICIONADO', '']));
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fila: 2, columna: 'email' }),
      expect.objectContaining({ fila: 2, columna: 'nivel' }),
      expect.objectContaining({ fila: 2, columna: 'requisito_pendiente' }),
    ]));
  });

  it('rechaza fórmulas y columnas ajenas aunque las nueve columnas esperadas sean válidas', async () => {
    const formulaBook = new ExcelJS.Workbook();
    const formulaSheet = formulaBook.addWorksheet('Estudiantes');
    formulaSheet.addRow(columns);
    formulaSheet.addRow(['persona@live.uleam.edu.ec', 'Ana', 'Pérez', '0102030400', '00125', 'Sistemas', 8, 'REGULAR', null]);
    formulaSheet.getCell('J2').value = { formula: '1+1' };
    const parsed = await parseStudentsXlsx(Buffer.from(await formulaBook.xlsx.writeBuffer() as ArrayBuffer));
    expect(parsed.errors[0]).toMatchObject({ fila: 2, columna: 'fila' });
  });
});
