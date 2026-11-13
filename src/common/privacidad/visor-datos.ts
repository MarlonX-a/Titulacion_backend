import type { EntityManager } from 'typeorm';
import { Estudiante } from '../../estudiantes/entities/estudiante.entity.js';
import type { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../../usuarios/enums/usuario-rol.enum.js';

/**
 * Destinatario de una respuesta que contiene datos de estudiantes.
 *
 * La matrícula de un estudiante importado es su cédula, que también es su clave temporal
 * inicial. Por eso solo ADMIN y el propio estudiante reciben la matrícula; compañeros y docentes
 * reciben únicamente identificador, nombres y apellidos.
 */
export interface VisorDatos {
  readonly esAdmin: boolean;
  /** Perfil de estudiante del visor, o `null` si no lo tiene (DOCENTE, cuenta sin perfil). */
  readonly estudianteId: string | null;
}

export const VISOR_ADMIN: VisorDatos = Object.freeze({ esAdmin: true, estudianteId: null });

export async function visorDe(manager: EntityManager, actor: Usuario): Promise<VisorDatos> {
  if (actor.rol === UsuarioRol.ADMIN) return VISOR_ADMIN;
  if (actor.rol !== UsuarioRol.ESTUDIANTE) return { esAdmin: false, estudianteId: null };
  const student = await manager.getRepository(Estudiante).findOne({ where: { usuario: { id: actor.id } }, select: { id: true } });
  return { esAdmin: false, estudianteId: student?.id ?? null };
}

/** El visor puede recibir los identificadores personales (matrícula) de ese estudiante. */
export function veIdentificadores(visor: VisorDatos, estudianteId: string): boolean {
  return visor.esAdmin || (visor.estudianteId !== null && visor.estudianteId === estudianteId);
}

/** Quita la matrícula de los datos de un estudiante cuando el visor no es ADMIN ni el propio estudiante. */
export function datosEstudianteVisibles<T extends { id: string; matricula: string }>(visor: VisorDatos, datos: T): Omit<T, 'matricula'> & { matricula?: string } {
  if (veIdentificadores(visor, datos.id)) return datos;
  const { matricula: _oculta, ...visibles } = datos;
  return visibles;
}
