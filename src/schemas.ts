import { z } from 'zod';

export const IMAGE_KEY_PATTERN =
  /^(uploads|apartments)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export const imageKeySchema = z
  .string()
  .trim()
  .regex(IMAGE_KEY_PATTERN, 'Invalid image key');

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code');

export const createApartmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().default(''),
  price: z.number().int().nonnegative(),
  currency: currencySchema.optional().default('UAH'),
  city: z.string().trim().max(120).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
  rooms: z.number().int().nonnegative().nullable().optional(),
  areaM2: z.number().positive().max(100000).nullable().optional(),
  floor: z.number().int().min(-5).max(200).nullable().optional(),
  imageKeys: z.array(imageKeySchema).max(30).optional().default([]),
});

export const updateApartmentSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    price: z.number().int().nonnegative().optional(),
    currency: currencySchema.optional(),
    city: z.string().trim().max(120).optional(),
    address: z.string().trim().max(300).optional(),
    rooms: z.number().int().nonnegative().nullable().optional(),
    areaM2: z.number().positive().max(100000).nullable().optional(),
    floor: z.number().int().min(-5).max(200).nullable().optional(),
    imageKeys: z.array(imageKeySchema).max(30).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
});

export const deleteImagesSchema = z.object({
  keys: z.array(imageKeySchema).min(1).max(30),
});

export type CreateApartmentInput = z.infer<typeof createApartmentSchema>;
export type UpdateApartmentInput = z.infer<typeof updateApartmentSchema>;
