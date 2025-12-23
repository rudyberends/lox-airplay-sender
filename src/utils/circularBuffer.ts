import { EventEmitter } from 'node:events';
import PacketPool, { Packet } from './packetPool';

const WAITING = 0;
const FILLING = 1;
const NORMAL = 2;
const DRAINING = 3;
const ENDING = 4;
const ENDED = 5;

export type BufferStatus = 'buffering' | 'playing' | 'drain' | 'end';

/**
 * Fixed-size circular buffer that smooths incoming PCM/ALAC chunks into fixed packet sizes.
 * Emits status changes for buffering/playing/drain/end to drive UI + sync.
 */
export default class CircularBuffer extends EventEmitter {
  private readonly packetPool: PacketPool;
  private readonly maxSize: number;
  private readonly packetSize: number;
  public writable = true;
  public muted = false;
  private buffers: Buffer[] = [];
  private currentSize = 0;
  private status = WAITING;

  constructor(packetsInBuffer: number, packetSize: number) {
    super();
    this.packetPool = new PacketPool(packetSize);
    this.maxSize = packetsInBuffer * packetSize;
    this.packetSize = packetSize;
  }

  /**
   * Write a PCM/ALAC chunk into the buffer.
   * Returns false when the buffer is full so upstream can throttle.
   */
  public write(chunk: Buffer): boolean {
    this.buffers.push(chunk);
    this.currentSize += chunk.length;

    if (this.status === ENDING || this.status === ENDED) {
      throw new Error('Cannot write in buffer after closing it');
    }

    if (this.status === WAITING) {
      this.emit('status', 'buffering' satisfies BufferStatus);
      this.status = FILLING;
    }

    if (this.status === FILLING && this.currentSize > this.maxSize / 2) {
      this.status = NORMAL;
      this.emit('status', 'playing' satisfies BufferStatus);
    }

    if (this.currentSize >= this.maxSize) {
      this.status = DRAINING;
      return false;
    }
    return true;
  }

  /**
   * Read the next fixed-size packet, zero-filling gaps to preserve timing.
   */
  public readPacket(): Packet {
    const packet = this.packetPool.getPacket();

    if (
      this.status !== ENDING &&
      this.status !== ENDED &&
      (this.status === FILLING || this.currentSize < this.packetSize)
    ) {
      packet.pcm.fill(0);

      if (this.status !== FILLING && this.status !== WAITING) {
        this.status = FILLING;
        this.emit('status', 'buffering' satisfies BufferStatus);
      }
    } else {
      let offset = 0;
      let remaining = this.packetSize;

      while (remaining > 0) {
        if (this.buffers.length === 0) {
          packet.pcm.fill(0, offset);
          remaining = 0;
          break;
        }

        const first = this.buffers[0];

        if (first.length <= remaining) {
          first.copy(packet.pcm, offset);
          offset += first.length;
          remaining -= first.length;
          this.buffers.shift();
        } else {
          first.copy(packet.pcm, offset, 0, remaining);
          this.buffers[0] = first.slice(remaining);
          offset += remaining;
          remaining = 0;
        }
      }

      this.currentSize -= this.packetSize;

      if (this.status === ENDING && this.currentSize <= 0) {
        this.status = ENDED;
        this.currentSize = 0;
        this.emit('status', 'end' satisfies BufferStatus);
      }

      if (this.status === DRAINING && this.currentSize < this.maxSize / 2) {
        this.status = NORMAL;
        this.emit('drain');
      }
    }

    if (this.muted) {
      packet.pcm.fill(0);
    }

    return packet;
  }

  /** Mark the buffer as ending; drains then emits `end`. */
  public end(): void {
    if (this.status === FILLING) {
      this.emit('status', 'playing' satisfies BufferStatus);
    }
    this.status = ENDING;
  }

  /** Clear internal buffers and state. */
  public reset(): void {
    this.buffers = [];
    this.currentSize = 0;
    this.status = WAITING;
  }
}
