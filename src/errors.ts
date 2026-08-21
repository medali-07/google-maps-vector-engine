/**
 * Base class for every error this library throws deliberately.
 *
 * Catch this to distinguish a misconfiguration from an unrelated runtime
 * failure. Until 1.0 the constructor validated nothing at all - `docs/API.md`
 * showed a `try/catch` around it as the error-handling story, but there was
 * never anything to catch.
 */
export class MVTError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MVTError';
    // Required for `instanceof` to work when the build targets ES5, where
    // subclassing a built-in loses the prototype link.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An option passed to the `MVTSource` constructor is missing or unusable. */
export class MVTOptionsError extends MVTError {
  constructor(
    /** The option at fault, e.g. `'url'`. */
    public readonly option: string,
    message: string,
  ) {
    super(message);
    this.name = 'MVTOptionsError';
  }
}

/** Assert a condition, throwing an `MVTOptionsError` naming the option. */
export function assertOption(condition: boolean, option: string, message: string): asserts condition {
  if (!condition) {
    throw new MVTOptionsError(option, message);
  }
}
