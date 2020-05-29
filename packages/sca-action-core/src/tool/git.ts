import { spawn } from 'child_process';
import stream from 'stream';
import util from 'util';
import Command from '@moneyforward/command';
import { map, of, transform, arrayify } from '@moneyforward/stream-util';

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

  async * listRemote(): AsyncIterable<Remote> {
    const results = new Command('git', ['remote', '-v'], undefined, async child => {
      child.stdout && child.stdout.unpipe(process.stdout);
      const readable = child.stdout ? child.stdout.pipe(new transform.Lines()) : stream.Readable.from([]);
      return async function* (remotes: AsyncIterable<string>): AsyncIterable<Remote> {
        for await (const line of remotes) {
          const [matches, name, url, mirror] = /^(.+)\t(.+) \((fetch|push)\)$/.exec(line) || [];
          if (matches) yield { name, url, mirror: mirror === 'fetch' ? 'fetch' : 'push' };
        }
      }(readable);
    }).execute();
    for await (const [result] of results) yield* result;
  }

  async * diff(commit: string, other?: string, notation: 'none' | '..' | '...' = 'none'): AsyncIterable<string> {
    const args = ['--no-pager', 'diff', '--no-prefix', '--no-color', '-U0', '--diff-filter=b'];
    const commits = other === undefined ? [commit] : notation === 'none' ? [commit, other] : [`${commit}${notation}${other}`];
    debug('%s', commits.join(' '));

    const child = spawn('git', args.concat(commits));
    const promise = new Promise((resolve, reject) => {
      child.once('close', exitStatus => (exitStatus ? reject : resolve)(exitStatus));
    });
    for await (const line of child.stdout.pipe(new transform.Lines())) yield line;
    return await promise;
  }

  async measureChangeRanges(baseRef: string, headRef: string, repository?: string): Promise<Map<string, [number, number][]>> {
    debug('%s...%s', baseRef, headRef);

    const [base, head] = await arrayify(map(of(baseRef, headRef), async ref => {
      const sha1 = await this.parseRevision(ref);
      if (sha1 !== '' || repository === undefined) return sha1;
      await this.fetchShallow(repository, ref);
      return this.parseRevision(ref, repository);
    }));

    const changeRanges = new Map<string, [number, number][]>();
    let name = '';
    for await (const line of this.diff(base, head, '...')) if (/^([@]{2}|[+]{3})\s/.test(line)) {
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
