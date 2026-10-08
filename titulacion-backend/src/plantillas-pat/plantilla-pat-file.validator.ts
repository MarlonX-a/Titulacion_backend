import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';

export const PLANTILLA_PAT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PDF_MIME = 'application/pdf';

export interface ValidatedPlantillaFile {
  extension: 'pdf' | 'docx';
  mimeType: typeof PDF_MIME | typeof DOCX_MIME;
  fileName: string;
}

interface ZipEntry { name: string; method: number; compressed: number; size: number; localOffset: number; }

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

export function validatePlantillaFile(file: Express.Multer.File): ValidatedPlantillaFile {
  if (!Buffer.isBuffer(file.buffer) || file.buffer.length === 0) throw new BadRequestException('El archivo no puede estar vacío.');
  if (file.buffer.length > PLANTILLA_PAT_MAX_BYTES) throw new BadRequestException('El archivo supera el máximo de 10 MiB.');
  if (!file.originalname || file.originalname.length > 200 || file.originalname.includes('/') || file.originalname.includes('\\') || hasControlCharacter(file.originalname)) {
    throw new BadRequestException('El nombre debe tener hasta 200 caracteres y no incluir rutas ni caracteres de control.');
  }
  const match = /\.([^.]+)$/.exec(file.originalname);
  const extension = match?.[1]?.toLowerCase();
  if (extension === 'pdf' && file.mimetype === PDF_MIME) {
    validatePdf(file.buffer);
    return { extension, mimeType: PDF_MIME, fileName: file.originalname };
  }
  if (extension === 'docx' && file.mimetype === DOCX_MIME) {
    validateDocx(file.buffer);
    return { extension, mimeType: DOCX_MIME, fileName: file.originalname };
  }
  throw new UnsupportedMediaTypeException('Solo se admiten archivos PDF o DOCX con extensión y tipo MIME coincidentes.');
}

function validatePdf(buffer: Buffer): void {
  if (!buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new BadRequestException('El contenido no tiene una cabecera PDF válida.');
  const eof = buffer.lastIndexOf(Buffer.from('%%EOF'));
  if (eof < 0 || buffer.length - eof > 1024) throw new BadRequestException('El documento PDF está incompleto o no tiene marcador de cierre.');
}

function validateDocx(buffer: Buffer): void {
  const entries = inspectZip(buffer);
  const required = ['[content_types].xml', '_rels/.rels', 'word/document.xml'];
  for (const name of required) if (!entries.some((entry) => entry.name.toLowerCase() === name)) throw new BadRequestException('El DOCX no contiene la estructura obligatoria de Word.');
  if (entries.some((entry) => /vbaproject|vbaData/i.test(entry.name))) throw new BadRequestException('No se permiten documentos con macros.');
  const contentTypes = readEntry(buffer, entries.find((entry) => entry.name.toLowerCase() === '[content_types].xml')!);
  const document = readEntry(buffer, entries.find((entry) => entry.name.toLowerCase() === 'word/document.xml')!);
  if (/macroEnabled/i.test(contentTypes) || !/wordprocessingml\.document\.main\+xml/i.test(contentTypes) || !/<w:document(?:\s|>)/.test(document)) {
    throw new BadRequestException('El archivo comprimido no corresponde a un documento DOCX válido.');
  }
}

function inspectZip(buffer: Buffer): ZipEntry[] {
  let end = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) if (buffer.readUInt32LE(offset) === 0x06054b50) end = offset;
  if (end < 0 || buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) throw new BadRequestException('El archivo DOCX no es un contenedor ZIP válido.');
  const count = buffer.readUInt16LE(end + 10);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  if (count < 1 || count > 1000 || directoryOffset >= end || buffer.readUInt16LE(end + 8) !== count) throw new BadRequestException('El DOCX excede los límites de estructura permitidos.');
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  let expanded = 0;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new BadRequestException('La tabla de contenido comprimida no es válida.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || flags & 1 || (method !== 0 && method !== 8) || offset + 46 + nameLength + extraLength + commentLength > end) throw new BadRequestException('El DOCX utiliza compresión, cifrado o ZIP64 no permitido.');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name.startsWith('/') || name.includes('..') || name.includes('\\') || hasControlCharacter(name)) throw new BadRequestException('El DOCX contiene una ruta interna inválida.');
    expanded += size;
    if (expanded > 50 * 1024 * 1024 || (compressed > 0 && size / compressed > 200)) throw new BadRequestException('El contenido descomprimido del DOCX excede los límites permitidos.');
    entries.push({ name, method, compressed, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset > end) throw new BadRequestException('La tabla de contenido comprimida no es válida.');
  return entries;
}

function readEntry(buffer: Buffer, entry: ZipEntry): string {
  if (entry.size > 2 * 1024 * 1024 || entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new BadRequestException('El componente DOCX excede el tamaño permitido o está corrupto.');
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressed;
  if (end > buffer.length) throw new BadRequestException('El componente DOCX está incompleto.');
  try {
    const result = entry.method === 0 ? buffer.subarray(start, end) : inflateRawSync(buffer.subarray(start, end), { maxOutputLength: 2 * 1024 * 1024 });
    if (result.length !== entry.size) throw new Error('zip entry size mismatch');
    return result.toString('utf8');
  } catch {
    throw new BadRequestException('No se pudo validar la estructura interna del DOCX.');
  }
}
