import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApartmentSchema, imageKeySchema, listQuerySchema, updateApartmentSchema } from '../src/schemas.js';

const validKey = 'uploads/11111111-1111-4111-8111-111111111111.webp';

test('a minimal apartment gets UAH and no images', () => {
  const parsed = createApartmentSchema.parse({ title: 'Студія', price: 10000 });
  assert.equal(parsed.currency, 'UAH');
  assert.equal(parsed.description, '');
  assert.deepEqual(parsed.imageKeys, []);
});

test('currency is stored in upper case', () => {
  const parsed = createApartmentSchema.parse({ title: 'Студія', price: 1, currency: 'usd' });
  assert.equal(parsed.currency, 'USD');
});

test('price must be a non-negative integer', () => {
  assert.equal(createApartmentSchema.safeParse({ title: 'Студія', price: -1 }).success, false);
  assert.equal(createApartmentSchema.safeParse({ title: 'Студія', price: 10.5 }).success, false);
  assert.equal(createApartmentSchema.safeParse({ title: 'Студія', price: 0 }).success, true);
});

test('blank title and a two-letter currency are rejected', () => {
  assert.equal(createApartmentSchema.safeParse({ title: '   ', price: 1 }).success, false);
  assert.equal(createApartmentSchema.safeParse({ title: 'Студія', price: 1, currency: 'US' }).success, false);
});

test('an empty update is rejected', () => {
  const parsed = updateApartmentSchema.safeParse({});
  assert.equal(parsed.success, false);
});

test('image keys are limited to generated webp paths', () => {
  assert.equal(imageKeySchema.safeParse(validKey).success, true);
  assert.equal(imageKeySchema.safeParse('uploads/not-a-uuid.webp').success, false);
  assert.equal(imageKeySchema.safeParse('../.env').success, false);
});

test('list query defaults to the first page of 20 and rejects an oversized page', () => {
  const parsed = listQuerySchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.limit, 20);
  assert.equal(listQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(listQuerySchema.safeParse({ limit: 101 }).success, false);
});
