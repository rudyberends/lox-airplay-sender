import encryption from './encryption';
const struct: any = require('python-struct');

/**
 * Holds and serializes HomeKit credential blobs used during AirPlay 2 auth.
 */

class Credentials {
    uniqueIdentifier: string;
    identifier: Buffer;
    pairingId: string;
    publicKey: Buffer;
    encryptionKey: Buffer;
    encryptCount: number;
    decryptCount: number;
    writeKey: Buffer;
    readKey: Buffer;

    constructor(uniqueIdentifier: string, identifier: Buffer, pairingId: string, publicKey: Buffer, encryptionKey: Buffer) {
        this.uniqueIdentifier = uniqueIdentifier;
        this.identifier = identifier;
        this.pairingId = pairingId;
        this.publicKey = publicKey;
        this.encryptionKey = encryptionKey;
        this.encryptCount = 0;
        this.decryptCount = 0;
        this.writeKey = encryptionKey;
        this.readKey = encryptionKey;
    }
    /**
    * Parse a credentials string into a Credentials object.
    * @param text  The credentials string.
    * @returns A credentials object.
    */
    static parse(text: string): Credentials {
        const parts = text.split(':');
        return new Credentials(
            parts[0],
            Buffer.from(parts[1], 'hex'),
            Buffer.from(parts[2], 'hex').toString(),
            Buffer.from(parts[3], 'hex'),
            Buffer.from(parts[4], 'hex')
        );
    }
    /**
    * Returns a string representation of a Credentials object.
    * @returns A string representation of a Credentials object.
    */
    toString(): string {
        return this.uniqueIdentifier
            + ":"
            + this.identifier.toString('hex')
            + ":"
            + Buffer.from(this.pairingId).toString('hex')
            + ":"
            + this.publicKey.toString('hex')
            + ":"
            + this.encryptionKey.toString('hex');
    }
    encrypt(message: Buffer): Buffer {
        let offset = 0;
        const total = message.byteLength;
        let result = Buffer.concat([]);
        while (offset < total) {
            const length = Math.min(total - offset, 1024);
            const s1lengthBytes = struct.pack("H", length);
            // let cipher = crypto.createCipheriv('chacha20-poly1305', this.writeKey, Buffer.concat([Buffer.from([0x00,0x00,0x00,0x00]),struct.pack("Q", this.decryptCount)]), { authTagLength: 16 });
            // cipher.setAAD(s1length_bytes);
            // let s1ct = cipher.update(message);
            // cipher.final();
            // let s1tag = encryption_1.default.computePoly1305(s1ct,s1length_bytes,Buffer.concat([Buffer.from([0x00,0x00,0x00,0x00]),struct.pack("Q", this.decryptCount)]),this.writeKey)
            const [s1ct, s1tag] = encryption.encryptAndSeal(
                message.slice(offset, offset + length),
                s1lengthBytes,
                Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00]), struct.pack("Q", this.encryptCount)]),
                this.writeKey
            );
            
            const ciphertext = Buffer.concat([s1lengthBytes, s1ct, s1tag]);
            offset += length;
            this.encryptCount += 1;
            result = Buffer.concat([result, ciphertext]);
        }
        return result;
    }
    decrypt(message: Buffer): Buffer {
        let offset = 0;
        let result = Buffer.concat([]);
        while (offset < message.byteLength) {
            const lengthBytes = message.slice(offset, offset + 2);
            const length = struct.unpack("H", lengthBytes);
            const messagea = message.slice(offset + 2, offset + 2 + length[0] + 16);
            const cipherText = messagea.slice(0, -16);
            const hmac = messagea.slice(-16);
            const decrypted = encryption.verifyAndDecrypt(
                cipherText,
                hmac,
                lengthBytes,
                Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x00]), struct.pack("Q", this.decryptCount)]),
                this.readKey
            );
            this.decryptCount += 1;
            offset = offset + length[0] + 16 + 2;
            result = Buffer.concat([result, decrypted ?? Buffer.alloc(0)]);
        }
        return result;
    }
    encryptAudio(message: Buffer, aad: Buffer | null, nonce: number): Buffer {
        return Buffer.concat([
            Buffer.concat(encryption.encryptAndSeal(message, aad, struct.pack("Q", nonce), this.writeKey)),
            Buffer.from(struct.pack("Q", nonce)),
        ]);
    }
}

export { Credentials };
