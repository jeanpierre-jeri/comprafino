import { withinRequestBudget } from "../lib/request-budget.ts";
import { publicRequestPolicy } from "../lib/public-request-policy.ts";

// 50 items with maximum labels/query/profile and JSON-escaped Unicode fit below
// 128 KiB, including IDs, timestamps, quantities and conservative headroom.
export const shoppingListBodyBytes = 128 * 1024;

export async function boundedJson(
  request: Request,
  signal: AbortSignal = request.signal,
  budgetMs: number = publicRequestPolicy.bodyMs,
): Promise<{ body: unknown } | { status: 400 | 408 | 413 }> {
  const declared = request.headers.get("content-length");

  if (declared && /^\d+$/u.test(declared) && Number(declared) > shoppingListBodyBytes) {
    void request.body?.cancel().catch(() => {});

    return { status: 413 };
  }

  if (!request.body) return { status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    return await withinRequestBudget(budgetMs, signal, async (bodySignal) => {
      const cancel = () => {
        void reader.cancel().catch(() => {});
      };
      bodySignal.addEventListener("abort", cancel, { once: true });
      try {
        for (;;) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          bytes += value.byteLength;

          if (bytes > shoppingListBodyBytes) {
            void reader.cancel().catch(() => {});

            return { status: 413 as const };
          }

          chunks.push(value);
        }

        bodySignal.throwIfAborted();
        const buffer = new Uint8Array(bytes);
        let offset = 0;

        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));

        return { body };
      } catch {
        return { status: 400 as const };
      } finally {
        bodySignal.removeEventListener("abort", cancel);
      }
    });
  } catch {
    void reader.cancel().catch(() => {});
    return { status: 408 };
  } finally {
    reader.releaseLock();
  }
}
