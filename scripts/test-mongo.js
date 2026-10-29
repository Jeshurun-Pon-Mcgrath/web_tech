import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function configureTestMongo() {
  const cached = fileURLToPath(new URL('../.cache/mongodb/mongod.exe', import.meta.url));
  if (!process.env.MONGOMS_SYSTEM_BINARY && process.platform === 'win32' && existsSync(cached))
    process.env.MONGOMS_SYSTEM_BINARY = cached;
}
