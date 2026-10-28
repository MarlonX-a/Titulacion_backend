import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { CedulaEcuatorianaValidator } from '../common/validators/cedula-ecuatoriana.validator.js';
import {
  cellText,
  HEADER_SCAN_ROWS,
  isEmpty,
  isUnsafeCell,
  loadFirstSheet,
  MAX_ROWS,
  normalizeExcelText,
  readCedula,
  readSiNo,
  type ExcelRowError,
} from './estudiantes-excel.parser.js';

export interface DocenteExcelRow {
  fila: number;
  cedula: string;
  nombres: string;
  apellidos: string;
  email: string;
  titulo_academico: string;
  departamento: string;
  habilitado_tutoria: boolean;
}

export interface ParsedTeacherWorkbook { sha256: string; rows: DocenteExcelRow[]; errors: ExcelRowError[]; }

export const TEACHER_REQUIRED_HEADERS = ['cedula', 'nombres', 'apellidos', 'email', 'titulo', 'departamento', 'habilitado_tutoria'] as const;
type TeacherHeader = (typeof TEACHER_REQUIRED_HEADERS)[number];

const HEADER_LIST = TEACHER_REQUIRED_HEADERS.join(', ');
/** DOCENTE y ADMIN pueden usar @uleam.edu.ec o @live.uleam.edu.ec (AGENTS.md, Usuarios). */
const TEACHER_EMAIL = /^[^@\s]+@(?:live\.)?uleam\.edu\.ec$/;
const BASIC_EMAIL = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/;

function normalizeHeader(value: string): string {
  return normalizeExcelText(value).replace(/[\s-]+/g, '_');
}

function findHeaderRow(sheet: ExcelJS.Worksheet): number {
  for (let number = 1; number <= HEADER_SCAN_ROWS; number += 1) {
    let found = false;
    sheet.getRow(number).eachCell({ includeEmpty: false }, (cell) => {
      const value = cellText(cell.value);
      if (value !== null && normalizeHeader(value) === 'cedula') found = true;
    });
    if (found) return number;
  }
  throw new BadRequestException(`No se encontró la fila de encabezados en las primeras ${HEADER_SCAN_ROWS} filas. Encabezados obligatorios: ${HEADER_LIST}.`);
}

function mapColumns(sheet: ExcelJS.Worksheet, headerRow: number): Record<TeacherHeader, number> {
  const columns = new Map<TeacherHeader, number>();
  sheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, column) => {
    const value = cellText(cell.value);
    if (value === null) return;
    const header = TEACHER_REQUIRED_HEADERS.find((item) => item === normalizeHeader(value));
    if (header && !columns.has(header)) columns.set(header, column);
  });
  const missing = TEACHER_REQUIRED_HEADERS.filter((header) => !columns.has(header));
  if (missing.length > 0) throw new BadRequestException(`Faltan encabezados obligatorios en la fila ${headerRow}: ${missing.join(', ')}. Encabezados obligatorios: ${HEADER_LIST}.`);
  return Object.fromEntries(columns) as Record<TeacherHeader, number>;
}

/**
 * Excel convierte los correos escritos en enlaces `mailto:`. Se acepta ese enlace solo cuando
 * apunta exactamente al texto visible; cualquier otro enlace o fórmula se rechaza.
 */
function readEmail(cell: ExcelJS.Cell): { email: string; unsafe: boolean } {
  const value = cell.value;
  if (typeof value === 'object' && value !== null && 'hyperlink' in value && 'text' in value && !cell.formula) {
    const text = typeof value.text === 'string' ? value.text.trim() : cellText(value.text as ExcelJS.CellValue) ?? '';
    const link = String(value.hyperlink).trim().toLowerCase();
    const safe = link === `mailto:${text.toLowerCase()}` || link === text.toLowerCase();
    return { email: text.toLowerCase(), unsafe: !safe };
  }
  return { email: (cellText(value) ?? '').toLowerCase(), unsafe: isUnsafeCell(cell) };
}

function textField(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max;
}

export async function parseTeachersXlsx(buffer: Buffer): Promise<ParsedTeacherWorkbook> {
  const sheet = await loadFirstSheet(buffer);
  const headerRow = findHeaderRow(sheet);
  const columns = mapColumns(sheet, headerRow);
  const mapped = TEACHER_REQUIRED_HEADERS.map((header) => columns[header]);

  const dataRows: ExcelJS.Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number > headerRow && mapped.some((column) => !isEmpty(row.getCell(column).value))) dataRows.push(row);
  });
  if (dataRows.length > MAX_ROWS) throw new BadRequestException(`El archivo supera el máximo de ${MAX_ROWS} filas de docentes.`);

  const errors: ExcelRowError[] = [];
  const rows: DocenteExcelRow[] = [];
  const cedulaRows = new Map<string, number>();
  const emailRows = new Map<string, number>();
  const cedulaCheck = new CedulaEcuatorianaValidator();
  for (const row of dataRows) {
    const number = row.number;
    const emailCell = readEmail(row.getCell(columns.email));
    const otherColumns = mapped.filter((column) => column !== columns.email);
    if (emailCell.unsafe || otherColumns.some((column) => isUnsafeCell(row.getCell(column)))) {
      errors.push({ fila: number, columna: 'fila', mensaje: 'No se permiten fórmulas ni enlaces en las columnas importadas.' });
      continue;
    }
    const value = (header: TeacherHeader) => row.getCell(columns[header]).value;
    const rowErrors: ExcelRowError[] = [];
    const field = (column: string, message: string) => rowErrors.push({ fila: number, columna: column, mensaje: message });
    const cedula = readCedula(value('cedula'));
    const nombres = cellText(value('nombres')) ?? '';
    const apellidos = cellText(value('apellidos')) ?? '';
    const email = emailCell.email;
    const titulo = cellText(value('titulo')) ?? '';
    const departamento = cellText(value('departamento')) ?? '';
    const habilitado = readSiNo(value('habilitado_tutoria'));
    if (!cedulaCheck.validate(cedula)) field('cedula', 'La cédula debe tener 10 dígitos y ser válida.');
    if (!textField(nombres, 100)) field('nombres', 'Es obligatorio y admite máximo 100 caracteres.');
    if (!textField(apellidos, 100)) field('apellidos', 'Es obligatorio y admite máximo 100 caracteres.');
    if (!textField(email, 150) || !BASIC_EMAIL.test(email)) field('email', 'Es obligatorio, debe tener formato de correo y máximo 150 caracteres.');
    else if (!TEACHER_EMAIL.test(email)) field('email', 'El correo de un docente debe ser @uleam.edu.ec o @live.uleam.edu.ec.');
    if (!textField(titulo, 120)) field('titulo', 'Es obligatorio y admite máximo 120 caracteres.');
    if (!textField(departamento, 120)) field('departamento', 'Es obligatorio y admite máximo 120 caracteres.');
    if (habilitado === null) field('habilitado_tutoria', 'Debe ser SI o NO.');
    if (cedula) {
      const previous = cedulaRows.get(cedula);
      if (previous !== undefined) field('cedula', `Está duplicada con la fila ${previous}.`);
      else cedulaRows.set(cedula, number);
    }
    if (email) {
      const previous = emailRows.get(email);
      if (previous !== undefined) field('email', `Está duplicado con la fila ${previous}.`);
      else emailRows.set(email, number);
    }
    if (rowErrors.length > 0) { errors.push(...rowErrors); continue; }
    rows.push({
      fila: number, cedula, nombres, apellidos, email,
      titulo_academico: titulo, departamento, habilitado_tutoria: habilitado === true,
    });
  }
  if (rows.length === 0 && errors.length === 0) throw new BadRequestException('El libro no contiene filas de docentes.');
  return { sha256: createHash('sha256').update(buffer).digest('hex'), rows, errors };
}
