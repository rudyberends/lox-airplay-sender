import assert from 'assert';
/*
 * Originally based on code from github:KhaosT/HAP-NodeJS@0c8fd88 used
 * used per the terms of the Apache Software License v2.
 *
 * Original code copyright Khaos Tian <khaos.tian@gmail.com>
 *
 * Modifications copyright Zach Bean <zb@forty2.com>
 *  * Reformatted for ES6-style module
 *  * renamed *UInt64* to *UInt53* to be more clear about range
 *  * renamed uintHighLow to be more clear about what it does
 *  * Refactored to return a buffer rather write into a passed-in buffer
 */
function splitUInt53(value: number): [number, number] {
  const MAX_UINT32 = 0x00000000ffffffff;
  const MAX_INT53 = 0x001fffffffffffff;
  assert(value > -1 && value <= MAX_INT53, 'number out of range');
  assert(Math.floor(value) === value, 'number must be an integer');
  let high = 0;
  const signbit = value & 0xffffffff;
  const low = signbit < 0 ? (value & 0x7fffffff) + 0x80000000 : signbit;
  if (value > MAX_UINT32) {
    high = (value - low) / (MAX_UINT32 + 1);
  }
  return [high, low];
}

function UInt53toBufferLE(value: number): Buffer {
  const [high, low] = splitUInt53(value);
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(low, 0);
  buf.writeUInt32LE(high, 4);
  return buf;
}

function UInt16toBufferBE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value, 0);
  return buf;
}

export default {
  UInt53toBufferLE,
  UInt16toBufferBE,
};
