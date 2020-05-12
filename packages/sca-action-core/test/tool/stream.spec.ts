import { expect } from 'chai';
import os from 'os';
import stream from 'stream';
import { Lines, stringify } from '../../src/tool/stream';

describe('tool', () => {
  describe('stream', () => {
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
  });
});
