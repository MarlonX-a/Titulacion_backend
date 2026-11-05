import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import {
  cellText,
  HEADER_SCAN_ROWS,
  isEmpty,
  isUnsafeCell,
  loadWorkbook,
  MAX_ROWS,
  normalizeExcelText,
  titleCase,
  type ExcelRowError,
} from './estudiantes-excel.parser.js';

export type TipoDocenteExcel = 'NOMBRAMIENTO' | 'CONTRATO' | null;

export interface DocenteExcelRow {
  fila: number;
  nombres: string;
  apellidos: string;
  email: string;
  tipo: TipoDocenteExcel;
  habilitado_tutoria: boolean;
  /** Aviso no bloqueante que se muestra en la vista previa. */
  advertencia: string | null;
}

export interface ParsedTeacherWorkbook { sha256: string; rows: DocenteExcelRow[]; errors: ExcelRowError[]; }

export const TEACHER_HEADERS = ['DOCENTES', 'Tipo'] as const;
export const TEACHER_SHEET_NAME = 'Tutores';
export const TEACHER_EMAIL_DOMAIN = 'live.uleam.edu.ec';

const HEADER_LIST = TEACHER_HEADERS.join(', ');
const TIPO_DESCONOCIDO = 'Tipo vacío o no reconocido (se esperaba Nombramiento o Contratos); se importa sin habilitación de tutoría.';

interface TeacherColumns { docentes: number; tipo: number; }

function findColumns(sheet: ExcelJS.Worksheet): { headerRow: number; columns: TeacherColumns } | null {
  for (let number = 1; number <= HEADER_SCAN_ROWS; number += 1) {
    let docentes: number | null = null;
    let tipo: number | null = null;
    sheet.getRow(number).eachCell({ includeEmpty: false }, (cell, column) => {
      const value = cellText(cell.value);
      if (value === null) return;
      const header = normalizeExcelText(value);
      if (header === 'docentes' && docentes === null) docentes = column;
      if (header === 'tipo' && tipo === null) tipo = column;
    });
    if (docentes !== null && tipo !== null) return { headerRow: number, columns: { docentes, tipo } };
  }
  return null;
}

/** Usa la hoja «Tutores» si existe; si no, la primera hoja con los encabezados DOCENTES y Tipo. */
function selectSheet(workbook: ExcelJS.Workbook): { sheet: ExcelJS.Worksheet; headerRow: number; columns: TeacherColumns } {
  const named = workbook.worksheets.find((sheet) => normalizeExcelText(sheet.name) === normalizeExcelText(TEACHER_SHEET_NAME));
  if (named) {
    const found = findColumns(named);
    if (!found) throw new BadRequestException(`La hoja "${named.name}" no tiene los encabezados ${HEADER_LIST} en sus primeras ${HEADER_SCAN_ROWS} filas.`);
    return { sheet: named, ...found };
  }
  for (const sheet of workbook.worksheets) {
    const found = findColumns(sheet);
    if (found) return { sheet, ...found };
  }
  throw new BadRequestException(`No se encontró la hoja "${TEACHER_SHEET_NAME}" ni otra hoja con los encabezados ${HEADER_LIST}.`);
}

function readTipo(value: ExcelJS.CellValue): TipoDocenteExcel {
  const text = cellText(value);
  const normalized = text === null ? '' : normalizeExcelText(text);
  if (/^nombramientos?$/.test(normalized)) return 'NOMBRAMIENTO';
  if (/^contratos?$/.test(normalized)) return 'CONTRATO';
  return null;
}

const TIPO_PRIORITY: Record<'NOMBRAMIENTO' | 'CONTRATO' | 'NULL', number> = { NOMBRAMIENTO: 2, CONTRATO: 1, NULL: 0 };

function priority(tipo: TipoDocenteExcel): number {
  return TIPO_PRIORITY[tipo ?? 'NULL'];
}

function emailPart(word: string): string {
  return normalizeExcelText(word).replace(/[^a-z0-9]/g, '');
}

/** «APELLIDO1 APELLIDO2 NOMBRE1 [NOMBRE2…]» → nombres, apellidos y correo nombre1.apellido1. */
export function splitTeacherName(value: string): { nombres: string; apellidos: string; email: string } | null {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  const first = emailPart(words[2]);
  const last = emailPart(words[0]);
  if (!first || !last) return null;
  return {
    apellidos: titleCase(words.slice(0, 2).join(' ')),
    nombres: titleCase(words.slice(2).join(' ')),
    email: `${first}.${last}@${TEACHER_EMAIL_DOMAIN}`,
  };
}

export async function parseTeachersXlsx(buffer: Buffer): Promise<ParsedTeacherWorkbook> {
  const { sheet, headerRow, columns } = selectSheet(await loadWorkbook(buffer));

  const dataRows: ExcelJS.Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number > headerRow && !isEmpty(row.getCell(columns.docentes).value)) dataRows.push(row);
  });
  if (dataRows.length > MAX_ROWS) throw new BadRequestException(`El archivo supera el máximo de ${MAX_ROWS} filas de docentes.`);

  const errors: ExcelRowError[] = [];
  const rows: DocenteExcelRow[] = [];
  const byName = new Map<string, DocenteExcelRow>();
  const emailOwners = new Map<string, { name: string; fila: number }>();
  for (const row of dataRows) {
    const number = row.number;
    const nameCell = row.getCell(columns.docentes);
    const tipoCell = row.getCell(columns.tipo);
    if (isUnsafeCell(nameCell) || isUnsafeCell(tipoCell)) {
      errors.push({ fila: number, columna: 'fila', mensaje: 'No se permiten fórmulas ni enlaces en las columnas importadas.' });
      continue;
    }
    const raw = cellText(nameCell.value);
    if (raw === null) {
      errors.push({ fila: number, columna: 'DOCENTES', mensaje: 'Debe ser texto con apellidos y nombres.' });
      continue;
    }
    const fullName = normalizeExcelText(raw);
    const tipo = readTipo(tipoCell.value);
    const previous = byName.get(fullName);
    if (previous) {
      if (priority(tipo) > priority(previous.tipo)) {
        previous.tipo = tipo;
        previous.habilitado_tutoria = tipo === 'NOMBRAMIENTO';
        previous.advertencia = null;
      }
      continue;
    }
    const split = splitTeacherName(raw);
    if (!split) {
      errors.push({ fila: number, columna: 'DOCENTES', mensaje: 'Debe contener dos apellidos y al menos un nombre (APELLIDO1 APELLIDO2 NOMBRE1 …).' });
      continue;
    }
    if (split.nombres.length > 100 || split.apellidos.length > 100 || split.email.length > 150) {
      errors.push({ fila: number, columna: 'DOCENTES', mensaje: 'Los nombres y apellidos admiten máximo 100 caracteres.' });
      continue;
    }
    const owner = emailOwners.get(split.email);
    if (owner && owner.name !== fullName) {
      errors.push({ fila: number, columna: 'DOCENTES', mensaje: `Genera el mismo correo (${split.email}) que otro docente de la fila ${owner.fila}; regístralo manualmente.` });
      continue;
    }
    emailOwners.set(split.email, { name: fullName, fila: number });
    const parsed: DocenteExcelRow = {
      fila: number, ...split, tipo, habilitado_tutoria: tipo === 'NOMBRAMIENTO',
      advertencia: tipo === null ? TIPO_DESCONOCIDO : null,
    };
    byName.set(fullName, parsed);
    rows.push(parsed);
  }
  if (rows.length === 0 && errors.length === 0) throw new BadRequestException('El libro no contiene filas de docentes.');
  return { sha256: createHash('sha256').update(buffer).digest('hex'), rows, errors };
}
