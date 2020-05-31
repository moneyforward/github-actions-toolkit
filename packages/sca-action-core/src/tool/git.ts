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
    yield* new Command('git', ['remote', '-v'], undefined, async function* (child): AsyncIterable<Remote> {
      if (child.stdout === null) return;
      child.stdout.unpipe(process.stdout);
      for await (const line of child.stdout.pipe(new transform.Lines())) {
        const [matches, name, url, mirror] = /^(.+)\t(.+) \((fetch|push)\)$/.exec(line) || [];
        if (matches) yield { name, url, mirror: mirror === 'fetch' ? 'fetch' : 'push' };
      }
    }).execute();
  }

  async * diff(commit: string, other?: string, notation: 'none' | '..' | '...' = 'none'): AsyncIterable<string> {
    const args = ['--no-pager', 'diff', '--no-prefix', '--no-color', '-U0', '--diff-filter=b'];
    const commits = other === undefined ? [commit] : notation === 'none' ? [commit, other] : [`${commit}${notation}${other}`];
    debug('%s', commits.join(' '));

    yield* new Command('git', args, undefined, async function* (child) {
      if (child.stdout === null) return;
      child.stdout.unpipe(process.stdout);
      yield* child.stdout.pipe(new transform.Lines());
    }).execute(commits);
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
