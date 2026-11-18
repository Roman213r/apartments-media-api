import type { FastifyInstance, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { detachImageKeys } from './db.js';
import { HttpError } from './http.js';
import { deleteImagesSchema, IMAGE_KEY_PATTERN } from './schemas.js';
import { deleteObject, openObject, uploadWebp } from './s3.js';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
  'application/octet-stream',
]);

export function imageUrl(request: FastifyRequest, key: string): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim() || request.protocol;
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  return `${proto}://${host}/api/images/${key}`;
}

export async function toWebp(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { failOn: 'error' })
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new HttpError(400, 'File is not a valid image');
  }
}

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/images', async (request) => {
    if (!request.isMultipart()) {
      throw new HttpError(400, 'Send multipart/form-data with one or more file fields');
    }

    const converted: Array<{ key: string; body: Buffer }> = [];
    for await (const part of request.files()) {
      const mime = part.mimetype.toLowerCase();
      if (!ALLOWED_TYPES.has(mime)) {
        throw new HttpError(415, `Unsupported file type: ${part.mimetype}`);
      }
      const input = await part.toBuffer();
      if (input.length === 0) {
        throw new HttpError(400, 'Empty file');
      }
      const body = await toWebp(input);
      converted.push({ key: `uploads/${crypto.randomUUID()}.webp`, body });
    }

    if (converted.length === 0) {
      throw new HttpError(400, 'Attach at least one image in the file field');
    }

    const uploaded: string[] = [];
    try {
      for (const item of converted) {
        await uploadWebp(item.key, item.body);
        uploaded.push(item.key);
      }
    } catch (error) {
      await Promise.allSettled(uploaded.map((key) => deleteObject(key)));
      throw error;
    }

    return {
      images: converted.map((item) => ({
        key: item.key,
        url: imageUrl(request, item.key),
        contentType: 'image/webp',
        bytes: item.body.length,
      })),
    };
  });

  app.get('/api/images/*', async (request, reply) => {
    const key = (request.params as { '*': string })['*'];
    if (!IMAGE_KEY_PATTERN.test(key)) {
      throw new HttpError(400, 'Invalid image key');
    }
    const object = await openObject(key);
    if (!object) {
      throw new HttpError(404, 'Image not found');
    }
    if (object.contentLength !== undefined) {
      reply.header('Content-Length', object.contentLength);
    }
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'public, max-age=86400')
      .send(object.stream);
  });

  app.delete('/api/images', async (request) => {
    const parsed = deleteImagesSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, 'Body must be { "keys": ["uploads/<uuid>.webp"] }');
    }
    for (const key of parsed.data.keys) {
      await deleteObject(key);
    }
    detachImageKeys(parsed.data.keys);
    return { deleted: parsed.data.keys };
  });
}
