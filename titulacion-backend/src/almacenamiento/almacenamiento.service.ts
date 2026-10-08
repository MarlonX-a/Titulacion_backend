import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AppEnvironment } from '../config/environment.js';

@Injectable()
export class AlmacenamientoService implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucket?: string;
  private readonly createBucketOnDemand: boolean;
  private bucketReady?: Promise<void>;

  constructor(config: ConfigService<AppEnvironment, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.createBucketOnDemand =
      config.get('NODE_ENV', { infer: true }) !== 'production';
    this.client = new S3Client({
      region: config.get('S3_REGION', { infer: true }),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      ...(config.get('S3_ACCESS_KEY', { infer: true }) &&
      config.get('S3_SECRET_KEY', { infer: true })
        ? {
            credentials: {
              accessKeyId: config.get('S3_ACCESS_KEY', { infer: true })!,
              secretAccessKey: config.get('S3_SECRET_KEY', { infer: true })!,
            },
          }
        : {}),
    });
  }

  async savePrivate(buffer: Buffer, contentType: string): Promise<string> {
    if (!this.bucket)
      throw new ServiceUnavailableException(
        'El almacenamiento privado no está configurado.',
      );
    const key = `importaciones/${randomUUID()}.xlsx`;
    try {
      await this.ensureBucket();
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          ServerSideEncryption: 'AES256',
        }),
      );
      return key;
    } catch (error: unknown) {
      throw new ServiceUnavailableException(
        'No se pudo guardar el archivo de importación.',
        { cause: error },
      );
    }
  }

  async readPrivate(key: string): Promise<Buffer> {
    if (!this.bucket || !key.startsWith('importaciones/'))
      throw new ServiceUnavailableException(
        'El archivo de importación no está disponible.',
      );
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) throw new Error('body absent');
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error: unknown) {
      throw new ServiceUnavailableException(
        'No se pudo leer el archivo de importación.',
        { cause: error },
      );
    }
  }

  async removePrivate(key: string): Promise<void> {
    if (!this.bucket || !key.startsWith('importaciones/')) return;
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.client.destroy();
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucket || !this.createBucketOnDemand) return;
    this.bucketReady ??= this.createDevelopmentBucket();
    return this.bucketReady;
  }

  private async createDevelopmentBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : '';
      if (!['NotFound', 'NoSuchBucket', 'NotFoundError'].includes(name))
        throw error;
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
      } catch (createError: unknown) {
        const createName = createError instanceof Error ? createError.name : '';
        if (
          !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(
            createName,
          )
        )
          throw createError;
      }
    }
  }
}
