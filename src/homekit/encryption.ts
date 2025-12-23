import crypto from 'crypto';

/**
 * AirPlay 2/HomeKit encryption helpers (ChaCha20-Poly1305 + HKDF) ported from node_airtunes2.
 */
// i'd really prefer for this to be a direct call to
// Sodium.crypto_aead_chacha20poly1305_decrypt()
// but unfortunately the way it constructs the message to
// calculate the HMAC is not compatible with homekit
// (long story short, it uses [ AAD, AAD.length, CipherText, CipherText.length ]
// whereas homekit expects [ AAD, CipherText, AAD.length, CipherText.length ]
function verifyAndDecrypt(
  cipherText: Buffer,
  mac: Buffer,
  AAD: Buffer | null,
  nonce: Buffer,
  key: Buffer
): Buffer | null {
  try {
    let nonceBuf = nonce;
    if (nonceBuf.byteLength === 8) {
      nonceBuf = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00]), nonceBuf]);
    }
    const decipher = crypto.createDecipheriv('chacha20-poly1305', key, nonceBuf, { authTagLength: 16 }) as crypto.DecipherGCM;
    if (AAD != null) {
      decipher.setAAD(AAD); // must be called before data
    }
    decipher.setAuthTag(mac);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted;
  } catch (error) {
    return null;
  }
}

function encryptAndSeal(
  plainText: Buffer,
  AAD: Buffer | null,
  nonce: Buffer,
  key: Buffer
): [Buffer, Buffer] {
  let nonceBuf = nonce;
  if (nonceBuf.byteLength === 8) {
    nonceBuf = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00]), nonceBuf]);
  }
  const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonceBuf, { authTagLength: 16 }) as crypto.CipherGCM;
  if (AAD != null) {
    cipher.setAAD(AAD); // must be called before data
  }
  const cipherText = Buffer.concat([cipher.update(plainText), cipher.final()]);
  const hmac = cipher.getAuthTag();
  return [cipherText, hmac];
}
// function getPadding(buffer, blockSize) {
//     return buffer.length % blockSize === 0
//         ? Buffer.alloc(0)
//         : Buffer.alloc(blockSize - (buffer.length % blockSize));
// }
function HKDF(hashAlg: string, salt: Buffer, ikm: Buffer, info: Buffer | string, size: number): Buffer {
    // create the hash alg to see if it exists and get its length
    const hash = crypto.createHash(hashAlg);
    const hashLength = hash.digest().length;
    // now we compute the PRK
    const hmac = crypto.createHmac(hashAlg, salt);
    hmac.update(ikm);
    const prk = hmac.digest();
    let prev = Buffer.alloc(0);
    const buffers: Buffer[] = [];
    const numBlocks = Math.ceil(size / hashLength);
    const infoBuf = Buffer.from(info);
    for (let i = 0; i < numBlocks; i++) {
        const roundHmac = crypto.createHmac(hashAlg, prk);
        const input = Buffer.concat([
            prev,
            infoBuf,
            Buffer.from(String.fromCharCode(i + 1)),
        ]);
        roundHmac.update(input);
        prev = roundHmac.digest();
        buffers.push(prev);
    }
    const output = Buffer.concat(buffers, size);
    return output.slice(0, size);
}

export default {
  encryptAndSeal,
  verifyAndDecrypt,
  HKDF,
};
