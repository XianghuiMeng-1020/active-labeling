#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const API_BASE = process.env.API_BASE ?? "https://sentence-labeling-api.xmeng19.workers.dev";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const I18N_PATH = path.join(ROOT, "apps/web/src/lib/i18n.tsx");

async function getTaxonomyLabels() {
  const resp = await fetch(`${API_BASE}/api/taxonomy`);
  if (!resp.ok) throw new Error(`taxonomy request failed: ${resp.status}`);
  const data = await resp.json();
  return (data.labels ?? []).map((x) => x.label);
}

async function getI18nLabelKeys() {
  const content = await fs.readFile(I18N_PATH, "utf8");
  const regex = /"label\.([^"]+)"/g;
  const labels = new Set();
  let match;
  while ((match = regex.exec(content))) {
    labels.add(match[1]);
  }
  return labels;
}

async function main() {
  const [taxonomyLabels, i18nLabels] = await Promise.all([
    getTaxonomyLabels(),
    getI18nLabelKeys()
  ]);

  const missing = taxonomyLabels.filter((label) => !i18nLabels.has(label));
  const unused = [...i18nLabels].filter((label) => !taxonomyLabels.includes(label));

  console.log(`API_BASE=${API_BASE}`);
  console.log(`taxonomy labels: ${taxonomyLabels.length}`);
  console.log(`i18n label keys: ${i18nLabels.size}`);
  console.log("");
  if (missing.length) {
    console.log("Missing i18n keys for taxonomy labels:");
    for (const label of missing) console.log(`  - label.${label}`);
  } else {
    console.log("No missing i18n keys.");
  }
  console.log("");
  if (unused.length) {
    console.log("Unused i18n label keys:");
    for (const label of unused) console.log(`  - label.${label}`);
  } else {
    console.log("No unused i18n label keys.");
  }

  if (missing.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
