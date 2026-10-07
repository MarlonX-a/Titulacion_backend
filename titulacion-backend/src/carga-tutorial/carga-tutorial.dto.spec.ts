import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateConfigCargaTutorialDto } from './dto/create-config-carga-tutorial.dto.js';
import { UpdateConfigCargaTutorialDto } from './dto/update-config-carga-tutorial.dto.js';

describe('DTO de configuración de carga tutorial', () => {
  it('acepta máximo entero y booleano estrictos, con ámbito global omitido o null', () => {
    for (const docente_id of [undefined, null]) {
      const dto = plainToInstance(CreateConfigCargaTutorialDto, {
        docente_id,
        max_trabajos: 5,
        bloquear_al_superar: true,
      });
      expect(validateSync(dto)).toHaveLength(0);
    }
  });

  it('rechaza cadenas numéricas y booleanas, y máximos fuera de rango', () => {
    for (const body of [
      { max_trabajos: '5', bloquear_al_superar: true },
      { max_trabajos: 5, bloquear_al_superar: 'true' },
      { max_trabajos: 0, bloquear_al_superar: false },
      { max_trabajos: 32768, bloquear_al_superar: false },
    ]) {
      const dto = plainToInstance(CreateConfigCargaTutorialDto, body);
      expect(validateSync(dto).length).toBeGreaterThan(0);
    }
  });

  it('rechaza null explícito al editar', () => {
    const dto = plainToInstance(UpdateConfigCargaTutorialDto, {
      max_trabajos: null,
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
