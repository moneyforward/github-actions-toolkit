import fs from 'fs';
import os from 'os';
import path from "path";
import util from 'util';
import { SpawnPrguments } from '@moneyforward/command';
import { Reporter, Resolver, Statistic, ReportWriter, Problem, ChangeRanges } from "../reporter";

const debug = util.debuglog('@moneyforward/sca-action-core/reporters/annotation-reporter');

export default class AnnotationReporter implements Reporter {
  private static readonly problemMatcher = [
    {
      "owner": "@moneyforward/sca-action-core/reporters/annotation-reporter#0",
      "pattern": [
        {
          "regexp": /^\[([^\t]+)\] Detected(?:| `([^\t]+)`) problem at line (\d+)(?:|, column (\d+)) of ([^\t]+)\t([^\t]+)$/.toString(),
          "file": 5,
          "line": 3,
          "column": 4,
          "severity": 1,
          "message": 6,
          "code": 2
        }
      ]
    }
  ];

  private static readonly problemMatchers = JSON.stringify({
    "problemMatcher": AnnotationReporter.problemMatcher
  });

  private numberOfWriters = 0;

  constructor(private readonly changeRanges: ChangeRanges, private readonly resolver: Resolver, private readonly commandPrguments: SpawnPrguments) {
  }

  async initialize(): Promise<void> {
    const matcher = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), `-`)), 'problem-matcher.json');
    await fs.promises.writeFile(matcher, AnnotationReporter.problemMatchers);
    console.log(`::add-matcher::${matcher}`);
  }

  async finalize(): Promise<void> {
    for (const owner of AnnotationReporter.problemMatcher.map(({ owner }) => owner))
      console.log('::remove-matcher owner=%s::', owner);
  }

  createReportWriter(resolve: (value: Statistic) => void, spawnPrguments: SpawnPrguments): ReportWriter {
    const writerNumber = this.numberOfWriters += 1;
    return new class AnnotationWriter extends ReportWriter {
      private readonly writerNumber = writerNumber;
      private numberOfProblems = 0;
      private numberOfDetections = 0;
      constructor(reporter: AnnotationReporter) {
        super({
          objectMode: true,
          write: (problem: Problem, _encoding, done): void => {
            this.numberOfProblems += 1;
            const file = reporter.resolver.resolve(problem.file);
            const line = Number(problem.line);
            const ranges = reporter.changeRanges.get(file) || [];
            debug('%s:%d = %s', file, line, ranges);
            for (const [start, end] of ranges) if (line >= start && line <= end) {
              const column = Number(problem.column);
              const message = [
                problem.severity,
                problem.code === undefined ? 'the' : ` \`${problem.code}\``,
                line,
                Number.isNaN(column) ? '' : `, column ${column}`,
                file,
                problem.message,
              ].map(e => typeof e === 'number' ? e : (e === undefined ? '' : String(e)).replace(/\s+/g, ' '));
              console.log('[%s] Detected%s problem at line %d%s of %s\t%s', ...message);
              this.numberOfDetections += 1;
              break;
            }
            done();
          },
          final: (done): void => {
            const [, commandArgs] = reporter.commandPrguments;
            const [, spawnArgs] = spawnPrguments;
            const files = spawnArgs.slice(commandArgs.length);
            debug('AnnotationWriter # %d detected %d out of %d problems. (%d files)', this.writerNumber, this.numberOfDetections, this.numberOfProblems, files.length);
            done();
            resolve(new Statistic(this.numberOfProblems, this.numberOfDetections, files.length));
          }
        });
        debug('Created AnnotationWriter #%d', writerNumber);
      }
    }(this);
  }
}
