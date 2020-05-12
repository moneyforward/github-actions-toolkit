import stream from 'stream';
import { StringDecoder } from 'string_decoder';
import util from 'util';

const debug = util.debuglog('@moneyforward/sca-action-core/tool/stream');

export async function stringify(readable: stream.Readable): Promise<string> {
  const isObjectStream = (readable: stream.Readable): boolean => readable.readableObjectMode;
  const isTextStream = (readable: stream.Readable): boolean => {
    interface Readable extends stream.Readable {
      readableEncoding?: string | null;
      _readableState?: {
        encoding: string | null;
      };
    }
    function readableEncoding(readable: Readable): string | null {
      const encoding = readable.readableEncoding;
      if (encoding !== undefined) return encoding;
      return readable._readableState ? readable._readableState.encoding : null
    }
    return readableEncoding(readable) !== null;
  };

  if (isObjectStream(readable) || isTextStream(readable)) {
    let text = '';
    for await (const buffer of readable) text += String(buffer);
    return text.trim();
  } else {
    const buffers: Buffer[] = [];
    for await (const buffer of readable) buffers.push(buffer);
    return Buffer.concat(buffers).toString().trim();
  }
}

export class LineTransformStream extends stream.Transform {
  private readonly decoder: StringDecoder;
  private buffer: string;

  constructor(encoding?: string) {
    super({
      objectMode: true,
      transform: (chunk, _encoding, done) => {
        try {
          debug('%o %s', chunk, _encoding);
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

export class JSON extends stream.Transform {
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
