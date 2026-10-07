// Canonical JSON of createWorld() for the C# port's byte-for-byte parity test.
// Keys are sorted (UTF-16 order), undefined members dropped, numbers in JS form.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createWorld } from '../../src/world';

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) { const v = (value as Record<string, unknown>)[key]; if (v !== undefined) out[key] = canonical(v); }
    return out;
  }
  return value;
}
const layout = (process.argv[3] ?? 'current-v6') as Parameters<typeof createWorld>[1];
const json = JSON.stringify(canonical(createWorld(20261001, layout)));
writeFileSync(process.argv[2], gzipSync(json, { level: 9 }));
console.log(`${layout}: ${json.length} bytes`);
