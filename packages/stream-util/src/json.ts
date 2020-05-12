import stream from 'stream';
import util from 'util';

const debug = util.debuglog('@moneyforward/stream-util/json');

export default class JSON extends stream.Transform {
  private count = 0;
  private buffers: Buffer[] = [];
  constructor() {
    super({
      readableObjectMode: true,
      writableObjectMode: false,
      transform: (chunk, encoding, done): void => {
        debug('%d: %s', this.count += 1, encoding);
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
        this.buffers.push(buffer);
        done();
      },
      flush: (done): void => {
        try {
          const json = Buffer.concat(this.buffers).toString();
          debug('%s', json);
          const result = global.JSON.parse(json);
          done(null, result);
        } catch (error) {
          done(error);
        }
      }
    });
  }
}
