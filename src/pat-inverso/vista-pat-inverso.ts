import { DISCAPACIDADES_PAT } from '../generaciones-pat/pat-pendientes.js';
import type { PatOficialExtraido } from './parsear-pat-oficial.js';
import { coincidirTutor, tokensNombre, type CoincidenciaTutor } from './coincidir-tutor.js';

export interface SistemaPatInverso {
  cedula: string;
  nombres: string;
  apellidos: string;
  carrera: string;
  titulo_tema: string;
  correo_institucional: string;
  modalidad: 'INDIVIDUAL' | 'GRUPAL';
  estudiante_id: string;
  integrantes: Array<{ id: string; nombres: string; apellidos: string }>;
  candidatos: Array<{ id: string; nombres: string; apellidos: string }>;
}

export interface DiferenciaPat { campo: string; word: string; sistema: string }
export interface ErrorCampoPat { campo: string; mensaje: string }

export interface VistaPatInverso {
  extraido: PatOficialExtraido;
  diferencias: DiferenciaPat[];
  errores: ErrorCampoPat[];
  tutor: CoincidenciaTutor;
  integrantes_word: string[];
  integrantes_sin_coincidencia: string[];
  datos: Record<string, unknown>;
  contenido: Record<string, unknown>;
}

/** Contrasta el Word con los datos institucionales. Los institucionales no se sustituyen; los personales salen del Word. */
export function vistaPatInverso(extraido: PatOficialExtraido, sistema: SistemaPatInverso): VistaPatInverso {
  const diferencias: DiferenciaPat[] = [];
  const comparar = (campo: string, word: string, institucional: string) => {
    if (normalizarComparacion(word) && normalizarComparacion(word) !== normalizarComparacion(institucional)) {
      diferencias.push({ campo, word: word.trim(), sistema: institucional.trim() });
    }
  };
  comparar('cedula', extraido.cedula, sistema.cedula);
  comparar('nombres_apellidos', extraido.nombres_apellidos, `${sistema.nombres} ${sistema.apellidos}`);
  comparar('carrera', extraido.carrera, sistema.carrera);
  comparar('titulo', extraido.titulo_provisional, sistema.titulo_tema);
  comparar('correo_institucional', extraido.correo_institucional, sistema.correo_institucional);
  if (extraido.mecanismo && extraido.mecanismo !== sistema.modalidad) {
    diferencias.push({ campo: 'mecanismo', word: extraido.mecanismo, sistema: sistema.modalidad });
  }
  const integrantesWord = nombresGrupales(extraido.nombres_grupales);
  const integrantesSistema = sistema.integrantes.filter((item) => item.id !== sistema.estudiante_id);
  const sinCoincidencia = integrantesWord.filter((nombre) => !integrantesSistema.some((item) => mismoNombre(nombre, `${item.nombres} ${item.apellidos}`)));
  if (sistema.modalidad === 'GRUPAL') {
    for (const nombre of sinCoincidencia) diferencias.push({ campo: 'integrante', word: nombre, sistema: integrantesSistema.map((item) => `${item.nombres} ${item.apellidos}`).join(', ') });
  }

  const errores: ErrorCampoPat[] = [];
  const fecha = fechaIso(extraido.fecha_nacimiento);
  if (!fecha) errores.push({ campo: 'fecha_nacimiento', mensaje: 'La fecha de nacimiento debe tener la forma dd/mm/aaaa.' });
  exigir(errores, 'paralelo', extraido.paralelo, 'Falta el paralelo.');
  exigir(errores, 'sexo', extraido.sexo, 'Falta el sexo.');
  exigir(errores, 'nacionalidad', extraido.nacionalidad, 'Falta la nacionalidad.');
  exigir(errores, 'estado_civil', extraido.estado_civil, 'Falta el estado civil.');
  exigir(errores, 'provincia', extraido.provincia, 'Falta la provincia.');
  exigir(errores, 'canton', extraido.canton, 'Falta el cantón.');
  exigir(errores, 'parroquia', extraido.parroquia, 'Falta la parroquia.');
  exigir(errores, 'celular', extraido.celular, 'Falta el teléfono celular.');
  if (!extraido.problematica.trim()) errores.push({ campo: 'problematica', mensaje: 'Falta la problemática.' });
  const correoPersonal = noAplica(extraido.correo_personal);
  if (!correoPersonal.noAplica && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correoPersonal.valor)) errores.push({ campo: 'correo_personal', mensaje: 'El correo personal no es válido.' });
  const articulaciones = articulacionesDe(extraido);
  if (!articulaciones.length) errores.push({ campo: 'articulaciones', mensaje: 'Marca al menos una articulación con x.' });
  if (articulaciones.includes('NINGUNA') && articulaciones.length > 1) errores.push({ campo: 'articulaciones', mensaje: 'Ninguna no puede combinarse con otra articulación.' });
  const marcadas = extraido.discapacidades.filter((item) => item.marcada);
  if (marcadas.some((item) => !item.grado.trim())) errores.push({ campo: 'grado_discapacidad', mensaje: 'Cada discapacidad marcada necesita su grado.' });
  if (marcadas.some((item) => item.tipo === 'OTRA' && !item.detalle.trim())) errores.push({ campo: 'otra_discapacidad', mensaje: 'Describe la otra discapacidad.' });

  const certificado = noAplica(extraido.certificado_votacion);
  const convencional = noAplica(extraido.telefono_convencional);
  const datos: Record<string, unknown> = {
    fecha_nacimiento: fecha,
    paralelo: extraido.paralelo.trim(),
    sexo: extraido.sexo.trim(),
    nacionalidad: extraido.nacionalidad.trim(),
    estado_civil: extraido.estado_civil.trim(),
    provincia: extraido.provincia.trim(),
    canton: extraido.canton.trim(),
    parroquia: extraido.parroquia.trim(),
    celular: extraido.celular.trim(),
    tiene_discapacidad: marcadas.length > 0,
    certificado_votacion: certificado.noAplica ? '' : certificado.valor,
    certificado_votacion_no_aplica: certificado.noAplica,
    correo_personal: correoPersonal.noAplica ? '' : correoPersonal.valor,
    correo_personal_no_aplica: correoPersonal.noAplica,
    telefono_convencional: convencional.noAplica ? '' : convencional.valor,
    telefono_convencional_no_aplica: convencional.noAplica,
  };
  if (marcadas.length) {
    datos.discapacidades = marcadas.map((item) => item.tipo).filter((tipo) => (DISCAPACIDADES_PAT as readonly string[]).includes(tipo));
    datos.grado_discapacidad = marcadas.find((item) => item.grado.trim())?.grado.trim() ?? '';
    const otra = marcadas.find((item) => item.tipo === 'OTRA');
    if (otra) datos.otra_discapacidad = otra.detalle.trim();
  }
  const contenido: Record<string, unknown> = {
    problematica: extraido.problematica.trim(),
    articulaciones,
    modalidad_detalle: extraido.modalidad_detalle.trim(),
    confirma_problematica: true,
  };
  return { extraido, diferencias, errores, tutor: coincidirTutor(extraido.tutor_solicitado, sistema.candidatos), integrantes_word: integrantesWord, integrantes_sin_coincidencia: sinCoincidencia, datos, contenido };
}

function articulacionesDe(extraido: PatOficialExtraido): string[] {
  const marcas = extraido.articulaciones;
  return [
    marcas.investigacion ? 'INVESTIGACION' : '',
    marcas.vinculacion ? 'VINCULACION' : '',
    marcas.docencia ? 'DOCENCIA' : '',
    marcas.ninguna ? 'NINGUNA' : '',
  ].filter(Boolean);
}

function exigir(errores: ErrorCampoPat[], campo: string, valor: string, mensaje: string): void {
  if (!valor.trim()) errores.push({ campo, mensaje });
}

function noAplica(valor: string): { noAplica: boolean; valor: string } {
  const limpio = valor.trim();
  if (!limpio || normalizarComparacion(limpio) === 'no aplica') return { noAplica: true, valor: '' };
  return { noAplica: false, valor: limpio };
}

export function fechaIso(valor: string): string | null {
  const texto = valor.trim();
  const latina = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const anio = Number(latina?.[3] ?? iso?.[1]);
  const mes = Number(latina?.[2] ?? iso?.[2]);
  const dia = Number(latina?.[1] ?? iso?.[3]);
  if (!anio || !mes || !dia) return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia || fecha.getTime() > Date.now()) return null;
  return fecha.toISOString().slice(0, 10);
}

function nombresGrupales(valor: string): string[] {
  return valor.split(/[,;\n]|\s+y\s+/i).map((nombre) => nombre.trim()).filter(Boolean);
}

function mismoNombre(word: string, sistema: string): boolean {
  return tokensNombre(word).join(' ') === tokensNombre(sistema).join(' ');
}

function normalizarComparacion(valor: string): string {
  return tokensNombre(valor).join(' ');
}
