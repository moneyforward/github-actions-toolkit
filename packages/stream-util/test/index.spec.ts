import { expect } from 'chai';
import stream from 'stream';
import { arrayify, stringify, reduce, map, of, concat, first } from '../src/index';

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
    const actual = await reduce(of(...numbers), sum);
    expect(actual).to.equal(expected);
  });

  it('should return single value with different type', async () => {
    const numbers = [1, 2, 3];
    const join = (previous: string, current: number): string => previous + String(current);
    const expected = numbers.reduce(join, '');
    const actual = await reduce(of(...numbers), join, '');
    expect(actual).to.equal(expected);
  });

  it('should return initial value if empty', async () => {
    const numbers: number[] = [];
    const initialValue = -1;
    const sum = (previous: number, current: number): number => previous + current;
    const expected = numbers.reduce(sum, initialValue);
    const actual = await reduce(of(...numbers), sum, initialValue);
    expect(actual).to.equal(expected);
  });

  it('should throw error if empty and not exists initial value', async () => {
    try {
      await reduce(of(), previous => previous);
      expect.fail();
    } catch (error) {
      expect(error).to.be.an.instanceof(TypeError);
    }

    expect(await reduce(of(), previous => previous, undefined)).to.be.undefined;
  });
});

describe('concat', () => {
  it('should return new iterable', async () => {
    const numbers = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const expected = numbers.reduce((previous, current) => previous.concat(current));
    const actual = await arrayify(concat(...numbers.map(array => of(...array))));
    expect(actual).to.deep.equal(expected);
  });
});

describe('first', () => {
  it('should return the first element', async () => {
    const expected = 0;
    const actual = await first(of(expected));
    expect(actual).to.equal(expected);
  });

  it('should return undefined if empty', async () => {
    const actual = await first(of());
    expect(actual).to.be.undefined;
  });
});
