import stream from "stream";
import { SpawnPrguments } from "@moneyforward/command";
import { ChangeRanges, Reporter, ReportWriter, Resolver, Statistic } from "../reporter";

export default class NopReporter implements Reporter {
  constructor(private readonly changeRanges: ChangeRanges, private readonly resolver: Resolver, private readonly commandPrguments: SpawnPrguments) { }

  readonly initialize = (): Promise<unknown> => Promise.resolve();

  readonly finalize = (): Promise<unknown> => Promise.resolve();

  createReportWriter(resolve: (value: Statistic) => void): ReportWriter {
    return new stream.Writable({
      objectMode: true,
      write: (chunk, encoding, done): void => {
        done();
      },
      final: (done): void => {
        done();
        resolve(new Statistic());
      }
    });
  }
}
