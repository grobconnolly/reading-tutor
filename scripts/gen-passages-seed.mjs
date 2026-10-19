// Regenerates supabase/migrations/20261019000002_seed_library_passages.sql from src/lib/passages.ts,
// so the TypeScript library stays the single source of truth. Run: node scripts/gen-passages-seed.mjs
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { PASSAGES } = await import(resolve(root, "src/lib/passages.ts"));

const q = (s) => {
  if (s.includes("$p$")) throw new Error("passage contains the quoting tag");
  return `$p$${s}$p$`;
};

const rows = PASSAGES.map((p) =>
  `  (${q(p.id)}, ${p.level}, ${q(p.title)}, ${q(p.text)}, ${q(JSON.stringify(p.questions))}::jsonb, 'library')`,
).join(",\n");

const sql = `-- Seed: the ${PASSAGES.length} library passages (levels 1-7, two per level).
-- Generated from src/lib/passages.ts by scripts/gen-passages-seed.mjs. Do not edit by hand.
-- Upserts, so re-running it refreshes edited library text.

insert into public.passages (id, level, title, text, questions, source) values
${rows}
on conflict (id) do update
  set level = excluded.level,
      title = excluded.title,
      text = excluded.text,
      questions = excluded.questions,
      source = excluded.source;
`;

const out = resolve(root, "supabase/migrations/20261019000002_seed_library_passages.sql");
writeFileSync(out, sql);
console.log(`wrote ${out} (${PASSAGES.length} passages)`);
