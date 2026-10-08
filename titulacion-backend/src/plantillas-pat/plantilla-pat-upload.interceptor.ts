import { Injectable, NestInterceptor, PayloadTooLargeException, UnsupportedMediaTypeException, BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import multer from 'multer';
import type { Request, Response } from 'express';
import { from, switchMap, type Observable } from 'rxjs';
import { DOCX_MIME, PDF_MIME, PLANTILLA_PAT_MAX_BYTES } from './plantilla-pat-file.validator.js';

type UploadRequest = Request & { file?: Express.Multer.File };

@Injectable()
export class PlantillaPatUploadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<UploadRequest>();
    const response = http.getResponse<Response>();
    const upload = new Promise<void>((resolve, reject) => {
      multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: PLANTILLA_PAT_MAX_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 128 },
        fileFilter: (_request, file, callback) => {
          const extension = file.originalname.toLowerCase().split('.').pop();
          const allowed = (extension === 'pdf' && file.mimetype === PDF_MIME) || (extension === 'docx' && file.mimetype === DOCX_MIME);
          if (!allowed) return callback(new UnsupportedMediaTypeException('Solo se admiten archivos PDF o DOCX con extensión y tipo MIME coincidentes.'));
          callback(null, true);
        },
      }).single('archivo')(request, response, (error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'LIMIT_FILE_SIZE') {
          reject(new PayloadTooLargeException('El archivo supera el máximo de 10 MiB.'));
          return;
        }
        if (error) {
          reject(error instanceof Error ? error : new BadRequestException('El formulario de archivo no es válido.'));
          return;
        }
        if (request.file && (request.file.originalname.length > 200 || request.file.originalname.includes('/') || request.file.originalname.includes('\\') || hasControlCharacter(request.file.originalname))) {
          reject(new BadRequestException('El nombre debe tener hasta 200 caracteres y no incluir rutas ni caracteres de control.'));
          return;
        }
        resolve();
      });
    });
    return from(upload).pipe(switchMap(() => next.handle()));
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
