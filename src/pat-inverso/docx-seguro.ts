import { BadRequestException } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';

/** El Word llenado del PAT no supera el mismo tope que el resto de documentos del módulo. */
export const PAT_DOCX_MAX_BYTES = 10 * 1024 * 1024;
const ENTRADAS_MAX = 1000;
const DESCOMPRIMIDO_MAX = 50 * 1024 * 1024;
const DOCUMENTO_MAX = 2 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface EntradaZip { name: string; method: number; compressed: number; size: number; localOffset: number }

/**
 * Lee únicamente `word/document.xml` de un .docx. Rechaza macros, plantillas externas, ZIP64,
 * cifrado y bombas de descompresión. No ejecuta campos ni relaciones.
 */
export function parrafosDocxOficial(buffer: Buffer, mime: string): string[] {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new BadRequestException('El archivo no es un documento Word (.docx).');
  }
  if (buffer.length > PAT_DOCX_MAX_BYTES) throw new BadRequestException('El archivo supera el máximo de 10 MiB.');
  if (mime && mime !== DOCX_MIME && mime !== 'application/octet-stream') throw new BadRequestException('El archivo debe ser un Word .docx.');
  const entradas = inspeccionarZip(buffer);
  if (entradas.some((entrada) => /vbaProject|vbaData|activeX|embeddings|macro/i.test(entrada.name))) {
    throw new BadRequestException('No se permiten documentos con macros, objetos incrustados o plantillas ejecutables.');
  }
  const tipos = leerEntrada(buffer, exigir(entradas, '[content_types].xml'));
  const documento = leerEntrada(buffer, exigir(entradas, 'word/document.xml'));
  if (!/wordprocessingml\.document\.main\+xml/i.test(tipos) || !/<w:document[\s>]/.test(documento)) {
    throw new BadRequestException('El archivo comprimido no es un documento Word.');
  }
  return parrafosDeXml(documento);
}

export function parrafosDeXml(xml: string): string[] {
  return [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((parrafo) =>
    [...parrafo[0].matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((texto) => decodificarXml(texto[1] ?? '')).join(''),
  ).map((texto) => texto.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function exigir(entradas: EntradaZip[], nombre: string): EntradaZip {
  const encontrada = entradas.find((entrada) => entrada.name.toLowerCase() === nombre);
  if (!encontrada) throw new BadRequestException('El DOCX no contiene la estructura obligatoria de Word.');
  return encontrada;
}

function decodificarXml(valor: string): string {
  return valor
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function inspeccionarZip(buffer: Buffer): EntradaZip[] {
  let fin = -1;
  for (let offset = Math.max(0, buffer.length - 65_557); offset <= buffer.length - 22; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) fin = offset;
  }
  if (fin < 0) throw new BadRequestException('El archivo DOCX no es un contenedor ZIP válido.');
  const cantidad = buffer.readUInt16LE(fin + 10);
  const directorio = buffer.readUInt32LE(fin + 16);
  if (cantidad < 1 || cantidad > ENTRADAS_MAX || directorio >= fin) throw new BadRequestException('El DOCX excede los límites de estructura permitidos.');
  const entradas: EntradaZip[] = [];
  let offset = directorio;
  let expandido = 0;
  for (let i = 0; i < cantidad; i += 1) {
    if (offset + 46 > fin || buffer.readUInt32LE(offset) !== 0x02014b50) throw new BadRequestException('La tabla de contenido comprimida no es válida.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff || (flags & 1) !== 0 || (method !== 0 && method !== 8)) {
      throw new BadRequestException('El DOCX utiliza compresión, cifrado o ZIP64 no permitido.');
    }
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name.startsWith('/') || name.includes('..') || name.includes('\\')) throw new BadRequestException('El DOCX contiene una ruta interna inválida.');
    expandido += size;
    if (expandido > DESCOMPRIMIDO_MAX || (compressed > 0 && size / compressed > 200)) {
      throw new BadRequestException('El contenido descomprimido del DOCX excede los límites permitidos.');
    }
    entradas.push({ name, method, compressed, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entradas;
}

function leerEntrada(buffer: Buffer, entrada: EntradaZip): string {
  if (entrada.size > DOCUMENTO_MAX || entrada.localOffset + 30 > buffer.length || buffer.readUInt32LE(entrada.localOffset) !== 0x04034b50) {
    throw new BadRequestException('El componente DOCX excede el tamaño permitido o está corrupto.');
  }
  const nameLength = buffer.readUInt16LE(entrada.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entrada.localOffset + 28);
  const inicio = entrada.localOffset + 30 + nameLength + extraLength;
  const fin = inicio + entrada.compressed;
  if (fin > buffer.length) throw new BadRequestException('El componente DOCX está incompleto.');
  try {
    const result = entrada.method === 0 ? buffer.subarray(inicio, fin) : inflateRawSync(buffer.subarray(inicio, fin), { maxOutputLength: DOCUMENTO_MAX });
    if (result.length !== entrada.size) throw new Error('tamaño');
    return result.toString('utf8');
  } catch {
    throw new BadRequestException('No se pudo leer el documento Word.');
  }
}
