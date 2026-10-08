import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { deflateRawSync } from 'node:zlib';
import { validatePlantillaFile, DOCX_MIME, PDF_MIME, PLANTILLA_PAT_MAX_BYTES } from './plantilla-pat-file.validator.js';

function docx(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const [name, contents] of entries) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(contents);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30 + fileName.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26);
    fileName.copy(local, 30); locals.push(local, compressed);
    const central = Buffer.alloc(46 + fileName.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(localOffset, 42);
    fileName.copy(central, 46); centrals.push(central); localOffset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

function file(name: string, mimetype: string, buffer: Buffer): Express.Multer.File {
  return { originalname: name, mimetype, buffer, size: buffer.length } as Express.Multer.File;
}

describe('validación de archivos de plantilla PAT', () => {
  it('acepta un PDF con cabecera y cierre', () => {
    const result = validatePlantillaFile(file('plantilla.PDF', PDF_MIME, Buffer.from('%PDF-1.7\ncontenido\n%%EOF')));
    expect(result.extension).toBe('pdf');
    expect(result.fileName).toBe('plantilla.PDF');
  });

  it('acepta un DOCX comprimido con los componentes mínimos de Word', () => {
    const valid = docx([
      ['[Content_Types].xml', '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<Relationships/>'],
      ['word/document.xml', '<w:document xmlns:w="urn:word"><w:body/></w:document>'],
    ]);
    expect(validatePlantillaFile(file('plantilla.docx', DOCX_MIME, valid)).extension).toBe('docx');
  });

  it('rechaza contenido renombrado, tipos no admitidos, rutas, cierres incompletos y tamaños excedidos', () => {
    expect(() => validatePlantillaFile(file('falso.pdf', PDF_MIME, Buffer.from('no es pdf')))).toThrow(BadRequestException);
    expect(() => validatePlantillaFile(file('archivo.txt', 'text/plain', Buffer.from('texto')))).toThrow(UnsupportedMediaTypeException);
    expect(() => validatePlantillaFile(file('../plantilla.pdf', PDF_MIME, Buffer.from('%PDF-1.7\n%%EOF')))).toThrow(BadRequestException);
    expect(() => validatePlantillaFile(file('incompleto.pdf', PDF_MIME, Buffer.from('%PDF-1.7')))).toThrow(BadRequestException);
    expect(() => validatePlantillaFile(file('grande.pdf', PDF_MIME, Buffer.alloc(PLANTILLA_PAT_MAX_BYTES + 1)))).toThrow(BadRequestException);
  });

  it('acepta un archivo exactamente en el límite de 10 MiB', () => {
    const maximum = Buffer.alloc(PLANTILLA_PAT_MAX_BYTES, 0x20);
    maximum.write('%PDF-1.7\n', 0);
    maximum.write('%%EOF', maximum.length - 5);
    expect(validatePlantillaFile(file('limite.pdf', PDF_MIME, maximum)).extension).toBe('pdf');
  });

  it('rechaza ZIP corrupto, macros y DOCX que no es un documento Word', () => {
    expect(() => validatePlantillaFile(file('no-valido.docx', DOCX_MIME, Buffer.from('PK')))).toThrow(BadRequestException);
    const macro = docx([
      ['[Content_Types].xml', '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
      ['_rels/.rels', '<Relationships/>'], ['word/document.xml', '<w:document/>'], ['word/vbaProject.bin', 'macro'],
    ]);
    expect(() => validatePlantillaFile(file('macro.docx', DOCX_MIME, macro))).toThrow(BadRequestException);
    const wrong = docx([['[Content_Types].xml', '<Types/>'], ['_rels/.rels', '<Relationships/>'], ['word/document.xml', '<w:document/>']]);
    expect(() => validatePlantillaFile(file('renombrado.docx', DOCX_MIME, wrong))).toThrow(BadRequestException);
  });
});
