import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { CedulaEcuatorianaValidator } from '../common/validators/cedula-ecuatoriana.validator.js';
import { CondicionIngreso } from '../habilitados/enums/condicion-ingreso.enum.js';

export interface EstudianteExcelRow {
  fila: number;
  email: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  matricula: string;
  carrera: string;
  nivel: number;
  condicion_ingreso: CondicionIngreso;
  requisito_pendiente: string | null;
}

export interface ExcelRowError { fila: number; columna: string; mensaje: string; }
export interface ParsedStudentWorkbook { sha256: string; rows: EstudianteExcelRow[]; errors: ExcelRowError[]; }

const HEADERS = ['email', 'nombres', 'apellidos', 'cedula', 'matricula', 'carrera', 'nivel', 'condicion_ingreso', 'requisito_pendiente'];
const MAX_ROWS = 1000;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;

function text(cell: ExcelJS.CellValue): string | null {
  if (typeof cell !== 'string') return null;
  return cell.trim();
}

function inspectZip(buffer: Buffer): void {
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

export async function parseStudentsXlsx(buffer: Buffer): Promise<ParsedStudentWorkbook> {
  if (buffer.length > 5 * 1024 * 1024) throw new BadRequestException('El archivo supera el máximo de 5 MiB.');
  inspectZip(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw new BadRequestException('No se pudo leer el libro XLSX.'); }
  const sheet = workbook.getWorksheet('Estudiantes');
  if (!sheet || workbook.worksheets.length !== 1) throw new BadRequestException('El archivo debe contener únicamente una hoja llamada Estudiantes.');
  const errors: ExcelRowError[] = [];
  const headerRow = sheet.getRow(1);
  const headers = HEADERS.map((_header, index) => {
    const value = headerRow.getCell(index + 1).value;
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  });
  if (headers.length !== HEADERS.length || HEADERS.some((header, index) => headers[index] !== header)) throw new BadRequestException(`La fila 1 debe contener, en este orden: ${HEADERS.join(', ')}.`);
  const rows: EstudianteExcelRow[] = [];
  const emailRows = new Map<string, number>();
  const idRows = new Map<string, number>();
  const cedulaCheck = new CedulaEcuatorianaValidator();
  let usedRows = 0;
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number > 1 && HEADERS.some((_header, index) => row.getCell(index + 1).value !== null && row.getCell(index + 1).value !== undefined && row.getCell(index + 1).value !== '')) usedRows += 1;
  });
  if (usedRows > MAX_ROWS) throw new BadRequestException('El archivo supera el máximo de 1000 filas de estudiantes.');

  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number === 1) return;
    if (row.hidden) { errors.push({ fila: number, columna: 'fila', mensaje: 'No se permiten filas ocultas.' }); return; }
    let incompatibleCell = false;
    let extraData = false;
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const value = cell.value;
      const structured = typeof value === 'object' && value !== null;
      if (cell.formula || cell.hyperlink || (structured && 'sharedFormula' in value)) incompatibleCell = true;
      if (column > HEADERS.length && value !== null && value !== undefined && value !== '') extraData = true;
    });
    if (incompatibleCell) { errors.push({ fila: number, columna: 'fila', mensaje: 'No se permiten fórmulas ni enlaces.' }); return; }
    if (extraData) { errors.push({ fila: number, columna: 'fila', mensaje: 'La fila contiene datos fuera de las columnas permitidas.' }); return; }
    const cells = HEADERS.map((_header, index) => row.getCell(index + 1));
    const values = cells.map((cell) => cell.value);
    const get = (index: number) => text(values[index] as ExcelJS.CellValue);
    const email = get(0)?.toLowerCase() ?? '';
    const nombres = get(1) ?? '';
    const apellidos = get(2) ?? '';
    const cedula = get(3) ?? '';
    const matricula = get(4) ?? '';
    const carrera = get(5) ?? '';
    const rawLevel = values[6];
    const nivel = typeof rawLevel === 'number' ? rawLevel : typeof rawLevel === 'string' && /^\d+$/.test(rawLevel.trim()) ? Number(rawLevel) : Number.NaN;
    const condicionRaw = get(7)?.toUpperCase() ?? '';
    const condicion = Object.values(CondicionIngreso).find((item) => item === condicionRaw);
    const requirement = get(8);
    const field = (column: string, message: string) => errors.push({ fila: number, columna: column, mensaje: message });
    if (!/^[^@\s]+@live\.uleam\.edu\.ec$/.test(email) || email.length > 150) field('email', 'Debe ser un correo @live.uleam.edu.ec válido.');
    if (!nombres || nombres.length > 100) field('nombres', 'Es obligatorio y admite máximo 100 caracteres.');
    if (!apellidos || apellidos.length > 100) field('apellidos', 'Es obligatorio y admite máximo 100 caracteres.');
    if (!cedulaCheck.validate(cedula)) field('cedula', 'La cédula debe ser válida y estar guardada como texto.');
    if (!matricula || matricula.length > 20) field('matricula', 'Es obligatoria, debe ser texto y admite máximo 20 caracteres.');
    if (!carrera || carrera.length > 120) field('carrera', 'Es obligatoria y admite máximo 120 caracteres.');
    if (!Number.isInteger(nivel) || nivel < 1 || nivel > 32767) field('nivel', 'Debe ser entero entre 1 y 32767.');
    if (!condicion) field('condicion_ingreso', 'Debe ser REGULAR o CONDICIONADO.');
    if (condicion === CondicionIngreso.REGULAR && requirement) field('requisito_pendiente', 'REGULAR debe tener este campo vacío.');
    if (condicion === CondicionIngreso.CONDICIONADO && !requirement) field('requisito_pendiente', 'CONDICIONADO requiere un requisito pendiente.');
    for (const [key, value] of [['email', email], ['cedula', cedula], ['matricula', matricula]] as const) {
      const previous = (key === 'email' ? emailRows : idRows).get(key === 'email' ? value : `${key}:${value}`);
      if (previous !== undefined) field(key, `Está duplicado con la fila ${previous}.`);
      else (key === 'email' ? emailRows : idRows).set(key === 'email' ? value : `${key}:${value}`, number);
    }
    if (condicion) rows.push({ fila: number, email, nombres, apellidos, cedula, matricula, carrera, nivel, condicion_ingreso: condicion, requisito_pendiente: condicion === CondicionIngreso.CONDICIONADO ? requirement : null });
  });
  if (rows.length === 0 && errors.length === 0) throw new BadRequestException('El libro no contiene filas de estudiantes.');
  return { sha256: createHash('sha256').update(buffer).digest('hex'), rows, errors };
}
