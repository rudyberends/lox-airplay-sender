import { EventEmitter } from 'node:events';
import config from '../utils/config';
import { low32 } from '../utils/numUtil';
import type { Packet } from '../utils/packetPool';
import type CircularBuffer from '../utils/circularBuffer';

const SEQ_NUM_WRAP = Math.pow(2, 16);

type DevicesEmitter = EventEmitter & {
  on(event: 'airtunes_devices', listener: (hasAirTunes: boolean) => void): DevicesEmitter;
  on(event: 'need_sync', listener: () => void): DevicesEmitter;
};

/**
 * Generates RTP timestamps and sequence, pulling PCM/ALAC packets from a circular buffer.
 * Emits `packet` events for devices and sync requests (`need_sync`) at intervals.
 */
export default class AudioOut extends EventEmitter {
  private lastSeq = -1;
  private hasAirTunes = false;
  private rtpTimeRef = Date.now();
  private startTimeMs?: number;
  private latencyFrames = 0;
  private latencyApplied = false;

  /**
   * Begin pulling from the buffer and emitting packets at the configured cadence.
   * @param devices Device manager for sync events.
   * @param circularBuffer PCM/ALAC buffer.
   * @param startTimeMs Optional unix ms to align playback.
   */
  public init(
    devices: DevicesEmitter,
    circularBuffer: CircularBuffer,
    startTimeMs?: number,
  ): void {
    this.startTimeMs =
      typeof startTimeMs === 'number' && Number.isFinite(startTimeMs)
        ? startTimeMs
        : undefined;
    this.rtpTimeRef = this.startTimeMs ?? Date.now();

    devices.on('airtunes_devices', (hasAirTunes) => {
      this.hasAirTunes = hasAirTunes;
    });

    devices.on('need_sync', () => {
      this.emit('need_sync', this.lastSeq);
    });

    const sendPacket = (seq: number) => {
      const packet: Packet & { timestamp?: number } = circularBuffer.readPacket();
      packet.seq = seq % SEQ_NUM_WRAP;
      packet.timestamp = low32(seq * config.frames_per_packet + 2 * config.sampling_rate);

      if (this.hasAirTunes && seq % config.sync_period === 0) {
        this.emit('need_sync', seq);
      }

      this.emit('packet', packet);
      packet.release();
    };

    const syncAudio = () => {
      const elapsed = Date.now() - this.rtpTimeRef;
      if (elapsed < 0) {
        setTimeout(syncAudio, Math.min(config.stream_latency, Math.abs(elapsed)));
        return;
      }
      const currentSeq = Math.floor(
        (elapsed * config.sampling_rate) / (config.frames_per_packet * 1000),
      );

      for (let i = this.lastSeq + 1; i <= currentSeq; i += 1) {
        sendPacket(i);
      }

      this.lastSeq = currentSeq;
      setTimeout(syncAudio, config.stream_latency);
    };

    syncAudio();
  }

  /**
   * Apply latency (in audio frames) when aligning start time.
   */
  public setLatencyFrames(latencyFrames: number): void {
    if (!Number.isFinite(latencyFrames) || latencyFrames <= 0) {
      return;
    }
    this.latencyFrames = latencyFrames;
    if (this.startTimeMs === undefined || this.latencyApplied) {
      return;
    }
    const latencyMs = (this.latencyFrames / config.sampling_rate) * 1000;
    this.rtpTimeRef = this.startTimeMs - latencyMs;
    this.latencyApplied = true;
  }
}
