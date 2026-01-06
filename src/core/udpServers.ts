import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import async from 'async';
import config from '../utils/config';
import { low32 } from '../utils/numUtil';
import ntp from '../utils/ntp';

const UNBOUND = 0;
const BINDING = 1;
const BOUND = 2;

type SocketInfo = {
  socket: dgram.Socket | null;
  port: number | null;
  name: string;
};

type ControlSyncTarget = {
  host: string;
  controlPort: number;
};

type SenderReportCounters = {
  rtpTimestamp: number;
  ntp: Buffer;
  packetCount: number;
  octetCount: number;
};

type ReceiverReport = {
  ssrc?: number;
};

type ExtendedReport = {
  ntp?: Buffer;
  ssrc?: number;
  lastRr?: number;
  delaySinceLastRr?: number;
};

/**
 * Manages control/timing UDP sockets used by RAOP for resend requests and clock sync.
 * Binds ports for both endpoints and emits events with socket info.
 */
export default class UDPServers extends EventEmitter {
  private status = UNBOUND;
  private readonly control: SocketInfo = { socket: null, port: null, name: 'control' };
  private readonly timing: SocketInfo = { socket: null, port: null, name: 'timing' };
  private readonly hosts: string[] = [];

  /**
   * Bind control + timing sockets for a host and emit `ports` when ready.
   */
  public bind(host: string): void {
    this.hosts.push(host);

    if (this.status === BOUND) {
      process.nextTick(() => {
        this.emit('ports', null, this.control, this.timing);
      });
      return;
    }

    if (this.status === BINDING) {
      return;
    }

    this.status = BINDING;

    this.timing.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.timing.socket.on('message', (msg, rinfo) => {
      if (!this.hosts.includes(rinfo.address)) return;

      const ts1 = msg.readUInt32BE(24);
      const ts2 = msg.readUInt32BE(28);
      const reply = Buffer.alloc(32);
      reply.writeUInt16BE(0x80d3, 0);
      reply.writeUInt16BE(0x0007, 2);
      reply.writeUInt32BE(0x00000000, 4);
      reply.writeUInt32BE(ts1, 8);
      reply.writeUInt32BE(ts2, 12);

      const ntpTime = ntp.timestamp();
      ntpTime.copy(reply, 16);
      ntpTime.copy(reply, 24);

      this.timing.socket?.send(reply, 0, reply.length, rinfo.port, rinfo.address);
    });

    this.control.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.control.socket.on('message', (msg, rinfo) => {
      if (!this.hosts.includes(rinfo.address)) return;
      const resendRequested = msg.readUInt8(1) === (0x80 | 0x55);
      if (resendRequested) {
        const missedSeq = msg.readUInt16BE(4);
        const count = msg.readUInt16BE(6);
        this.emit('resendRequested', missedSeq, count);
      }
    });

    if (process.platform !== 'darwin') {
      this.control.socket.on('error', (err) => {
        this.emit('ports', err);
      });
      this.timing.socket.on('error', (err) => {
        this.emit('ports', err);
      });
      this.control.socket.bind(0, () => {
        this.control.port = this.control.socket?.address().port ?? null;
      });
      this.timing.socket.bind(0, () => {
        this.timing.port = this.timing.socket?.address().port ?? null;
      });
      const interval = setInterval(() => {
        if (this.timing.port != null && this.control.port != null) {
          clearInterval(interval);
          this.status = BOUND;
          this.emit('ports', null, this.control, this.timing);
        }
      }, 100);
      return;
    }

    const toBind = [this.control, this.timing];
    let currentPort = config.udp_default_port;

    (async as any).whilst(
      (cb: (err: Error | null, test?: boolean) => void) => cb(null, toBind.length > 0),
      (cb: (err?: Error | null) => void) => {
        const nextPort = toBind[0];
        nextPort.socket?.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            currentPort += 1;
            cb();
          } else {
            cb(err);
          }
        });

        nextPort.socket?.once('listening', () => {
          toBind.shift();
          nextPort.port = currentPort;
          currentPort += 1;
          cb();
        });

        nextPort.socket?.bind(currentPort);
      },
      (err: Error | null) => {
        if (err) {
          this.close();
          this.emit('ports', err);
        } else {
          this.status = BOUND;
          this.emit('ports', null, this.control, this.timing);
        }
      },
    );
  }

  /** Close sockets and reset state. */
  public close(): void {
    try {
      this.status = UNBOUND;
      this.timing.socket?.close();
      this.timing.socket = null;
      this.control.socket?.close();
      this.control.socket = null;
    } catch {
      // ignore
    }
  }

  /**
   * Send an RTCP sync packet to a receiver to align playback.
   */
  public sendControlSync(
    seq: number,
    dev: ControlSyncTarget,
    tsOffsetFrames = 0,
    sr?: SenderReportCounters,
    rr?: ReceiverReport,
    xr?: ExtendedReport,
  ): void {
    if (this.status !== BOUND || !this.control.socket) return;

    const packet = Buffer.alloc(20);
    packet.writeUInt16BE(0x80d4, 0);
    packet.writeUInt16BE(0x0007, 2);
    packet.writeUInt32BE(low32((seq + tsOffsetFrames) * config.frames_per_packet), 4);

    const ntpTime = ntp.timestamp();
    ntpTime.copy(packet, 8);

    packet.writeUInt32BE(low32((seq + tsOffsetFrames) * config.frames_per_packet + config.sampling_rate * 2), 16);
    const delay = Math.max(
      0,
      config.control_sync_base_delay_ms +
        Math.random() * config.control_sync_jitter_ms,
    );

    setTimeout(() => {
      if (config.debug_dump) {
        // eslint-disable-next-line no-console
        console.debug('rtcp_sync', { seq, tsOffsetFrames, host: dev.host, port: dev.controlPort });
      }
      this.control.socket?.send(packet, 0, packet.length, dev.controlPort, dev.host);
      if (sr && config.send_rtcp_sr) {
        const srPacket = this.buildSenderReport(sr);
        if (config.debug_dump) {
          // eslint-disable-next-line no-console
          console.debug('rtcp_sr', { ssrc: config.device_magic, rtp: sr.rtpTimestamp, packets: sr.packetCount });
        }
        this.control.socket?.send(srPacket, 0, srPacket.length, dev.controlPort, dev.host);
      }
      if (config.send_rtcp_rr) {
        const rrPacket = this.buildReceiverReport(rr);
        if (config.debug_dump) {
          // eslint-disable-next-line no-console
          console.debug('rtcp_rr', { ssrc: config.device_magic });
        }
        this.control.socket?.send(rrPacket, 0, rrPacket.length, dev.controlPort, dev.host);
      }
      if (xr && config.send_rtcp_xr) {
        const xrPacket = this.buildExtendedReport(xr);
        if (config.debug_dump) {
          // eslint-disable-next-line no-console
          console.debug('rtcp_xr', { ssrc: config.device_magic });
        }
        this.control.socket?.send(xrPacket, 0, xrPacket.length, dev.controlPort, dev.host);
      }
    }, delay);
  }

  private buildSenderReport(counters: SenderReportCounters): Buffer {
    const sr = Buffer.alloc(28);
    // V=2, P=0, RC=0
    sr.writeUInt8(0x80, 0);
    // PT=200 (SR)
    sr.writeUInt8(200, 1);
    // length in 32-bit words minus 1 -> 6 words (28 bytes) => 6
    sr.writeUInt16BE(6, 2);
    // SSRC
    sr.writeUInt32BE(config.device_magic, 4);
    // NTP timestamp
    counters.ntp.copy(sr, 8, 0, 8);
    // RTP timestamp
    sr.writeUInt32BE(low32(counters.rtpTimestamp), 16);
    // packet count
    sr.writeUInt32BE(low32(counters.packetCount), 20);
    // octet count
    sr.writeUInt32BE(low32(counters.octetCount), 24);
    return sr;
  }

  private buildReceiverReport(rr?: ReceiverReport): Buffer {
    const packet = Buffer.alloc(8);
    // V=2, P=0, RC=0
    packet.writeUInt8(0x80, 0);
    // PT=201 (RR)
    packet.writeUInt8(201, 1);
    // length = 1 (8 bytes / 4 - 1)
    packet.writeUInt16BE(1, 2);
    // SSRC
    packet.writeUInt32BE(rr?.ssrc ?? config.device_magic, 4);
    return packet;
  }

  private buildExtendedReport(xr?: ExtendedReport): Buffer {
    // XR with RRT (Receiver Reference Time) and optional DLRR.
    const rrtBlock = Buffer.alloc(12);
    // BT=4 (RRT), reserved+block length=2 (8 octets following header)
    rrtBlock.writeUInt8(4, 0);
    rrtBlock.writeUInt8(0, 1);
    rrtBlock.writeUInt16BE(2, 2);
    (xr?.ntp ?? ntp.timestamp()).copy(rrtBlock, 4, 0, 8);

    let dlrrBlock: Buffer | null = null;
    if (typeof xr?.lastRr === 'number' || typeof xr?.delaySinceLastRr === 'number') {
      dlrrBlock = Buffer.alloc(12);
      // BT=5 (DLRR)
      dlrrBlock.writeUInt8(5, 0);
      dlrrBlock.writeUInt8(0, 1);
      dlrrBlock.writeUInt16BE(3, 2); // block length (3 words = 12 bytes following header)
      dlrrBlock.writeUInt32BE(xr?.lastRr ?? 0, 4);
      dlrrBlock.writeUInt32BE(xr?.delaySinceLastRr ?? 0, 8);
    }

    const blocks = dlrrBlock ? Buffer.concat([rrtBlock, dlrrBlock]) : rrtBlock;
    const packet = Buffer.alloc(8 + blocks.length);
    // V=2, P=0, RC=0
    packet.writeUInt8(0x80, 0);
    // PT=207 (XR)
    packet.writeUInt8(207, 1);
    // length in 32-bit words minus 1
    packet.writeUInt16BE(packet.length / 4 - 1, 2);
    // SSRC
    packet.writeUInt32BE(xr?.ssrc ?? config.device_magic, 4);
    blocks.copy(packet, 8);
    return packet;
  }
}
