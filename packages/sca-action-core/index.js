const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const stream = require('stream');
const { execute, stringify } = require('./tool');

exports.analyzeCodeStatically = async (command, args = [], options, transformers = [], prepare = Promise.resolve(), exitStatusThreshold = 1) => {
  await prepare;
  console.log(`::group::Analyze code statically using ${command}`);
  return execute(command, args, options, child => new Promise(async (resolve, reject) => {
    child.stdout.unpipe(process.stdout);
    const [prev = new stream.PassThrough(), next = prev] = transformers.map(transformer => transformer.once('error', reject));
    child.stdout.pipe(prev);
    measureChangeRanges(process.env.GITHUB_BASE_REF, process.env.GITHUB_HEAD_REF).then(changeRanges => {
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
  }), exitStatusThreshold)
    .finally(() => console.log(`::endgroup::`));
};

const measureChangeRanges = async (baseRef, headRef) => {
  const command = 'git';
  const remote = await execute(command, ['remote', '-v'], undefined, async child => {
    child.stdout.unpipe(process.stdout);
    const lines = [];
    for await (const line of readline.createInterface(child.stdout))
      if (/\bgithub\.com\b/.test(line) && / \(fetch\)$/.test(line))
        lines.push(line);
    return lines.map(line => line.split('\t', 1)[0])[0];
  });
  const commits = await [baseRef, headRef]
    .map(ref =>
      () => execute(command, ['rev-parse', '--verify', '-q', ref], undefined, async child => {
        child.stdout.unpipe(process.stdout);
        return stringify(child.stdout);
      }).catch(async () => {
        await execute(command, ['fetch', '--depth=1', '-q', remote, ref]);
        return execute(command, ['rev-parse', '--verify', '-q', `${remote}/${ref}`], undefined, async child => {
          child.stdout.unpipe(process.stdout);
          return stringify(child.stdout);
        });
      }).then(buffer => buffer.toString().trim())
    )
    .reduce((promise, executor) => promise.then(async commits => commits.concat(await executor())), Promise.resolve([]));
  const args = ['--no-pager', 'diff', '--no-prefix', '--no-color', '-U0', '--diff-filter=b', commits.join('...')];
  return execute(command, args, undefined, async child => {
    child.stdout.unpipe(process.stdout);
    const lines = [];
    for await (const line of readline.createInterface(child.stdout))
      /^([@]{2}|[+]{3})\s/.test(line) && lines.push(line);

    const changeRanges = new Map();
    let name;
    for (const line of lines) {
      if (/^[+]{3}\s/.test(line)) {
        name = line.substring('+++ '.length);
        continue;
      }
      const metadata = ((/^@@ (.*) @@.*$/.exec(line) || [])[1] || '').split(' ');
      const [start, lines = 1] = metadata[metadata.length - 1].split(',').map(Number).map(Math.abs);
      changeRanges.set(name, (changeRanges.get(name) || []).concat([[start, start + lines - 1]]));
    }
    return changeRanges;
  });
};
