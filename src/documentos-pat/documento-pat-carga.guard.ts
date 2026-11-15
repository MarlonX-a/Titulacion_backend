import { BadRequestException, CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import type { Usuario } from '../usuarios/entities/usuario.entity.js';
import { DocumentosPatService } from './documentos-pat.service.js';

type CargaRequest = Request & { usuario?: Usuario };

/**
 * Autoriza la entrega PAT antes de que multer lea el cuerpo: los guards se ejecutan antes que los
 * interceptores, de modo que un estudiante ajeno al trabajo recibe 403/404 sin que el servidor
 * reciba hasta 10 MiB en memoria. `DocumentosPatService.cargar` repite la autorización dentro de
 * la transacción (defensa en profundidad y bloqueos).
 */
@Injectable()
export class DocumentoPatCargaGuard implements CanActivate {
  constructor(private readonly documentos: DocumentosPatService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CargaRequest>();
    if (!request.usuario) throw new UnauthorizedException('Se requiere una sesión válida.');
    // Los pipes de parámetros todavía no se han ejecutado.
    const { periodoId, asignacionId } = request.params;
    if (typeof periodoId !== 'string' || typeof asignacionId !== 'string' || !isUUID(periodoId) || !isUUID(asignacionId)) throw new BadRequestException('Validation failed (uuid is expected)');
    await this.documentos.preautorizarCarga(periodoId, asignacionId, request.usuario);
    return true;
  }
}
