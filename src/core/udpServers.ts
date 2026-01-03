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
  public sendControlSync(seq: number, dev: ControlSyncTarget): void {
    if (this.status !== BOUND || !this.control.socket) return;

    const packet = Buffer.alloc(20);
    packet.writeUInt16BE(0x80d4, 0);
    packet.writeUInt16BE(0x0007, 2);
    packet.writeUInt32BE(low32(seq * config.frames_per_packet), 4);

    const ntpTime = ntp.timestamp();
    ntpTime.copy(packet, 8);

    packet.writeUInt32BE(low32(seq * config.frames_per_packet + config.sampling_rate * 2), 16);
    const delay = Math.max(
      0,
      config.control_sync_base_delay_ms +
        Math.random() * config.control_sync_jitter_ms,
    );

    setTimeout(() => {
      this.control.socket?.send(packet, 0, packet.length, dev.controlPort, dev.host);
    }, delay);
  }
}
