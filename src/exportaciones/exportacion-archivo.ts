import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { ReporteDatos } from '../reportes/reportes.service.js';
import { ExportacionFormato } from './enums/exportacion-formato.enum.js';

export interface ExportacionMetadatos { periodo: string; filtros: Record<string, unknown>; fecha_corte: Date }

export function safeSpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date
    ? new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'short', timeStyle: 'medium' }).format(value)
    : String(value);
  return /^\s*[=+\-@]/u.test(text) ? `'${text}` : text;
}

const cell = safeSpreadsheetCell;

function csv(data: ReporteDatos, meta: ExportacionMetadatos): Buffer {
  const rows: unknown[][] = [
    ['Período', meta.periodo],
    ['Fecha de corte', cell(meta.fecha_corte)],
    ['Filtros', JSON.stringify(meta.filtros)],
    [],
    data.columnas,
    ...data.filas.map((row) => data.columnas.map((column) => row[column])),
  ];
  const content = rows.map((row) => row.map((value) => `"${cell(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  return Buffer.from(`\uFEFF${content}`, 'utf8');
}

async function xlsx(data: ReporteDatos, meta: ExportacionMetadatos): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sistema de Gestión del Proceso de Titulación';
  const sheet = workbook.addWorksheet('Reporte');
  sheet.addRow(['Período', meta.periodo]);
  sheet.addRow(['Fecha de corte', cell(meta.fecha_corte)]);
  sheet.addRow(['Filtros', JSON.stringify(meta.filtros)]);
  sheet.addRow([]);
  sheet.addRow(data.columnas);
  sheet.getRow(5).font = { bold: true };
  for (const column of sheet.columns ?? []) column.width = 24;
  for (const row of data.filas) sheet.addRow(data.columnas.map((column) => {
    const value = row[column];
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return cell(value);
  }));
  sheet.views = [{ state: 'frozen', ySplit: 5 }];
  const written = await workbook.xlsx.writeBuffer();
  return Buffer.from(written);
}

async function pdf(data: ReporteDatos, meta: ExportacionMetadatos): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, autoFirstPage: true, bufferPages: false });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const drawHeader = (): void => {
    doc.fontSize(15).font('Helvetica-Bold').text('Sistema de Gestión del Proceso de Titulación');
    doc.moveDown(0.25).fontSize(9).font('Helvetica').text(`Reporte: período ${meta.periodo} | Corte: ${meta.fecha_corte.toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`);
    doc.text(`Filtros: ${JSON.stringify(meta.filtros)}`);
    doc.moveDown(0.7);
  };
  drawHeader();
  const widths = data.columnas.map(() => Math.max(50, (doc.page.width - 72) / Math.max(data.columnas.length, 1)));
  const row = (values: string[], bold = false): void => {
    const height = Math.max(22, ...values.map((value, index) => doc.heightOfString(value, { width: (widths[index] ?? widths[0]!) - 6 }) + 8));
    if (doc.y + height > doc.page.height - 36) { doc.addPage(); drawHeader(); }
    const startY = doc.y;
    let x = 36;
    values.forEach((value, index) => {
      const width = widths[index] ?? widths[0]!;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 7 : 6.5).text(value, x + 3, startY + 4, { width: width - 6, height: height - 4, ellipsis: true });
      x += width;
    });
    doc.y = startY + height;
    doc.moveTo(36, doc.y).lineTo(doc.page.width - 36, doc.y).lineWidth(0.3).strokeColor('#cccccc').stroke();
  };
  row(data.columnas, true);
  if (!data.filas.length) row(['Sin resultados para los filtros seleccionados.']);
  for (const record of data.filas) row(data.columnas.map((column) => cell(record[column])));
  doc.end();
  return done;
}

export async function renderExportacion(formato: ExportacionFormato, datos: ReporteDatos, meta: ExportacionMetadatos): Promise<Buffer> {
  if (formato === ExportacionFormato.CSV) return csv(datos, meta);
  if (formato === ExportacionFormato.XLSX) return xlsx(datos, meta);
  return pdf(datos, meta);
}

