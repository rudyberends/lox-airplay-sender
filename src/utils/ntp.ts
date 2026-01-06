import config from './config';

const NS_PER_SEC = 1_000_000_000n;
const FRAC_PER_SEC = 0x1_0000_0000n; // 2^32

export type NtpTimestampInput = bigint | number | { sec: number; frac: number };

class NTP {
  /** Convert monotonic clock to NTP epoch (1900-01-01) seconds + fractional. */
  public timestamp(): Buffer {
    const nowNs = process.hrtime.bigint();
    const sec = Number(nowNs / NS_PER_SEC) + config.ntp_epoch;
    const frac = Number(((nowNs % NS_PER_SEC) * FRAC_PER_SEC) / NS_PER_SEC);

    const ts = Buffer.alloc(8);
    ts.writeUInt32BE(sec >>> 0, 0);
    ts.writeUInt32BE(frac >>> 0, 4);
    return ts;
  }

  /** Return the current NTP fractional component (for compatibility). */
  public getTime(): number {
    const nowNs = process.hrtime.bigint();
    return Number(((nowNs % NS_PER_SEC) * FRAC_PER_SEC) / NS_PER_SEC);
  }
}

export default new NTP();

/** Pack various NTP timestamp representations into a uint64 bigint (sec<<32|frac). */
export function toNtpTimestamp(input: NtpTimestampInput): bigint {
  if (typeof input === 'bigint') return input;
  if (typeof input === 'number') return BigInt(input);
  const sec = BigInt(input.sec >>> 0);
  const frac = BigInt(input.frac >>> 0);
  return (sec << 32n) | frac;
}

/** Parse an NTP timestamp (uint64 or sec/frac) into components. */
export function parseNtpTimestamp(input: NtpTimestampInput): { sec: number; frac: number } {
  if (typeof input === 'bigint' || typeof input === 'number') {
    const value = typeof input === 'bigint' ? input : BigInt(input);
    const sec = Number(value >> 32n);
    const frac = Number(value & 0xffffffffn);
    return { sec, frac };
  }
  return { sec: input.sec, frac: input.frac };
}

/** Build an NTP timestamp from a Unix epoch (ms). */
export function ntpFromUnixMs(unixMs: number): bigint {
  const sec = Math.floor(unixMs / 1000) + config.ntp_epoch;
  const ms = unixMs % 1000;
  const frac = Math.floor((ms / 1000) * Number(FRAC_PER_SEC));
  return (BigInt(sec >>> 0) << 32n) | BigInt(frac >>> 0);
}
