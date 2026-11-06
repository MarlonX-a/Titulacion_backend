import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { cellText, HEADER_SCAN_ROWS, isUnsafeCell, loadWorkbook, MAX_ROWS, normalizeExcelText } from './estudiantes-excel.parser.js';

export const TOPIC_HEADERS = ['Nro.', 'Docente', 'Temas', 'Carrera', 'Observación'] as const;
export const TOPIC_SHEET_NAME = 'Temas';
export const MAX_TITULO = 250;

export interface TemaExcelRow {
  fila: number;
  nro: string | null;
  docente: string;
  titulo: string;
  descripcion: string | null;
  /** Career written in the file; informative only (the form's career wins). */
  carrera: string | null;
  /** The normalized title already appeared in an earlier row of the file. */
  duplicado: boolean;
  errores: string[];
  advertencias: string[];
}

export interface ParsedTemasWorkbook { sha256: string; rows: TemaExcelRow[]; }

type Columna = 'nro' | 'docente' | 'temas' | 'carrera' | 'observacion';

const ALIAS: Record<string, Columna> = {
  nro: 'nro', no: 'nro', 'n°': 'nro', 'nº': 'nro', numero: 'nro',
  docente: 'docente', docentes: 'docente',
  tema: 'temas', temas: 'temas',
  carrera: 'carrera',
  observacion: 'observacion', observaciones: 'observacion',
};

function headerKey(value: string): Columna | undefined {
  return ALIAS[normalizeExcelText(value).replace(/[.:]/g, '').trim()];
}

function textoCelda(value: ExcelJS.CellValue): string | null {
  const text = cellText(value);
  if (text !== null) return text.length > 0 ? text.replace(/\s+/g, ' ') : null;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Locates the header row by text (case/accent-insensitive) within the first HEADER_SCAN_ROWS rows. */
function findColumns(sheet: ExcelJS.Worksheet): { headerRow: number; columns: Partial<Record<Columna, number>> } | null {
  for (let number = 1; number <= HEADER_SCAN_ROWS; number += 1) {
    const columns: Partial<Record<Columna, number>> = {};
    sheet.getRow(number).eachCell({ includeEmpty: false }, (cell, column) => {
      const value = cellText(cell.value);
      const key = value === null ? undefined : headerKey(value);
      if (key && columns[key] === undefined) columns[key] = column;
    });
    if (columns.docente !== undefined && columns.temas !== undefined) return { headerRow: number, columns };
  }
  return null;
}

/** Same career when equal or when one name contains the other (the sheet often abbreviates it). */
export function carrerasCoinciden(archivo: string, seleccionada: string): boolean {
  const a = normalizeExcelText(archivo);
  const b = normalizeExcelText(seleccionada);
  return a === b || a.includes(b) || b.includes(a);
}

export async function parseTemasXlsx(buffer: Buffer, carreraSeleccionada: string): Promise<ParsedTemasWorkbook> {
  const workbook = await loadWorkbook(buffer);
  let sheet: ExcelJS.Worksheet | undefined;
  let found: ReturnType<typeof findColumns> = null;
  for (const candidate of workbook.worksheets) {
    found = findColumns(candidate);
    if (found) { sheet = candidate; break; }
  }
  if (!sheet || !found) throw new BadRequestException(`No se encontró una hoja con los encabezados Docente y Temas en sus primeras ${HEADER_SCAN_ROWS} filas.`);
  const { headerRow, columns } = found;

  const rows: TemaExcelRow[] = [];
  const titulos = new Map<string, number>();
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number <= headerRow) return;
    const celdas = (Object.entries(columns) as Array<[Columna, number]>).map(([columna, indice]) => [columna, row.getCell(indice)] as const);
    const valor = (columna: Columna): string | null => {
      const celda = celdas.find(([nombre]) => nombre === columna)?.[1];
      return celda ? textoCelda(celda.value) : null;
    };
    const docente = valor('docente') ?? '';
    const titulo = valor('temas') ?? '';
    if (!docente && !titulo) return;
    const errores: string[] = [];
    const advertencias: string[] = [];
    if (celdas.some(([, celda]) => isUnsafeCell(celda))) errores.push('No se permiten fórmulas ni enlaces en las columnas importadas.');
    if (!titulo) errores.push('La columna Temas es obligatoria.');
    else if (titulo.length > MAX_TITULO) errores.push(`El tema supera ${MAX_TITULO} caracteres (${titulo.length}).`);
    if (!docente) errores.push('La columna Docente es obligatoria.');
    const carrera = valor('carrera');
    if (carrera && !carrerasCoinciden(carrera, carreraSeleccionada)) {
      advertencias.push(`La carrera del archivo («${carrera}») no coincide con la seleccionada («${carreraSeleccionada}»); se usa la seleccionada.`);
    }
    const clave = normalizeExcelText(titulo);
    const previa = titulo ? titulos.get(clave) : undefined;
    if (previa !== undefined) advertencias.push(`Tema repetido en el archivo (fila ${previa}); se omitirá.`);
    else if (titulo) titulos.set(clave, number);
    rows.push({ fila: number, nro: valor('nro'), docente, titulo, descripcion: valor('observacion'), carrera, duplicado: previa !== undefined, errores, advertencias });
  });
  if (rows.length === 0) throw new BadRequestException('El libro no contiene temas.');
  if (rows.length > MAX_ROWS) throw new BadRequestException(`El archivo supera el máximo de ${MAX_ROWS} temas.`);
  return { sha256: createHash('sha256').update(buffer).digest('hex'), rows };
}
