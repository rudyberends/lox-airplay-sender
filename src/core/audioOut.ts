import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import config from '../utils/config';
import { low32 } from '../utils/numUtil';
import ntp, { parseNtpTimestamp } from '../utils/ntp';
import type { Packet } from '../utils/packetPool';
import type CircularBuffer from '../utils/circularBuffer';

const SEQ_NUM_WRAP = Math.pow(2, 16);
const FRAC_PER_SEC = 0x1_0000_0000;

type DevicesEmitter = EventEmitter & {
  on(event: 'airtunes_devices', listener: (hasAirTunes: boolean) => void): DevicesEmitter;
  on(event: 'need_sync', listener: () => void): DevicesEmitter;
  emit(event: 'underrun'): boolean;
};

/**
 * Generates RTP timestamps and sequence, pulling PCM/ALAC packets from a circular buffer.
 * Emits `packet` events for devices and sync requests (`need_sync`) at intervals.
 */
export default class AudioOut extends EventEmitter {
  private lastSeq = -1;
  private lastWireSeq = 0;
  private hasAirTunes = false;
  private rtpTimeRef = 0;
  private startTimeMs?: number;
  private startTimeNtp?: bigint | number;
  private latencyFrames = 0;
  private latencyApplied = false;
  private seqOffset = 0;
  private tsOffset = 0;
  private syncOffsetFrames = 0;
  private deviceMagic = 0;
  private packetCount = 0;
  private octetCount = 0;
  private readonly frameDurationMs =
    (config.frames_per_packet / config.sampling_rate) * 1000;
  private muteUntilMs = 0;

  /**
   * Begin pulling from the buffer and emitting packets at the configured cadence.
   * @param devices Device manager for sync events.
   * @param circularBuffer PCM/ALAC buffer.
   * @param startTimeMs Optional unix ms to align playback.
   * @param startTimeNtp Optional NTP uint64 (sec<<32|frac) to align playback.
   */
  public init(
    devices: DevicesEmitter,
    circularBuffer: CircularBuffer,
    startTimeMs?: number,
    startTimeNtp?: bigint | number,
    deviceMagic?: number,
    underrunMuteMs?: number,
  ): void {
    this.startTimeMs =
      typeof startTimeMs === 'number' && Number.isFinite(startTimeMs)
        ? startTimeMs
        : undefined;
    this.startTimeNtp = startTimeNtp;
    this.seqOffset = Math.floor(Math.random() * SEQ_NUM_WRAP);
    this.tsOffset = Math.floor(Math.random() * 0xffffffff);
    this.syncOffsetFrames = this.tsOffset / config.frames_per_packet;
    this.deviceMagic = typeof deviceMagic === 'number' ? deviceMagic : config.device_magic;
    if (typeof underrunMuteMs === 'number') {
      config.underrun_mute_ms = underrunMuteMs;
    }
    circularBuffer.on('underrun', () => this.handleUnderrun());

    const monoNow = performance.now();
    const wallToMonoOffset = Date.now() - monoNow;
    if (typeof this.startTimeNtp === 'bigint' || typeof this.startTimeNtp === 'number') {
      const { sec, frac } = parseNtpTimestamp(this.startTimeNtp);
      const unixMs = (sec - config.ntp_epoch) * 1000 + Math.floor((frac * 1000) / FRAC_PER_SEC);
      const nowMs = config.use_monotonic_clock ? monoNow : Date.now();
      const delta = unixMs - nowMs;
      // If target is too close/past, clamp to now.
      this.rtpTimeRef = delta > -config.stream_latency ? unixMs - wallToMonoOffset : nowMs;
    } else if (this.startTimeMs !== undefined) {
      const nowMs = config.use_monotonic_clock ? monoNow : Date.now();
      const delta = this.startTimeMs - nowMs;
      this.rtpTimeRef = delta > -config.stream_latency ? this.startTimeMs - wallToMonoOffset : nowMs;
    } else if (config.use_monotonic_clock) {
      this.rtpTimeRef = monoNow;
    } else {
      this.rtpTimeRef = Date.now();
    }

    devices.on('airtunes_devices', (hasAirTunes) => {
      this.hasAirTunes = hasAirTunes;
    });

    devices.on('need_sync', () => {
      this.emit('need_sync', { seq: this.lastWireSeq, tsOffsetFrames: this.syncOffsetFrames });
    });

    const syncEvery =
      config.sync_period && config.sync_period > 0
        ? config.sync_period
        : Math.max(1, Math.round(config.sampling_rate / config.frames_per_packet));

    const sendPacket = (seq: number) => {
      const wireSeq = (this.seqOffset + seq) % SEQ_NUM_WRAP;
      const packet: Packet & { timestamp?: number } = circularBuffer.readPacket();
      packet.seq = wireSeq;
      packet.timestamp = low32(this.tsOffset + wireSeq * config.frames_per_packet + 2 * config.sampling_rate);
      this.packetCount += 1;
      this.octetCount += packet.pcm.length;

      if (this.hasAirTunes && seq % syncEvery === 0) {
        this.emit('need_sync', {
          seq: wireSeq,
          tsOffsetFrames: this.syncOffsetFrames,
          rtcp: {
            rtpTimestamp: packet.timestamp,
            ntp: ntp.timestamp(),
            packetCount: this.packetCount,
            octetCount: this.octetCount,
            xr: { ntp: ntp.timestamp() },
          },
        });
        const nowMs = config.use_monotonic_clock ? performance.now() : Date.now();
        const expectedTimeMs =
          this.rtpTimeRef +
          (((seq + this.syncOffsetFrames) * config.frames_per_packet) / config.sampling_rate) * 1000;
        const deltaMs = nowMs - expectedTimeMs;
        this.emit('metrics', { type: 'sync', seq: wireSeq, deltaMs, latencyFrames: this.latencyFrames });
      }

      this.emit('packet', packet);
      if (this.muteUntilMs > 0) {
        const nowMsSend = config.use_monotonic_clock ? performance.now() : Date.now();
        if (nowMsSend < this.muteUntilMs) {
          packet.pcm.fill(0);
        } else {
          this.muteUntilMs = 0;
        }
      }
      packet.release();
      this.lastWireSeq = wireSeq;
    };

    const syncAudio = () => {
      const nowMs = config.use_monotonic_clock ? performance.now() : Date.now();
      const elapsed = nowMs - this.rtpTimeRef;
      if (elapsed < 0) {
        setTimeout(syncAudio, Math.min(config.stream_latency, Math.abs(elapsed)));
        return;
      }
      let currentSeq = Math.floor(
        (elapsed * config.sampling_rate) / (config.frames_per_packet * 1000),
      );

      // If we're lagging behind significantly, jump forward to avoid long hitches.
      if (config.jump_forward_enabled) {
        const expectedTimeMs = this.rtpTimeRef + currentSeq * this.frameDurationMs;
        const deltaMs = nowMs - expectedTimeMs;
        if (deltaMs > config.jump_forward_threshold_ms) {
          const jumpSeq = Math.ceil(
            (config.jump_forward_lead_ms * config.sampling_rate) /
              (config.frames_per_packet * 1000),
          );
          const newSeq = currentSeq + jumpSeq;
          this.rtpTimeRef = nowMs - newSeq * this.frameDurationMs;
          this.lastSeq = newSeq - 1;
          currentSeq = newSeq;
        }
      }

      for (let i = this.lastSeq + 1; i <= currentSeq; i += 1) {
        sendPacket(i);
      }

      this.lastSeq = currentSeq;
      setTimeout(syncAudio, config.stream_latency);
    };

    // If a future start is scheduled, defer until then; otherwise start immediately.
    const nowMs = config.use_monotonic_clock ? performance.now() : Date.now();
    const delayMs = Math.max(0, this.rtpTimeRef - nowMs);
    if (delayMs > 0) {
      setTimeout(syncAudio, delayMs);
    } else {
      syncAudio();
    }
  }

  /**
   * Apply latency (in audio frames) when aligning start time.
   */
  public setLatencyFrames(latencyFrames: number): void {
    if (!Number.isFinite(latencyFrames) || latencyFrames <= 0) {
      return;
    }
    this.latencyFrames = latencyFrames;
    if ((this.startTimeMs === undefined && this.startTimeNtp === undefined) || this.latencyApplied) {
      return;
    }
    const latencyMs = (this.latencyFrames / config.sampling_rate) * 1000;
    this.rtpTimeRef -= latencyMs;
    this.latencyApplied = true;
  }

  private handleUnderrun(): void {
    const nowMs = config.use_monotonic_clock ? performance.now() : Date.now();
    const currentSeq = Math.max(0, this.lastSeq);
    const currentFrames = currentSeq * config.frames_per_packet;
    const offsetMs = (currentFrames / config.sampling_rate) * 1000;
    this.rtpTimeRef = nowMs - offsetMs;
    if (config.underrun_mute_ms > 0) {
      this.muteUntilMs = nowMs + config.underrun_mute_ms;
    }
    this.emit('underrun');
  }
}
