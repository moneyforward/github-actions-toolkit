import { strict as assert } from 'assert';
import { SpawnOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import stream from 'stream';
import * as tool from './tool';

export { tool };

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

export const analyzeCodeStatically = async (command: string, args = [], options: SpawnOptions = {}, transformers: stream.Transform[] = [], prepare = Promise.resolve(), exitStatusThreshold = 1) => {
  await prepare;
  console.log(`::group::Analyze code statically using ${command}`);
  return tool.execute<number>(command, args, options, exitStatusThreshold, child => new Promise((resolve, reject) => {
    assert(child.stdout !== null);
    child.stdout && child.stdout.unpipe(process.stdout);
    const [prev = new stream.PassThrough(), next = prev]: stream.Transform[]  = transformers.map(transformer => transformer.once('error', reject));
    child.stdout && child.stdout.pipe(prev);
    assert(process.env.GITHUB_BASE_REF, 'Environment variable `GITHUB_BASE_REF` is undefined.');
    assert(process.env.GITHUB_HEAD_REF, 'Environment variable `GITHUB_HEAD_REF` is undefined.');
    measureChangeRanges(process.env.GITHUB_BASE_REF || '', process.env.GITHUB_HEAD_REF || '').then(changeRanges => {
      next.pipe((() => {
        const problemMatchers = {
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
        let count = 0;
        let isReady = false;
        return new stream.Writable({
          objectMode: true,
          write: function (problem, encoding, done) {
            if (!isReady) {
              const matcher = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `-`)), 'problem-matcher.json');
              fs.writeFileSync(matcher, JSON.stringify(problemMatchers));
              console.log(`::add-matcher::${matcher}`);
              isReady = true;
            }
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
            console.log('::remove-matcher owner=analyze-result.tsv::');
            if (count > 0) {
              console.log(`Detected ${count} issue(s).`);
            }
            done();
            resolve(count > 0 ? 1 : 0);
          }
        });
      })()).once('error', reject);
    });
  }))
    .finally(() => console.log(`::endgroup::`));
};
