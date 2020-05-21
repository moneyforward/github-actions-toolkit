import { strict as assert } from 'assert';
import { SpawnOptions, ChildProcess } from 'child_process';
import path from 'path';
import stream from 'stream';
import util from 'util';
import { analyzer, reporter } from '@moneyforward/code-review-action';
import Command, { CommandConstructor, SpawnPrguments } from '@moneyforward/command';
import * as streaming from '@moneyforward/stream-util';
import { FinderConstructor, PassThroughFinder } from './finder';
import Git, { Remote } from './tool/git';

const Statistic = reporter.Statistic;

const pipeline = util.promisify(stream.pipeline);
const debug = util.debuglog('@moneyforward/sca-action-core');

export * as finder from './finder';
export * as installer from './tool/installer';

export default abstract class StaticCodeAnalyzer implements analyzer.Analyzer {
  protected readonly git = new Git();

  protected constructor(
    protected command: string,
    protected args: string[] = [],
    protected options: SpawnOptions = {},
    protected exitStatusThreshold?: number | ((exitStatus: number) => boolean),
    protected Finder: FinderConstructor = PassThroughFinder,
    protected title?: string
  ) {
  }

  protected abstract prepare(): Promise<unknown>;

  protected abstract createTransformStreams(): stream.Transform[] | undefined;

  protected get Command(): CommandConstructor {
    return Command;
  }

  abstract get Reporter(): reporter.ReporterConstructor;

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

    const measureChangeRanges = (async (): Promise<reporter.ChangeRanges> => {
      const predicate = (remote: Remote): boolean => /\bgithub\.com\b/.test(remote.url) && remote.mirror === 'fetch';
      const remote = await streaming.first(streaming.filter(this.git.listRemote(), predicate));
      return this.git.measureChangeRanges(process.env.GITHUB_BASE_REF || '', process.env.GITHUB_SHA || '', remote?.name);
    })();
    const createResolver = (async (): Promise<reporter.Resolver> => {
      const cdup = await this.git.showCurrentDirectoryUp();
      const dirname = path.relative(path.resolve(process.cwd(), cdup), process.cwd());
      debug('dirname: %s', dirname);
      return {
        resolve: (file): string => path.join(dirname, path.relative(process.cwd(), file))
      }
    })();
    const [changeRanges, resolver] = await Promise.all<reporter.ChangeRanges, reporter.Resolver, unknown>([
      measureChangeRanges,
      createResolver,
      this.prepare()
    ]);
    console.log(`::group::Analyze code statically using ${this.title || this.command}`);
    try {
      const reporter = new this.Reporter(changeRanges, resolver, [this.command, this.args, this.options]);
      const promisify = async (child: ChildProcess, ...spawnArguments: SpawnPrguments): Promise<reporter.Statistic> => {
        return new Promise((resolve, reject) => {
          const writable = reporter.createReportWriter(resolve, spawnArguments);
          this.pipeline(child.stdout, writable, ...spawnArguments).then(pipeline).catch(reject);
        });
      };
      const command = new this.Command<reporter.Statistic>(this.command, this.args, this.options, promisify, this.exitStatusThreshold);

      await reporter.initialize();
      try {
        const results = await streaming.arrayify(command.execute(new this.Finder().find(patterns)));
        const statistic = results.map(([statistic]) => statistic).reduce(Statistic.add, new Statistic());
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
