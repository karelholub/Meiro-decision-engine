export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export const isTimeoutError = (value: unknown): value is TimeoutError => {
  return value instanceof TimeoutError;
};

export const withTimeout = async <T>(input: {
  timeoutMs: number;
  timeoutMessage?: string;
  task: (signal: AbortSignal) => Promise<T>;
}): Promise<T> => {
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs));
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new TimeoutError(timeoutMs, input.timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([input.task(controller.signal), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (!timedOut) {
      controller.abort();
    }
  }
};
