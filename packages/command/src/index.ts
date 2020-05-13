import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import stream from 'stream';
import util from 'util';
import { stringify, reduce } from '@moneyforward/stream-util';

const debug = util.debuglog('@moneyforward/command');

type StdioOption = "pipe" | "ipc" | "ignore" | "inherit" | stream.Stream | number | null | undefined;

export interface Action<T, U> {
  execute(args?: Iterable<T> | AsyncIterable<T>): U | PromiseLike<U>;
}

export type CommandConstructor = {
  new <T>(
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
    promisify?: (child: ChildProcess, command: string, args: readonly string[], options: SpawnOptions) => Promise<T>,
    exitStatusThreshold?: number | ((exitStatus: number) => boolean),
    argumentsSizeMargin?: number
  ): Action<string, [T, number][]>;
}

export type SpawnPrguments = Parameters<typeof spawn>

export default class Command<T = void> implements Action<string, AsyncIterable<[T, number]>> {
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

  static async execute<T = void, U = [T, number]>(
    command: string,
    args: readonly string[] = [],
    options: SpawnOptions = {},
    exitStatusThreshold = 1,
    promisify?: (child: ChildProcess) => Promise<T>,
    evaluateExitStatus = (exitStatus: number): boolean => exitStatus < exitStatusThreshold,
    [reducer, initValue] = [(previous: U): U => previous, undefined]
  ): Promise<U> {
    const results = new Command<T>(command, args, options, promisify, evaluateExitStatus).execute();
    return reduce(results, reducer, initValue);
  }

  static async substitute(command: string, args: readonly string[] = [], options?: SpawnOptions, stdin?: StdioOption): Promise<string> {
    const results = new Command(command, args, Object.assign({}, options, { stdio: [stdin, 'pipe', 'ignore'] }), async child => {
      if (child.stdout === null) return '';
      child.stdout.unpipe(process.stdout);
      return stringify(child.stdout);
    }).execute();
    return reduce<[string, number], string[]>(results, (previous, [current]) => {
      return previous.concat(current);
    }, []).then(result => result.join().replace(/((\r\n)+|\n+)$/, '')).catch(() => '');
  }

  protected readonly initArgumentsSize: number;
  protected readonly evaluateExitStatus: (exitStatus: number) => boolean;

  constructor(
    protected readonly command: string,
    protected readonly args: readonly string[] = [],
    protected readonly options: SpawnOptions = {},
    protected readonly promisify?: (child: ChildProcess, ...spawnPrguments: SpawnPrguments) => Promise<T>,
    exitStatusThreshold: number | ((exitStatus: number) => boolean) = 1,
    argumentsSizeMargin = 0
  ) {
    this.initArgumentsSize = Command.calculateInitArgumentsSize(this.command, this.args, argumentsSizeMargin);
    this.evaluateExitStatus = typeof exitStatusThreshold === 'number' ? (exitStatus: number): boolean => exitStatus < exitStatusThreshold : exitStatusThreshold;
  }

  protected async configureArguments(args: string[]): Promise<string[]> {
    return this.args.concat(args);
  }

  private async _execute(parameters: string[]): Promise<[T, number]> {
    const args = await this.configureArguments(parameters);
    return new Promise((resolve, reject) => {
      let exitStatus: number | null | undefined;
      const spawnArgs: SpawnPrguments = [this.command, args, this.options];
      const child = spawn(...spawnArgs)
        .once('error', reject)
        .once('exit', code => exitStatus = code)
        .once('close', exitStatus => debug('`%s` command closed. (%d)', this.command, exitStatus));
      child.stdout && child.stdout.pipe(process.stdout);
      child.stderr && child.stderr.pipe(process.stderr);
      const promise: Promise<T | void> = this.promisify ? this.promisify(child, ...spawnArgs) : Promise.resolve();
      promise.catch(reject);
      const exitListener = (exitStatus: number | null): void => {
        if (exitStatus === null || !this.evaluateExitStatus(exitStatus)) return reject(exitStatus);
        promise.then(result => resolve([(result as T), exitStatus]));
      }
      if (exitStatus !== undefined) exitListener(exitStatus);
      child.once('exit', exitListener);
    });
  }

  async * execute(args?: Iterable<string> | AsyncIterable<string>): AsyncIterable<[T, number]> {
    let numberOfPromises = 0;
    const command = this.command;
    const execute = this._execute.bind(this);
    const promiseToExecuteCommand = async function* (args: string[]): AsyncIterable<[T, number]> {
      debug('%d: Promise to execute `%s` ', numberOfPromises += 1, command);
      yield execute(args);
    }
    if (args === undefined) {
      yield* promiseToExecuteCommand([]);
    } else {
      const maxArgsSize = Command.calculateMaxArgumentsSize();
      const buffer: string[] = [];
      let size = this.initArgumentsSize;
      for await (const arg of args) {
        const length = Command.sizeOf(arg);
        if ((length + size) > maxArgsSize) {
          yield* promiseToExecuteCommand(buffer);
          buffer.length = 0;
          size = this.initArgumentsSize;
        }
        buffer.push(arg);
        size += length;
      }
      if (buffer.length) yield* promiseToExecuteCommand(buffer);
    }
    debug('%s %d promise(s)', this.command, numberOfPromises);
  }
}
