import { ConflictException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { Usuario } from '../../usuarios/entities/usuario.entity.js';
import { UsuarioEstado } from '../../usuarios/enums/usuario-estado.enum.js';
import { LOCAL_DEMO_USERS } from './local-authentication.service.js';

const accountDetails = [
  { nombres: 'Administrador', apellidos: 'Local' },
  { nombres: 'Docente', apellidos: 'Local' },
  { nombres: 'Estudiante', apellidos: 'Local' },
  { nombres: 'Estudiante 2', apellidos: 'Local' },
] as const;

async function provisionInTransaction(manager: EntityManager): Promise<void> {
  await manager.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    ['titulacion.local-demo-accounts'],
  );
  const repository = manager.getRepository(Usuario);

  for (const [index, demoUser] of LOCAL_DEMO_USERS.entries()) {
    const byEmail = await repository.findOneBy({ email: demoUser.email });
    const bySubject = await repository.findOneBy({
      id_externo_sso: demoUser.subject,
    });
    const existing = byEmail ?? bySubject;
    if (existing) {
      const matches =
        byEmail?.id === existing.id &&
        bySubject?.id === existing.id &&
        existing.rol === demoUser.role &&
        existing.estado === UsuarioEstado.ACTIVO;
      if (!matches) {
        throw new ConflictException(
          'Existe una cuenta incompatible con una identidad local de prueba.',
        );
      }
      continue;
    }

    const details = accountDetails[index];
    await repository.save(
      repository.create({
        email: demoUser.email,
        nombres: details.nombres,
        apellidos: details.apellidos,
        rol: demoUser.role,
        estado: UsuarioEstado.ACTIVO,
        id_externo_sso: demoUser.subject,
        ultimo_acceso: null,
      }),
    );
  }
}

export function provisionLocalDemoAccounts(dataSource: DataSource): Promise<void> {
  return dataSource.transaction(provisionInTransaction);
}
