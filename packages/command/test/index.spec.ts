import { expect } from 'chai';
import os from 'os';
import { stringify } from '@moneyforward/stream-util';
import Command from '../src/index';

describe('command', () => {
  describe('Command', () => {
    describe('Command.execute', () => {
      it('should return single output value', async () => {
        const expected = 'hello, world!' + os.EOL;
        const actual = await Command.execute<string>(
          'node',
          ['-pe', '"hello, world!"'],
          undefined,
          undefined,
          async function * (child) {
            if (child.stdout === null) return;
            child.stdout.unpipe(process.stdout);
            yield stringify(child.stdout);
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
