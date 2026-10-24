import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { HttpException, ValidationError } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { loadEnvironment } from '../config/load-environment.js';
import { createDatabaseOptions } from '../database/database.options.js';
import { DatabaseDataSource } from '../database/database-data-source.js';
import { CreateUsuarioDto } from './dto/create-usuario.dto.js';
import { UsuariosService } from './usuarios.service.js';
import { UsuarioRol } from './enums/usuario-rol.enum.js';

function messages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

async function secretQuestion(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Este comando requiere una terminal interactiva.');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Operación cancelada.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); stdout.write('\b \b'); continue; }
        if (character >= ' ') { value += character; stdout.write('*'); }
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Ejecuta este comando desde una terminal interactiva.');
  const prompts = createInterface({ input: stdin, output: stdout });
  const environment = loadEnvironment();
  if (environment.DB_SCHEMA !== 'titulacion_dev') {
    throw new Error('El comando de bootstrap solo opera en el esquema titulacion_dev.');
  }
  let details: CreateUsuarioDto & { password: string };
  try {
    const email = await prompts.question('Correo @uleam.edu.ec o @live.uleam.edu.ec: ');
    const nombres = await prompts.question('Nombres: ');
    const apellidos = await prompts.question('Apellidos: ');
    prompts.close();
    const password = await secretQuestion('Contraseña personal (no se mostrará): ');
    const confirmation = await secretQuestion('Confirma la contraseña: ');
    if (password !== confirmation || password.length < 15 || password.length > 128) throw new Error('Las contraseñas no coinciden o no cumplen la longitud mínima de 15 caracteres.');
    details = { email, nombres, apellidos, rol: UsuarioRol.ADMIN, password };
  } finally {
    prompts.close();
  }
  const dto = plainToInstance(CreateUsuarioDto, details);
  const validationErrors = await validate(dto);
  if (validationErrors.length > 0) throw new Error(messages(validationErrors).join(' '));

  const source = new DatabaseDataSource(createDatabaseOptions(environment));
  try {
    await source.initialize();
    const user = await new UsuariosService(source.getRepository((await import('./entities/usuario.entity.js')).Usuario), source)
      .createInitialAdmin({ email: dto.email, nombres: dto.nombres, apellidos: dto.apellidos, password: details.password });
    stdout.write(`ADMIN registrado: ${user.email}\n`);
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof HttpException
    ? error.message
    : error instanceof Error ? error.message : 'No se pudo registrar el ADMIN inicial.';
  console.error(message);
  process.exitCode = 1;
}
