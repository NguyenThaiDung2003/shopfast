import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupSwagger } from '../src/swagger';
import { createTestApp } from './create-test-app';

describe('Swagger /docs (e2e)', () => {
  let app: INestApplication;
  let doc: {
    paths: Record<string, Record<string, { security?: unknown[]; tags?: string[] }>>;
    components: { securitySchemes: Record<string, { type: string; scheme: string }> };
  };

  beforeAll(async () => {
    ({ app } = await createTestApp({ beforeInit: setupSwagger }));
    doc = (await request(app.getHttpServer()).get('/docs-json').expect(200)).body;
  });

  afterAll(async () => {
    await app.close();
  });

  it('UI Swagger tại /docs', async () => {
    const res = await request(app.getHttpServer()).get('/docs').expect(200);

    expect(res.text).toContain('swagger-ui');
  });

  it('khai báo bearer auth', () => {
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('có đủ nhóm API chính, prefix /api (health ở ngoài)', () => {
    for (const path of [
      '/api/auth/login',
      '/api/products',
      '/api/products/{id}',
      '/api/categories',
      '/api/brands',
      '/api/cart',
      '/api/orders',
      '/api/orders/me',
      '/api/orders/{id}/status',
      '/api/users',
      '/health',
      '/health/live',
    ]) {
      expect(Object.keys(doc.paths)).toContain(path);
    }
  });

  it('endpoint cần đăng nhập có khoá bearer, endpoint công khai thì không', () => {
    expect(doc.paths['/api/orders/{id}/status']!.patch!.security).toEqual([{ bearer: [] }]);
    expect(doc.paths['/api/cart']!.get!.security).toEqual([{ bearer: [] }]);
    expect(doc.paths['/api/products']!.get!.security).toBeUndefined();
    expect(doc.paths['/api/auth/login']!.post!.security).toBeUndefined();
  });
});
