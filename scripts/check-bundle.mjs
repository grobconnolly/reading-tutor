// Fails the build if a server-only secret shows up in the JavaScript shipped to browsers (.next/static).
// Runs automatically after `next build` (see "postbuild" in package.json). Acceptance check from spec §11.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const dir = resolve(root, ".next", "static");
if (!existsSync(dir)) {
  console.error("check-bundle: .next/static not found. Run `next build` first.");
  process.exit(1);
}

const SERVER_ONLY = ["SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "AZURE_SPEECH_KEY", "BREVO_API_KEY"];

/** KEY=VALUE lines from .env.local, if present (never printed). */
function envFile(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2].replace(/\s+#.*$/, "");
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = { ...envFile(".env"), ...envFile(".env.local"), ...process.env };
const needles = [
  ["sk-ant", "an Anthropic API key prefix"],
  ['"role":"service_role"', "a service-role JWT claim"],
  ...SERVER_ONLY.map((n) => [n, `the ${n} variable name`]),
];
for (const name of SERVER_ONLY) {
  const v = env[name];
  if (v && v.length >= 12) needles.push([v, `the value of ${name}`]);
}
// A service-role JWT carries its role in the base64 payload; check that encoding too.
const srClaim = Buffer.from('"role":"service_role"').toString("base64").replace(/=+$/, "");
needles.push([srClaim.slice(0, 20), "a base64-encoded service-role claim"]);

function* walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(js|mjs|css|json|txt)$/.test(f)) yield p;
  }
}

const hits = [];
let files = 0;
for (const file of walk(dir)) {
  files++;
  const text = readFileSync(file, "utf8");
  for (const [needle, what] of needles) if (text.includes(needle)) hits.push(`${file.slice(root.length + 1)} contains ${what}`);
}
if (files === 0) {
  console.error("check-bundle: FAILED. No client files found under .next/static; the build did not finish.");
  process.exit(1);
}
if (hits.length) {
  console.error(`check-bundle: FAILED. Secrets found in client files:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-bundle: OK. ${files} client files scanned, no server-only secrets found.`);
