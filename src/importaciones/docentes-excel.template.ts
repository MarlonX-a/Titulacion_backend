import ExcelJS from 'exceljs';
import { TEACHER_REQUIRED_HEADERS } from './docentes-excel.parser.js';

export const TEACHER_TEMPLATE_HEADER_ROW = 4;
const TEMPLATE_DATA_ROWS = 1000;

export async function buildTeachersTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Docentes');
  sheet.getCell('A1').value = 'LISTA DE DOCENTES DEL PROCESO DE TITULACIÓN';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').value = 'Registra un docente por fila desde la fila 5. El correo debe ser @uleam.edu.ec o @live.uleam.edu.ec; habilitado_tutoria acepta SI o NO.';
  sheet.getCell('A2').font = { italic: true };
  sheet.columns = [
    { key: 'cedula', width: 14 },
    { key: 'nombres', width: 26 },
    { key: 'apellidos', width: 26 },
    { key: 'email', width: 32 },
    { key: 'titulo', width: 30 },
    { key: 'departamento', width: 26 },
    { key: 'habilitado_tutoria', width: 20 },
  ];
  const header = sheet.getRow(TEACHER_TEMPLATE_HEADER_ROW);
  header.values = [...TEACHER_REQUIRED_HEADERS];
  header.font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: TEACHER_TEMPLATE_HEADER_ROW }];
  for (let row = TEACHER_TEMPLATE_HEADER_ROW + 1; row <= TEACHER_TEMPLATE_HEADER_ROW + TEMPLATE_DATA_ROWS; row += 1) {
    sheet.getCell(`A${row}`).numFmt = '@';
    sheet.getCell(`D${row}`).numFmt = '@';
    sheet.getCell(`G${row}`).dataValidation = {
      type: 'list', formulae: ['"SI,NO"'], allowBlank: true, showErrorMessage: true,
      errorTitle: 'Valor no permitido', error: 'Escribe SI o NO.',
    };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
