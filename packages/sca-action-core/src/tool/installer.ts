import fs from 'fs';
import path from 'path';
import stream from 'stream';
import util from 'util';
import { reduce, transform } from '@moneyforward/stream-util';
import Command, { Action } from '@moneyforward/command';

const debug = util.debuglog('@moneyforward/sca-action-core/tool/installer');

export type Installer = Action<string, Promise<Map<string, string>>>;

export class RubyGemsInstaller implements Installer {
  private static async addPath(env: NodeJS.ProcessEnv = global.process.env): Promise<string> {
    const gempath = await Command.substitute('gem', ['env', 'path']);
    const paths = env['PATH'] = gempath
      .split(path.delimiter)
      .map(gemdir => path.join(gemdir, 'bin'))
      .concat(env.PATH || '')
      .join(path.delimiter);
    debug('PATH=%s', paths);
    return paths;
  }

  private path: Promise<string>;
  private bundledGems: Promise<Map<string, string>>;

  constructor(private isStrict = true, private process: NodeJS.Process = global.process) {
    this.path = RubyGemsInstaller.addPath(this.process.env);
    this.bundledGems = (async (): Promise<Map<string, string>> => {
      const gems = new Map<string, string>();
      const readable = fs.existsSync('Gemfile.lock') ? fs.createReadStream('Gemfile.lock') : stream.Readable.from([]);
      const filter = /^ {4}(.+) \((.+)\)$/;
      for await (const line of readable.pipe(new transform.Lines())) {
        const [matches, key, value] = (filter.exec(line) || []);
        if (matches) gems.set(key, value);
      }
      return gems;
    })();
  }

  private async * resolve(gemNames: Iterable<string> | AsyncIterable<string>): AsyncIterable<string> {
    const format = ([name, version]: [string, string | undefined]): string => `${name}${(version && ':' + version) || ''}`;
    const bundledGems = await this.bundledGems;
    for await (const gemName of gemNames)
      if (this.isStrict) {
        yield format([gemName, bundledGems.get(gemName)]);
      } else {
        for (const [gem, version] of bundledGems) {
          if (!gem.startsWith(gemName)) continue;
          const c = gem[gemName.length];
          if (c === undefined || c === '_' || c === '-') yield format([gem, version]);
        }
      }
  }

  async execute(gemNames: Iterable<string> | AsyncIterable<string> = []): Promise<Map<string, string>> {
    return Promise.all([
      (async (): Promise<Map<string, string>> => {
        const initArgs = ['i', '-N', '--user-install'];
        const command = new Command('gem', initArgs, undefined, function* (child, command, args) {
          child.stdout?.pipe(process.stdout);
          child.stderr?.pipe(process.stderr);
          yield args.slice(initArgs.length);
        });
        return reduce(command.execute(this.resolve(gemNames)), (gems, result) => {
          result
            .map(gem => gem.split(':', 2))
            .forEach(([name, version]) => gems.set(name, version));
          return gems;
        }, new Map<string, string>());
      })(),
      this.path
    ]).then(([gems,]) => gems);
  }
}
