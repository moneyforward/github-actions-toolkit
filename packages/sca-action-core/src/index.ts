import { strict as assert } from 'assert';
import { SpawnOptions, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import stream from 'stream';
import util from 'util';
import * as glob from '@actions/glob';
import Command, { CommandConstructor, SpawnPrguments } from './tool/command';
import Git from './tool/git';
import { ChangeRanges, ReporterConstructor, ReporterRepository, Resolver, Statistic } from './reporter';

const pipeline = util.promisify(stream.pipeline);
const debug = util.debuglog('@moneyforward/sca-action-core');

debug('Node.js %s (arch: %s; platform: %s, cups: %d)', process.version, process.arch, process.platform, os.cpus().length);

export * as tool from './tool';
export * as reporter from './reporter';

export type Finder = {
  find(paths: string): Iterable<string> | AsyncIterable<string>;
}

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

export default abstract class StaticCodeAnalyzer {
  protected static readonly reporterRepository = new ReporterRepository();

  protected readonly git = new Git();
  reporterTypeNotation: string | undefined;

  protected constructor(protected command: string, protected args: string[] = [], protected options: SpawnOptions = {}, protected exitStatusThreshold?: number | ((exitStatus: number) => boolean), protected Finder: { new(): Finder } = PassThroughFinder, protected title?: string) {
  }

  protected abstract prepare(): Promise<unknown>;

  protected abstract createTransformStreams(): stream.Transform[] | undefined;

  protected get Command(): CommandConstructor {
    return Command;
  }

  protected get Reporter(): ReporterConstructor {
    return StaticCodeAnalyzer.reporterRepository.get(this.reporterTypeNotation);
  }

  protected async pipeline(stdout: stream.Readable | null, writable: stream.Writable, ...[command, args, options]: SpawnPrguments): Promise<[stream.Readable, ...stream.Writable[]]> {
    debug('pipelining `%s` with %d argument(s)... (options: %o)', command, args.length, options);
    const readable = stdout || stream.Readable.from([]);
    readable.unpipe(process.stdout);
    const transformers: stream.Writable[] = this.createTransformStreams() || [];
    return [readable, ...transformers.concat(writable)];
  }

  async analyze(patterns = '.'): Promise<number> {
    assert(process.env.GITHUB_BASE_REF, 'Environment variable `GITHUB_BASE_REF` is undefined.');
    assert(process.env.GITHUB_SHA, 'Environment variable `GITHUB_SHA` is undefined.');

    const measureChangeRanges = (async (): Promise<Map<string, [number, number][]>> => {
      let remoteName: string | undefined;
      for await (const remote of await this.git.listRemote()) if (/\bgithub\.com\b/.test(remote.url) && remote.mirror === 'fetch') {
        debug('%o', remote);
        remoteName = remote.name;
        break;
      }
      return this.git.measureChangeRanges(process.env.GITHUB_BASE_REF || '', process.env.GITHUB_SHA || '', remoteName);
    })();
    const createResolver = (async (): Promise<Resolver> => {
      const cdup = await this.git.showCurrentDirectoryUp();
      const dirname = path.relative(path.resolve(process.cwd(), cdup), process.cwd());
      debug('dirname: %s', dirname);
      return {
        resolve: (file): string => path.join(dirname, path.relative(process.cwd(), file))
      }
    })();
    const [changeRanges, resolver] = await Promise.all<ChangeRanges, Resolver, unknown>([
      measureChangeRanges,
      createResolver,
      this.prepare()
    ]);
    console.log(`::group::Analyze code statically using ${this.title || this.command}`);
    try {
      const reporter = new this.Reporter(changeRanges, resolver, [this.command, this.args, this.options]);
      const promisify = async (child: ChildProcess, ...spawnArguments: SpawnPrguments): Promise<Statistic> => {
        return new Promise((resolve, reject) => {
          const writable = reporter.createReportWriter(resolve, spawnArguments);
          this.pipeline(child.stdout, writable, ...spawnArguments).then(pipeline).catch(reject);
        });
      };
      const command = new this.Command<Statistic>(this.command, this.args, this.options, promisify, this.exitStatusThreshold);

      await reporter.initialize();
      try {
        const results = await command.execute(new this.Finder().find(patterns));
        const statistic = results.map(([result,]) => result).reduce(Statistic.add);
        debug('%o', statistic);
        console.log('Detected %d issue(s).', statistic.numberOfDetections);
        return statistic.numberOfDetections > 0 ? 1 : 0;
      } finally {
        await reporter.finalize();
      }
    } finally {
      console.log(`::endgroup::`);
    }
  }
}
