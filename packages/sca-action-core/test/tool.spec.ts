import { expect } from 'chai';
import stream from 'stream';
import * as tool from '../src/tool';

describe('tool', () => {
  describe('stringify', () => {
    it('should return a string', async () => {
      {
        const expected = 'hello, world!';
        const readable = stream.Readable.from(expected, { objectMode: false, encoding: 'utf8' });
        const actual = await tool.stringify(readable);
        expect(actual).to.equal(expected);
      }
      {
        const expected = 'hello, world!';
        const readable = stream.Readable.from(Buffer.from(expected), { objectMode: false });
        const actual = await tool.stringify(readable);
        expect(actual).to.equal(expected);
      }
      {
        const expected = 'hello, world!';
        const readable = stream.Readable.from([{ toString: () => expected }])
        const actual = await tool.stringify(readable);
        expect(actual).to.equal(expected);
      }
    })
  });
});