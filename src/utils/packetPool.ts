/**
 * Reusable packet structure holding PCM/ALAC data plus sequence.
 * Reference-counted to reduce allocations in the streaming path.
 */
export class Packet {
  private ref = 1;
  public seq: number | null = null;
  public readonly pcm: Buffer;

  constructor(private readonly pool: PacketPool, packetSize: number) {
    this.pcm = Buffer.alloc(packetSize);
  }

  /** Increment ref count when sharing the packet. */
  public retain(): void {
    this.ref += 1;
  }

  /** Decrement ref count and return to pool when free. */
  public release(): void {
    this.ref -= 1;
    if (this.ref === 0) {
      this.seq = null;
      this.pool.release(this);
    }
  }
}

/** Simple pool of Packet instances to avoid GC pressure during streaming. */
export default class PacketPool {
  private readonly pool: Packet[] = [];

  constructor(private readonly packetSize: number) {}

  /** Borrow a packet from the pool or allocate a new one. */
  public getPacket(): Packet {
    const packet = this.pool.shift();
    if (!packet) {
      return new Packet(this, this.packetSize);
    }
    packet.retain();
    return packet;
  }

  /** Return a packet to the pool. */
  public release(packet: Packet): void {
    this.pool.push(packet);
  }
}
