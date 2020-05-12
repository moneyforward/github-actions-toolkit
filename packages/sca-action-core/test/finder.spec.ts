import { expect } from 'chai';
import os from 'os';
import { PassThroughFinder } from '../src/finder';

describe('finder', () => {
  describe('PassThroughFinder', () => {
    it('should return paths', async () => {
      const expected = ['foo', 'bar', 'baz'];
      const finder = new PassThroughFinder();
      const actual = finder.find(expected.join(os.EOL));
      expect(actual).to.deep.equal(expected);
    });
  });
});
