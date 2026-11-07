// Action cue tones and the cue for every command type, ok and failed, for the C# Core/ActionCues.cs parity test.
import { readFileSync, writeFileSync } from 'node:fs';
import { CUE_TONES, cueFor } from '../../src/audio/cues';
import type { Command } from '../../src/types';
const union = /export interface Command \{ type: ([^;]+);/.exec(readFileSync('src/types.ts', 'utf8'))![1];
const types = [...union.matchAll(/'([A-Za-z]+)'/g)].map(m => m[1] as Command['type']);
const rows = types.flatMap(type => [true, false].map(ok => ({ type, ok, cue: cueFor(type, ok) })));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/action-cues.json', JSON.stringify({ tones: CUE_TONES, rows }));
console.log(`${types.length} command types, ${rows.length} rows`);
