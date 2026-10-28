import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseTeachersXlsx, TEACHER_REQUIRED_HEADERS } from './docentes-excel.parser.js';
import { buildTeachersTemplate, TEACHER_TEMPLATE_HEADER_ROW } from './docentes-excel.template.js';

async function workbook(rows: unknown[][], headers: string[] = [...TEACHER_REQUIRED_HEADERS], headerRow = 4): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Docentes');
  sheet.getCell('A1').value = 'LISTA DE DOCENTES';
  headers.forEach((value, index) => { sheet.getCell(headerRow, index + 1).value = value; });
  rows.forEach((values, rowIndex) => values.forEach((value, index) => {
    sheet.getCell(headerRow + 1 + rowIndex, index + 1).value = value as ExcelJS.CellValue;
  }));
  return Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer);
}

describe('parseTeachersXlsx', () => {
  it('lee las columnas de la plantilla, normaliza el correo y SI/NO sin distinguir mayúsculas ni tildes', async () => {
    const parsed = await parseTeachersXlsx(await workbook([
      ['1316661675', 'Rosa', 'Mera', 'Rosa.Mera@ULEAM.edu.ec', 'Magíster', 'Sistemas', 'sí'],
      [102030400, 'Luis', 'Vera', 'luis@live.uleam.edu.ec', 'Ing.', 'Software', ' no '],
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { fila: 5, cedula: '1316661675', nombres: 'Rosa', apellidos: 'Mera', email: 'rosa.mera@uleam.edu.ec', titulo_academico: 'Magíster', departamento: 'Sistemas', habilitado_tutoria: true },
      { fila: 6, cedula: '0102030400', nombres: 'Luis', apellidos: 'Vera', email: 'luis@live.uleam.edu.ec', titulo_academico: 'Ing.', departamento: 'Software', habilitado_tutoria: false },
    ]);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('acepta encabezados con mayúsculas, tildes o espacios y en otro orden', async () => {
    const parsed = await parseTeachersXlsx(await workbook(
      [['Sistemas', 'NO', 'Rosa', 'Mera', '1316661675', 'rosa@uleam.edu.ec', 'Magíster']],
      ['Departamento', 'Habilitado Tutoría', 'Nombres', 'Apellidos', 'Cédula', 'EMAIL', 'Título'],
      1,
    ));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ cedula: '1316661675', habilitado_tutoria: false, titulo_academico: 'Magíster' });
  });

  it('acepta el enlace mailto que Excel crea para el correo visible', async () => {
    const parsed = await parseTeachersXlsx(await workbook([
      ['1316661675', 'Rosa', 'Mera', { text: 'rosa@uleam.edu.ec', hyperlink: 'mailto:rosa@uleam.edu.ec' }, 'Magíster', 'Sistemas', 'SI'],
    ]));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].email).toBe('rosa@uleam.edu.ec');
  });

  it('informa errores por fila: cédula, dominio, SI/NO, duplicados y fórmulas', async () => {
    const parsed = await parseTeachersXlsx(await workbook([
      ['0102030401', 'Rosa', 'Mera', 'rosa@uleam.edu.ec', 'Magíster', 'Sistemas', 'SI'],
      ['1316661675', 'Luis', 'Vera', 'luis@gmail.com', 'Ing.', 'Sistemas', 'TAL VEZ'],
      ['1316661675', 'Ana', 'Loor', 'ana@uleam.edu.ec', 'Ing.', 'Sistemas', 'NO'],
      ['0102030400', 'Ana', 'Loor', 'ana@uleam.edu.ec', 'Ing.', 'Sistemas', 'NO'],
      ['0102030418', '', 'Loor', 'x@uleam.edu.ec', { formula: '1+1' }, 'Sistemas', 'NO'],
      ['0102030426', 'Eva', 'Loor', { text: 'eva@uleam.edu.ec', hyperlink: 'https://malicioso.example' }, 'Ing.', 'Sistemas', 'NO'],
    ]));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ fila: 7, columna: 'cedula', mensaje: expect.stringContaining('fila 6') }),
      expect.objectContaining({ fila: 5, columna: 'cedula' }),
      expect.objectContaining({ fila: 6, columna: 'email', mensaje: expect.stringContaining('@uleam.edu.ec') }),
      expect.objectContaining({ fila: 6, columna: 'habilitado_tutoria' }),
      expect.objectContaining({ fila: 8, columna: 'email', mensaje: expect.stringContaining('fila 7') }),
      expect.objectContaining({ fila: 9, columna: 'fila' }),
      expect.objectContaining({ fila: 10, columna: 'fila' }),
    ]));
  });

  it('rechaza libros sin encabezados obligatorios o sin filas', async () => {
    await expect(parseTeachersXlsx(await workbook([['1316661675']], ['cedula', 'nombres']))).rejects.toThrow('Faltan encabezados obligatorios');
    await expect(parseTeachersXlsx(await workbook([], ['otra']))).rejects.toThrow('No se encontró la fila de encabezados');
    await expect(parseTeachersXlsx(await workbook([]))).rejects.toThrow('no contiene filas de docentes');
    await expect(parseTeachersXlsx(Buffer.from('no es xlsx'))).rejects.toThrow();
  });

  it('la plantilla descargable se puede leer con el mismo parser', async () => {
    const template = await buildTeachersTemplate();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(template as unknown as Parameters<typeof book.xlsx.load>[0]);
    const sheet = book.worksheets[0];
    expect(sheet.getRow(TEACHER_TEMPLATE_HEADER_ROW).values).toEqual([undefined, ...TEACHER_REQUIRED_HEADERS]);
    ['1316661675', 'Rosa', 'Mera', 'rosa@uleam.edu.ec', 'Magíster', 'Sistemas', 'SI'].forEach((value, index) => {
      sheet.getCell(TEACHER_TEMPLATE_HEADER_ROW + 1, index + 1).value = value;
    });
    const parsed = await parseTeachersXlsx(Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
  });
});
