import { Injectable, NestInterceptor, PayloadTooLargeException, UnsupportedMediaTypeException, BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import multer from 'multer';
import type { Request, Response } from 'express';
import { from, switchMap, type Observable } from 'rxjs';
import { DOCX_MIME, PDF_MIME, PLANTILLA_PAT_MAX_BYTES } from '../plantillas-pat/plantilla-pat-file.validator.js';

type UploadRequest = Request & { file?: Express.Multer.File };

@Injectable()
export class DocumentoPatUploadInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<UploadRequest>();
    const response = http.getResponse<Response>();
    const upload = new Promise<void>((resolve, reject) => {
      multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: PLANTILLA_PAT_MAX_BYTES, files: 1, fields: 1, parts: 2, fieldSize: 64 },
        fileFilter: (_request, file, callback) => {
          const ext = file.originalname.toLowerCase().split('.').pop();
          if (!((ext === 'pdf' && file.mimetype === PDF_MIME) || (ext === 'docx' && file.mimetype === DOCX_MIME))) {
            callback(new UnsupportedMediaTypeException('Solo se admiten PDF o DOCX válidos.'));
            return;
          }
          callback(null, true);
        },
      }).single('archivo')(request, response, (error: unknown) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'LIMIT_FILE_SIZE') {
          reject(new PayloadTooLargeException('El archivo supera el máximo de 10 MiB.'));
          return;
        }
        if (error) { reject(error instanceof Error ? error : new BadRequestException('El formulario de archivo no es válido.')); return; }
        resolve();
      });
    });
    return from(upload).pipe(switchMap(() => next.handle()));
  }
}
