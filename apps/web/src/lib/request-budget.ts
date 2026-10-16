/** A cooperative deadline: fetch/body waits are canceled and late results rejected.
 * JavaScript cannot preempt synchronous CPU work; hosting provides the outer cap.
 */
export async function withinRequestBudget<T>(
  milliseconds: number,
  parent: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const expires = performance.now() + milliseconds;
  const timeout = () =>
    controller.abort(new DOMException("Request deadline exceeded", "TimeoutError"));
  const timer = setTimeout(timeout, milliseconds);
  let onAbort: (() => void) | undefined;

  try {
    signal.throwIfAborted();
    const canceled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const running = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation(signal);
    });
    const result = await Promise.race([running, canceled]);

    if (performance.now() >= expires) timeout();

    signal.throwIfAborted();

    return result;
  } finally {
    clearTimeout(timer);

    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
