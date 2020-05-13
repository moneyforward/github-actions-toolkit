import { expect } from 'chai';
import os from 'os';
import stream from 'stream';
import { stringify } from '@moneyforward/stream-util';
import Command, { reduce } from '../src/index';

describe('command', () => {
  describe('reduce', () => {
    it('should return single output value', async () => {
      const numbers = [1, 2, 3];
      const sum = (previous: number, current: number): number => previous + current;
      const expected = numbers.reduce(sum);
      const actual = await reduce(
        async function* (numbers): AsyncGenerator<number> { for (const n of numbers) yield n; }(numbers),
        sum, 0
      );
      expect(actual).to.equal(expected);
    });
  });

  describe('Command', () => {
    describe('Command.execute', () => {
      it('should return single output value', async () => {
        const expected = ['hello, world!' + os.EOL, 0];
        const actual = await Command.execute<string>(
          'node',
          ['-pe', '"hello, world!"'],
          undefined,
          undefined,
          async child => {
            child.stdout && child.stdout.unpipe(process.stdout);
            return stringify(child.stdout || stream.Readable.from(''));
          }
        );
        expect(actual).to.deep.equal(expected);
      });
    });

    describe('Command.substitute', () => {
      it('should return string', async () => {
        const expected = 'hello, world!';
        const actual = await Command.substitute('node', ['-pe', '"hello, world!"']);
        expect(actual).to.equal(expected);
      });
    });
  });
});
