/**
 * Type Length Value encoding/decoding, used by HAP as a wire format.
 * https://en.wikipedia.org/wiki/Type-length-value
 */
const Tag = {
  PairingMethod: 0x00,
  Username: 0x01,
  Salt: 0x02,
  // could be either the SRP client public key (384 bytes) or the ED25519 public key (32 bytes), depending on context
  PublicKey: 0x03,
  Proof: 0x04,
  EncryptedData: 0x05,
  Sequence: 0x06,
  ErrorCode: 0x07,
  BackOff: 0x08,
  Signature: 0x0a,
  MFiCertificate: 0x09,
  MFiSignature: 0x0a,
  Flags: 0x13,
} as const;

type TLVValue = Buffer | string | number;
type TLVMap = Record<number, Buffer>;
type TLVArgs = Array<number | TLVValue>;

function encodeOne(type: number, data: TLVValue): Buffer {
  let bufferData: Buffer;
  if (typeof data === 'number') {
    bufferData = Buffer.from([data]);
  } else if (typeof data === 'string') {
    bufferData = Buffer.from(data);
  } else {
    bufferData = data;
  }

  if (bufferData.length <= 255) {
    return Buffer.concat([Buffer.from([type, bufferData.length]), bufferData]);
  }

  let leftLength = bufferData.length;
  let tempBuffer = Buffer.alloc(0);
  let currentStart = 0;
  for (; leftLength > 0;) {
    if (leftLength >= 255) {
      tempBuffer = Buffer.concat([
        tempBuffer,
        Buffer.from([type, 0xff]),
        bufferData.slice(currentStart, currentStart + 255),
      ]);
      leftLength -= 255;
      currentStart += 255;
    } else {
      tempBuffer = Buffer.concat([
        tempBuffer,
        Buffer.from([type, leftLength]),
        bufferData.slice(currentStart, currentStart + leftLength),
      ]);
      leftLength = 0;
    }
  }
  return tempBuffer;
}

function encode(type: number, data: TLVValue, ...args: TLVArgs): Buffer {
  const encodedTLVBuffer = encodeOne(type, data);
  if (args.length === 0) {
    return encodedTLVBuffer;
  }

  const nextType = args[0] as number;
  const nextData = args[1] as TLVValue;
  const remaining = args.slice(2);
  const remainingTLVBuffer = encode(nextType, nextData, ...remaining);
  return Buffer.concat([encodedTLVBuffer, remainingTLVBuffer]);
}

function decode(data: Buffer): TLVMap {
  const objects: TLVMap = {};
  let leftLength = data.length;
  let currentIndex = 0;
  for (; leftLength > 0;) {
    const type = data[currentIndex];
    const length = data[currentIndex + 1];
    currentIndex += 2;
    leftLength -= 2;

    const newData = data.slice(currentIndex, currentIndex + length);
    if (objects[type]) {
      objects[type] = Buffer.concat([objects[type], newData]);
    } else {
      objects[type] = newData;
    }

    currentIndex += length;
    leftLength -= length;
  }
  return objects;
}

export default {
  Tag,
  encode,
  decode,
};
