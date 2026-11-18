import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(srcDir, '..');

loadEnv({ path: path.join(projectRoot, '.env') });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }
  return value;
}

const port = Number(process.env.PORT ?? 3000);

export const env = {
  port: Number.isInteger(port) && port > 0 ? port : 3000,
  awsRegion: process.env.AWS_REGION?.trim() || 'eu-north-1',
  awsAccessKeyId: required('AWS_ACCESS_KEY_ID'),
  awsSecretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
  s3Bucket: required('S3_BUCKET'),
  databasePath: path.resolve(projectRoot, process.env.DATABASE_PATH?.trim() || 'data/apartments.db'),
};
