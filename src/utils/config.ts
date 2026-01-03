import { randomInt } from './numUtil';

export interface AirplayConfig {
  user_agent: string;
  udp_default_port: number;
  frames_per_packet: number;
  channels_per_frame: number;
  bits_per_channel: number;
  pcm_packet_size: number;
  alac_packet_size: number;
  packet_size: number;
  packets_in_buffer: number;
  coreaudio_min_level: number;
  coreaudio_check_period: number;
  coreaudio_preload: number;
  sampling_rate: number;
  sync_period: number;
  stream_latency: number;
  rtsp_timeout: number;
  rtsp_heartbeat: number;
  rtsp_retry_attempts: number;
  rtsp_retry_base_ms: number;
  rtsp_retry_max_ms: number;
  rtsp_retry_jitter_ms: number;
  control_sync_base_delay_ms: number;
  control_sync_jitter_ms: number;
  device_magic: number;
  ntp_epoch: number;
  iv_base64: string;
  rsa_aeskey_base64: string;
}

export const config: AirplayConfig = {
  user_agent: 'iTunes/11.3.1 (Windows; Microsoft Windows 10 x64 (Build 19044); x64) (dt:2)',
  udp_default_port: 54621, // preferred starting port in AirTunes v2
  frames_per_packet: 352, // samples per frames in ALAC packets
  channels_per_frame: 2, // always stereo in AirTunes v2
  bits_per_channel: 16, // -> 2 bytes per channel
  pcm_packet_size: 352 * 2 * 2, // frames*channels*bytes
  alac_packet_size: 352 * 2 * 2 + 8, // pcm payload + alac header/footer
  packet_size: 352 * 2 * 2, // active packet size (depends on input codec)
  packets_in_buffer: 260, // ~2.1s of audio (matches MA's ~2000ms buffer)
  coreaudio_min_level: 5, // if CoreAudio's internal buffer drops too much, inject some silence to raise it
  coreaudio_check_period: 2000, // CoreAudio buffer level check period
  coreaudio_preload: 352 * 2 * 2 * 50, // ~0.5s of silence pushed to CoreAudio to avoid draining AudioQueue
  sampling_rate: 44100, // fixed by AirTunes v2
  sync_period: 126, // UDP sync packets are sent to all AirTunes devices regularly
  stream_latency: 200, // audio UDP packets are flushed in bursts periodically
  rtsp_timeout: 15000, // RTSP servers are considered gone if no reply is received before the timeout
  rtsp_heartbeat: 15000, // some RTSP (like HomePod) servers requires heartbeat.
  rtsp_retry_attempts: 3,
  rtsp_retry_base_ms: 300,
  rtsp_retry_max_ms: 4000,
  rtsp_retry_jitter_ms: 150,
  control_sync_base_delay_ms: 2,
  control_sync_jitter_ms: 3,
  device_magic: randomInt(9),
  ntp_epoch: 0x83aa7e80,
  iv_base64: 'ePRBLI0XN5ArFaaz7ncNZw',
  rsa_aeskey_base64:
    'VjVbxWcmYgbBbhwBNlCh3K0CMNtWoB844BuiHGUJT51zQS7SDpMnlbBIobsKbfEJ3SCgWHRXjYWf7VQWRYtEcfx7ejA8xDIk5PSBYTvXP5dU2QoGrSBv0leDS6uxlEWuxBq3lIxCxpWO2YswHYKJBt06Uz9P2Fq2hDUwl3qOQ8oXb0OateTKtfXEwHJMprkhsJsGDrIc5W5NJFMAo6zCiM9bGSDeH2nvTlyW6bfI/Q0v0cDGUNeY3ut6fsoafRkfpCwYId+bg3diJh+uzw5htHDyZ2sN+BFYHzEfo8iv4KDxzeya9llqg6fRNQ8d5YjpvTnoeEQ9ye9ivjkBjcAfVw',
};

export default config;
