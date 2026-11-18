import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from './config.js';
import type { CreateApartmentInput, UpdateApartmentInput } from './schemas.js';

export type ApartmentRow = {
  id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  city: string;
  address: string;
  rooms: number | null;
  area_m2: number | null;
  floor: number | null;
  image_keys: string;
  created_at: string;
  updated_at: string;
};

let database: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!database) {
    throw new Error('Database is not initialized');
  }
  return database;
}

export function initDb(): void {
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
  database = new DatabaseSync(env.databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS apartments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL,
      currency TEXT NOT NULL,
      city TEXT NOT NULL,
      address TEXT NOT NULL,
      rooms INTEGER,
      area_m2 REAL,
      floor INTEGER,
      image_keys TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_apartments_created_at ON apartments (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_apartments_city ON apartments (city);
  `);
}

export function closeDb(): void {
  database?.close();
  database = null;
}

export function parseImageKeys(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function getApartment(id: string): ApartmentRow | null {
  const row = db().prepare('SELECT * FROM apartments WHERE id = ?').get(id) as ApartmentRow | undefined;
  return row ?? null;
}

type ListFilters = {
  q: string | null;
  city: string | null;
  limit: number;
  offset: number;
};

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function listApartments(filters: ListFilters): { rows: ApartmentRow[]; total: number } {
  const pattern = filters.q ? likePattern(filters.q) : null;
  const where = `
    WHERE (? IS NULL OR city = ? COLLATE NOCASE)
      AND (
        ? IS NULL
        OR title LIKE ? ESCAPE '\\'
        OR city LIKE ? ESCAPE '\\'
        OR address LIKE ? ESCAPE '\\'
      )
  `;
  const params = [filters.city, filters.city, filters.q, pattern, pattern, pattern];
  const totalRow = db()
    .prepare(`SELECT COUNT(*) AS total FROM apartments ${where}`)
    .get(...params) as { total: number };
  const rows = db()
    .prepare(`SELECT * FROM apartments ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, filters.limit, filters.offset) as ApartmentRow[];
  return { rows, total: totalRow.total };
}

export function insertApartment(input: CreateApartmentInput): ApartmentRow {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db()
    .prepare(
      `INSERT INTO apartments (
        id, title, description, price, currency, city, address, rooms, area_m2, floor, image_keys, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.title,
      input.description,
      input.price,
      input.currency,
      input.city,
      input.address,
      input.rooms ?? null,
      input.areaM2 ?? null,
      input.floor ?? null,
      JSON.stringify(input.imageKeys),
      now,
      now,
    );
  return getApartment(id) as ApartmentRow;
}

export function updateApartment(id: string, patch: UpdateApartmentInput): ApartmentRow | null {
  const current = getApartment(id);
  if (!current) return null;

  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null) => {
    assignments.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.title !== undefined) set('title', patch.title);
  if (patch.description !== undefined) set('description', patch.description);
  if (patch.price !== undefined) set('price', patch.price);
  if (patch.currency !== undefined) set('currency', patch.currency);
  if (patch.city !== undefined) set('city', patch.city);
  if (patch.address !== undefined) set('address', patch.address);
  if (patch.rooms !== undefined) set('rooms', patch.rooms);
  if (patch.areaM2 !== undefined) set('area_m2', patch.areaM2);
  if (patch.floor !== undefined) set('floor', patch.floor);
  if (patch.imageKeys !== undefined) set('image_keys', JSON.stringify(patch.imageKeys));

  set('updated_at', new Date().toISOString());
  values.push(id);
  db().prepare(`UPDATE apartments SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  return getApartment(id);
}

export function deleteApartment(id: string): ApartmentRow | null {
  const current = getApartment(id);
  if (!current) return null;
  db().prepare('DELETE FROM apartments WHERE id = ?').run(id);
  return current;
}

export function imageKeyInUse(key: string, exceptId?: string): boolean {
  const rows = db().prepare('SELECT id, image_keys FROM apartments').all() as Array<{
    id: string;
    image_keys: string;
  }>;
  return rows.some((row) => row.id !== exceptId && parseImageKeys(row.image_keys).includes(key));
}

export function detachImageKeys(keys: string[]): void {
  const drop = new Set(keys);
  const rows = db().prepare('SELECT id, image_keys FROM apartments').all() as Array<{
    id: string;
    image_keys: string;
  }>;
  const update = db().prepare('UPDATE apartments SET image_keys = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();
  for (const row of rows) {
    const current = parseImageKeys(row.image_keys);
    const next = current.filter((key) => !drop.has(key));
    if (next.length !== current.length) {
      update.run(JSON.stringify(next), now, row.id);
    }
  }
}
