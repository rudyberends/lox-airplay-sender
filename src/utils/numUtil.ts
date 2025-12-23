import crypto from 'node:crypto';

export const randomHex = (n: number): string => crypto.randomBytes(n).toString('hex');

export const randomBase64 = (n: number): string =>
  crypto.randomBytes(n).toString('base64').replace('=', '');

export const randomInt = (n: number): number =>
  Math.floor(Math.random() * Math.pow(10, n));

export const low16 = (i: number): number => Math.abs(i) % 65536;

export const low32 = (i: number): number => Math.abs(i) % 4294967296;
