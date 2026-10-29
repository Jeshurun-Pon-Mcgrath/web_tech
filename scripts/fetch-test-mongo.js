// Optional Windows test bootstrap: download only mongod.exe from the official ZIP.
// Range responses are size checked; extracted bytes are verified against ZIP CRC32.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const exec = promisify(execFile);
const url = 'https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-7.0.24.zip';
const destination = fileURLToPath(new URL('../.cache/mongodb/mongod.exe', import.meta.url));
try {
  await access(destination);
  console.log('Cached test binary already exists:', destination);
  process.exit(0);
} catch {
  /* Download a fresh binary. */
}
async function range(start, end) {
  const { stdout } = await exec(
    'curl.exe',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--retry',
      '2',
      '--max-time',
      '120',
      '--range',
      `${start}-${end}`,
      url,
    ],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  const expected = end - start + 1;
  if (stdout.length !== expected)
    throw new Error(`Unexpected range size ${stdout.length}; expected ${expected}`);
  return stdout;
}
const archiveSize = 628810191;
const tail = await range(archiveSize - 65536, archiveSize - 1);
let entry;
for (let i = 0; i < tail.length - 46; i++) {
  if (tail.readUInt32LE(i) !== 0x02014b50) continue;
  const nameLength = tail.readUInt16LE(i + 28);
  const name = tail.subarray(i + 46, i + 46 + nameLength).toString();
  if (name.endsWith('/bin/mongod.exe')) {
    entry = {
      method: tail.readUInt16LE(i + 10),
      crc: tail.readUInt32LE(i + 16),
      compressed: tail.readUInt32LE(i + 20),
      size: tail.readUInt32LE(i + 24),
      offset: tail.readUInt32LE(i + 42),
      name,
    };
    break;
  }
}
if (!entry || entry.offset === 0xffffffff || entry.method !== 8)
  throw new Error('Unsupported MongoDB ZIP layout; use the standard test downloader.');
console.log(`Fetching ${entry.name}: ${(entry.compressed / 1048576).toFixed(1)} MB compressed.`);
const header = await range(entry.offset, entry.offset + 29);
if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid ZIP local header.');
const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
const chunkSize = 4 * 1024 * 1024;
const chunks = [];
for (let position = 0; position < entry.compressed; position += chunkSize)
  chunks.push({
    start: start + position,
    end: start + Math.min(entry.compressed, position + chunkSize) - 1,
  });
const results = new Array(chunks.length);
let next = 0;
let completed = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < chunks.length) {
      const index = next++;
      const chunk = chunks[index];
      results[index] = await range(chunk.start, chunk.end);
      completed++;
      console.log(`Downloaded segment ${completed}/${chunks.length}`);
    }
  }),
);
const binary = inflateRawSync(Buffer.concat(results));
if (binary.length !== entry.size) throw new Error('Uncompressed size mismatch.');
const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
let crc = 0xffffffff;
for (const byte of binary) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
if ((crc ^ 0xffffffff) >>> 0 !== entry.crc) throw new Error('ZIP CRC32 checksum mismatch.');
if (binary.toString('ascii', 0, 2) !== 'MZ') throw new Error('Expected a Windows executable.');
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, binary);
console.log('Verified test binary saved:', destination);
