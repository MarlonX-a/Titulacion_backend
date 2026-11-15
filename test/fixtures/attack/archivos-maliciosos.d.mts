// Tipos de archivos-maliciosos.mjs (generadores compartidos por la suite de ataque y scripts/attack-probes.mjs).

/** `estado`: código HTTP exacto esperado en la subida; sin él se admite 400, 415 o 422. */
export interface ArchivoMalicioso { nombre: string; archivo: string; mime: string; contenido: () => Buffer; estado?: number }
export type PiezaPdf = string | Buffer | { objeto: number } | { comprimido: number; en: number; indice: number };

export function zipStored(entries: Record<string, string | Buffer>): Buffer;
export function docxBenigno(): Buffer;
export function docxRelacionExterna(): Buffer;
export function docxOleIncrustado(): Buffer;
export function docxDdeauto(): Buffer;
export const pdfBenigno: () => Buffer;
export const pdfJavaScript: () => Buffer;
export const pdfOpenAction: () => Buffer;
export const pdfLaunch: () => Buffer;
export const pdfEmbeddedFile: () => Buffer;
export const pdfObjStmBenigno: () => Buffer;
export const pdfObjStmJavaScriptRelleno: () => Buffer;
export const pdfObjStmLaunch: () => Buffer;
export const pdfObjStmEmbeddedFile: () => Buffer;
export const pdfObjStmRichMedia: () => Buffer;
export function docxEntidadFueraDeRango(referencia?: string): Buffer;
export function ensamblarPdf(piezas: PiezaPdf[], opciones?: { raiz?: number; xref?: 'tabla' | 'stream'; trailerExtra?: string; base?: number }): Buffer;
export function streamDeObjetos(numero: number, objetos: Array<[number, string]>, diccionario?: string): { abierto: PiezaPdf[]; cierre: string };
export function pdfLongitudIndirectaEndstreamFalso(): Buffer;
export function pdfObjStmSinType(variante?: 'sin-type' | 'type-indirecto'): Buffer;
export function pdfObjetoOculto(opciones?: { donde?: 'stream' | 'cadena' | 'comentario'; accion?: 'openaction' | 'aa'; cabecera?: string }): Buffer;
export function pdfLongitudDirectaInexacta(): Buffer;
export function pdfLongitudIndirecta(caso: 'falta' | 'no-entero' | 'negativo' | 'referencia' | 'duplicado-distinto' | 'duplicado-igual' | 'correcto'): Buffer;
export function pdfModernoBenigno(): Buffer;
export function pdfActualizacionIncremental(): Buffer;
export function pdfLinealizado(): Buffer;
export function pdfCabeceraConComentarios(): Buffer;
export function pdfCifrado(donde?: 'trailer' | 'hex' | 'xref-stream'): Buffer;
export function pdfObjStmSoloN(opciones?: { filtro?: 'flate' | 'ninguno'; accion?: 'javascript' | 'uri' }): Buffer;
export function pdfIccBasado(opciones?: { perfil?: Buffer; filtro?: 'flate' | 'ninguno' | 'lzw' }): Buffer;
export const PDF_MIME: 'application/pdf';
export const DOCX_MIME: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ARCHIVOS_MALICIOSOS: ArchivoMalicioso[];
