import ExcelJS from 'exceljs';

export const STUDENT_TEMPLATE_HEADER_ROW = 6;
const TEMPLATE_DATA_ROWS = 1000;

export async function buildStudentsTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Estudiantes');
  sheet.getCell('A1').value = 'LISTA DE ESTUDIANTES HABILITADOS PARA EL PROCESO DE TITULACIÓN';
  sheet.getCell('A2').value = 'CARRERA <NOMBRE>';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A2').font = { bold: true };
  sheet.getCell('A3').value = 'Reemplaza <NOMBRE> por la carrera. Registra los estudiantes desde la fila 7; ACADEMICO e INGLES aceptan SI o NO.';
  sheet.getCell('A3').font = { italic: true };
  sheet.columns = [
    { key: 'numero', width: 6 },
    { key: 'campus', width: 14 },
    { key: 'identificacion', width: 16 },
    { key: 'apellidos', width: 28 },
    { key: 'nombres', width: 28 },
    { key: 'nivel', width: 8 },
    { key: 'academico', width: 12 },
    { key: 'ingles', width: 10 },
  ];
  const header = sheet.getRow(STUDENT_TEMPLATE_HEADER_ROW);
  header.values = ['#', 'Campus', 'Identificación', 'Apellidos', 'Nombres', 'nivel', 'ACADEMICO', 'INGLES'];
  header.font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: STUDENT_TEMPLATE_HEADER_ROW }];
  for (let row = STUDENT_TEMPLATE_HEADER_ROW + 1; row <= STUDENT_TEMPLATE_HEADER_ROW + TEMPLATE_DATA_ROWS; row += 1) {
    sheet.getCell(`C${row}`).numFmt = '@';
    for (const column of ['G', 'H']) {
      sheet.getCell(`${column}${row}`).dataValidation = {
        type: 'list', formulae: ['"SI,NO"'], allowBlank: true, showErrorMessage: true,
        errorTitle: 'Valor no permitido', error: 'Escribe SI o NO.',
      };
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
