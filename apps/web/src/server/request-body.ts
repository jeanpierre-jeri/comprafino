// 50 items with maximum labels/query/profile and JSON-escaped Unicode fit below
// 128 KiB, including IDs, timestamps, quantities and conservative headroom.
export const shoppingListBodyBytes = 128 * 1024;

export async function boundedJson(
  request: Request,
): Promise<{ body: unknown } | { status: 400 | 413 }> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > shoppingListBodyBytes) {
    await request.body?.cancel().catch(() => {});
    return { status: 413 };
  }
  if (!request.body) return { status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > shoppingListBodyBytes) {
        await reader.cancel().catch(() => {});
        return { status: 413 };
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    return { body };
  } catch {
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
}
