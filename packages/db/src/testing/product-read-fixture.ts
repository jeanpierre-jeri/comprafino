import { sql } from "drizzle-orm";
import { z } from "zod";
import { fixtureDatabase } from "./fixture-client.ts";

/** Controls only the dedicated comparison-read fixture in the parent's owned schema. */
export function productReadFixture(rawId: string | undefined) {
  const id = z.uuid().parse(rawId);
  const db = fixtureDatabase();

  return {
    async attempts() {
      const result = await db.execute(
        sql`select attempts from fixture_product_reads where product_id=${id}::uuid`,
      );
      return z.array(z.object({ attempts: z.number().int() })).parse(result.rows)[0]!.attempts;
    },

    async reset() {
      await db.execute(
        sql`update fixture_product_reads set attempts=0,fail_reads=false where product_id=${id}::uuid`,
      );
    },

    async failReads(fail: boolean) {
      await db.execute(
        sql`update fixture_product_reads set fail_reads=${fail} where product_id=${id}::uuid`,
      );
    },

    async setEligible(eligible: boolean) {
      await db.execute(
        sql`update canonical_product_listings set confidence=${eligible ? 1 : 0} where canonical_product_id=${id}::uuid`,
      );
    },
  };
}
