// Create private development configuration without replacing existing settings.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const apiEnvironment = new URL('apps/api/.env', root);
let template = await readFile(new URL('apps/api/.env.example', root), 'utf8');
const password = `EL-${randomBytes(12).toString('base64url')}!`;
template = template
  .replace(/^CSRF_SECRET=.*$/m, `CSRF_SECRET=${randomBytes(32).toString('hex')}`)
  .replace(/^SEED_ADMIN_PASSWORD=.*$/m, `SEED_ADMIN_PASSWORD=${password}`);
async function createPrivateFile(url, contents) {
  try {
    await writeFile(url, contents, { flag: 'wx', mode: 0o600 });
    console.log(`Created ${url.pathname.split('/').slice(-3).join('/')}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Existing environment file retained.');
  }
}
await createPrivateFile(apiEnvironment, template);
await createPrivateFile(
  new URL('apps/web/.env', root),
  await readFile(new URL('apps/web/.env.example', root), 'utf8'),
);
console.log('Private local configuration ready. Administrator credentials are in apps/api/.env.');
console.log('Start MongoDB, then run npm run seed. Existing database accounts are never replaced.');
