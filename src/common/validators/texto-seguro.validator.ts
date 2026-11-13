import {
  registerDecorator,
  ValidatorConstraint,
  type ValidationOptions,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Texto escrito por un usuario que termina en avisos o correos dirigidos a otras personas
 * (por ejemplo, el nombre de un grupo en una invitación). Se rechazan los caracteres que
 * permiten disfrazarlo y el contenido con aspecto de enlace, que convertiría el correo
 * institucional en un vector de phishing.
 */

// Controles C0/C1 (incluye saltos de línea y tabuladores).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
// Formato bidireccional e invisibles: U+200B–U+200F, U+202A–U+202E, U+2060–U+2069 y U+FEFF.
export const FORMATO_INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;
// Esquemas (`https://`, `hxxp://`) y prefijos `www.` sin esquema.
const ENLACE = /:\/\/|\bwww\./iu;

export function esTextoSeguro(value: string): boolean {
  return !CONTROL.test(value) && !FORMATO_INVISIBLE.test(value) && !ENLACE.test(value);
}

@ValidatorConstraint({ name: 'textoSeguro', async: false })
export class TextoSeguroValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && esTextoSeguro(value);
  }

  defaultMessage(): string {
    return 'El texto no puede incluir enlaces, caracteres de control ni caracteres invisibles o de dirección de escritura.';
  }
}

export function TextoSeguro(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({ target: target.constructor, propertyName: String(propertyName), options, validator: TextoSeguroValidator });
  };
}

/**
 * Nombre visible de un grupo: letras de cualquier alfabeto (con sus marcas combinantes),
 * dígitos, espacios y la puntuación `- _ , ' ( ) & #`. Debe comenzar con letra o dígito. El punto,
 * la barra y la arroba se excluyen para que el nombre no pueda formar un dominio, una ruta ni un correo.
 */
export const NOMBRE_GRUPO_PATRON = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} \-_,'()&#]*$/u;
export const NOMBRE_GRUPO_MENSAJE = 'El nombre del grupo solo admite letras, números, espacios y los signos - _ , \' ( ) & #.';
