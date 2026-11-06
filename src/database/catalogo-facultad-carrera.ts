/**
 * Catálogo institucional sembrado por la migración 20261105110000-FacultadCarrera.
 * Es un dato congelado: cualquier cambio exige una migración nueva. No vive en `migrations/`
 * porque TypeORM carga como migración toda función exportada desde esa carpeta.
 */
export interface CarreraSemilla { codigo: string; nombre: string; }
export interface FacultadSemilla { codigo: string; nombre: string; carreras: readonly CarreraSemilla[]; }

/** «Nutrición y Dietética» → «NUTRICION_Y_DIETETICA». */
export function codigoCatalogo(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function facultad(nombre: string, carreras: readonly string[]): FacultadSemilla {
  return { codigo: codigoCatalogo(nombre), nombre, carreras: carreras.map((carrera) => ({ codigo: codigoCatalogo(carrera), nombre: carrera })) };
}

export const CATALOGO_FACULTAD_CARRERA: readonly FacultadSemilla[] = [
  facultad('Facultad Ciencias de la Salud', [
    'Medicina', 'Odontología', 'Enfermería', 'Fisioterapia', 'Fonoaudiología', 'Laboratorio Clínico',
    'Terapia Ocupacional', 'Psicología', 'Nutrición y Dietética',
  ]),
  facultad('Facultad Ciencias Administrativas, Contables y Comercio', [
    'Administración de Empresas', 'Mercadotecnia', 'Contabilidad y Auditoría', 'Auditoría y Control de Gestión',
    'Finanzas', 'Comercio Exterior', 'Gestión de la Información Gerencial', 'Gestión del Talento Humano',
  ]),
  facultad('Facultad de Educación y Turismo', [
    'Educación Inicial', 'Educación Especial', 'Psicología Educativa', 'Educación Básica',
    'Pedagogía de la Actividad Física y el Deporte', 'Pedagogía de la Lengua y la Literatura',
    'Pedagogía de los Idiomas Nacionales y Extranjeros', 'Turismo', 'Hospitalidad y Hotelería',
    'Educación Básica Bilingüe', 'Educación Inicial Bilingüe', 'Entrenamiento Deportivo',
    'Gestión Hotelera Internacional', 'Educación Inclusiva',
  ]),
  facultad('Facultad Ingeniería, Industria y Arquitectura', [
    'Ingeniería Civil', 'Ingeniería Marítima', 'Electricidad', 'Arquitectura', 'Ingeniería Industrial',
  ]),
  facultad('Facultad Ciencias de la Vida y Tecnologías', [
    'Ingeniería Agropecuaria', 'Agronegocios', 'Ingeniería Agroindustrial', 'Ingeniería Ambiental',
    'Ingeniería en Tecnologías de la Información', 'Ingeniería en Software', 'Ingeniería en Sistemas',
    'Biología', 'Ingeniería de Alimentos',
  ]),
  facultad('Facultad de Ciencias Sociales, Derecho y Bienestar', [
    'Derecho', 'Criminología y Ciencias Forenses', 'Economía', 'Trabajo Social', 'Comunicación',
    'Gestión Pública y Desarrollo',
  ]),
  facultad('Facultad de Artes, Humanidades y Patrimonio', [
    'Artes Plásticas', 'Arqueología', 'Artes Escénicas', 'Diseño Textil e Indumentaria', 'Sociología',
  ]),
];
