import { strict as assert } from 'assert';
import { SpawnOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import stream from 'stream';
import util from 'util';
import * as tool from './tool';

export { tool };

const debug = util.debuglog('@moneyforward/sca-action-core');

const measureChangeRanges = async (baseRef: string, headRef: string) => {
  const command = 'git';
  const remote = await tool.execute(command, ['remote', '-v'], undefined, undefined, async child => {
    assert(child.stdout !== null); if (child.stdout == null) return '';
    child.stdout.unpipe(process.stdout);
    const lines = [];
    for await (const line of readline.createInterface(child.stdout))
      if (/\bgithub\.com\b/.test(line) && / \(fetch\)$/.test(line))
        lines.push(line);
    return lines.map(line => line.split('\t', 1)[0])[0];
  });
  const commits = await [baseRef, headRef]
    .map(ref =>
      () => tool.execute(command, ['rev-parse', '--verify', '-q', ref], undefined, undefined, async child => {
        assert(child.stdout !== null); if (child.stdout == null) return;
        child.stdout.unpipe(process.stdout);
        return tool.stringify(child.stdout);
      }).catch(async () => {
        await tool.execute(command, ['fetch', '--depth=1', '-q', remote, ref]);
        return tool.execute(command, ['rev-parse', '--verify', '-q', `${remote}/${ref}`], undefined, undefined, async child => {
          assert(child.stdout !== null); if (child.stdout == null) return;
          child.stdout.unpipe(process.stdout);
          return tool.stringify(child.stdout);
        });
      }).then(sha1 => (sha1 || '').trim())
    )
    .reduce((promise, executor) => promise.then(async commits => commits.concat(await executor())), Promise.resolve([] as string[]));
  const args = ['--no-pager', 'diff', '--no-prefix', '--no-color', '-U0', '--diff-filter=b', commits.join('...')];
  return tool.execute(command, args, undefined, undefined, async child => {
    const changeRanges = new Map<string, [number, number][]>();
    assert(child.stdout !== null); if (child.stdout == null) return changeRanges;
    child.stdout.unpipe(process.stdout);
    const lines = [];
    for await (const line of readline.createInterface(child.stdout))
      /^([@]{2}|[+]{3})\s/.test(line) && lines.push(line);

    let name = '';
    for (const line of lines) {
      if (/^[+]{3}\s/.test(line)) {
        name = line.substring('+++ '.length);
        continue;
      }
      const metadata = ((/^@@ (.*) @@.*$/.exec(line) || [])[1] || '').split(' ');
      const [start, lines = 1] = metadata[metadata.length - 1].split(',').map(Number).map(Math.abs);
      changeRanges.set(name, (changeRanges.get(name) || ([] as Array<[number, number]>)).concat([[start, start + lines - 1]]));
    }
    return changeRanges;
  });
};

export type Transformers = [stream.Transform] | [stream.Transform, stream.Transform];

export type Finder = (paths: string) => Promise<() => AsyncGenerator<string, void, unknown>>

export const find = async (paths: string): Promise<() => AsyncGenerator<string, void, unknown>> => {
  const generator = async function* (): AsyncGenerator<string, void, unknown> {
    for (const path of paths.replace(/[\r\n]+/g, '\n').split('\n').filter(line => line !== '')) yield path;
  }
  return generator;
}

export abstract class StaticCodeAnalyzer {
  private readonly problemMatchers = {
    "problemMatcher": [
      {
        "owner": "analyze-result.tsv",
        "pattern": [
          {
            "regexp": "^\\[([^\\t]+)\\] Detected `([^\\t]+)` problem at line (\\d+), column (\\d+) of ([^\\t]+)\\t([^\\t]+)$",
            "file": 5,
            "line": 3,
            "column": 4,
            "severity": 1,
            "message": 6,
            "code": 2
          }
        ]
      }
    ]
  };

  protected initArgumentsSize: number;

  protected constructor(protected command: string, protected args: string[] = [], protected options: SpawnOptions = {}, protected exitStatusThreshold = 1, protected finder: Finder = find) {
    this.initArgumentsSize = [this.command].concat(this.args).map(tool.sizeOf).reduce((previous, current) => previous + current, 0);
  }

  protected abstract prepare(): Promise<unknown>;

  protected abstract createTransformStreams(): Transformers;

  private execute(args: string[], changeRanges: Map<string, [number, number][]>): Promise<number> {
    return tool.execute<number>(this.command, args, this.options, this.exitStatusThreshold, child => new Promise((resolve, reject) => {
      assert(child.stdout !== null);
      child.stdout && child.stdout.unpipe(process.stdout);
      const [prev = new stream.PassThrough(), next = prev]: stream.Transform[] = this.createTransformStreams().map(transformer => transformer.once('error', reject));
      debug('prev = %s, next = %s', prev, next);
      child.stdout && child.stdout.pipe(prev);
      next.pipe((() => {
        let count = 0;
        return new stream.Writable({
          objectMode: true,
          write: function (problem, _encoding, done) {
            const name = path.relative(process.cwd(), problem.file);
            const position = Number(problem.line);
            const ranges = changeRanges.get(name) || [];
            for (const [start, end] of ranges) if (position >= start && position <= end) {
              const message = [
                problem.severity,
                problem.code,
                position,
                Number(problem.column),
                name,
                problem.message,
              ].map(e => typeof e === 'number' ? e : (e === undefined ? '' : String(e)).replace(/\s+/g, ' '));
              console.log(`[%s] Detected \`%s\` problem at line %d, column %d of %s\t%s`, ...message);
              count += 1;
              break;
            }
            done();
          },
          final: function (done) {
            if (count > 0) {
              console.log(`Detected ${count} issue(s).`);
            }
            done();
            resolve(count > 0 ? 1 : 0);
          }
        });
      })()).once('error', reject);
    }));
  }

  async analyze(patterns: string = '.'): Promise<number> {
    console.log(`::group::Analyze code statically using ${this.command}`);
    try {
      await this.prepare();
      assert(process.env.GITHUB_BASE_REF, 'Environment variable `GITHUB_BASE_REF` is undefined.');
      assert(process.env.GITHUB_HEAD_REF, 'Environment variable `GITHUB_HEAD_REF` is undefined.');
      const changeRanges = await measureChangeRanges(process.env.GITHUB_BASE_REF || '', process.env.GITHUB_HEAD_REF || '');

      const matcher = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `-`)), 'problem-matcher.json');
      fs.writeFileSync(matcher, JSON.stringify(this.problemMatchers));
      console.log(`::add-matcher::${matcher}`);

      const maxArgsSize = tool.calculateMaxArgumentsSize(process);
      const promises: Promise<number>[] = [];
      const files: string[] = [];
      let size = this.initArgumentsSize;
      for await (const file of (await this.finder(patterns))()) {
        const length = tool.sizeOf(file);
        if ((length + size) > maxArgsSize) {
          promises.push(this.execute(this.args.concat(files), changeRanges));
          files.length = 0;
          size = this.initArgumentsSize;
        }
        files.push(file);
        size += length;
      }
      if (files.length) promises.push(this.execute(this.args.concat(files), changeRanges));
      console.log('::debug::%d promise(s)', promises.length);
      return await Promise.all(promises)
        .then(exitStatuses => exitStatuses.some(exitStatus => exitStatus > 0) ? 1 : 0)
        .finally(() => {
          console.log('::remove-matcher owner=analyze-result.tsv::');
        });
    } finally {
      console.log(`::endgroup::`);
    }
  }
}
