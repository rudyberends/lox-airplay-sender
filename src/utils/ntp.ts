import config from './config';

class NTP {
  private readonly timeRef = Date.now() - config.ntp_epoch * 1000;

  public timestamp(): Buffer {
    const time = Date.now() - this.timeRef;
    const sec = Math.floor(time / 1000);
    const msec = time - sec * 1000;
    const ntp_msec = Math.floor(msec * 4294967.296);

    const ts = Buffer.alloc(8);
    ts.writeUInt32BE(sec, 0);
    ts.writeUInt32BE(ntp_msec, 4);
    return ts;
  }

  public getTime(): number {
    const time = Date.now() - this.timeRef;
    const sec = Math.floor(time / 1000);
    const msec = time - sec * 1000;
    const ntp_msec = Math.floor(msec * 4294967.296);
    return ntp_msec;
  }
}

export default new NTP();
