import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'docs';

/**
 * Tài liệu API sinh tự động (F07) tại /docs, JSON tại /docs-json.
 * Schema DTO lấy từ type + class-validator + JSDoc qua Nest CLI plugin (nest-cli.json).
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('ShopFast API')
    .setDescription(
      [
        'Backend thương mại điện tử ShopFast.',
        '',
        '- Mọi endpoint có biểu tượng khoá cần `Authorization: Bearer <accessToken>` – lấy token qua `POST /api/auth/login` rồi bấm **Authorize**.',
        '- Lỗi trả về dạng `{ statusCode, code, message, path, timestamp, details? }`, thông điệp tiếng Việt.',
        '- Tiền tệ: số nguyên, đơn vị đồng (VND).',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token (15 phút)',
      },
      'bearer',
    )
    .build();

  const document = splitSummaries(SwaggerModule.createDocument(app, config));
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    useGlobalPrefix: false,
    customSiteTitle: 'ShopFast API docs',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: 'alpha' },
  });
}

/**
 * Plugin đưa cả JSDoc của handler vào `description`. Tách đoạn đầu làm `summary`
 * (hiện trên danh sách endpoint), phần còn lại giữ làm `description`.
 */
export function splitSummaries(document: OpenAPIObject): OpenAPIObject {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation?.description || operation.summary) continue;
      const [first, ...rest] = operation.description.split(/\n\s*\n/);
      operation.summary = first!.replace(/\s+/g, ' ').trim();
      operation.description =
        rest
          .join('\n\n')
          .replace(/\n(?!\n)/g, ' ')
          .trim() || undefined;
    }
  }
  return document;
}
