import { expect } from 'chai';
import stream from 'stream';
import { arrayify, stringify, reduce, map, of } from '../src/index';

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

describe('map', () => {
  it('should return new iterable', async () => {
    const numbers = [1, 2, 3];
    const expected = numbers.map(String);
    const actual = map(of(...numbers), async value => String(value));
    expect(await arrayify(actual)).to.deep.equal(expected);
  });
});

describe('reduce', () => {
  it('should return single output value', async () => {
    const numbers = [1, 2, 3];
    const sum = (previous: number, current: number): number => previous + current;
    const expected = numbers.reduce(sum);
    const actual = await reduce(of(...numbers), sum, 0);
    expect(actual).to.equal(expected);
  });
});
