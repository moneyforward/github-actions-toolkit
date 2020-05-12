import { expect } from 'chai';
import os from 'os';
import stream from 'stream';
import Lines from '../src/lines';

describe('Lines', () => {
  it('should return lines', async () => {
    const expected = ['foo', '', 'bar', '', 'baz'];
    const readable = stream.Readable.from(Buffer.from(expected.join(os.EOL)), { objectMode: false });
    const actual = [];
    for await (const line of readable.pipe(new Lines())) actual.push(line);
    expect(actual).to.deep.equal(expected);
  });

  it('should return lines if the encoding is set', async () => {
    const expected = ['foo', '', 'bar', '', 'baz'];
    const readable = stream.Readable.from(Buffer.from(expected.join(os.EOL)), { objectMode: false, encoding: 'utf8' });
    const actual = [];
    for await (const line of readable.pipe(new Lines())) actual.push(line);
    expect(actual).to.deep.equal(expected);
  });
});
