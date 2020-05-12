import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';
import { Lines } from '@moneyforward/stream-util';
import Command, { Action } from '@moneyforward/command';

const debug = util.debuglog('@moneyforward/sca-action-core/tool/installer');

export type Installer = Action<string, Map<string, string>>;

export class RubyGemsInstaller implements Installer {
  private static async addPath(dirctory: Promise<string>, env: NodeJS.ProcessEnv = global.process.env): Promise<string> {
    const gemdir = await dirctory;
    const gempath = env['GEM_PATH'] = [gemdir, await Command.substitute('gem', ['env', 'path'])].join(path.delimiter);
    const paths = env['PATH'] = [path.join(gemdir, 'bin'), env.PATH || ''].join(path.delimiter);
    debug('GEM_PATH=%s', gempath);
    debug('PATH=%s', paths);
    return paths;
  }

  private dirctory: Promise<string>;
  private path: Promise<string>;
  private bundledGems: Promise<Map<string, string>>;

  constructor(private isStrict = true, private process: NodeJS.Process = global.process) {
    this.dirctory = fs.promises.mkdtemp(path.join(os.tmpdir(), 'ruby-'));
    this.path = RubyGemsInstaller.addPath(this.dirctory, this.process.env);
    this.bundledGems = (async (): Promise<Map<string, string>> => {
      const gems = new Map<string, string>();
      const readable = fs.existsSync('Gemfile.lock') ? fs.createReadStream('Gemfile.lock') : stream.Readable.from([]);
      const filter = /^ {4}(.+) \((.+)\)$/;
      for await (const line of readable.pipe(new Lines())) {
        const [matches, key, value] = (filter.exec(line) || []);
        if (matches) gems.set(key, value);
      }
      return gems;
    })();
  }

  private async * resolve(gemNames: Iterable<string> | AsyncIterable<string>): AsyncGenerator<string, void, unknown> {
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
        const initArgs = ['i', '-N', '-i', await this.dirctory];
        const command = new Command('gem', initArgs, undefined, async (_child, _command, args) => args.slice(initArgs.length));
        return command.execute(this.resolve(gemNames))
          .then(results => new Map<string, string>(
            results
              .map(([gems,]) => gems)
              .reduce((previous, current) => previous.concat(current))
              .map(gem => gem.split(':', 2) as [string, string])
          ));
      })(),
      this.path
    ]).then(([gems,]) => gems);
  }
}
