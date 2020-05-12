import stream from 'stream';
import { StringDecoder } from 'string_decoder';
import util from 'util';

const debug = util.debuglog('@moneyforward/stream-util/lines');

export default class Lines extends stream.Transform {
  private readonly decoder: StringDecoder;
  private count = 0;
  private buffer: string;

  constructor(encoding?: string) {
    super({
      objectMode: true,
      transform: (chunk, encoding, done) => {
        try {
          debug('%d: %s', this.count += 1, encoding);
          const isDecodable = ((chunk): boolean => {
            return Buffer.isBuffer(chunk) || chunk instanceof String || typeof chunk === 'string';
          })(chunk);
          if (!isDecodable) return done(null, chunk);
          const text = this.decoder.write(chunk);
          const lines = this.split(this.buffer + text);
          const last = lines.pop();
          for (const line of lines) this.push(line);
          this.buffer = last || '';
          done();
        } catch (error) {
          done(error);
        }
      },
      flush: (done) => {
        try {
          const text = this.decoder.end();
          const lines = this.split(this.buffer + text);
          const last = lines.pop();
          for (const line of lines) this.push(line);
          if (last && last.length) this.push(last);
          done();
        } catch (error) {
          done(error);
        }
      }
    });
    this.decoder = new StringDecoder(encoding);
    this.buffer = '';
  }

  private split(text: string): string[] {
    return text.replace(/\r\n/g, '\n').split(/[\r\n]/);
  }
}
