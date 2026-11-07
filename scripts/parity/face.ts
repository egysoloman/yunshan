// SHA-256 of the citizen face texture bytes, for the C# parity test.
import { createHash } from 'node:crypto';
import { createCitizenFaceTexture } from '../../src/rendering/citizen-appearance';
const t = createCitizenFaceTexture(); const data = t.image.data as Uint8Array;
console.log(t.image.width, t.image.height, createHash('sha256').update(data).digest('hex'));
