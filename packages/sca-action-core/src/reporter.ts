import stream from 'stream';
import util from 'util';
import { SpawnPrguments } from '@moneyforward/command';
import AnnotationReporter from './reporters/annotation-reporter';
import NopReporter from './reporters/nop-reporter';

const debug = util.debuglog('@moneyforward/sca-action-core/reporter');

export abstract class ReportWriter extends stream.Writable {
}

export type ChangeRanges = Map<string, [number, number][]>;

export type Resolver = {
  resolve: (file: string) => string;
}

export interface Problem {
  file: string;
  line: string | number;
  column?: string | number;
  severity?: string;
  message?: string;
  code?: string;
}

export type ReporterConstructor = {
  new(changeRanges: ChangeRanges, resolver: Resolver, commandPrguments: SpawnPrguments): Reporter;
}

export interface Reporter {
  initialize(): Promise<unknown>;
  finalize(): Promise<unknown>;
  createReportWriter(resolve: (value: Statistic | PromiseLike<Statistic>) => void, spawnPrguments: SpawnPrguments): ReportWriter;
}

export class Statistic {
  static add(previous: Statistic, current: Statistic): Statistic {
    return new Statistic(
      previous.numberOfProblems + current.numberOfProblems,
      previous.numberOfDetections + current.numberOfDetections,
      previous.numberOfFiles + current.numberOfFiles
    );
  }

  constructor(public readonly numberOfProblems = 0, public readonly numberOfDetections = 0, public readonly numberOfFiles = 0) { }
}

export class ReporterRepository {
  private static readonly defaultReporterType = AnnotationReporter;

  private static createMulticasterType(...ReporterTypes: ReporterConstructor[]): ReporterConstructor {
    debug('ReporterTypes: %s', ReporterTypes);
    return class Multicaster implements Reporter {
      private reporters: Reporter[];

      constructor(changeRanges: ChangeRanges, resolver: Resolver, commandPrguments: SpawnPrguments) {
        this.reporters = ReporterTypes
          .map(ReporterType => new ReporterType(changeRanges, resolver, commandPrguments))
      }

      initialize(): Promise<unknown> {
        return Promise.all(this.reporters.map(reporter => reporter.initialize()));
      }

      finalize(): Promise<unknown> {
        return Promise.all(this.reporters.map(reporter => reporter.finalize()));
      }

      createReportWriter(resolve: (value: Statistic | PromiseLike<Statistic>) => void, spawnPrguments: SpawnPrguments): ReportWriter {
        const statistics = new Map<Reporter, Statistic | PromiseLike<Statistic>>();
        const writers = this.reporters
          .map(reporter => reporter.createReportWriter((value: Statistic | PromiseLike<Statistic>) => {
            if (statistics.has(reporter)) return;
            statistics.set(reporter, value);
            if (statistics.size === writers.length) {
              Promise.all(statistics.values()).then(results => resolve(results.reduce(Statistic.add)));
            }
          }, spawnPrguments));
        const passthrough = new stream.PassThrough({ objectMode: true });
        for (const wirter of writers) stream.pipeline(passthrough, wirter, error => error && debug('%o', error));
        return passthrough;
      }
    }
  }

  private readonly repository = new Map<string | undefined, ReporterConstructor>([
    ReporterRepository.defaultReporterType,
    NopReporter
  ].map(c => [c.name, c]));

  set(reporterType: ReporterConstructor, name?: string): void {
    const reportTypeName = name || reporterType.name;
    debug('setting %s...', reportTypeName);
    this.repository.set(reportTypeName, reporterType);
  }

  get(notation?: string): ReporterConstructor {
    const parse = (notation?: string): ReporterConstructor[] => {
      return (notation || '').split(',')
        .map(name => name ? name : undefined)
        .map(name => this.repository.get(name) || ReporterRepository.defaultReporterType);
    };
    const [one, ...othors] = parse(notation);
    return othors.length > 0 ? ReporterRepository.createMulticasterType(one, ...othors) : one;
  }
}
