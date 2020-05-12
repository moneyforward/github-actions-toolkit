import { expect } from 'chai';
import stream from 'stream';
import { stringify } from '../src/index';

describe('stringify', () => {
  it('should return a string', async () => {
    const expected = 'hello, world!';
    const readable = stream.Readable.from([{ toString: (): string => expected }])
    const actual = await stringify(readable);
    expect(actual).to.equal(expected);
  });

  it('should return a string if the encoding is set', async () => {
    const expected = 'hello, world!';
    const readable = stream.Readable.from(expected, { objectMode: false, encoding: 'utf8' });
    const actual = await stringify(readable);
    expect(actual).to.equal(expected);
  });

  it('should return a string if the objectMode is true', async () => {
    const expected = 'hello, world!';
    const readable = stream.Readable.from(Buffer.from(expected), { objectMode: false });
    const actual = await stringify(readable);
    expect(actual).to.equal(expected);
  });
});
