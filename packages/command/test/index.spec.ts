import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { stringify } from '@moneyforward/stream-util';
import Command from '../src/index';

describe('Command', () => {
  describe('Command.execute', () => {
    it('should should spawn child process', async () => {
      const expected = 'hello, world!';
      const args = ['-pe', 'process.argv[1]', expected];
      const file = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-')), 'out.txt');
      const { fd } = await fs.promises.open(file, 'w');
      try {
        const result = await Command.execute('node', args, { stdio: ['ignore', fd, 'ignore'] });
        expect(result).to.be.undefined;
      } finally {
        fs.closeSync(fd);
      }
      const actual = await stringify(fs.createReadStream(file));
      expect(actual).to.equal(expected + os.EOL);
    });

    it('should throw an error if the exit status is non-zero', async () => {
      try {
        await Command.execute('node', ['-pe', 'process.exit(1)']);
        expect.fail();
      } catch (error) {
        expect(error).to.equal(1);
      }
    });

    it('should return single output value', async () => {
      const expected = 'hello, world!' + os.EOL;
      const actual = await Command.execute<string>(
        'node',
        ['-pe', '"hello, world!"'],
        undefined,
        undefined,
        async function* (child) {
          if (child.stdout === null) return;
          yield stringify(child.stdout);
        }
      );
      expect(actual).to.equal(expected);
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
