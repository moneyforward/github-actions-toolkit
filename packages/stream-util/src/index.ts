import stream from 'stream';
import util from 'util';
import JSON from './json';
import Lines from './lines';

export { JSON, Lines };

const debug = util.debuglog('@moneyforward/stream-util');

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
    for await (const chunk of readable) text += String(chunk);
    return text;
  } else {
    const buffers: Buffer[] = [];
    for await (const chunk of readable) buffers.push(chunk);
    return Buffer.concat(buffers).toString();
  }
}
