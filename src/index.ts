import { buildApp } from './app.js';
import { env } from './config.js';
import { closeDb, initDb } from './db.js';
import { explainS3Error, initS3, s3Region } from './s3.js';

async function main(): Promise<void> {
  initDb();
  try {
    await initS3();
  } catch (error) {
    console.error(`S3 connection failed: ${explainS3Error(error)}`);
    process.exit(1);
  }

  const app = await buildApp();
  const shutdown = async () => {
    await app.close();
    closeDb();
  };
  process.on('SIGINT', () => {
    void shutdown().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().then(() => process.exit(0));
  });

  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`S3 bucket ${env.s3Bucket} (${s3Region()})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
