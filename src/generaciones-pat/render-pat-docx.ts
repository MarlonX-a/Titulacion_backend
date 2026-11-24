import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cursoDesdeNivel, MODALIDAD_ACADEMICA_PREDETERMINADA } from './pat-pendientes.js';
import { calcularEdad, type InstantaneaPat, type PersonaPat } from './render-pat.js';

/** Formato institucional PAT-04-F-002 con etiquetas (regenerable con `scripts/generar-plantilla-pat-docx.mjs`). */
const NOMBRE_PLANTILLA = 'PAT-04-F-002.docx';
export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MARCA = 'x';
const NO_APLICA = 'No aplica';

/** Celda de cada categoría de discapacidad del sistema en el formato institucional. */
const CELDA_DISCAPACIDAD: Record<string, string> = {
  VISUAL: 'visual', FISICA: 'fisica', AUDITIVA: 'auditiva', INTELECTUAL: 'intelectual', PSICOLOGICA: 'psicologica', LENGUAJE: 'lengua', OTRA: 'otras',
};
let plantillaEnMemoria: Buffer | undefined;

/**
 * Plantilla junto al módulo compilado (copiada por `nest-cli.json`) o, si el proceso se inició antes de
 * declarar el recurso (modo watch), la de `src/` del directorio de trabajo.
 */
function plantilla(): Buffer {
  if (plantillaEnMemoria) return plantillaEnMemoria;
  const candidatas = [
    fileURLToPath(new URL(`./plantillas/${NOMBRE_PLANTILLA}`, import.meta.url)),
    join(process.cwd(), 'src', 'generaciones-pat', 'plantillas', NOMBRE_PLANTILLA),
  ];
  const ruta = candidatas.find((candidata) => existsSync(candidata));
  if (!ruta) throw new Error('No se encontró la plantilla institucional del PAT.');
  plantillaEnMemoria = readFileSync(ruta);
  return plantillaEnMemoria;
}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim() : typeof valor === 'number' ? String(valor) : '');
const nombre = (persona: PersonaPat | null | undefined): string => [texto(persona?.nombres), texto(persona?.apellidos)].filter(Boolean).join(' ');

/** `AAAA-MM-DD` → `dd/mm/aaaa`; cualquier otro valor se imprime vacío. */
export function fechaDdMmAaaa(valor: unknown): string {
  const m = typeof valor === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Valor o «No aplica» si el estudiante marcó que no aplica; ausente se imprime vacío. */
function conNoAplica(personal: Record<string, unknown>, campo: string): string {
  return texto(personal[campo]) || (personal[`${campo}_no_aplica`] === true ? NO_APLICA : '');
}

/** Integrantes distintos del estudiante del PAT (se descarta una sola coincidencia por nombre). */
function companeros(instantanea: InstantaneaPat): string[] {
  const propio = nombre(instantanea);
  const nombres = (instantanea.participantes ?? []).map(nombre).filter(Boolean);
  const indicePropio = nombres.indexOf(propio);
  if (indicePropio >= 0) nombres.splice(indicePropio, 1);
  return nombres;
}

/** Valores de cada etiqueta de la plantilla a partir de la instantánea congelada de la generación. */
export function datosPlantillaPat(instantanea: InstantaneaPat): Record<string, string | boolean> {
  const personal = instantanea.personal ?? {};
  const contenido = instantanea.contenido ?? {};
  const fechaNacimiento = texto(personal['fecha_nacimiento']);
  const referencia = instantanea.capturado_en ? new Date(instantanea.capturado_en) : new Date();
  const edad = /^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento) ? String(calcularEdad(fechaNacimiento, referencia)) : '';
  const extension = texto(instantanea.extension);
  const facultad = texto(instantanea.facultad);

  const discapacidades = personal['tiene_discapacidad'] === true && Array.isArray(personal['discapacidades']) ? personal['discapacidades'] as unknown[] : [];
  const grado = texto(personal['grado_discapacidad']);
  const celdasDiscapacidad: Record<string, string> = {};
  for (const [categoria, celda] of Object.entries(CELDA_DISCAPACIDAD)) {
    const marcada = discapacidades.includes(categoria);
    const detalle = categoria === 'OTRA' ? texto(personal['otra_discapacidad']) : '';
    celdasDiscapacidad[`discapacidad_${celda}`] = marcada ? (detalle ? `${MARCA} (${detalle})` : MARCA) : '';
    celdasDiscapacidad[`grado_${celda}`] = marcada ? grado : '';
  }

  const articulaciones = Array.isArray(contenido['articulaciones']) ? contenido['articulaciones'] as unknown[] : [];
  const marca = (articulacion: string) => (articulaciones.includes(articulacion) ? MARCA : '');

  const modalidadAcademica = texto(contenido['modalidad_academica']);
  const modalidadEspecifica = modalidadAcademica !== '' && modalidadAcademica !== MODALIDAD_ACADEMICA_PREDETERMINADA;
  const otrosIntegrantes = companeros(instantanea);
  const mecanismo = instantanea.modalidad === 'GRUPAL' ? 'Grupal:' : instantanea.modalidad === 'INDIVIDUAL' ? 'Individual' : '';

  return {
    facultad_extension: [facultad, extension].filter(Boolean).join(' – '),
    carrera: texto(instantanea.carrera),
    nombre_completo: nombre(instantanea),
    nivel: texto(instantanea.curso) || (cursoDesdeNivel(instantanea.nivel) ?? ''),
    curso: texto(personal['curso']),
    paralelo: texto(personal['paralelo']),
    cedula: texto(instantanea.cedula),
    fecha_nacimiento: fechaDdMmAaaa(fechaNacimiento),
    edad,
    sexo: texto(personal['sexo']),
    nacionalidad: texto(personal['nacionalidad']),
    estado_civil: texto(personal['estado_civil']),
    certificado_votacion: conNoAplica(personal, 'certificado_votacion'),
    provincia: texto(personal['provincia']),
    canton: texto(personal['canton']),
    parroquia: texto(personal['parroquia']),
    correo_institucional: texto(instantanea.email),
    correo_personal: conNoAplica(personal, 'correo_personal'),
    celular: texto(personal['celular']),
    telefono_convencional: conNoAplica(personal, 'telefono_convencional'),
    ...celdasDiscapacidad,
    modalidad_pendiente: !modalidadEspecifica,
    // El valor predeterminado (Trabajo de Integración Curricular) es la opción de aprobación, no una
    // modalidad de la columna MODALIDAD: en ese caso se conservan las instrucciones oficiales.
    modalidad: modalidadEspecifica ? modalidadAcademica : '',
    titulo: texto(instantanea.titulo),
    problematica: texto(contenido['problematica']),
    articulacion_investigacion: marca('INVESTIGACION'),
    articulacion_vinculacion: marca('VINCULACION'),
    articulacion_docencia: marca('DOCENCIA'),
    articulacion_ninguna: marca('NINGUNA'),
    mecanismo,
    integrantes: instantanea.modalidad === 'GRUPAL' ? otrosIntegrantes.join(', ') : '',
    tutor: nombre(instantanea.tutor),
  };
}

/** Genera el PAT en el formato Word institucional PAT-04-F-002 a partir de la instantánea congelada. */
export function renderizarPatDocx(instantanea: InstantaneaPat): Buffer {
  const documento = new Docxtemplater(new PizZip(plantilla()), {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });
  documento.render(datosPlantillaPat(instantanea));
  return documento.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}
