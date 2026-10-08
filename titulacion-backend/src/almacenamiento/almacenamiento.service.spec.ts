import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment.js';
import { AlmacenamientoService } from './almacenamiento.service.js';

describe('AlmacenamientoService', () => {
  it('genera una URL S3 firmada de cinco minutos sin contactar el almacenamiento', async () => {
    const values: Partial<AppEnvironment> = {
      NODE_ENV: 'test',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'pat-test-bucket',
      S3_ENDPOINT: 'http://127.0.0.1:8333',
      S3_ACCESS_KEY: 'test-access-key',
      S3_SECRET_KEY: 'test-secret-key',
    };
    const config = new ConfigService<AppEnvironment, true>(values as AppEnvironment);
    const storage = new AlmacenamientoService(config);

    try {
      const url = new URL(await storage.signPrivateDownload(
        'plantillas-pat/version-test.pdf',
        'Plantilla PAT.pdf',
        'application/pdf',
      ));

      expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
      expect(url.searchParams.has('X-Amz-Signature')).toBe(true);
      expect(url.pathname).toContain('/pat-test-bucket/plantillas-pat/version-test.pdf');
      expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
      expect(url.searchParams.get('response-content-disposition')).toContain('Plantilla%20PAT.pdf');
    } finally {
      await storage.onModuleDestroy();
    }
  });
});
