import { evaluateMatching } from "./matching-evaluate.ts";
try {
  console.log(JSON.stringify(await evaluateMatching(), null, 2));
} catch {
  console.error("Matching evaluation failed. Check DATABASE_URL and pg_trgm migration.");
  process.exitCode = 1;
}
