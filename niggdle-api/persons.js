const fs = require("fs");

const API = "https://epsteinexposed.com/api/v2";

async function exportPersonsToJson() {
  const resp = await fetch(`${API}/export/persons?format=json`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const payload = await resp.json();
  const persons = Array.isArray(payload) ? payload : (payload.data ?? []);

  const byId = new Map();

  for (const p of persons) {
    const id = p.id ?? p.slug;
    if (!id) continue;

    byId.set(id, {
      id,
      slug: p.slug ?? id,
      name: p.name,
      aliases: p.aliases ?? [],
      category: p.category,
      shortBio: p.shortBio ?? null,
      description: p.description ?? null,
      nationality: p.nationality ?? null,
      notablePositions: p.notablePositions ?? [],
      blackBookEntry: p.blackBookEntry ?? null,
      blackBookPhones: p.blackBookPhones ?? null,
      tags: p.tags ?? [],
      imageUrl: p.imageUrl ?? null,
      flightCount: p.flightCount ?? null,
      documentCount: p.documentCount ?? null,
      connectionCount: p.connectionCount ?? null,
      emailCount: p.emailCount ?? null
    });
  }

  return Array.from(byId.values());
}

async function main() {
  const data = await exportPersonsToJson();

  fs.writeFileSync(
    "persons.json",
    JSON.stringify(data, null, 2),
    "utf-8"
  );

  console.log("Exportado:", data.length, "personas");
}

main().catch(console.error);