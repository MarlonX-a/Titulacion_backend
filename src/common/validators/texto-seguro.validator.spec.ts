import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateGrupoDto } from '../../grupos/dto/create-grupo.dto.js';
import { datosEstudianteVisibles, VISOR_ADMIN } from '../privacidad/visor-datos.js';
import { esTextoSeguro } from './texto-seguro.validator.js';

const errores = (nombre: unknown) => validateSync(plainToInstance(CreateGrupoDto, { nombre })).length;

describe('texto seguro para avisos y correos', () => {
  it('rechaza enlaces, controles y caracteres bidireccionales o invisibles', () => {
    for (const value of ['ver https://evil.example', 'hxxp://x', 'www.evil.example', 'a\nb', 'a\u0007b', 'Grupo ‮fdp.exe', 'a​b', 'a⁦b', '﻿Grupo']) {
      expect(esTextoSeguro(value), JSON.stringify(value)).toBe(false);
    }
    expect(esTextoSeguro('Grupo de titulación A')).toBe(true);
  });

  it('el nombre de grupo admite letras de cualquier alfabeto, dígitos y puntuación básica', () => {
    for (const nombre of ['Grupo de titulación A', 'Equipo Ñandú 2', "Grupo (B) & O'Neil #3", 'Grupo_1-2', 'Γκρουπ']) expect(errores(nombre), nombre).toBe(0);
  });

  it('el nombre de grupo rechaza dominios, rutas, correos y caracteres invisibles', () => {
    for (const nombre of ['evil.example', 'a/b', 'x@y', 'Verifica en https://evil.example/login', 'Grupo ‮fdp.exe', '-Grupo', '<b>Grupo</b>']) expect(errores(nombre), nombre).toBeGreaterThan(0);
  });
});

describe('visibilidad de la matrícula', () => {
  const datos = { id: 'e1', nombres: 'Ana', apellidos: 'Pérez', matricula: '1712345678' };
  it('solo ADMIN y el propio estudiante la reciben', () => {
    expect(datosEstudianteVisibles(VISOR_ADMIN, datos)).toHaveProperty('matricula');
    expect(datosEstudianteVisibles({ esAdmin: false, estudianteId: 'e1' }, datos)).toHaveProperty('matricula');
    expect(datosEstudianteVisibles({ esAdmin: false, estudianteId: 'e2' }, datos)).not.toHaveProperty('matricula');
    expect(datosEstudianteVisibles({ esAdmin: false, estudianteId: null }, datos)).not.toHaveProperty('matricula');
  });
});
