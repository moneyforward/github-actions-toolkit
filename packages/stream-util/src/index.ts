import stream from 'stream';

export * as transform from './transform';

export async function* concat<T>(...args: AsyncIterable<T>[]): AsyncIterable<T> {
  for (const asyncIterable of args)
    yield* asyncIterable;
}

export type Mapper<T, U = T> = (value: T, index: number) => U | PromiseLike<U>;
export async function* map<T, U = T>(asyncIterable: AsyncIterable<T>, mapper: Mapper<T, U>): AsyncIterable<U> {
  let index = -1;
  for await (const value of asyncIterable) yield mapper(value, index += 1);
}

export type Predicate<T> = (value: T, index: number) => boolean;
export async function* filter<T>(asyncIterable: AsyncIterable<T>, predicate: Predicate<T>): AsyncIterable<T> {
  let index = -1;
  for await (const value of asyncIterable) if (predicate(value, index += 1)) yield value;
}

export type Reducer<T, U = T> = (previous: U, current: T, index: number) => U;
export async function reduce<T>(asyncIterable: AsyncIterable<T>, reducer: Reducer<T>): Promise<T>;
export async function reduce<T>(asyncIterable: AsyncIterable<T>, reducer: Reducer<T>, initValue: T): Promise<T>;
export async function reduce<T, U>(asyncIterable: AsyncIterable<T>, reducer: Reducer<T, U>, initValue: U): Promise<U>;
export async function reduce<T, U = T>(asyncIterable: AsyncIterable<T>, reducer: Reducer<T, U>, ...initValue: [] | [U]): Promise<U> {
  const iterator = asyncIterable[Symbol.asyncIterator]();
  let next;
  if ((next = await iterator.next()).done) {
    if (initValue.length === 0) {
      throw new TypeError('Reduce of empty array with no initial value');
    } else {
      return initValue[0];
    }
  }
  let index = 0;
  let previous: U = initValue.length === 0 ? next.value : reducer(initValue[0], next.value, index);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if ((next = await iterator.next()).done) return previous;
    previous = reducer(previous, next.value, index += 1);
  }
}

export async function first<T>(asyncIterable: AsyncIterable<T>): Promise<T | undefined> {
  for await (const value of asyncIterable) return value;
}

export async function count<T = unknown>(asyncIterable: AsyncIterable<T>): Promise<number> {
  return reduce(asyncIterable, previous => previous + 1, 0);
}

export async function arrayify<T>(asyncIterable: AsyncIterable<T>): Promise<T[]> {
  return reduce<T, T[]>(asyncIterable, (array, value) => {
    array.push(value);
    return array;
  }, [])
}

async function _stringify(readable: stream.Readable): Promise<string> {
  const isObjectStream = (readable: stream.Readable): boolean => readable.readableObjectMode;
  const isTextStream = (readable: stream.Readable): boolean => {
    interface Readable extends stream.Readable {
      readableEncoding?: string | null;
      _readableState?: {
        encoding: string | null;
      };
    }
    function readableEncoding(readable: Readable): string | null {
      const encoding = readable.readableEncoding;
      if (encoding !== undefined) return encoding;
      return readable._readableState ? readable._readableState.encoding : null
    }
    return readableEncoding(readable) !== null;
  };

  if (isObjectStream(readable) || isTextStream(readable)) {
    return reduce(readable, (previous, current) => previous + String(current), '');
  } else {
    const asyncIterable: AsyncIterable<Buffer> = readable;
    return Buffer.concat(await arrayify(asyncIterable)).toString();
  }
}

export async function stringify<T = unknown>(asyncIterable: AsyncIterable<T>): Promise<string> {
  if (asyncIterable instanceof stream.Readable) return _stringify(asyncIterable);
  return reduce(asyncIterable, (previous, current) => previous + String(current), '');
}

export async function* of<T>(...values: (T | PromiseLike<T>)[]): AsyncIterable<T> {
  yield* values;
}
