export const hexString2ArrayBuffer = (hexString: string): Uint8Array =>
  new Uint8Array(hexString.match(/[\da-f]{2}/gi)?.map((h) => parseInt(h, 16)) ?? []);

export const buf2hex = (buffer: ArrayBuffer | Uint8Array): string =>
  Array.prototype.map
    .call(new Uint8Array(buffer as ArrayBuffer), (x: number) => `00${x.toString(16)}`.slice(-2))
    .join('');
