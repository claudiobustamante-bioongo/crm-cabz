// Genera supabase/migrations/ a partir de los archivos numerados NN_*.sql (sin los personales *b / gitignored),
// con el formato que entiende `supabase db push` / `supabase migration up`: <timestamp>_<nombre>.sql
// Uso: node scripts/migraciones.mjs   (idempotente; borra y regenera la carpeta)
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = "supabase", out = join(dir, "migrations");
const personales = new Set(readFileSync(".gitignore", "utf8").split("\n").filter((l) => l.startsWith("supabase/")).map((l) => l.replace("supabase/", "").trim()));
const files = readdirSync(dir).filter((f) => /^\d{2}[a-z]?_.*\.sql$/.test(f) && !personales.has(f)).sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
if (existsSync(out)) rmSync(out, { recursive: true }); mkdirSync(out);
files.forEach((f, i) => {
  const n = String(i + 1).padStart(4, "0");
  const nombre = f.replace(/^\d{2}[a-z]?_/, "").replace(/\.sql$/, "");
  const cuerpo = readFileSync(join(dir, f), "utf8");
  writeFileSync(join(out, `2026010100${n}_${nombre}.sql`), `-- generado desde supabase/${f} (no editar aquí; edita el original y corre node scripts/migraciones.mjs)\n${cuerpo}`);
});
console.log(`${files.length} migraciones en ${out}. Personales omitidos: ${[...personales].join(", ")}`);
