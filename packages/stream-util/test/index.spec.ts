import { expect } from 'chai';
import stream from 'stream';
import util from 'util';
import { arrayify, stringify, reduce, map, of, parallel } from '../src/index';

const debug = util.debuglog('@moneyforward/stream-util');

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

describe('parallel', () => {
  it('should return the same result', async () => {
    const expected = [60, 20, 40, 30];
    const promisify = (value: number, index: number): Promise<number> =>
      new Promise(resolve => {
        debug('%s #%d starting %s...', new Date(), index, value);
        setTimeout((v, i) => {
          debug('%s #%d done %s', new Date(), i, v);
          resolve(v);
        }, value, value, index);
      });
    const iterable = (async function * (numbers): AsyncIterable<number> {
      yield* numbers.map(promisify);
    })(expected);
    const actual = await arrayify(parallel(iterable, expected.length / 2));
    expect(actual).to.deep.equal(expected);
  });
});
