#!/usr/bin/env node
// Regenera la plantilla con etiquetas docxtemplater del formato institucional PAT-04-F-002 a partir del
// documento oficial VACÍO. Solo modifica word/document.xml: reemplaza el contenido de los párrafos de
// valor por una etiqueta en un único run (las etiquetas nunca quedan partidas entre runs) y conserva
// propiedades de párrafo, fuentes, bordes, encabezado con logo y notas. Las demás partes del paquete
// se copian sin cambios.
//
// Uso: node scripts/generar-plantilla-pat-docx.mjs <PAT-04-F-002 oficial vacío.docx> [salida.docx]
// Salida predeterminada: src/generaciones-pat/plantillas/PAT-04-F-002.docx
// Las etiquetas y su origen están documentados en src/generaciones-pat/render-pat-docx.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import PizZip from 'pizzip';

const [entrada, salida = join(import.meta.dirname, '..', 'src', 'generaciones-pat', 'plantillas', 'PAT-04-F-002.docx')] = process.argv.slice(2);
if (!entrada) {
  console.error('Uso: node scripts/generar-plantilla-pat-docx.mjs <PAT-04-F-002 oficial vacío.docx> [salida.docx]');
  process.exit(1);
}

const ARIAL = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
const RPR = {
  /** Valor de una celda «Etiqueta: valor» (Arial 10, sin negrita, como el ejemplo institucional lleno). */
  valor10: `${ARIAL}<w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/>`,
  /** Marca «x» de discapacidad y articulación (Arial 8 negrita, como las celdas de marca). */
  marca8: `${ARIAL}<w:b/><w:sz w:val="16"/><w:szCs w:val="16"/>`,
  /** Grado de discapacidad (Arial 8). */
  valor8: `${ARIAL}<w:sz w:val="16"/><w:szCs w:val="16"/>`,
  /** Texto que reemplaza las instrucciones grises de la tabla 2 (Arial 10 negro). */
  contenido10: `${ARIAL}<w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="es-419"/>`,
  contenido10Negrita: `${ARIAL}<w:b/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="es-419"/>`,
};

const zip = new PizZip(readFileSync(entrada));
const RUTA_DOCUMENTO = 'word/document.xml';
const xml = zip.file(RUTA_DOCUMENTO)?.asText();
if (!xml) throw new Error('El archivo no contiene word/document.xml.');

// Párrafos en orden de documento (los de las tablas anidadas incluidos); los párrafos no se anidan.
const PATRON_PARRAFO = /<w:p(?:\s[^>]*?)?(?:\/>|>[\s\S]*?<\/w:p>)/g;
const piezas = [];
let ultimo = 0;
for (const m of xml.matchAll(PATRON_PARRAFO)) {
  piezas.push({ tipo: 'texto', xml: xml.slice(ultimo, m.index) });
  piezas.push({ tipo: 'parrafo', xml: m[0] });
  ultimo = m.index + m[0].length;
}
piezas.push({ tipo: 'texto', xml: xml.slice(ultimo) });
const parrafos = piezas.filter((p) => p.tipo === 'parrafo');

const decodificar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const textoDe = (p) => decodificar([...p.xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''));
const run = (texto, rPr) => `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${escapar(texto)}</w:t></w:r>`;
const rPrPrimerRun = (p) => /<w:r(?:\s[^>]*)?>\s*<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(p.xml)?.[1] ?? RPR.valor10;
const marcadores = (p) => (p.xml.match(/<w:bookmark(?:Start|End)\b[^>]*\/>/g) ?? []).join('');

function buscar(predicado, descripcion) {
  const indices = parrafos.flatMap((p, i) => (predicado(textoDe(p)) ? [i] : []));
  if (indices.length !== 1) throw new Error(`Se esperaba exactamente un párrafo «${descripcion}» y hay ${indices.length}.`);
  return indices[0];
}
const empiezaCon = (prefijo) => buscar((t) => t.startsWith(prefijo), prefijo);
const exacto = (valor) => buscar((t) => t.trim() === valor, valor);

/** Reemplaza los runs del párrafo; conserva la etiqueta de apertura, `w:pPr` y los marcadores. */
function reemplazarRuns(indice, runs) {
  const p = parrafos[indice];
  const apertura = /^<w:p(?:\s[^>]*?)?(?=\/?>)/.exec(p.xml)[0];
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p.xml)?.[0] ?? '';
  p.xml = `${apertura}>${pPr}${runs}${marcadores(p)}</w:p>`;
}
function vacio(indice, descripcion) {
  if (textoDe(parrafos[indice]).trim() !== '') throw new Error(`Se esperaba un párrafo vacío para ${descripcion}.`);
}
function parrafoConPPrDe(indice, contenido) {
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(parrafos[indice].xml)?.[0] ?? '';
  return `<w:p>${pPr}${contenido}</w:p>`;
}

// --- Tabla 1: celdas «Etiqueta: valor» (la etiqueta en negrita y el valor en un run aparte). ---
const CELDAS = [
  [empiezaCon('Facultad/Extensión/Sede:'), 'facultad_extension'],
  [empiezaCon('Carrera:'), 'carrera'],
  [empiezaCon('Nombres y apellidos del estudiante:'), 'nombre_completo'],
  [empiezaCon('Nivel:'), 'nivel'],
  [empiezaCon('Curso:'), 'curso'],
  [empiezaCon('Paralelo:'), 'paralelo'],
  [empiezaCon('Cédula de Ciudadanía:'), 'cedula'],
  [empiezaCon('Fecha de Nacimiento:'), 'fecha_nacimiento'],
  [empiezaCon('Edad:'), 'edad'],
  [empiezaCon('Sexo:'), 'sexo'],
  [empiezaCon('Nacionalidad:'), 'nacionalidad'],
  [empiezaCon('Estado Civil:'), 'estado_civil'],
  [empiezaCon('N° de Certificado de Votación:'), 'certificado_votacion'],
  [exacto('1)'), 'correo_institucional'],
  [exacto('2)'), 'correo_personal'],
  [empiezaCon('Teléfono Celular:'), 'celular'],
  [empiezaCon('Teléfono Convencional:'), 'telefono_convencional'],
];
for (const [indice, etiqueta] of CELDAS) {
  const p = parrafos[indice];
  const rPrEtiqueta = rPrPrimerRun(p);
  const rPrValor = rPrEtiqueta.replace(/<w:b\/>/g, '');
  reemplazarRuns(indice, run(`${textoDe(p).trimEnd()} `, rPrEtiqueta) + run(`{${etiqueta}}`, rPrValor));
}

// Residencia: el valor va en el párrafo vacío siguiente de la misma celda.
for (const [rotulo, etiqueta] of [['Provincia de residencia:', 'provincia'], ['Cantón de residencia:', 'canton'], ['Parroquia de residencia:', 'parroquia']]) {
  const indice = empiezaCon(rotulo) + 1;
  vacio(indice, rotulo);
  reemplazarRuns(indice, run(`{${etiqueta}}`, RPR.valor10));
}

// Discapacidad: tabla interna por tipo; marca en la celda contigua al tipo y grado junto a «Grado de Discapacidad:».
for (const [rotulo, clave] of [['Visual:', 'visual'], ['Física:', 'fisica'], ['Auditiva:', 'auditiva'], ['Intelectual:', 'intelectual'], ['Psicológica:', 'psicologica'], ['Lengua:', 'lengua'], ['Otras:', 'otras']]) {
  const tipo = exacto(rotulo);
  vacio(tipo + 1, rotulo); vacio(tipo + 2, `marca ${rotulo}`); vacio(tipo + 4, rotulo); vacio(tipo + 5, `grado ${rotulo}`);
  if (!textoDe(parrafos[tipo + 3]).startsWith('Grado de Discapacidad:')) throw new Error(`Estructura inesperada en ${rotulo}`);
  reemplazarRuns(tipo + 2, run(`{discapacidad_${clave}}`, RPR.marca8));
  reemplazarRuns(tipo + 5, run(`{grado_${clave}}`, RPR.valor8));
}

// --- Tabla 2 ---
// Modalidad: sin una modalidad específica se conservan las instrucciones oficiales; si existe, se imprime.
const podra = empiezaCon('Podrá ser:');
if (!textoDe(parrafos[podra + 1]).startsWith('Proyectos de investigación') || !textoDe(parrafos[podra + 2]).startsWith('(Deberá ser una sola modalidad)')) {
  throw new Error('Estructura inesperada en la celda MODALIDAD.');
}
const etiquetaSola = (indice, texto) => parrafoConPPrDe(indice, run(texto, RPR.contenido10));
parrafos[podra].xml = etiquetaSola(podra, '{#modalidad_pendiente}') + parrafos[podra].xml;
parrafos[podra + 2].xml += etiquetaSola(podra, '{/modalidad_pendiente}') + etiquetaSola(podra, '{^modalidad_pendiente}')
  + etiquetaSola(podra, '{modalidad}') + etiquetaSola(podra, '{/modalidad_pendiente}');

reemplazarRuns(empiezaCon('Oración enunciativa'), run('{titulo}', RPR.contenido10));

const problematica = empiezaCon('Este apartado solo se llenará');
reemplazarRuns(problematica, run('{problematica}', RPR.contenido10));
if (!textoDe(parrafos[problematica + 1]).startsWith('La problemática tendrá')) throw new Error('Estructura inesperada en PROBLEMÁTICA.');
parrafos[problematica + 1].xml = marcadores(parrafos[problematica + 1]) ? parrafoConPPrDe(problematica + 1, marcadores(parrafos[problematica + 1])) : '';

for (const [rotulo, clave] of [['programas de Investigación:', 'investigacion'], ['programas de Vinculación:', 'vinculacion'], ['(Docencia):', 'docencia']]) {
  const indice = buscar((t) => t.endsWith(rotulo), rotulo) + 1;
  vacio(indice, rotulo);
  reemplazarRuns(indice, run(`{articulacion_${clave}}`, RPR.marca8));
}
const ninguna = exacto('Ninguna:') + 1;
vacio(ninguna, 'Ninguna:');
reemplazarRuns(ninguna, run('{articulacion_ninguna}', RPR.marca8));

const mecanismo = empiezaCon('Se específica aquí si la propuesta');
vacio(mecanismo + 1, 'MECANISMO');
reemplazarRuns(mecanismo, run('{mecanismo}', RPR.contenido10Negrita));
reemplazarRuns(mecanismo + 1, run('{integrantes}', RPR.contenido10));

reemplazarRuns(empiezaCon('Se específica aquí los nombres y apellidos del Docente Tutor'), run('{tutor}', RPR.contenido10));

// --- Tabla 3: nombre del estudiante que postula; la línea de firma queda en blanco. ---
const firmante = empiezaCon('Nombres del estudiante que postula') + 1;
vacio(firmante, 'firma');
reemplazarRuns(firmante, run('{nombre_completo}', `${ARIAL}<w:sz w:val="20"/><w:szCs w:val="20"/>`));

zip.file(RUTA_DOCUMENTO, piezas.map((p) => p.xml).join(''));
writeFileSync(salida, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Plantilla generada en ${salida}`);
