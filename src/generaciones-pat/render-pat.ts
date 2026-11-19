import PDFDocument from 'pdfkit';

/** Persona mostrada en el PAT (tutor o integrante): solo nombres y apellidos. */
export interface PersonaPat {
  nombres?: string | null;
  apellidos?: string | null;
}

/**
 * Instantánea congelada al solicitar la generación (`generacion_pat.instantanea`).
 * Todos los campos son opcionales porque es JSONB histórico: una instantánea antigua puede no tenerlos.
 */
export interface InstantaneaPat {
  periodo_nombre?: string | null;
  periodo_codigo?: string | null;
  extension?: string | null;
  facultad?: string | null;
  carrera?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
  cedula?: string | null;
  matricula?: string | null;
  email?: string | null;
  nivel?: number | null;
  curso?: string | null;
  titulo?: string | null;
  modalidad?: 'INDIVIDUAL' | 'GRUPAL' | null;
  linea_investigacion?: { nombre?: string | null } | null;
  tutor?: PersonaPat | null;
  participantes?: PersonaPat[] | null;
  personal?: Record<string, unknown> | null;
  contenido?: Record<string, unknown> | null;
  capturado_en?: string | null;
}

const TAMANO_PAGINA = 'A4';
const MARGEN = 46;
const COLOR_INSTITUCION = '#374151';
const COLOR_TITULO = '#0f3d68';
const COLOR_SUBTITULO = '#555';
const COLOR_CUERPO = '#111';
const COLOR_NOTA_FINAL = '#777';
const COLOR_PIE = '#666';
const FUENTE_INSTITUCION = 10;
const FUENTE_TITULO = 15;
const FUENTE_SUBTITULO = 9;
const FUENTE_SECCION = 11;
const FUENTE_CUERPO = 9;
const FUENTE_PIE = 8;
const ESPACIO_ANTES_DE_SECCION = 0.45;
const ESPACIO_TRAS_TITULO_SECCION = 0.2;
const ESPACIO_TRAS_INSTITUCION = 0.25;
const ESPACIO_ANTES_DE_FIRMA = 1.8;
const ALTO_ENCABEZADO_CONTINUACION = 24;
const DISTANCIA_PIE_AL_BORDE = 38;
const ANCHO_NUMERO_PAGINA = 115;
const SEPARADOR = '    ';
const LINEA_FIRMA = '__________________________________';

/** Convierte un valor opcional de la instantánea en texto; ausente o nulo se imprime vacío. */
function texto(valor: unknown): string {
  return String(valor ?? '');
}

/** Años cumplidos entre la fecha de nacimiento (`AAAA-MM-DD`) y la fecha de referencia. */
export function calcularEdad(fechaNacimiento: string, referencia: Date): number {
  const nacimiento = new Date(`${fechaNacimiento}T00:00:00`);
  let anios = referencia.getFullYear() - nacimiento.getFullYear();
  const aunNoCumple = referencia.getMonth() < nacimiento.getMonth()
    || (referencia.getMonth() === nacimiento.getMonth() && referencia.getDate() < nacimiento.getDate());
  if (aunNoCumple) anios--;
  return anios;
}

/** Genera el PDF sin firma del PAT a partir de la instantánea congelada de la generación. */
export function renderizarPat(instantanea: InstantaneaPat): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const documento = new PDFDocument({ size: TAMANO_PAGINA, margin: MARGEN, bufferPages: true });
    const fragmentos: Buffer[] = [];
    documento.on('data', (fragmento: Buffer) => fragmentos.push(fragmento));
    documento.on('end', () => resolve(Buffer.concat(fragmentos)));
    documento.on('error', reject);

    escribirEncabezado(documento);
    escribirInformacionAcademica(documento, instantanea);
    escribirDatosPersonales(documento, instantanea);
    escribirPlanDeTrabajo(documento, instantanea);
    escribirPiesDePagina(documento, instantanea);
    documento.end();
  });
}

function escribirEncabezado(documento: PDFKit.PDFDocument): void {
  documento.fontSize(FUENTE_INSTITUCION).fillColor(COLOR_INSTITUCION)
    .text('UNIVERSIDAD LAICA ELOY ALFARO DE MANABÍ', { align: 'center' })
    .moveDown(ESPACIO_TRAS_INSTITUCION);
  documento.fontSize(FUENTE_TITULO).fillColor(COLOR_TITULO).text('PLAN DE TRABAJO DE TITULACIÓN', { align: 'center' });
  documento.fontSize(FUENTE_SUBTITULO).fillColor(COLOR_SUBTITULO)
    .text('Formulario individual · Documento generado sin firma', { align: 'center' })
    .moveDown();
}

function escribirTituloSeccion(documento: PDFKit.PDFDocument, titulo: string): void {
  documento.moveDown(ESPACIO_ANTES_DE_SECCION)
    .fontSize(FUENTE_SECCION).fillColor(COLOR_TITULO).text(titulo, { underline: true })
    .moveDown(ESPACIO_TRAS_TITULO_SECCION)
    .fontSize(FUENTE_CUERPO).fillColor(COLOR_CUERPO);
}

function escribirInformacionAcademica(documento: PDFKit.PDFDocument, instantanea: InstantaneaPat): void {
  const personal = instantanea.personal ?? {};
  const tutor = instantanea.tutor ?? {};
  const integrantes = instantanea.participantes ?? [];
  const curso = texto(instantanea.curso) || texto(personal['curso']);
  const correoPersonal = texto(personal['correo_personal']) || 'No aplica';

  escribirTituloSeccion(documento, '1. INFORMACIÓN ACADÉMICA');
  documento.text(`Período: ${texto(instantanea.periodo_nombre)} (${texto(instantanea.periodo_codigo)})`);
  documento.text(`Facultad: ${texto(instantanea.facultad)}${SEPARADOR}Carrera: ${texto(instantanea.carrera)}`);
  documento.text(`Estudiante: ${texto(instantanea.apellidos)} ${texto(instantanea.nombres)}${SEPARADOR}Cédula: ${texto(instantanea.cedula)}`);
  documento.text(`Matrícula: ${texto(instantanea.matricula)}${SEPARADOR}Nivel: ${texto(instantanea.nivel)}${SEPARADOR}Curso: ${curso}${SEPARADOR}Paralelo: ${texto(personal['paralelo'])}`);
  documento.text(`Correo institucional: ${texto(instantanea.email)}${SEPARADOR}Correo personal: ${correoPersonal}`);
  documento.text(`Tema: ${texto(instantanea.titulo)}`);
  if (instantanea.linea_investigacion) documento.text(`Línea de investigación: ${texto(instantanea.linea_investigacion.nombre)}`);
  if (instantanea.modalidad) documento.text(`Modalidad: ${instantanea.modalidad === 'GRUPAL' ? 'Grupal' : 'Individual'}`);
  documento.text(`Tutor: ${texto(tutor.nombres)} ${texto(tutor.apellidos)}`);
  const nombresIntegrantes = integrantes.map((integrante) => `${texto(integrante.nombres)} ${texto(integrante.apellidos)}`).join('; ');
  documento.text(`Integrantes del trabajo: ${nombresIntegrantes}`);
}

function escribirDatosPersonales(documento: PDFKit.PDFDocument, instantanea: InstantaneaPat): void {
  const personal = instantanea.personal ?? {};
  const fechaNacimiento = texto(personal['fecha_nacimiento']);
  const fechaReferencia = instantanea.capturado_en ? new Date(instantanea.capturado_en) : new Date();
  const edad = fechaNacimiento ? `${calcularEdad(fechaNacimiento, fechaReferencia)} años` : '';
  const discapacidades = Array.isArray(personal['discapacidades']) ? personal['discapacidades'].join(', ') : 'No';
  const otraDiscapacidad = texto(personal['otra_discapacidad']);
  const detalleOtraDiscapacidad = otraDiscapacidad ? ` (${otraDiscapacidad})` : '';
  const certificadoVotacion = texto(personal['certificado_votacion']) || 'No aplica';
  const telefonoConvencional = texto(personal['telefono_convencional']) || 'No aplica';

  escribirTituloSeccion(documento, '2. DATOS PERSONALES');
  documento.text(`Fecha de nacimiento: ${fechaNacimiento}${SEPARADOR}Edad: ${edad}${SEPARADOR}Sexo: ${texto(personal['sexo'])}`);
  documento.text(`Nacionalidad: ${texto(personal['nacionalidad'])}${SEPARADOR}Estado civil: ${texto(personal['estado_civil'])}`);
  documento.text(`Residencia: ${texto(personal['provincia'])} / ${texto(personal['canton'])} / ${texto(personal['parroquia'])}`);
  documento.text(`Certificado de votación: ${certificadoVotacion}${SEPARADOR}Celular: ${texto(personal['celular'])}${SEPARADOR}Convencional: ${telefonoConvencional}`);
  documento.text(`Discapacidad declarada: ${discapacidades}${detalleOtraDiscapacidad}${SEPARADOR}Grado: ${texto(personal['grado_discapacidad'])}`);
}

function escribirPlanDeTrabajo(documento: PDFKit.PDFDocument, instantanea: InstantaneaPat): void {
  const contenido = instantanea.contenido ?? {};
  const articulaciones = Array.isArray(contenido['articulaciones']) ? contenido['articulaciones'].join(', ') : '';

  escribirTituloSeccion(documento, '3. PLAN DE TRABAJO');
  documento.text(`Modalidad académica: ${texto(contenido['modalidad_academica'])}`);
  documento.text(`Título provisional: ${texto(instantanea.titulo)}`);
  documento.text('Problemática:', { continued: true }).text(` ${texto(contenido['problematica'])}`, { align: 'justify' });
  documento.text(`Articulación: ${articulaciones}`);
  documento.text('Tipo de trabajo: Trabajo de Integración Curricular.');
  documento.moveDown(ESPACIO_ANTES_DE_FIRMA)
    .text(LINEA_FIRMA, { align: 'center' })
    .text(`${texto(instantanea.nombres)} ${texto(instantanea.apellidos)}`, { align: 'center' })
    .text('Firma del estudiante', { align: 'center' });
  documento.moveDown().fontSize(FUENTE_PIE).fillColor(COLOR_NOTA_FINAL)
    .text('Generado electrónicamente a partir de la información institucional y la registrada por el estudiante.', { align: 'center' });
}

/** Encabezado de continuación (desde la segunda página), sede y numeración en cada página. */
function escribirPiesDePagina(documento: PDFKit.PDFDocument, instantanea: InstantaneaPat): void {
  const paginas = documento.bufferedPageRange();
  for (let indice = 0; indice < paginas.count; indice++) {
    documento.switchToPage(indice);
    const alturaPie = documento.page.height - DISTANCIA_PIE_AL_BORDE;
    if (indice > 0) {
      documento.fontSize(FUENTE_PIE).fillColor(COLOR_PIE)
        .text('PLAN DE TRABAJO DE TITULACIÓN · CONTINUACIÓN', MARGEN, ALTO_ENCABEZADO_CONTINUACION, { align: 'center', lineBreak: false });
    }
    documento.fontSize(FUENTE_PIE).fillColor(COLOR_PIE)
      .text(`Extensión / sede: ${texto(instantanea.extension)}`, MARGEN, alturaPie, { align: 'left', lineBreak: false });
    documento.text(`PAT · ${indice + 1} / ${paginas.count}`, documento.page.width - ANCHO_NUMERO_PAGINA, alturaPie, { align: 'right', lineBreak: false });
  }
}
