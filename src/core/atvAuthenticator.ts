import crypto from 'crypto';
import * as ed from '@noble/ed25519';
import { hexString2ArrayBuffer, buf2hex } from '../utils/util';

if (!ed.utils.sha512Sync)
{
    ed.utils.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
        const hash = crypto.createHash('sha512');
        for (const message of messages)
        {
            hash.update(message);
        }
        return new Uint8Array(hash.digest());
    };
}

// ...
// Note: All functions expect parameters to be hex strings.

function pair_setup_aes_key(K: string): string
{
    return crypto.createHash('sha512')
        .update('Pair-Setup-AES-Key')
        .update(hexString2ArrayBuffer(K))
        .digest('hex')
        .substring(0, 32);
}

function pair_setup_aes_iv(K: string): string
{
    let ab = crypto.createHash('sha512')
        .update('Pair-Setup-AES-IV')
        .update(hexString2ArrayBuffer(K))
        .digest()
        
    ab = ab.slice(0, 16);
    ab[ab.length - 1] += 0x01;

    return buf2hex(ab);
}

function pair_verify_aes_key(shared: string): string
{
    return buf2hex(
        crypto.createHash('sha512')
            .update('Pair-Verify-AES-Key')
            .update(hexString2ArrayBuffer(shared))
            .digest()
            .slice(0, 16)
    );
}

function pair_verify_aes_iv(shared: string): string
{
    return buf2hex(
        crypto.createHash('sha512')
            .update('Pair-Verify-AES-IV')
            .update(hexString2ArrayBuffer(shared))
            .digest()
            .slice(0, 16)
    );
}

// ...
// Public.

function a_pub(a: string): string
{
    const publicKey = ed.sync.getPublicKey(hexString2ArrayBuffer(a));
    return buf2hex(publicKey);
}

function confirm(a: string, K: string): { epk: string; authTag: string }
{
    const key   = pair_setup_aes_key(K);
    const iv    = pair_setup_aes_iv(K); 

    const cipher = crypto.createCipheriv(
        'aes-128-gcm', 
        hexString2ArrayBuffer(key), 
        hexString2ArrayBuffer(iv)
    );

    const encrypted = Buffer.concat([
        cipher.update(hexString2ArrayBuffer(a_pub(a)) as any),
        cipher.final(),
    ]);

    return {
        epk: encrypted.toString('hex'),
        authTag: buf2hex(cipher.getAuthTag()),
    };
}

function verifier(a: string): { verifierBody: Buffer; v_pri: string; v_pub: string }
{
    const privateKey = Buffer.from(ed.utils.randomPrivateKey());
    const publicKey = Buffer.from(ed.curve25519.scalarMultBase(privateKey));
    const v_pri     = buf2hex(privateKey);
    const v_pub     = buf2hex(publicKey);
    
    const header    = Buffer.from([0x01, 0x00, 0x00, 0x00]);
    const a_pub_buf = Buffer.from(a_pub(a), 'hex');

    return {
        verifierBody: Buffer.concat(
            [header, publicKey, a_pub_buf],
            header.byteLength + publicKey.byteLength + a_pub_buf.byteLength
        ),
        v_pri,
        v_pub
    };
}

function shared(v_pri: string, atv_pub: string): string
{
    return buf2hex(
        Buffer.from(
            ed.curve25519.scalarMult(
                hexString2ArrayBuffer(v_pri),
                hexString2ArrayBuffer(atv_pub)
            )
        )
    );
}

function signed(a: string, v_pub: string, atv_pub: string): string
{
    const message = hexString2ArrayBuffer(v_pub + atv_pub);
    const signature = ed.sync.sign(message, hexString2ArrayBuffer(a));
    return buf2hex(signature);
}

function signature(shared: string, atv_data: string, signed: string): string
{
    const cipher = crypto.createCipheriv(
        'aes-128-ctr', 
        hexString2ArrayBuffer(pair_verify_aes_key(shared)), 
        hexString2ArrayBuffer(pair_verify_aes_iv(shared))
    );

    // discard the result of encrypting atv_data.
    cipher.update(hexString2ArrayBuffer(atv_data));
    
    const encrypted = Buffer.concat([
        cipher.update(Buffer.from(signed, 'hex') as any),
        cipher.final(),
    ]);

    return encrypted.toString('hex');
}

export default {
  pair_setup_aes_key,
  pair_setup_aes_iv,
  pair_verify_aes_key,
  pair_verify_aes_iv,
  a_pub,
  confirm,
  verifier,
  shared,
  signed,
  signature,
};
