import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import stream from 'stream';
import { StringDecoder } from 'string_decoder';

export function sizeOf(value: string): number {
  return Buffer.from(value).length;
}

function sizeOfEnvironment(env: NodeJS.ProcessEnv): number {
  return Object.keys(env)
    .map(key => sizeOf(`${key}=${env[key]} || '`))
    .reduce((previous, current) => previous + current, 0);
}

export function calculateMaxArgumentsSize(process: NodeJS.Process) {
  return process.platform === 'win32' ? 8_191 : (131_072 - 2_048 - sizeOfEnvironment(process.env));
}

export const execute = <T>(command: string, args: string[] = [], options: SpawnOptions = {}, exitStatusThreshold = 1, callback?: (child: ChildProcess) => Promise<T>, evaluateExitStatus = (exitStatus: number) => exitStatus < exitStatusThreshold): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    let exitStatus: number | null | undefined;
    const child = spawn(command, args, options).once('error', reject).once('exit', code => exitStatus = code);
    child.stdout && child.stdout.pipe(process.stdout);
    child.stderr && child.stderr.pipe(process.stderr);
    const promise: Promise<T | undefined> = callback ? callback(child) : Promise.resolve(undefined);
    const exitListener = async (exitStatus: number | null) =>
      exitStatus === null || !evaluateExitStatus(exitStatus) ? reject(exitStatus) : resolve(await promise);
    if (exitStatus !== undefined) exitListener(exitStatus);
    child.once('exit', exitListener);
  });
}

export async function stringify (readable: stream.Readable) {
  const isObjectStream = (readable: stream.Readable) => readable.readableObjectMode;
  const isTextStream = (readable: stream.Readable) => {
    function readableEncoding(readable: stream.Readable) {
      const encoding = (readable as any).readableEncoding;
      if (encoding !== undefined) return encoding;
      return (readable as any)._readableState ? (readable as any)._readableState.encoding : null
    }
    return readableEncoding(readable) !== null;
  };

  if (isObjectStream(readable) || isTextStream(readable)) {
    let text = '';
    for await (const buffer of readable) text += buffer.toString();
    return text.trim();
  } else {
    const buffers: Buffer[] = [];
    for await (const buffer of readable) buffers.push(buffer);
    return Buffer.concat(buffers).toString().trim();
  }
}

type StdioOption = "pipe" | "ipc" | "ignore" | "inherit" | stream.Stream | number | null | undefined;

export const substitute = (command: string, args: string[] = [], options?: SpawnOptions, stdin?: StdioOption) => new Promise<string>((resolve, reject) => {
  const child = spawn(command, args, Object.assign({}, options, { stdio: [stdin, 'pipe', 'ignore'] }))
    .once('error', reject);
  if (child.stdout === null) return resolve('');
  stringify(child.stdout).then(resolve).catch(reject);
});

export const installGem = async (isStrict = true, ...gemNames: string[]) =>
  (async () => { console.log(`::group::Installing gems...`); })().then(async () => {
    return await Promise.all([
      (async () => {
        const gems = await (async (...gemNames) => {
          const gems = new Map<string, string | undefined>(gemNames.map(gem => [gem, undefined]));

          const filename = 'Gemfile.lock';
          if (!fs.existsSync(filename)) return gems;

          const filter = new RegExp(`^ {4}(${gemNames.map(name => isStrict ? name : name + '\\b[\\w-]*').join('|')}) \\((.*)\\)$`);
          for await (const line of readline.createInterface(fs.createReadStream(filename))) {
            const [matches, key, value] = (filter.exec(line) || []);
            if (matches) gems.set(key, value);
          }
          return gems;
        })(...gemNames);

        await (async (gems, ...options: string[]) => {
          const args = ['install'].concat(options);
          for (const [gem, version] of gems) args.push(`${gem}${(version && ':' + version) || ''}`);
          return execute<void>('gem', args);
        })(gems, '-N', '--user-install');
        return gems;
      })(),
      (async () => {
        const gempath = await substitute('gem', ['environment', 'gempath']);
        const paths = (gempath ? gempath.split(path.delimiter) : []).map(gemdir => path.join(gemdir, 'bin'));
        process.env['PATH'] = paths.concat(process.env.PATH || '').join(path.delimiter);
      })()
    ]).then(([gems,]) => gems);
  }).finally(() => console.log(`::endgroup::`));

export class LineTransformStream extends stream.Transform {
  private readonly decoder: StringDecoder;
  private buffer: string;

  constructor(encoding?: string) {
    super({ writableObjectMode: true });
    this.decoder = new StringDecoder(encoding);
    this.buffer = '';
  }

  _transform(chunk: Buffer, encoding: string, done: stream.TransformCallback): void {
    try {
      const text = this.decoder.write(chunk);
      const lines = (this.buffer + text).split(os.EOL);
      const last = lines.pop();
      for (const line of lines) this.push(line);
      this.buffer = last || '';
      done();
    } catch (error) {
      done(error);
    }
  }

  _flush(done: stream.TransformCallback): void {
    try {
      const text = this.decoder.end();
      const lines = (this.buffer + text).split(os.EOL);
      const last = lines.pop();
      for (const line of lines) this.push(line);
      if (last && last.length) this.push(last);
      done();
    } catch (error) {
      done(error);
    }
  }
}
