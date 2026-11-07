import ExcelJS from 'exceljs';
import { TOPIC_HEADERS, TOPIC_SHEET_NAME } from './temas-excel.parser.js';

export const TOPIC_TEMPLATE_EXAMPLE = [
  '1',
  'ALMEIDA ZAMBRANO EDISON ERNESTO',
  'Sistema de recomendación de cursos basado en aprendizaje automático',
  'INGENIERÍA EN SOFTWARE',
  'Opcional: descripción u observación del tema',
] as const;

export async function buildTopicsTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(TOPIC_SHEET_NAME);
  sheet.columns = [
    { key: 'nro', width: 8 }, { key: 'docente', width: 40 }, { key: 'temas', width: 70 },
    { key: 'carrera', width: 30 }, { key: 'observacion', width: 50 },
  ];
  const header = sheet.getRow(1);
  header.values = [...TOPIC_HEADERS];
  header.font = { bold: true };
  sheet.getRow(2).values = [...TOPIC_TEMPLATE_EXAMPLE];
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
