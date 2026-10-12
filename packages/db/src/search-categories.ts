import { searchCategory } from "@comprafino/core";
import type { SearchCategoryId } from "@comprafino/core";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/** Membership uses acquired paths, never title guesses or matching associations. */
export function categoryListingPredicate(listingId: SQL, categoryId: SearchCategoryId | null): SQL {
  const category = searchCategory(categoryId);
  if (!category) return sql`true`;

  const departments = category.departments.map((department) => sql`${department.toLowerCase()}`);
  return sql`exists (
    select 1 from catalog_source_listings category_link
    join catalog_sources category_source on category_source.id=category_link.source_id
    where category_link.listing_id=${listingId} and category_source.active
      and lower(trim(split_part(category_source.name,' / ',1))) in (${sql.join(departments, sql`,`)})
  )`;
}
