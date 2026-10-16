/** Match fetch aborts without pretending that the underlying local SQL was canceled.
 * The caller must track and settle the transport promise before disposing its schema.
 */
export function abortableFixtureFetch<T>(operation: Promise<T>, signal?: AbortSignal | null) {
  if (!signal) return operation;

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
    }
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
