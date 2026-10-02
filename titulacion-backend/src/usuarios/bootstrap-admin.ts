import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { HttpException, ValidationError } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppModule } from '../app.module.js';
import { CreateUsuarioDto } from './dto/create-usuario.dto.js';
import { UsuarioRol } from './enums/usuario-rol.enum.js';
import { UsuariosService } from './usuarios.service.js';

function validationMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

async function main(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      'Ejecuta este comando desde una terminal interactiva para registrar el primer ADMIN.',
    );
  }

  const prompts = createInterface({ input: stdin, output: stdout });
  let dto: CreateUsuarioDto;
  try {
    dto = plainToInstance(CreateUsuarioDto, {
      email: await prompts.question('Correo institucional: '),
      nombres: await prompts.question('Nombres: '),
      apellidos: await prompts.question('Apellidos: '),
      id_externo_sso: await prompts.question(
        'Identificador sub del proveedor institucional: ',
      ),
      rol: UsuarioRol.ADMIN,
    });
  } finally {
    prompts.close();
  }

  const validationErrors = await validate(dto);
  if (validationErrors.length > 0) {
    throw new Error(validationMessages(validationErrors).join(' '));
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const usuario = await app.get(UsuariosService).createInitialAdmin(dto);
    stdout.write(`ADMIN inicial registrado: ${usuario.email}\n`);
  } finally {
    await app.close();
  }
}

try {
  await main();
} catch (error: unknown) {
  const message =
    error instanceof HttpException
      ? error.message
      : error instanceof Error
        ? error.message
        : 'No se pudo registrar el primer ADMIN.';
  console.error(message);
  process.exitCode = 1;
}
