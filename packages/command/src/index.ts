import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import os from 'os';
import stream from 'stream';
import util from 'util';
import { arrayify, reduce, stringify, Reducer } from '@moneyforward/stream-util';

const debug = util.debuglog('@moneyforward/command');

type StdioOption = "pipe" | "ipc" | "ignore" | "inherit" | stream.Stream | number | null | undefined;

export interface Action<T, U> {
  execute(args?: Iterable<T> | AsyncIterable<T>): U;
}

type Iterate<T> = (child: ChildProcess, ...spawnPrguments: SpawnPrguments) => Iterable<T> | AsyncIterable<T>;
type EvaluateExitStatus = number | ((exitStatus: number) => boolean);

export type CommandConstructor = {
  new <T>(
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
    iterate?: Iterate<T>,
    exitStatusThreshold?: EvaluateExitStatus,
    argumentsSizeMargin?: number
  ): Action<string, AsyncIterable<T>>;
};

export type SpawnPrguments = Parameters<typeof spawn>;

export default class Command<T = void> implements Action<string, AsyncIterable<T>> {
  static readonly defaultParallelism = os.cpus().length;

  protected static sizeOf(value: string): number {
    return Buffer.from(value).length;
  }

  private static sizeOfEnvironment(env: NodeJS.ProcessEnv): number {
    return Object.entries(env).map(([key, value]) => Command.sizeOf(`${key}=${value}`))
      .reduce((previous, current) => previous + current, 0);
  }

  private static calculateMaxArgumentsSize(process: NodeJS.Process = global.process): number {
    return process.platform === 'win32' ? 8_191 : (131_072 - 2_048 - Command.sizeOfEnvironment(process.env));
  }

  protected static calculateInitArgumentsSize(command: string, args: readonly string[], argumentsSizeMargin: number): number {
    return [command].concat(args)
      .map(Command.sizeOf)
      .reduce((previous, current) => previous + current)
      + Math.max(0, argumentsSizeMargin);
  }

  static async execute(command: string, args?: readonly string[], options?: SpawnOptions, evaluateExitStatus?: EvaluateExitStatus): Promise<void>;
  static async execute<T = void>(command: string, args?: readonly string[], options?: SpawnOptions, evaluateExitStatus?: EvaluateExitStatus, iterate?: Iterate<T>): Promise<T>;
  static async execute<T = void, U = T>(
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
    evaluateExitStatus?: EvaluateExitStatus,
    iterate?: Iterate<T>,
    ...reduceArguments: [Reducer<T, U>] | [Reducer<T, U>, U]
  ): Promise<U>;
  static async execute<T = void, U = T>(
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
    evaluateExitStatus?: EvaluateExitStatus,
    iterate?: Iterate<T>,
    ...reduceArguments: [] | [Reducer<T, U>] | [Reducer<T, U>, U]
  ): Promise<U | void> {
    const results = new Command<T>(command, args, options, iterate, evaluateExitStatus).execute();
    if (!iterate) return;
    switch (reduceArguments.length) {
      case 0:
        return reduce<T, U>(results, previous => previous);

      case 1:
        {
          const [reducer] = reduceArguments;
          return reduce(results, reducer);
        }

      default:
        {
          const [reducer, initValue] = reduceArguments;
          return reduce(results, reducer, initValue);
        }
    }
  }

  static async substitute(command: string, args?: readonly string[], options?: SpawnOptions, stdin?: StdioOption): Promise<string> {
    const results = new Command(command, args, Object.assign({}, options, { stdio: [stdin, 'pipe', 'ignore'] }), async function* (child) {
      if (child.stdout === null) return;
      child.stdout.unpipe(process.stdout);
      yield stringify(child.stdout);
    }).execute();
    return arrayify(results)
      .then(results => results.join().replace(/((\r\n)+|\n+)$/, ''))
      .catch(error => {
        debug('%s', error);
        return '';
      });
  }

  protected readonly initArgumentsSize: number;
  protected readonly evaluateExitStatus: (exitStatus: number) => boolean;
  protected readonly parallelism = Command.defaultParallelism;
  protected readonly argumentCountThreshold = Number.POSITIVE_INFINITY;

  constructor(
    protected readonly command: string,
    protected readonly args: readonly string[] = [],
    protected readonly options: SpawnOptions = {},
    protected readonly iterate: (child: ChildProcess, ...spawnPrguments: SpawnPrguments) => Iterable<T> | AsyncIterable<T> = (): never[] => [],
    exitStatusThreshold: number | ((exitStatus: number) => boolean) = 1,
    argumentsSizeMargin = 0
  ) {
    this.initArgumentsSize = Command.calculateInitArgumentsSize(this.command, this.args, argumentsSizeMargin);
    this.evaluateExitStatus = typeof exitStatusThreshold === 'number' ? (exitStatus: number): boolean => exitStatus < exitStatusThreshold : exitStatusThreshold;
  }

  protected async configureArguments(args: string[]): Promise<string[]> {
    return this.args.concat(args);
  }

  private async * spawn(...parameters: string[]): AsyncGenerator<T, number, undefined> {
    const args = await this.configureArguments(parameters);
    const spawnArgs: SpawnPrguments = [this.command, args, this.options];
    const child = spawn(...spawnArgs);
    child.stdout && child.stdout.pipe(process.stdout);
    child.stderr && child.stderr.pipe(process.stderr);
    const promise = new Promise<number>((resolve, reject) => {
      child
        .once('error', reject)
        .once('close', exitStatus => (this.evaluateExitStatus(exitStatus) ? resolve : reject)(exitStatus));
    });
    yield* this.iterate(child, ...spawnArgs);
    return await promise;
  }

  async * execute(args?: Iterable<string> | AsyncIterable<string>): AsyncIterable<T> {
    debug('parallelism: %d', this.parallelism);
    const queue: AsyncIterable<T>[] = [];
    async function* drain(queue: AsyncIterable<T>[], threshold: number): AsyncIterable<T> {
      const values = queue.length < threshold ? [] : queue.splice(0);
      debug('drain %d values.', values.length);
      for (const value of values) yield* value;
    }

    let numberOfProcesses = 0;
    const spawnProcess = (args: string[], threshold = 0): AsyncIterable<T> => {
      queue.push(this.spawn(...args));
      debug('%d: spawn `%s` (arguments length: %d)', numberOfProcesses += 1, this.command, args.length);
      return drain(queue, threshold);
    }

    try {
      if (args === undefined) {
        yield* spawnProcess([]);
        return;
      }

      const maxArgsSize = Command.calculateMaxArgumentsSize();
      const buffer: string[] = [];
      let size = this.initArgumentsSize;
      let count = 0;
      for await (const arg of args) {
        const length = Command.sizeOf(arg);
        if ((length + size) > maxArgsSize || (count + 1) > this.argumentCountThreshold) {
          yield* spawnProcess(buffer, this.parallelism);
          buffer.length = 0;
          size = this.initArgumentsSize;
          count = 0;
        }
        buffer.push(arg);
        size += length;
        count += 1;
      }
      if (buffer.length) yield* spawnProcess(buffer);
    } finally {
      debug('%s %d process(es)', this.command, numberOfProcesses);
    }
  }
}
