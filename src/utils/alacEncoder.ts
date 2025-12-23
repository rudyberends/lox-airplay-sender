import { Transform, type TransformCallback } from 'node:stream';
import { encodePcmToAlac, PCM_PACKET_SIZE } from './alac';

/**
 * Transforms PCM (16-bit LE, stereo, 44.1kHz) into fixed-size ALAC frames.
 * Emits ALAC packets sized per `ALAC_PACKET_SIZE`.
 */
export class AlacEncoderStream extends Transform {
  private buffer = Buffer.alloc(0) as Buffer;

  /** Create a streaming ALAC encoder for PCM input. */
  constructor() {
    super();
  }

  /**
   * Buffer PCM until a full frame is available, then emit ALAC.
   */
  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (!chunk?.length) {
      callback();
      return;
    }
    this.buffer = (this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk) as Buffer;
    while (this.buffer.length >= PCM_PACKET_SIZE) {
      const frame = this.buffer.subarray(0, PCM_PACKET_SIZE);
      this.buffer = this.buffer.subarray(PCM_PACKET_SIZE);
      const alac = encodePcmToAlac(frame);
      this.push(alac);
    }
    callback();
  }
}
