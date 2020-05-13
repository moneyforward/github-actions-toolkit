import { expect } from 'chai';
import os from 'os';
import stream from 'stream';
import { stringify } from '@moneyforward/stream-util';
import Command from '../src/index';

describe('command', () => {
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
