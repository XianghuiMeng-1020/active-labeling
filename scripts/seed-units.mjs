import fs from "node:fs/promises";

const [filePath, apiBase = "http://127.0.0.1:8787", adminToken = "dev-admin-token"] = process.argv.slice(2);
const BATCH_SIZE = 80; // 每批条数，避免 Worker 单次执行超时（2940 条会触发 500）

if (!filePath) {
  console.error("Usage: node scripts/seed-units.mjs <jsonl-file> [apiBase] [adminToken]");
  process.exit(1);
}

const content = await fs.readFile(filePath, "utf-8");
const units = content
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

let imported = 0;
for (let i = 0; i < units.length; i += BATCH_SIZE) {
  const batch = units.slice(i, i + BATCH_SIZE);
  const response = await fetch(`${apiBase}/api/admin/units/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`
    },
    body: JSON.stringify({ units: batch })
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`Import failed at batch ${Math.floor(i / BATCH_SIZE) + 1} (units ${i + 1}-${i + batch.length}):`, text);
    process.exit(1);
  }
  imported += batch.length;
  console.log(`Imported ${imported}/${units.length}...`);
}

console.log("Imported units:", imported);
