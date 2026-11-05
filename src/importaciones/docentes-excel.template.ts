import ExcelJS from 'exceljs';
import { TEACHER_HEADERS, TEACHER_SHEET_NAME } from './docentes-excel.parser.js';

export const TEACHER_TEMPLATE_HEADER_ROW = 1;
const TEMPLATE_DATA_ROWS = 1000;

export const TEACHER_TEMPLATE_EXAMPLES = [
  ['ALMEIDA ZAMBRANO EDISON ERNESTO', 'Nombramiento'],
  ['VELASQUEZ MOREIRA GABRIELA MAHOLY', 'Contratos'],
] as const;

export async function buildTeachersTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TEACHER_SHEET_NAME);
  sheet.columns = [{ key: 'docentes', width: 42 }, { key: 'tipo', width: 18 }, { key: 'nota', width: 80 }];
  const header = sheet.getRow(TEACHER_TEMPLATE_HEADER_ROW);
  header.values = [...TEACHER_HEADERS];
  header.font = { bold: true };
  sheet.getCell('C1').value = 'DOCENTES: APELLIDO1 APELLIDO2 NOMBRES. El correo se genera como nombre.apellido@live.uleam.edu.ec. Tipo: Nombramiento (habilita tutoría) o Contratos.';
  sheet.getCell('C1').font = { italic: true };
  TEACHER_TEMPLATE_EXAMPLES.forEach((values, index) => { sheet.getRow(TEACHER_TEMPLATE_HEADER_ROW + 1 + index).values = [...values]; });
  sheet.views = [{ state: 'frozen', ySplit: TEACHER_TEMPLATE_HEADER_ROW }];
  for (let row = TEACHER_TEMPLATE_HEADER_ROW + 1; row <= TEACHER_TEMPLATE_HEADER_ROW + TEMPLATE_DATA_ROWS; row += 1) {
    sheet.getCell(`B${row}`).dataValidation = {
      type: 'list', formulae: ['"Nombramiento,Contratos"'], allowBlank: true, showErrorMessage: true,
      errorTitle: 'Valor no permitido', error: 'Escribe Nombramiento o Contratos.',
    };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
