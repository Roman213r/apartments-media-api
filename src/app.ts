import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { apartmentRoutes } from './apartments.js';
import { env } from './config.js';
import { HttpError } from './http.js';
import { imageRoutes } from './images.js';
import { s3Region } from './s3.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, trustProxy: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 15 * 1024 * 1024,
      files: 10,
    },
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    const statusCode =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: number }).statusCode)
        : undefined;
    const message = error instanceof Error ? error.message : 'Request failed';
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({
    ok: true,
    bucket: env.s3Bucket,
    region: s3Region(),
  }));

  app.get('/', async () => ({
    name: 'apartments-api',
    health: 'GET /health',
    apartments: {
      list: 'GET /api/apartments?page=1&limit=20&q=&city=',
      create: 'POST /api/apartments',
      read: 'GET /api/apartments/:id',
      update: 'PATCH /api/apartments/:id',
      delete: 'DELETE /api/apartments/:id',
    },
    images: {
      upload: 'POST /api/images (multipart field "file", stored as WebP)',
      read: 'GET /api/images/uploads/<uuid>.webp',
      delete: 'DELETE /api/images { "keys": ["uploads/<uuid>.webp"] }',
    },
  }));

  await app.register(apartmentRoutes);
  await app.register(imageRoutes);
  return app;
}
