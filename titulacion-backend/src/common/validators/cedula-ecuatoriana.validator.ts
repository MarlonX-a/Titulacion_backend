import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'cedulaEcuatoriana', async: false })
export class CedulaEcuatorianaValidator implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string' || !/^(0[1-9]|1[0-9]|2[0-4]|30)\d{8}$/.test(value)) {
      return false;
    }

    const digits = [...value].map(Number);
    const checksum = digits.slice(0, 9).reduce((sum, digit, index) => {
      const product = digit * (index % 2 === 0 ? 2 : 1);
      return sum + (product > 9 ? product - 9 : product);
    }, 0);
    const checkDigit = (10 - (checksum % 10)) % 10;
    return digits[9] === checkDigit;
  }

  defaultMessage(): string {
    return 'cedula debe tener 10 dígitos, un código provincial válido y checksum correcto.';
  }
}
