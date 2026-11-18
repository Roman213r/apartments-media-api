import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

const dbPath = path.join(os.tmpdir(), `apartments-db-${process.pid}.db`);
process.env.DATABASE_PATH = dbPath;
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.S3_BUCKET = 'test-bucket';
process.env.AWS_REGION = 'eu-north-1';

const { initDb, closeDb, insertApartment, listApartments, getApartment, updateApartment, deleteApartment, detachImageKeys } =
  await import('../src/db.js');

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('apartment database', { concurrency: false }, () => {
  before(() => {
    initDb();
  });

  after(() => {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  });

  test('lists the newest apartments first and pages them', async () => {
    await insert('Стара', 'Kyiv');
    await pause();
    await insert('Середня', 'Lviv');
    await pause();
    await insert('Нова', 'Lviv');

    const page = listApartments({ q: null, city: 'lviv', limit: 1, offset: 0 });
    assert.equal(page.total, 2);
    assert.equal(page.rows[0]?.title, 'Нова');

    const next = listApartments({ q: null, city: 'Lviv', limit: 1, offset: 1 });
    assert.equal(next.rows[0]?.title, 'Середня');
  });

  test('search matches a part of the address', async () => {
    const created = insertApartment({
      title: 'З адресою',
      description: '',
      price: 5,
      currency: 'UAH',
      city: 'Одеса',
      address: 'вул. Тестова 7',
      imageKeys: [],
    });
    const found = listApartments({ q: 'Тестова', city: null, limit: 10, offset: 0 });
    assert.ok(found.rows.some((row) => row.id === created.id));
  });

  test('update changes only the given fields and delete removes the row', () => {
    const created = insertApartment({
      title: 'До оновлення',
      description: 'опис',
      price: 100,
      currency: 'UAH',
      city: 'Київ',
      address: '',
      imageKeys: [],
    });
    const updated = updateApartment(created.id, { price: 180 });
    assert.equal(updated?.price, 180);
    assert.equal(updated?.title, 'До оновлення');
    assert.notEqual(updated?.updated_at, created.created_at);

    assert.ok(deleteApartment(created.id));
    assert.equal(getApartment(created.id), null);
  });

  test('detaching an image key removes it from every apartment', () => {
    const key = 'uploads/11111111-1111-4111-8111-111111111111.webp';
    const first = insertApartment({
      title: 'Перша',
      description: '',
      price: 1,
      currency: 'UAH',
      city: '',
      address: '',
      imageKeys: [key],
    });
    const second = insertApartment({
      title: 'Друга',
      description: '',
      price: 1,
      currency: 'UAH',
      city: '',
      address: '',
      imageKeys: [key],
    });

    detachImageKeys([key]);
    assert.deepEqual(JSON.parse(getApartment(first.id)?.image_keys ?? '[]'), []);
    assert.deepEqual(JSON.parse(getApartment(second.id)?.image_keys ?? '[]'), []);
  });
});

function insert(title: string, city: string) {
  return insertApartment({
    title,
    description: '',
    price: 1,
    currency: 'UAH',
    city,
    address: '',
    imageKeys: [],
  });
}
