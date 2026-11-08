// test-opus.js
import { createEncoder } from 'libopus-wasm';

const enc = await createEncoder({ sampleRate: 16000, channels: 1 });
console.log('frameSize:', enc.frameSize); // 320 là 20ms, 960 là 60ms