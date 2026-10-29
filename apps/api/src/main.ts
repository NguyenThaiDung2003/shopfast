import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { EnvironmentVariables } from './config/env.validation';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const config = app.get(ConfigService<EnvironmentVariables, true>);
  if (config.get('SWAGGER_ENABLED', { infer: true })) setupSwagger(app);
  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
