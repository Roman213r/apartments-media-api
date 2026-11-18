import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from './config.js';
import { imageKeyInUse } from './db.js';

let client: S3Client | null = null;
let resolvedRegion = env.awsRegion;
const memoryObjects = new Map<string, Buffer>();

function memoryStore(): Map<string, Buffer> | null {
  return process.env.S3_DRIVER === 'memory' ? memoryObjects : null;
}

export function resetMemoryS3(): void {
  memoryObjects.clear();
}

function buildClient(region: string): S3Client {
  return new S3Client({
    region,
    credentials: {
      accessKeyId: env.awsAccessKeyId,
      secretAccessKey: env.awsSecretAccessKey,
    },
  });
}

function headerValue(error: unknown, name: string): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as {
    $response?: { headers?: Record<string, string> };
    $metadata?: { httpHeaders?: Record<string, string> };
  };
  const headers = {
    ...(record.$metadata?.httpHeaders ?? {}),
    ...(record.$response?.headers ?? {}),
  };
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1];
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return record.name === 'NotFound' || record.name === 'NoSuchKey' || record.$metadata?.httpStatusCode === 404;
}

export function explainS3Error(error: unknown): string {
  const record = error as { name?: string; message?: string };
  const name = record.name ?? '';
  const message = record.message ?? 'Unknown S3 error';
  if (name === 'AccessDenied' || /access denied/i.test(message)) {
    return 'S3 access denied. In IAM, attach the ApartmentsS3Only policy to the user apartments-uploader.';
  }
  if (name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch') {
    return 'AWS rejected the access key. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.';
  }
  if (name === 'NoSuchBucket') {
    return `Bucket "${env.s3Bucket}" was not found.`;
  }
  return message;
}

export async function initS3(): Promise<void> {
  if (memoryStore()) {
    resolvedRegion = env.awsRegion;
    return;
  }
  let current = buildClient(env.awsRegion);
  try {
    await current.send(new ListObjectsV2Command({ Bucket: env.s3Bucket, MaxKeys: 1 }));
  } catch (error) {
    const hinted = headerValue(error, 'x-amz-bucket-region');
    if (!hinted || hinted === env.awsRegion) {
      current.destroy();
      throw error;
    }
    current.destroy();
    current = buildClient(hinted);
    await current.send(new ListObjectsV2Command({ Bucket: env.s3Bucket, MaxKeys: 1 }));
    resolvedRegion = hinted;
  }
  client = current;
}

export function s3Region(): string {
  return resolvedRegion;
}

function s3(): S3Client {
  if (!client) throw new Error('S3 client is not initialized');
  return client;
}

export async function uploadWebp(key: string, body: Buffer): Promise<void> {
  const memory = memoryStore();
  if (memory) {
    memory.set(key, Buffer.from(body));
    return;
  }
  await s3().send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

export async function objectExists(key: string): Promise<boolean> {
  const memory = memoryStore();
  if (memory) return memory.has(key);
  try {
    await s3().send(new HeadObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

export async function openObject(key: string): Promise<{ stream: Readable; contentLength?: number } | null> {
  const memory = memoryStore();
  if (memory) {
    const body = memory.get(key);
    if (!body) return null;
    return { stream: Readable.from(body), contentLength: body.length };
  }
  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    if (!result.Body) return null;
    const stream =
      result.Body instanceof Readable
        ? result.Body
        : Readable.from(Buffer.from(await result.Body.transformToByteArray()));
    return { stream, contentLength: result.ContentLength };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const memory = memoryStore();
  if (memory) {
    memory.delete(key);
    return;
  }
  await s3().send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
}

export async function deleteUnusedKeys(keys: string[], exceptApartmentId?: string): Promise<void> {
  for (const key of keys) {
    if (!imageKeyInUse(key, exceptApartmentId)) {
      await deleteObject(key);
    }
  }
}
