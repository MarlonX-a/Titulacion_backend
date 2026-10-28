import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { CedulaEcuatorianaValidator } from '../common/validators/cedula-ecuatoriana.validator.js';

export interface EstudianteExcelRow {
  fila: number;
  email: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  matricula: string;
  carrera: string;
  nivel: number;
  habilitado: boolean;
}

export interface ExcelRowError { fila: number; columna: string; mensaje: string; }
export interface ParsedStudentWorkbook { sha256: string; rows: EstudianteExcelRow[]; errors: ExcelRowError[]; }

export const STUDENT_REQUIRED_HEADERS = ['identificacion', 'apellidos', 'nombres', 'nivel', 'academico', 'ingles'] as const;
type RequiredHeader = (typeof STUDENT_REQUIRED_HEADERS)[number];

export const HEADER_SCAN_ROWS = 20;
export const MAX_ROWS = 1000;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const STUDENT_EMAIL_DOMAIN = 'live.uleam.edu.ec';
const LOWERCASE_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'para', 'con']);

export function normalizeExcelText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function cellText(value: ExcelJS.CellValue): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && value !== null && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join('').trim();
  }
  return null;
}

export function isEmpty(value: ExcelJS.CellValue): boolean {
  return value === null || value === undefined || cellText(value) === '';
}

export function isUnsafeCell(cell: ExcelJS.Cell): boolean {
  const value = cell.value;
  const structured = typeof value === 'object' && value !== null;
  return Boolean(cell.formula) || Boolean(cell.hyperlink) || (structured && ('sharedFormula' in value || 'formula' in value || 'hyperlink' in value));
}

function titleCase(value: string): string {
  return value.toLowerCase().split(/\s+/).filter(Boolean).map((word, index) =>
    index > 0 && LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
  ).join(' ');
}

export function inspectZip(buffer: Buffer): void {
  let eocd = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) eocd = offset;
  }
  if (eocd < 0 || buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new BadRequestException('El archivo no es un libro XLSX válido.');
  const entries = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries < 1 || entries > 1000 || directoryOffset >= eocd) throw new BadRequestException('El libro XLSX excede los límites permitidos.');
  let offset = directoryOffset;
  let expanded = 0;
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) throw new BadRequestException('La estructura comprimida del XLSX no es válida.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || flags & 1 || (method !== 0 && method !== 8) || offset + 46 + nameLength + extraLength + commentLength > eocd) throw new BadRequestException('El libro XLSX usa compresión o cifrado no permitido.');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).toLowerCase();
    if (name.includes('xl/vbaproject.bin') || name.startsWith('/') || name.includes('../')) throw new BadRequestException('No se permiten macros ni rutas internas no válidas.');
    expanded += uncompressed;
    if (expanded > MAX_EXPANDED_BYTES || (compressed > 0 && uncompressed / compressed > 200)) throw new BadRequestException('El contenido descomprimido excede el límite de seguridad.');
    offset += 46 + nameLength + extraLength + commentLength;
  }
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  for (let number = 1; number <= HEADER_SCAN_ROWS; number += 1) {
    let found = false;
    sheet.getRow(number).eachCell({ includeEmpty: false }, (cell) => {
      const value = cellText(cell.value);
      if (value !== null && normalizeExcelText(value) === 'identificacion') found = true;
    });
    if (found) return number;
  }
  throw new BadRequestException(`No se encontró la fila de encabezados en las primeras ${HEADER_SCAN_ROWS} filas. Encabezados obligatorios: Identificación, Apellidos, Nombres, nivel, ACADEMICO, INGLES.`);
}

function mapColumns(sheet: ExcelJS.Worksheet, headerRow: number): Record<RequiredHeader, number> {
  const columns = new Map<RequiredHeader, number>();
  sheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, column) => {
    const value = cellText(cell.value);
    if (value === null) return;
    const header = STUDENT_REQUIRED_HEADERS.find((item) => item === normalizeExcelText(value));
    if (header && !columns.has(header)) columns.set(header, column);
  });
  const missing = STUDENT_REQUIRED_HEADERS.filter((header) => !columns.has(header));
  if (missing.length > 0) throw new BadRequestException(`Faltan encabezados obligatorios en la fila ${headerRow}: ${missing.join(', ')}. Encabezados obligatorios: Identificación, Apellidos, Nombres, nivel, ACADEMICO, INGLES.`);
  return Object.fromEntries(columns) as Record<RequiredHeader, number>;
}

function findCareer(sheet: ExcelJS.Worksheet, headerRow: number): string {
  for (let number = 1; number < headerRow; number += 1) {
    let career: string | null = null;
    sheet.getRow(number).eachCell({ includeEmpty: false }, (cell) => {
      const value = cellText(cell.value);
      const match = career === null && value !== null ? /^carrera\s+(?:de\s+)?(.+)$/i.exec(value.replace(/\s+/g, ' ')) : null;
      if (match) career = match[1].trim();
    });
    if (career !== null) {
      const name = titleCase(career);
      if (/[<>]/.test(name)) throw new BadRequestException('Reemplaza el marcador de carrera del título (por ejemplo, "CARRERA SOFTWARE").');
      if (name.length > 120) throw new BadRequestException('El nombre de la carrera admite máximo 120 caracteres.');
      return name;
    }
  }
  throw new BadRequestException('No se encontró la carrera en el título del archivo; agrega una celda como "CARRERA SOFTWARE" sobre los encabezados.');
}

export function readCedula(value: ExcelJS.CellValue): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value).padStart(10, '0');
  return cellText(value) ?? '';
}

function readNivel(value: ExcelJS.CellValue): number {
  if (typeof value === 'number') return value;
  const textValue = cellText(value);
  return textValue !== null && /^\d+$/.test(textValue) ? Number(textValue) : Number.NaN;
}

export function readSiNo(value: ExcelJS.CellValue): boolean | null {
  const textValue = cellText(value);
  const normalized = textValue === null ? '' : normalizeExcelText(textValue);
  if (normalized === 'si') return true;
  if (normalized === 'no') return false;
  return null;
}

/** Aplica los límites de tamaño y estructura ZIP antes de abrir la primera hoja del libro. */
export async function loadFirstSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  if (buffer.length > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el máximo de 5 MiB.');
  inspectZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw new BadRequestException('No se pudo leer el libro XLSX.'); }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('El libro no contiene hojas.');
  return sheet;
}

export async function parseStudentsXlsx(buffer: Buffer): Promise<ParsedStudentWorkbook> {
  const sheet = await loadFirstSheet(buffer);
  const headerRow = findHeaderRow(sheet);
  const columns = mapColumns(sheet, headerRow);
  const carrera = findCareer(sheet, headerRow);
  const mapped = STUDENT_REQUIRED_HEADERS.map((header) => columns[header]);

  const dataRows: ExcelJS.Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number > headerRow && mapped.some((column) => !isEmpty(row.getCell(column).value))) dataRows.push(row);
  });
  if (dataRows.length > MAX_ROWS) throw new BadRequestException('El archivo supera el máximo de 1000 filas de estudiantes.');

  const errors: ExcelRowError[] = [];
  const rows: EstudianteExcelRow[] = [];
  const cedulaRows = new Map<string, number>();
  const cedulaCheck = new CedulaEcuatorianaValidator();
  for (const row of dataRows) {
    const number = row.number;
    if (mapped.some((column) => isUnsafeCell(row.getCell(column)))) {
      errors.push({ fila: number, columna: 'fila', mensaje: 'No se permiten fórmulas ni enlaces en las columnas importadas.' });
      continue;
    }
    const value = (header: RequiredHeader) => row.getCell(columns[header]).value;
    const rowErrors: ExcelRowError[] = [];
    const field = (column: string, message: string) => rowErrors.push({ fila: number, columna: column, mensaje: message });
    const cedula = readCedula(value('identificacion'));
    const apellidos = cellText(value('apellidos')) ?? '';
    const nombres = cellText(value('nombres')) ?? '';
    const nivel = readNivel(value('nivel'));
    const academico = readSiNo(value('academico'));
    const ingles = readSiNo(value('ingles'));
    if (!cedulaCheck.validate(cedula)) field('identificacion', 'La cédula debe tener 10 dígitos y ser válida.');
    if (!apellidos || apellidos.length > 100) field('apellidos', 'Es obligatorio y admite máximo 100 caracteres.');
    if (!nombres || nombres.length > 100) field('nombres', 'Es obligatorio y admite máximo 100 caracteres.');
    if (!Number.isInteger(nivel) || nivel < 1 || nivel > 32767) field('nivel', 'Debe ser entero entre 1 y 32767.');
    if (academico === null) field('academico', 'Debe ser SI o NO.');
    if (ingles === null) field('ingles', 'Debe ser SI o NO.');
    if (cedula) {
      const previous = cedulaRows.get(cedula);
      if (previous !== undefined) field('identificacion', `Está duplicado con la fila ${previous}.`);
      else cedulaRows.set(cedula, number);
    }
    if (rowErrors.length > 0) { errors.push(...rowErrors); continue; }
    rows.push({
      fila: number, email: `e${cedula}@${STUDENT_EMAIL_DOMAIN}`, nombres, apellidos, cedula, matricula: cedula,
      carrera, nivel, habilitado: academico === true && ingles === true,
    });
  }
  if (rows.length === 0 && errors.length === 0) throw new BadRequestException('El libro no contiene filas de estudiantes.');
  return { sha256: createHash('sha256').update(buffer).digest('hex'), rows, errors };
}
