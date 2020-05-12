export interface Action<T, U> {
  execute: (args?: Iterable<T> | AsyncIterable<T>) => Promise<U>;
}
