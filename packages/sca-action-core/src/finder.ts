import fs from 'fs';
import path from 'path';
import * as glob from '@actions/glob';

export type Finder = {
  find(paths: string): Iterable<string> | AsyncIterable<string>;
}

export type FinderConstructor = { new(): Finder };

export class PassThroughFinder implements Finder {
  find(paths: string): Iterable<string> | AsyncIterable<string> {
    return paths.replace(/[\r\n]+/g, '\n').split('\n').filter(line => line !== '');
  }
}

export class GlobFinder implements Finder {
  find(patterns: string): Iterable<string> | AsyncIterable<string> {
    return async function* (): AsyncGenerator<string> {
      const globber = await glob.create(patterns);
      for await (const filename of globber.globGenerator()) {
        if ((await fs.promises.stat(filename)).isDirectory()) continue;
        yield path.relative(process.cwd(), filename);
      }
    }();
  }
}
