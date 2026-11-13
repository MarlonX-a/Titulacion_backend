import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { inflateRawSync, inflateSync } from 'node:zlib';

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
  aplicarReglas({ formato: 'pdf', ...inspeccionarPdf(buffer) });
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
  aplicarReglas({
    formato: 'docx',
    nombres: entries.map((entry) => entry.name),
    leer: (patron) => entries.filter((entry) => patron.test(entry.name)).map((entry) => readEntry(buffer, entry)),
  });
}

/*
 * Contenido activo (M5). Cada regla rechaza una construcción que ejecuta código o contacta un
 * servidor al abrir el archivo. Para revertir una regla basta con quitarla de este arreglo.
 *
 * Hipervínculos: una tesis cita fuentes en línea, así que en DOCX se admiten las relaciones
 * externas de tipo `hyperlink` con destino http(s). Cualquier otra relación externa (plantilla
 * adjunta remota, imagen o marco enlazado, OLE vinculado) o un destino que no sea http(s)
 * (`file:`, `mailto:`, UNC, `javascript:`) se rechaza. En PDF las anotaciones de enlace /URI se
 * admiten; `/OpenAction` solo se admite con un destino explícito (`[página /Fit]`), que es la vista
 * inicial que generan LaTeX y otros conversores.
 */
interface PdfInspeccionado { completo: string; estructura: string }
interface DocxInspeccionado { nombres: string[]; leer: (patron: RegExp) => string[] }
type InspeccionArchivo = ({ formato: 'pdf' } & PdfInspeccionado) | ({ formato: 'docx' } & DocxInspeccionado);

export type ReglaContenido =
  | { codigo: string; formato: 'pdf'; mensaje: string; detecta: (pdf: PdfInspeccionado) => boolean }
  | { codigo: string; formato: 'docx'; mensaje: string; detecta: (docx: DocxInspeccionado) => boolean };

/** Nombre PDF completo: no lo sigue otro carácter regular (lo que no es espacio ni delimitador). */
const nombrePdf = (nombre: string, despues = '') => new RegExp(`/${nombre}(?![^\\s()<>\\[\\]{}/%])${despues}`);

export const REGLAS_CONTENIDO_ACTIVO: readonly ReglaContenido[] = [
  {
    codigo: 'DOCX_RELACION_EXTERNA', formato: 'docx',
    mensaje: 'El DOCX contiene una relación externa no permitida (solo se admiten hipervínculos http o https).',
    detecta: (docx) => docx.leer(/\.rels$/i).some(relacionesExternasNoPermitidas),
  },
  {
    codigo: 'DOCX_OBJETO_INCRUSTADO', formato: 'docx',
    mensaje: 'El DOCX contiene objetos incrustados u OLE/ActiveX, que no se permiten.',
    detecta: (docx) => docx.nombres.some((nombre) => /^word\/embeddings\//i.test(nombre) || /(^|\/)activeX\//i.test(nombre) || /oleObject/i.test(nombre))
      || docx.leer(/^\[content_types\]\.xml$/i).some((tipos) => /oleObject|activeX/i.test(tipos)),
  },
  {
    codigo: 'DOCX_CAMPO_DDE', formato: 'docx',
    mensaje: 'El DOCX contiene campos DDE, que no se permiten.',
    detecta: (docx) => docx.leer(/^word\/(?:glossary\/)?[^/]+\.xml$/i).some((parte) => /(?:^|[^A-Za-z])DDE(?:AUTO)?(?=[\s"\\]|$)/i.test(instruccionesCampo(parte))),
  },
  {
    // Cifrado: cadenas y streams son texto cifrado y ninguna otra regla puede inspeccionarlos (con
    // contraseña de usuario vacía el lector lo abre sin pedirla). Regla conservadora: el nombre
    // /Encrypt en cualquier parte del archivo o de los streams de objetos, no solo en "el" trailer.
    codigo: 'PDF_CIFRADO', formato: 'pdf',
    mensaje: 'El PDF está cifrado o protegido con contraseña y no se puede inspeccionar; expórtelo de nuevo sin protección por contraseña.',
    detecta: (pdf) => nombrePdf('Encrypt').test(pdf.completo),
  },
  {
    codigo: 'PDF_JAVASCRIPT', formato: 'pdf', mensaje: 'El PDF contiene JavaScript, que no se permite.',
    detecta: (pdf) => nombrePdf('JavaScript').test(pdf.completo) || nombrePdf('JS').test(pdf.estructura),
  },
  { codigo: 'PDF_LAUNCH', formato: 'pdf', mensaje: 'El PDF contiene una acción de ejecución (/Launch), que no se permite.', detecta: (pdf) => nombrePdf('Launch').test(pdf.completo) },
  {
    codigo: 'PDF_OPEN_ACTION', formato: 'pdf', mensaje: 'El PDF ejecuta una acción al abrirse (/OpenAction), que no se permite.',
    detecta: (pdf) => nombrePdf('OpenAction', '(?!\\s*\\[)').test(pdf.estructura),
  },
  { codigo: 'PDF_ACCIONES_ADICIONALES', formato: 'pdf', mensaje: 'El PDF contiene acciones automáticas (/AA), que no se permiten.', detecta: (pdf) => nombrePdf('AA').test(pdf.estructura) },
  { codigo: 'PDF_ARCHIVO_INCRUSTADO', formato: 'pdf', mensaje: 'El PDF contiene archivos incrustados, que no se permiten.', detecta: (pdf) => nombrePdf('EmbeddedFiles?').test(pdf.completo) },
  { codigo: 'PDF_RICH_MEDIA', formato: 'pdf', mensaje: 'El PDF contiene contenido multimedia activo (/RichMedia), que no se permite.', detecta: (pdf) => nombrePdf('RichMedia').test(pdf.completo) },
];

function aplicarReglas(archivo: InspeccionArchivo): void {
  for (const regla of REGLAS_CONTENIDO_ACTIVO) {
    const detectada = regla.formato === 'pdf'
      ? archivo.formato === 'pdf' && regla.detecta(archivo)
      : archivo.formato === 'docx' && regla.detecta(archivo);
    if (detectada) throw new BadRequestException(regla.mensaje);
  }
}

/**
 * Una referencia numérica fuera del rango Unicode (`&#x110000;`, `&#9999999;`) no es XML válido
 * (Word no abre el documento) y `String.fromCodePoint` lanzaría un RangeError (HTTP 500): se
 * rechaza el archivo como no inspeccionable.
 */
function caracterXml(codigo: number): string {
  if (!Number.isSafeInteger(codigo) || codigo > 0x10ffff) throw new BadRequestException(DOCX_NO_INSPECCIONABLE);
  return String.fromCodePoint(codigo);
}

function decodificarXml(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => caracterXml(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => caracterXml(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function atributoXml(atributos: string, nombre: string): string | null {
  const match = new RegExp(`(?:^|\\s)${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(atributos);
  return match ? decodificarXml(match[1] ?? match[2] ?? '') : null;
}

/*
 * Todo el análisis de esta sección es de una sola pasada, O(n) en el tamaño de la entrada: bucles
 * guiados por `indexOf` que siempre avanzan y expresiones regulares solo sobre fragmentos acotados.
 * Ninguna expresión puede volver a recorrer el resto de la entrada desde muchas posiciones (una
 * subida maliciosa no debe bloquear el bucle de eventos). Los presupuestos de trabajo son una
 * segunda defensa: superarlos rechaza el archivo como no inspeccionable, nunca lo acepta.
 */
const DOCX_NO_INSPECCIONABLE = 'El DOCX contiene estructuras que no se pueden inspeccionar.';
const DOCX_MAX_RELACIONES = 20_000;
const DOCX_MAX_CAMPOS = 50_000;
const DOCX_MAX_ETIQUETA = 16 * 1024;
const XML_RELACION = /^<(?:[\w.-]{1,64}:)?Relationship\b/;

const esCaracterPalabra = (codigo: number) => (codigo >= 48 && codigo <= 57) || (codigo >= 65 && codigo <= 90) || (codigo >= 97 && codigo <= 122) || codigo === 95;
const esEspacioXml = (codigo: number) => codigo === 32 || codigo === 9 || codigo === 10 || codigo === 13;

function relacionesExternasNoPermitidas(rels: string): boolean {
  let posicion = 0;
  let relaciones = 0;
  for (;;) {
    const inicio = rels.indexOf('<', posicion);
    if (inicio < 0) return false;
    const etiqueta = XML_RELACION.exec(rels.slice(inicio, inicio + 96));
    if (!etiqueta) { posicion = inicio + 1; continue; }
    const fin = rels.indexOf('>', inicio);
    relaciones += 1;
    if (fin < 0 || fin - inicio > DOCX_MAX_ETIQUETA || relaciones > DOCX_MAX_RELACIONES) throw new BadRequestException(DOCX_NO_INSPECCIONABLE);
    const atributos = rels.slice(inicio + etiqueta[0].length, fin);
    posicion = fin + 1;
    if ((atributoXml(atributos, 'TargetMode') ?? '').trim().toLowerCase() !== 'external') continue;
    const tipo = (atributoXml(atributos, 'Type') ?? '').trim();
    const destino = (atributoXml(atributos, 'Target') ?? '').trim();
    if (!/\/hyperlink$/i.test(tipo) || !/^https?:\/\/[^\s"<>\\]+$/i.test(destino)) return true;
  }
}

/**
 * Texto de las instrucciones de campo (`w:instrText` y `w:fldSimple/@w:instr`) de una parte de Word,
 * en orden de documento: Word puede repartir una instrucción entre varios `w:instrText` seguidos.
 */
function instruccionesCampo(parte: string): string {
  const partes: string[] = [];
  let posicion = 0;
  while (partes.length <= DOCX_MAX_CAMPOS) {
    const hallazgo = parte.indexOf('w:instr', posicion);
    if (hallazgo < 0) return partes.join('');
    posicion = hallazgo + 'w:instr'.length;
    const esElemento = parte.startsWith('Text', posicion) && !esCaracterPalabra(parte.charCodeAt(posicion + 4));
    if (esElemento && parte.charCodeAt(hallazgo - 1) === 0x3c /* < */) {
      const finApertura = parte.indexOf('>', hallazgo);
      if (finApertura < 0) throw new BadRequestException(DOCX_NO_INSPECCIONABLE);
      posicion = finApertura + 1;
      if (parte.charCodeAt(finApertura - 1) === 0x2f /* / */) continue;
      const cierre = parte.indexOf('</w:instrText>', finApertura);
      if (cierre < 0) throw new BadRequestException(DOCX_NO_INSPECCIONABLE);
      partes.push(decodificarXml(parte.slice(finApertura + 1, cierre)));
      posicion = cierre + '</w:instrText>'.length;
    } else if (!esElemento && !esCaracterPalabra(parte.charCodeAt(hallazgo - 1))) {
      while (esEspacioXml(parte.charCodeAt(posicion))) posicion += 1;
      if (parte[posicion] !== '=') continue;
      posicion += 1;
      while (esEspacioXml(parte.charCodeAt(posicion))) posicion += 1;
      const comilla = parte[posicion];
      if (comilla !== '"' && comilla !== "'") continue;
      const cierre = parte.indexOf(comilla, posicion + 1);
      if (cierre < 0) throw new BadRequestException(DOCX_NO_INSPECCIONABLE);
      partes.push(decodificarXml(parte.slice(posicion + 1, cierre)));
      posicion = cierre + 1;
    }
  }
  throw new BadRequestException(DOCX_NO_INSPECCIONABLE);
}

const PDF_OBJSTM_MAX_BYTES = 20 * 1024 * 1024;
const PDF_MAX_STREAMS = 50_000;
const PDF_MAX_PROFUNDIDAD = 256;
/** Cabeceras de objeto admitidas en todo el archivo (un PDF real de 10 MiB tiene muchas menos). */
const PDF_MAX_CABECERAS = 500_000;
/** Pasos de la búsqueda cruda de cabeceras y de la resolución de /Length por byte de entrada. */
const PDF_PASOS_POR_BYTE = 4;
const PDF_NO_INSPECCIONABLE = 'El PDF contiene objetos comprimidos o estructuras que no se pueden inspeccionar.';

const esEspacioPdf = (codigo: number) => codigo === 32 || codigo === 10 || codigo === 13 || codigo === 9 || codigo === 12 || codigo === 0;
const NO_REGULAR_PDF = new Set([...'()<>[]{}/%'].map((caracter) => caracter.charCodeAt(0)));
/** Carácter regular PDF: ni espacio ni delimitador `( ) < > [ ] { } / %`. */
const esRegularPdf = (codigo: number) => !esEspacioPdf(codigo) && !NO_REGULAR_PDF.has(codigo);
const esDigito = (codigo: number) => codigo >= 48 && codigo <= 57;
const esFinDeLinea = (codigo: number) => codigo === 10 || codigo === 13;
/**
 * Separadores entre los tokens de una cabecera en la búsqueda cruda: los espacios PDF más VT y
 * NBSP, que algunos lectores aceptan al reconstruir la tabla de referencias. Es más amplio que el
 * analizador léxico a propósito: una cabecera que solo la búsqueda cruda reconoce se rechaza.
 */
const esSeparadorCrudo = (codigo: number) => esEspacioPdf(codigo) || codigo === 0x0b || codigo === 0xa0;
const ENTERO_PDF = /^\d{1,10}$/;
const sinCerosIniciales = (digitos: string) => digitos.replace(/^0+(?=\d)/, '');

/** Trabajo acotado: superarlo rechaza el archivo como no inspeccionable, nunca lo acepta. */
class PresupuestoPdf {
  private restante: number;
  constructor(bytes: number) { this.restante = bytes * PDF_PASOS_POR_BYTE + 1024 * 1024; }
  gastar(pasos: number): void {
    this.restante -= pasos;
    if (this.restante < 0) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  }
}

/**
 * Fin de línea siguiente a una posición (donde termina un comentario). Recuerda los tramos ya
 * recorridos, ordenados y sin solaparse, para que muchos comentarios en la misma línea no la
 * vuelvan a recorrer: cada byte se recorre como máximo una vez.
 */
class FinesDeLinea {
  private readonly inicios: number[] = [];
  private readonly fines: number[] = [];
  constructor(private readonly texto: string, private readonly presupuesto: PresupuestoPdf) {}

  desde(posicion: number): number {
    let bajo = 0;
    let alto = this.inicios.length;
    while (bajo < alto) {
      const medio = (bajo + alto) >>> 1;
      if (this.inicios[medio]! <= posicion) bajo = medio + 1; else alto = medio;
    }
    const previo = bajo - 1;
    if (previo >= 0 && posicion <= this.fines[previo]!) return this.fines[previo]!;
    const siguienteInicio = bajo < this.inicios.length ? this.inicios[bajo]! : Number.POSITIVE_INFINITY;
    let i = posicion;
    while (i < this.texto.length && i < siguienteInicio && !esFinDeLinea(this.texto.charCodeAt(i))) i += 1;
    this.presupuesto.gastar(i - posicion + 1);
    if (i === siguienteInicio) {
      this.inicios[bajo] = posicion;
      return this.fines[bajo]!;
    }
    this.inicios.splice(bajo, 0, posicion);
    this.fines.splice(bajo, 0, i);
    return i;
  }
}

interface CabecerasCrudas {
  /** Posición de la palabra `obj` de cada cabecera, ordenadas y sin repetir. */
  posiciones: Int32Array;
  /** Posiciones de `obj` por objeto (`"número generación"`), para resolver /Length indirectos. */
  porObjeto: Map<string, number[]>;
}

/**
 * Regla 2: localiza toda cabecera `<entero> <entero> obj` en los bytes crudos, esté donde esté
 * (también dentro de datos de streams, cadenas o comentarios), con espacios o comentarios entre sus
 * tokens, igual que la encontraría un lector que salta a un desplazamiento de la tabla de
 * referencias o que la reconstruye. Cada candidato empieza en el primer dígito de una serie.
 */
function buscarCabecerasCrudas(texto: string, presupuesto: PresupuestoPdf): CabecerasCrudas {
  const lineas = new FinesDeLinea(texto, presupuesto);
  const posiciones: number[] = [];
  const porObjeto = new Map<string, number[]>();
  const finDigitos = (desde: number) => {
    let i = desde;
    while (esDigito(texto.charCodeAt(i))) i += 1;
    presupuesto.gastar(i - desde + 1);
    return i;
  };
  const saltarSeparadores = (desde: number) => {
    let i = desde;
    for (;;) {
      const codigo = texto.charCodeAt(i);
      if (esSeparadorCrudo(codigo)) { i += 1; presupuesto.gastar(1); } else if (codigo === 0x25 /* % */) i = lineas.desde(i);
      else return i;
    }
  };
  for (let inicio = 0; inicio < texto.length; inicio += 1) {
    if (!esDigito(texto.charCodeAt(inicio)) || esDigito(texto.charCodeAt(inicio - 1))) continue;
    const finNumero = finDigitos(inicio);
    const inicioGeneracion = saltarSeparadores(finNumero);
    if (inicioGeneracion === finNumero || !esDigito(texto.charCodeAt(inicioGeneracion))) continue;
    const finGeneracion = finDigitos(inicioGeneracion);
    const palabra = saltarSeparadores(finGeneracion);
    if (palabra === finGeneracion || !texto.startsWith('obj', palabra)) continue;
    // `obj` seguido de una letra no es la palabra clave; seguido de dígitos (`obj12`) algunos lectores lo aceptan.
    const despues = palabra + 3 < texto.length ? texto.charCodeAt(palabra + 3) : 32;
    if (esRegularPdf(despues) && !esDigito(despues)) continue;
    if (posiciones.length >= PDF_MAX_CABECERAS) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
    posiciones.push(palabra);
    const clave = `${sinCerosIniciales(texto.slice(inicio, finNumero))} ${sinCerosIniciales(texto.slice(inicioGeneracion, finGeneracion))}`;
    const definiciones = porObjeto.get(clave);
    if (definiciones) definiciones.push(palabra); else porObjeto.set(clave, [palabra]);
  }
  const ordenadas = Int32Array.from(posiciones).sort();
  let unicas = 0;
  for (let k = 0; k < ordenadas.length; k += 1) if (k === 0 || ordenadas[k] !== ordenadas[unicas - 1]) ordenadas[unicas++] = ordenadas[k]!;
  return { posiciones: ordenadas.subarray(0, unicas), porObjeto };
}

/**
 * Regla 1: valor de una referencia `n g R` usada como /Length. Debe resolver a uno o más objetos de
 * nivel superior `n g obj <entero no negativo> endobj` con el mismo valor (una actualización
 * incremental puede repetirlo); cualquier otra cosa no es inspeccionable.
 */
function crearResolutorLongitud(texto: string, porObjeto: Map<string, number[]>, presupuesto: PresupuestoPdf) {
  const resueltas = new Map<string, number>();
  const saltar = (desde: number) => {
    let i = desde;
    for (;;) {
      const codigo = texto.charCodeAt(i);
      if (esEspacioPdf(codigo)) i += 1;
      else if (codigo === 0x25 /* % */) i = finDeLinea(texto, i);
      else break;
    }
    presupuesto.gastar(i - desde + 1);
    return i;
  };
  const enteroDelObjeto = (palabraObj: number): number => {
    const inicio = saltar(palabraObj + 3);
    if (inicio === palabraObj + 3) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
    let fin = inicio;
    while (esDigito(texto.charCodeAt(fin)) && fin - inicio <= 10) fin += 1;
    const digitos = texto.slice(inicio, fin);
    const cierre = saltar(fin);
    if (!ENTERO_PDF.test(digitos) || cierre === fin || !texto.startsWith('endobj', cierre) || esRegularPdf(texto.charCodeAt(cierre + 6) || 32)) {
      throw new BadRequestException(PDF_NO_INSPECCIONABLE);
    }
    return Number(digitos);
  };
  return (numero: string, generacion: string): number => {
    const clave = `${sinCerosIniciales(numero)} ${sinCerosIniciales(generacion)}`;
    const conocida = resueltas.get(clave);
    if (conocida !== undefined) return conocida;
    const definiciones = porObjeto.get(clave);
    if (!definiciones) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
    let valor: number | undefined;
    for (const palabraObj of definiciones) {
      const actual = enteroDelObjeto(palabraObj);
      if (valor !== undefined && actual !== valor) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
      valor = actual;
    }
    resueltas.set(clave, valor!);
    return valor!;
  };
}

/**
 * `completo`: todo el archivo con los nombres normalizados más los streams de objetos
 * descomprimidos, para nombres largos inconfundibles.
 * `estructura`: el archivo sin el contenido de los streams, más los streams de objetos
 * descomprimidos, para nombres cortos (/JS, /AA) que podrían aparecer por azar en datos binarios.
 *
 * Un lector localiza los objetos por desplazamientos (tabla de referencias), no recorriendo el
 * archivo. Para que no exista un desplazamiento al que el lector salte y que este validador haya
 * tratado como datos, se aplican tres reglas:
 * 1. Límites exactos: los datos de un stream miden exactamente su /Length (entero directo o
 *    referencia a un objeto entero de nivel superior) y van seguidos del fin de línea opcional y de
 *    `endstream`. Nunca se busca "el primer `endstream`".
 * 2. Ninguna cabecera fuera de la vista del analizador: toda cabecera `n g obj` de los bytes crudos
 *    debe ser una que el analizador léxico reconoció en el nivel superior; una cabecera dentro de
 *    datos de un stream, una cadena o un comentario se rechaza como estructura ambigua.
 * 3. Streams de objetos por lo que los hace utilizables: `/Type /ObjStm`, o la clave `/First`, o
 *    la clave `/N`. Se descomprimen (FlateDecode o sin filtro) y se inspeccionan; si no se puede,
 *    el archivo se rechaza. Esto incluye los perfiles ICC (`/N 3`).
 */
function inspeccionarPdf(buffer: Buffer): PdfInspeccionado {
  const texto = buffer.toString('latin1');
  const presupuesto = new PresupuestoPdf(texto.length);
  const crudas = buscarCabecerasCrudas(texto, presupuesto);
  const resolverLongitud = crearResolutorLongitud(texto, crudas.porObjeto, presupuesto);
  const cabecerasLexico: number[] = [];
  const fueraDeStreams: string[] = [];
  const objetos: string[] = [];
  const estado = { descomprimido: 0, streams: 0 };
  let inicioSegmento = 0;
  let profundidad = 0;
  let diccionario: string[] = [];
  /** Tokens del último diccionario de nivel superior, mientras ningún otro token lo siga. */
  let diccionarioPrevio: string[] | null = null;
  /** Enteros consecutivos en el nivel superior (sin contar espacios ni comentarios): `n g` antes de `obj`. */
  let enteros = 0;
  const registrar = (token: string) => {
    if (profundidad > 0) diccionario.push(token); else diccionarioPrevio = null;
    enteros = 0;
  };
  let i = 0;
  while (i < texto.length) {
    const codigo = texto.charCodeAt(i);
    if (esEspacioPdf(codigo)) { i += 1; continue; }
    if (codigo === 0x25 /* % */) { i = finDeLinea(texto, i); continue; }
    if (codigo === 0x28 /* ( */) { i = finDeCadenaPdf(texto, i); registrar('()'); continue; }
    if (codigo === 0x3c /* < */ && texto.charCodeAt(i + 1) === 0x3c) {
      if (profundidad === 0) { diccionario = []; diccionarioPrevio = null; }
      profundidad += 1;
      enteros = 0;
      if (profundidad > PDF_MAX_PROFUNDIDAD) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
      diccionario.push('<<');
      i += 2;
      continue;
    }
    if (codigo === 0x3c /* < */) {
      const fin = texto.indexOf('>', i + 1);
      if (fin < 0) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
      registrar('<>');
      i = fin + 1;
      continue;
    }
    if (codigo === 0x3e /* > */ && texto.charCodeAt(i + 1) === 0x3e && profundidad > 0) {
      diccionario.push('>>');
      profundidad -= 1;
      enteros = 0;
      if (profundidad === 0) diccionarioPrevio = diccionario;
      i += 2;
      continue;
    }
    if (codigo !== 0x2f /* / */ && !esRegularPdf(codigo)) { registrar(texto[i]!); i += 1; continue; }
    let fin = i + 1;
    while (fin < texto.length && esRegularPdf(texto.charCodeAt(fin))) fin += 1;
    if (fin - i === 6 && texto.startsWith('stream', i)) {
      estado.streams += 1;
      if (!diccionarioPrevio || estado.streams > PDF_MAX_STREAMS) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
      const datos = inicioDatosStream(texto, fin);
      const finDatos = datos + longitudDeclarada(diccionarioPrevio, resolverLongitud);
      const endstream = posicionEndstream(texto, finDatos);
      if (esStreamDeObjetos(diccionarioPrevio)) objetos.push(contenidoStreamDeObjetos(buffer.subarray(datos, finDatos), diccionarioPrevio, estado));
      fueraDeStreams.push(texto.slice(inicioSegmento, datos));
      inicioSegmento = endstream;
      diccionarioPrevio = null;
      enteros = 0;
      i = endstream + 'endstream'.length;
      continue;
    }
    if (profundidad > 0) {
      const token = texto.slice(i, fin);
      diccionario.push(token.includes('#') ? normalizarNombresPdf(token) : token);
      enteros = 0;
    } else {
      diccionarioPrevio = null;
      if (fin - i === 3 && enteros >= 2 && texto.startsWith('obj', i)) cabecerasLexico.push(i);
      let soloDigitos = true;
      for (let k = i; k < fin && soloDigitos; k += 1) soloDigitos = esDigito(texto.charCodeAt(k));
      enteros = soloDigitos ? enteros + 1 : 0;
    }
    i = fin;
  }
  exigirCabecerasReconocidas(crudas.posiciones, cabecerasLexico);
  fueraDeStreams.push(texto.slice(inicioSegmento));
  const descomprimidos = normalizarNombresPdf(objetos.join('\n'));
  return {
    completo: `${normalizarNombresPdf(texto)}\n${descomprimidos}`,
    estructura: `${normalizarNombresPdf(fueraDeStreams.join(''))}\n${descomprimidos}`,
  };
}

/** Regla 2: las cabeceras crudas y las del analizador léxico (ya ordenadas y únicas) deben coincidir. */
function exigirCabecerasReconocidas(crudas: Int32Array, lexico: number[]): void {
  if (crudas.length !== lexico.length) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  for (let k = 0; k < lexico.length; k += 1) if (crudas[k] !== lexico[k]) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
}

function finDeLinea(texto: string, inicio: number): number {
  let i = inicio;
  while (i < texto.length && texto.charCodeAt(i) !== 10 && texto.charCodeAt(i) !== 13) i += 1;
  return i;
}

/** Cadena literal PDF: paréntesis balanceados y escapes con `\`. Sin cierre, el PDF no es inspeccionable. */
function finDeCadenaPdf(texto: string, inicio: number): number {
  let nivel = 0;
  for (let i = inicio; i < texto.length; i += 1) {
    const codigo = texto.charCodeAt(i);
    if (codigo === 0x5c /* \ */) i += 1;
    else if (codigo === 0x28) nivel += 1;
    else if (codigo === 0x29 && (nivel -= 1) === 0) return i + 1;
  }
  throw new BadRequestException(PDF_NO_INSPECCIONABLE);
}

/** Tras `stream` va un fin de línea (CRLF, LF o CR); se toleran espacios previos. */
function inicioDatosStream(texto: string, despues: number): number {
  let i = despues;
  while (texto.charCodeAt(i) === 32 || texto.charCodeAt(i) === 9) i += 1;
  if (texto.startsWith('\r\n', i)) return i + 2;
  if (texto.charCodeAt(i) === 10 || texto.charCodeAt(i) === 13) return i + 1;
  throw new BadRequestException(PDF_NO_INSPECCIONABLE);
}

/** Regla 1: tras los datos solo cabe un fin de línea opcional (CRLF, LF o CR) y luego `endstream`. */
function posicionEndstream(texto: string, finDatos: number): number {
  if (finDatos > texto.length) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  let i = finDatos;
  if (texto.startsWith('\r\n', i)) i += 2;
  else if (esFinDeLinea(texto.charCodeAt(i))) i += 1;
  if (!texto.startsWith('endstream', i) || esRegularPdf(texto.charCodeAt(i + 9) || 32)) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  return i;
}

/** Posición de cada clave de primer nivel del diccionario de un stream (`<< ... >>` anidados aparte). */
function clavesDePrimerNivel(diccionario: string[]): Map<string, number[]> {
  const claves = new Map<string, number[]>();
  let nivel = 0;
  for (let k = 0; k < diccionario.length; k += 1) {
    const token = diccionario[k]!;
    if (token === '<<') nivel += 1;
    else if (token === '>>') nivel -= 1;
    else if (nivel === 1 && token.startsWith('/')) {
      const posiciones = claves.get(token);
      if (posiciones) posiciones.push(k); else claves.set(token, [k]);
    }
  }
  return claves;
}

/** Regla 1: /Length es un entero directo no negativo o una referencia `n g R` que resuelve a uno. */
function longitudDeclarada(diccionario: string[], resolver: (numero: string, generacion: string) => number): number {
  const posiciones = clavesDePrimerNivel(diccionario).get('/Length');
  if (posiciones?.length !== 1) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  const valor = diccionario[posiciones[0]! + 1] ?? '';
  const generacion = diccionario[posiciones[0]! + 2] ?? '';
  if (!ENTERO_PDF.test(valor)) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  if (ENTERO_PDF.test(generacion) && diccionario[posiciones[0]! + 3] === 'R') return resolver(valor, generacion);
  return Number(valor);
}

/**
 * Regla 3: un lector carga objetos comprimidos de cualquier stream con /N, sin mirar /Type, y
 * alguno toma /First como 0 si falta. Basta la clave /N o /First (aunque su valor sea una
 * referencia) o `/Type /ObjStm`; ante la duda, se trata como stream de objetos. Los perfiles ICC
 * (`/N 3`) quedan incluidos: se descomprimen e inspeccionan como cualquier otro.
 */
function esStreamDeObjetos(diccionario: string[]): boolean {
  const claves = clavesDePrimerNivel(diccionario);
  return claves.has('/N') || claves.has('/First') || diccionario.includes('/ObjStm');
}

/** Contenido de un stream de objetos: FlateDecode simple o sin filtro, dentro del presupuesto total. */
function contenidoStreamDeObjetos(datos: Buffer, diccionario: string[], estado: { descomprimido: number }): string {
  const claves = clavesDePrimerNivel(diccionario);
  if (claves.has('/DecodeParms')) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  const filtro = claves.get('/Filter');
  let contenido: Buffer;
  if (!filtro) {
    contenido = datos;
  } else {
    const valor = filtro.length === 1 ? filtro[0]! + 1 : -1;
    const soloFlate = valor > 0 && (diccionario[valor] === '/FlateDecode'
      || (diccionario[valor] === '[' && diccionario[valor + 1] === '/FlateDecode' && diccionario[valor + 2] === ']'));
    if (!soloFlate) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
    try {
      contenido = inflateSync(datos, { maxOutputLength: Math.max(1, PDF_OBJSTM_MAX_BYTES - estado.descomprimido) });
    } catch {
      throw new BadRequestException(PDF_NO_INSPECCIONABLE);
    }
  }
  estado.descomprimido += contenido.length;
  if (estado.descomprimido > PDF_OBJSTM_MAX_BYTES) throw new BadRequestException(PDF_NO_INSPECCIONABLE);
  return contenido.toString('latin1');
}

/** Los nombres PDF admiten escapes hexadecimales: `/J#61vaScript` equivale a `/JavaScript`. */
function normalizarNombresPdf(texto: string): string {
  return texto.replace(/#([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
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
