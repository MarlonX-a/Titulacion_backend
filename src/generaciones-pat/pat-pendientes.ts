/**
 * Fuente única de los campos pendientes del PAT y de los valores autocompletados. La usan
 * `GET /estudiantes/me/datos-pat`, `GET/PATCH .../pat/me`, `GET .../pat/me/resumen` y el 400 de
 * `POST .../pat/me/generaciones`, de modo que el formulario y la generación nunca discrepan.
 */

export const ARTICULACIONES_PAT = ['INVESTIGACION', 'VINCULACION', 'DOCENCIA', 'NINGUNA'] as const;
export const DISCAPACIDADES_PAT = ['VISUAL', 'FISICA', 'AUDITIVA', 'INTELECTUAL', 'PSICOLOGICA', 'LENGUAJE', 'OTRA'] as const;
export const MODALIDAD_ACADEMICA_PREDETERMINADA = 'TRABAJO_INTEGRACION_CURRICULAR';

/** Campos personales que solo el estudiante puede aportar (se guardan una vez y se reutilizan). */
export const CAMPOS_PERSONALES_PAT = [
  'fecha_nacimiento', 'paralelo', 'sexo', 'nacionalidad', 'estado_civil', 'certificado_votacion', 'certificado_votacion_no_aplica',
  'provincia', 'canton', 'parroquia', 'correo_personal', 'correo_personal_no_aplica', 'celular', 'telefono_convencional',
  'telefono_convencional_no_aplica', 'tiene_discapacidad', 'discapacidades', 'grado_discapacidad', 'otra_discapacidad',
] as const;

const OBLIGATORIOS_PERSONALES = ['fecha_nacimiento', 'paralelo', 'sexo', 'nacionalidad', 'estado_civil', 'provincia', 'canton', 'parroquia', 'celular'] as const;
const NO_APLICABLES = ['correo_personal', 'telefono_convencional', 'certificado_votacion'] as const;

const vacio = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

export function pendientesPersonales(datos: Record<string, unknown>): string[] {
  const missing: string[] = OBLIGATORIOS_PERSONALES.filter((key) => vacio(datos[key]));
  if (typeof datos['tiene_discapacidad'] !== 'boolean') missing.push('tiene_discapacidad');
  for (const key of NO_APLICABLES) if (vacio(datos[key]) && datos[`${key}_no_aplica`] !== true) missing.push(key);
  if (datos['tiene_discapacidad'] === true) {
    const categories = Array.isArray(datos['discapacidades']) ? datos['discapacidades'] as unknown[] : [];
    if (!categories.length) missing.push('discapacidades');
    if (vacio(datos['grado_discapacidad'])) missing.push('grado_discapacidad');
    if (categories.includes('OTRA') && vacio(datos['otra_discapacidad'])) missing.push('otra_discapacidad');
  }
  return missing;
}

/** Contenido individual con los valores predeterminados aplicados (lo que se imprimirá). */
export interface ContenidoEfectivoPat {
  problematica: string;
  problematica_personalizada: boolean;
  confirma_problematica: boolean;
  articulaciones: string[];
  modalidad_academica: string;
  tutor_propuesto_id: string | null;
}

export interface SugerenciasContenidoPat {
  problematica: string | null;
  articulaciones: string[];
}

export function contenidoEfectivo(guardado: Record<string, unknown>, sugerencias: SugerenciasContenidoPat): ContenidoEfectivoPat {
  const saved = typeof guardado['problematica'] === 'string' && guardado['problematica'].trim() !== '';
  const articulaciones = Array.isArray(guardado['articulaciones']) ? (guardado['articulaciones'] as unknown[]).filter((v): v is string => typeof v === 'string') : sugerencias.articulaciones;
  const modalidad = typeof guardado['modalidad_academica'] === 'string' && guardado['modalidad_academica'].trim() ? guardado['modalidad_academica'].trim() : MODALIDAD_ACADEMICA_PREDETERMINADA;
  return {
    problematica: saved ? (guardado['problematica'] as string) : (sugerencias.problematica ?? ''),
    problematica_personalizada: saved,
    confirma_problematica: guardado['confirma_problematica'] === true,
    articulaciones,
    modalidad_academica: modalidad,
    tutor_propuesto_id: typeof guardado['tutor_propuesto_id'] === 'string' ? guardado['tutor_propuesto_id'] : null,
  };
}

export function pendientesContenido(contenido: ContenidoEfectivoPat): string[] {
  const missing: string[] = [];
  if (vacio(contenido.problematica)) missing.push('problematica');
  if (contenido.confirma_problematica !== true) missing.push('confirma_problematica');
  if (!contenido.articulaciones.length) missing.push('articulaciones');
  if (contenido.articulaciones.includes('NINGUNA') && contenido.articulaciones.length > 1) missing.push('articulaciones_excluyentes');
  return missing;
}

export function calcularPendientesPat(input: { personal: Record<string, unknown>; contenido: ContenidoEfectivoPat; tutorResuelto: boolean; extensionPat: string | null }): string[] {
  const missing = [...pendientesPersonales(input.personal), ...pendientesContenido(input.contenido)];
  if (!input.tutorResuelto) missing.push('tutor_propuesto_id');
  if (vacio(input.extensionPat)) missing.push('extension_pat');
  return missing;
}

const ORDINALES = ['Primero', 'Segundo', 'Tercero', 'Cuarto', 'Quinto', 'Sexto', 'Séptimo', 'Octavo', 'Noveno', 'Décimo'];

/** Curso impreso en el PAT a partir del nivel institucional del estudiante. */
export function cursoDesdeNivel(nivel: number | null | undefined): string | null {
  if (typeof nivel !== 'number' || !Number.isInteger(nivel) || nivel < 1) return null;
  return ORDINALES[nivel - 1] ?? `${nivel}.º`;
}

export interface TutorVigentePat { docente_id: string; nombres: string; apellidos: string }
export interface TutorPropuestoPat { id: string; orden_prioridad: number; docente_id: string; nombres: string; apellidos: string; elegible_actualmente: boolean; es_proponente_tema: boolean }
export type FuenteTutorPat = 'ASIGNACION_TUTOR' | 'TUTOR_PROPUESTO_ELEGIDO' | 'TUTOR_PROPUESTO_PREDETERMINADO' | 'SIN_TUTOR';
export interface TutorResueltoPat {
  valor: { docente_id: string; nombres: string; apellidos: string; tutor_propuesto_id: string | null } | null;
  fuente: FuenteTutorPat;
}

/**
 * Tutor que se imprimirá: vigente; si no, la propuesta elegida por el estudiante si sigue
 * perteneciendo a la postulación; si no, la primera propuesta (mismo orden que la lista).
 */
export function resolverTutorPat(vigente: TutorVigentePat | null, propuestas: TutorPropuestoPat[], elegidoId: string | null): TutorResueltoPat {
  if (vigente) return { valor: { ...vigente, tutor_propuesto_id: null }, fuente: 'ASIGNACION_TUTOR' };
  const elegido = elegidoId ? propuestas.find((item) => item.id === elegidoId) : undefined;
  const pick = (item: TutorPropuestoPat) => ({ docente_id: item.docente_id, nombres: item.nombres, apellidos: item.apellidos, tutor_propuesto_id: item.id });
  if (elegido) return { valor: pick(elegido), fuente: 'TUTOR_PROPUESTO_ELEGIDO' };
  if (propuestas[0]) return { valor: pick(propuestas[0]), fuente: 'TUTOR_PROPUESTO_PREDETERMINADO' };
  return { valor: null, fuente: 'SIN_TUTOR' };
}
