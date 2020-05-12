import stream from 'stream';
import util from 'util';
import Command from '@moneyforward/command';
import { Lines } from '@moneyforward/stream-util';

const debug = util.debuglog('@moneyforward/sca-action-core/tool/git');

export interface Remote {
  name: string;
  url: string;
  mirror: 'fetch' | 'push';
}

export default class Git {
  async fetchShallow(repository?: string, refspec?: string, depth = 1): Promise<void> {
    const args = ['fetch', '-q', `--depth=${depth}`];
    repository && args.push(repository);
    refspec && args.push(refspec);
    return Command.execute('git', args);
  }

  async parseRevision(refspec: string, repository?: string): Promise<string> {
    const revision = `${repository ? `${repository}/` : ''}${refspec}`;
    return Command.substitute('git', ['rev-parse', '--verify', '-q', revision]);
  }

  async listRemote(): Promise<AsyncIterable<Remote>> {
    return new Command('git', ['remote', '-v'], undefined, async child => {
      child.stdout && child.stdout.unpipe(process.stdout);
      const readable = child.stdout ? child.stdout.pipe(new Lines()) : stream.Readable.from([]);
      return async function* (remotes: AsyncIterable<string>): AsyncGenerator<Remote> {
        for await (const line of remotes) {
          const [matches, name, url, mirror] = /^(.+)\t(.+) \((fetch|push)\)$/.exec(line) || [];
          if (matches) yield { name, url, mirror: mirror === 'fetch' ? 'fetch' : 'push' };
        }
      }(readable);
    }).execute().then(async function* (results) {
      for (const [result] of results) yield* result;
    });
  }

  async diff(commit: string, other?: string, notation: 'none' | '..' | '...' = 'none'): Promise<AsyncIterable<string>> {
    const args = ['--no-pager', 'diff', '--no-prefix', '--no-color', '-U0', '--diff-filter=b'];
    const commits = other === undefined ? [commit] : notation === 'none' ? [commit, other] : [`${commit}${notation}${other}`];
    debug('%s', commits.join(' '));
    return new Command('git', args, undefined, async child => {
      child.stdout && child.stdout.unpipe(process.stdout);
      return child.stdout ? child.stdout.pipe(new Lines()) : stream.Readable.from([]);
    }).execute(commits).then(async function* (results) {
      for (const [result] of results) yield* result;
    });
  }

  async measureChangeRanges(baseRef: string, headRef: string, repository?: string): Promise<Map<string, [number, number][]>> {
    debug('%s...%s', baseRef, headRef);

    const [base, head] = await [baseRef, headRef]
      .map(ref => async (): Promise<string> => {
        const sha1 = await this.parseRevision(ref);
        if (sha1 !== '' || repository === undefined) return sha1;
        await this.fetchShallow(repository, ref);
        return this.parseRevision(ref, repository);
      })
      .reduce((promise, executor) => promise.then(async commits => commits.concat(await executor())), Promise.resolve<string[]>([]));

    const changeRanges = new Map<string, [number, number][]>();
    let name = '';
    for await (const line of await this.diff(base, head, '...')) if (/^([@]{2}|[+]{3})\s/.test(line)) {
      if (/^[+]{3}\s/.test(line)) {
        name = line.substring('+++ '.length);
        continue;
      }
      const metadata = ((/^@@ (.*) @@.*$/.exec(line) || [])[1] || '').split(' ');
      const [start, lines = 1] = metadata[metadata.length - 1].split(',').map(Number).map(Math.abs);
      debug('%s:%d,%d', name, start, lines);
      const changeRange = changeRanges.get(name) || [];
      changeRanges.set(name, changeRange.concat([[start, start + lines - 1]]));
    }
    return changeRanges;
  }

  async showCurrentDirectoryUp(): Promise<string> {
    return Command.substitute('git', ['rev-parse', '--show-cdup']);
  }
}
