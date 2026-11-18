import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  deleteApartment,
  getApartment,
  insertApartment,
  listApartments,
  parseImageKeys,
  updateApartment,
  type ApartmentRow,
} from './db.js';
import { imageUrl } from './images.js';
import { HttpError } from './http.js';
import { createApartmentSchema, listQuerySchema, updateApartmentSchema } from './schemas.js';
import { deleteUnusedKeys, objectExists } from './s3.js';

function toDto(row: ApartmentRow, request: FastifyRequest) {
  const imageKeys = parseImageKeys(row.image_keys);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    currency: row.currency,
    city: row.city,
    address: row.address,
    rooms: row.rooms,
    areaM2: row.area_m2,
    floor: row.floor,
    imageKeys,
    imageUrls: imageKeys.map((key) => imageUrl(request, key)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureImagesExist(keys: string[]): Promise<void> {
  for (const key of keys) {
    if (!(await objectExists(key))) {
      throw new HttpError(400, `Image not found: ${key}`);
    }
  }
}

export async function apartmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/apartments', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    const { page, limit, q, city } = parsed.data;
    const { rows, total } = listApartments({
      q: q || null,
      city: city || null,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      data: rows.map((row) => toDto(row, request)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  });

  app.get('/api/apartments/:id', async (request) => {
    const { id } = request.params as { id: string };
    const row = getApartment(id);
    if (!row) throw new HttpError(404, 'Apartment not found');
    return toDto(row, request);
  });

  app.post('/api/apartments', async (request, reply) => {
    const parsed = createApartmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.flatten() });
    }
    await ensureImagesExist(parsed.data.imageKeys);
    const row = insertApartment(parsed.data);
    return reply.code(201).send(toDto(row, request));
  });

  app.patch('/api/apartments/:id', async (request) => {
    const { id } = request.params as { id: string };
    const parsed = updateApartmentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    const current = getApartment(id);
    if (!current) throw new HttpError(404, 'Apartment not found');

    if (parsed.data.imageKeys) {
      await ensureImagesExist(parsed.data.imageKeys);
    }

    const updated = updateApartment(id, parsed.data);
    if (!updated) throw new HttpError(404, 'Apartment not found');

    if (parsed.data.imageKeys) {
      const previous = parseImageKeys(current.image_keys);
      const removed = previous.filter((key) => !parsed.data.imageKeys?.includes(key));
      await deleteUnusedKeys(removed, id);
    }

    return toDto(updated, request);
  });

  app.delete('/api/apartments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const current = getApartment(id);
    if (!current) throw new HttpError(404, 'Apartment not found');
    const keys = parseImageKeys(current.image_keys);
    deleteApartment(id);
    await deleteUnusedKeys(keys, id);
    return reply.code(204).send();
  });
}
