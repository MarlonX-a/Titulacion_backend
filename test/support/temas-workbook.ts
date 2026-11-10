import ExcelJS from 'exceljs';

/**
 * Topics workbook shaped like the institutional sample: title rows above and the header
 * (Nro., Docente, Temas, Carrera, Observación) on row `filasTitulo + 1`.
 */
export async function temasWorkbook(rows: unknown[][], filasTitulo = 8): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Hoja1');
  if (filasTitulo >= 1) sheet.getCell(1, 1).value = 'UNIVERSIDAD LAICA ELOY ALFARO DE MANABÍ';
  if (filasTitulo >= 3) sheet.getCell(3, 1).value = 'BANCO DE TEMAS DE TITULACIÓN';
  const header = filasTitulo + 1;
  ['Nro.', 'Docente', 'Temas', 'Carrera', 'Observación'].forEach((value, index) => { sheet.getCell(header, index + 1).value = value; });
  rows.forEach((values, rowIndex) => values.forEach((value, index) => {
    sheet.getCell(header + 1 + rowIndex, index + 1).value = value as ExcelJS.CellValue;
  }));
  return Buffer.from(await book.xlsx.writeBuffer() as ArrayBuffer);
}
