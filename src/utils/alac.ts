import config from './config';

/** PCM packet size (bytes) expected by the encoder. */
export const PCM_PACKET_SIZE = config.pcm_packet_size;
/** Output ALAC packet size (bytes). */
export const ALAC_PACKET_SIZE = config.alac_packet_size;

/**
 * Encode one PCM frame (16-bit LE stereo, 44.1kHz) into ALAC.
 * Input must be exactly `PCM_PACKET_SIZE` bytes.
 */
export function encodePcmToAlac(pcmData: Buffer): Buffer {
  let alacData = Buffer.alloc(ALAC_PACKET_SIZE);
  const bsize = 352;
  const frames = 352;
  const p = new Uint8Array(ALAC_PACKET_SIZE);
  const input = new Uint32Array(pcmData.length / 4);
  let j = 0;
  for (let i = 0; i < pcmData.length; i += 4) {
    let res = pcmData[i];
    res |= pcmData[i + 1] << 8;
    res |= pcmData[i + 2] << 16;
    res |= pcmData[i + 3] << 24;
    input[j++] = res;
  }

  let pindex = 0;
  let iindex = 0;

  p[pindex++] = 1 << 5;
  p[pindex++] = 0;
  p[pindex++] = (1 << 4) | (1 << 1) | ((bsize & 0x80000000) >>> 31);
  p[pindex++] = ((bsize & 0x7f800000) << 1) >>> 24;
  p[pindex++] = ((bsize & 0x007f8000) << 1) >>> 16;
  p[pindex++] = ((bsize & 0x00007f80) << 1) >>> 8;
  p[pindex] = (bsize & 0x0000007f) << 1;
  p[pindex++] |= (input[iindex] & 0x00008000) >>> 15;

  let count = frames - 1;
  while (count--) {
    const i = input[iindex++];
    p[pindex++] = (i & 0x00007f80) >>> 7;
    p[pindex++] = ((i & 0x0000007f) << 1) | ((i & 0x80000000) >>> 31);
    p[pindex++] = (i & 0x7f800000) >>> 23;
    p[pindex++] = ((i & 0x007f0000) >>> 15) | ((input[iindex] & 0x00008000) >> 15);
  }

  const i = input[iindex];
  p[pindex++] = (i & 0x00007f80) >>> 7;
  p[pindex++] = ((i & 0x0000007f) << 1) | ((i & 0x80000000) >>> 31);
  p[pindex++] = (i & 0x7f800000) >>> 23;
  p[pindex++] = (i & 0x007f0000) >>> 15;

  count = (bsize - frames) * 4;
  while (count--) p[pindex++] = 0;

  p[pindex - 1] |= 1;
  p[pindex++] = (7 >>> 1) << 6;

  const alacSize = pindex;
  alacData = Buffer.from(p.buffer);
  return alacData.slice(0, alacSize);
}
