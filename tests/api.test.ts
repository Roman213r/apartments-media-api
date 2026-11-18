import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { multipartBody } from './multipart.js';

const dbPath = path.join(os.tmpdir(), `apartments-api-${process.pid}.db`);
process.env.DATABASE_PATH = dbPath;
process.env.S3_DRIVER = 'memory';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_BUCKET = 'test-bucket';
process.env.AWS_REGION = 'eu-north-1';

const { buildApp } = await import('../src/app.js');
const { closeDb, initDb } = await import('../src/db.js');
const { resetMemoryS3 } = await import('../src/s3.js');
const { toWebp } = await import('../src/images.js');

let app: FastifyInstance;

before(async () => {
  initDb();
  resetMemoryS3();
  app = await buildApp();
});

after(async () => {
  await app.close();
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
});

describe('apartments API', { concurrency: false }, () => {
  test('a wide PNG is stored and served as WebP no wider than 1920', async () => {
    const png = await sharp({
      create: { width: 2000, height: 20, channels: 3, background: { r: 20, g: 80, b: 200 } },
    })
      .png()
      .toBuffer();
    const form = multipartBody([{ name: 'file', filename: 'wide.png', type: 'image/png', data: png }]);
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/images',
      headers: { 'content-type': form.contentType },
      payload: form.payload,
    });
    assert.equal(uploaded.statusCode, 200);
    const body = uploaded.json();
    assert.equal(body.images[0].contentType, 'image/webp');
    assert.match(body.images[0].key, /^uploads\/[0-9a-f-]{36}\.webp$/);

    const imageUrl = new URL(body.images[0].url);
    const fetched = await app.inject({ method: 'GET', url: imageUrl.pathname });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.headers['content-type'], 'image/webp');
    const bytes = fetched.rawPayload;
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
    const meta = await sharp(bytes).metadata();
    assert.ok((meta.width ?? 0) <= 1920);
    assert.ok((meta.height ?? 0) <= 1920);
  });

  test('a text file is rejected', async () => {
    const form = multipartBody([
      { name: 'file', filename: 'notes.txt', type: 'text/plain', data: Buffer.from('hello') },
    ]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/images',
      headers: { 'content-type': form.contentType },
      payload: form.payload,
    });
    assert.equal(response.statusCode, 415);
  });

  test('an apartment can be created, paged, updated, and a missing id is 404', async () => {
    const key = await uploadTiny();
    const created = await postApartment({
      title: 'QA нова',
      price: 25000,
      currency: 'uah',
      city: 'Львів',
      imageKeys: [key],
    });
    assert.equal(created.statusCode, 201);
    const apartment = created.json();
    assert.equal(apartment.currency, 'UAH');
    assert.deepEqual(apartment.imageKeys, [key]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await postApartment({ title: 'QA стара', price: 1, city: 'Львів' });
    const page = await app.inject({ method: 'GET', url: '/api/apartments?city=Львів&limit=1&page=1' });
    assert.equal(page.statusCode, 200);
    const listed = page.json();
    assert.equal(listed.pagination.total, 2);
    assert.equal(listed.pagination.totalPages, 2);
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].title, 'QA стара');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/apartments/${apartment.id}`,
      payload: { price: 26000 },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(patched.json().price, 26000);
    assert.equal(patched.json().title, 'QA нова');

    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: `/api/apartments/${apartment.id}`,
      payload: {},
    });
    assert.equal(emptyPatch.statusCode, 400);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/apartments/00000000-0000-4000-8000-000000000099',
    });
    assert.equal(missing.statusCode, 404);

    const badQuery = await app.inject({ method: 'GET', url: '/api/apartments?limit=101' });
    assert.equal(badQuery.statusCode, 400);
  });

  test('a shared photo stays until the last apartment is deleted', async () => {
    const key = await uploadTiny();
    const first = (await postApartment({ title: 'Спільна 1', price: 1, imageKeys: [key] })).json();
    const second = (await postApartment({ title: 'Спільна 2', price: 1, imageKeys: [key] })).json();

    const removed = await app.inject({ method: 'DELETE', url: `/api/apartments/${first.id}` });
    assert.equal(removed.statusCode, 204);
    const stillThere = await app.inject({ method: 'GET', url: `/api/images/${key}` });
    assert.equal(stillThere.statusCode, 200);

    await app.inject({ method: 'DELETE', url: `/api/apartments/${second.id}` });
    const gone = await app.inject({ method: 'GET', url: `/api/images/${key}` });
    assert.equal(gone.statusCode, 404);
  });

  test('deleting an image detaches it from the apartment', async () => {
    const key = await uploadTiny();
    const created = (await postApartment({ title: 'З фото', price: 2, imageKeys: [key] })).json();
    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/images',
      payload: { keys: [key] },
    });
    assert.equal(deleted.statusCode, 200);
    const apartment = await app.inject({ method: 'GET', url: `/api/apartments/${created.id}` });
    assert.deepEqual(apartment.json().imageKeys, []);
    const image = await app.inject({ method: 'GET', url: `/api/images/${key}` });
    assert.equal(image.statusCode, 404);
  });

  test('a forged image path is rejected', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/images/uploads/not-a-uuid.webp' });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, 'Invalid image key');
  });

  test('bytes that are not an image fail conversion', async () => {
    await assert.rejects(
      () => toWebp(Buffer.from('not-an-image')),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 400);
        return true;
      },
    );
  });
});

async function uploadTiny(): Promise<string> {
  const png = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 20, b: 20 } },
  })
    .png()
    .toBuffer();
  const form = multipartBody([{ name: 'file', filename: 'tiny.png', type: 'image/png', data: png }]);
  const response = await app.inject({
    method: 'POST',
    url: '/api/images',
    headers: { 'content-type': form.contentType },
    payload: form.payload,
  });
  assert.equal(response.statusCode, 200);
  return response.json().images[0].key as string;
}

function postApartment(body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/apartments', payload: body });
}
