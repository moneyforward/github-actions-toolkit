import { expect } from 'chai';
import Command from '../src/index';

describe('command', () => {
  describe('Command', () => {
    describe('substitute', () => {
      it('should return string', async () => {
        const expected = 'hello, world!';
        const actual = await Command.substitute('node', ['-pe', '"hello, world!"']);
        expect(actual).to.equal(expected);
      });
    });
  });
});
