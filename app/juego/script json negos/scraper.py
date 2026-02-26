import requests
import json
from datetime import date, datetime

TODAY = date(2026, 2, 25)

SPARQL = """
SELECT ?person ?personLabel ?givenNameLabel ?birthDate ?deathDate ?citizenshipLabel ?sitelinks WHERE {
  ?person wdt:P31 wd:Q5 ;
          wdt:P172 wd:Q817393 ;
          wdt:P569 ?birthDate ;
          wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?person wdt:P570 ?deathDate . }
  OPTIONAL { ?person wdt:P735 ?givenName . }
  OPTIONAL { ?person wdt:P27  ?citizenship . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
ORDER BY DESC(?sitelinks)
LIMIT 200
"""

def parse_iso_date(s: str) -> date:
    # Ejemplos WDQS: "1961-08-04T00:00:00Z"
    return datetime.fromisoformat(s.replace("Z", "+00:00")).date()

def calc_age(born: date, ref: date) -> int:
    return ref.year - born.year - ((ref.month, ref.day) < (born.month, born.day))

def qid_from_uri(uri: str) -> str:
    # "http://www.wikidata.org/entity/Q76" -> "Q76"
    return uri.rsplit("/", 1)[-1]

def first_name_fallback(full_name: str) -> str:
    # Si no hay givenName, pillamos primera “palabra”
    return full_name.strip().split(" ")[0] if full_name.strip() else full_name

headers = {
    "User-Agent": "json-people-generator/1.0 (contact: example@example.com)",
    "Accept": "application/sparql-results+json",
}

r = requests.get(
    "https://query.wikidata.org/sparql",
    params={"format": "json", "query": SPARQL},
    headers=headers,
    timeout=60,
)
r.raise_for_status()
data = r.json()

# Agrupar por persona (porque puede duplicarse por múltiples ciudadanías/nombres)
by_person = {}
for b in data["results"]["bindings"]:
    person_uri = b["person"]["value"]
    qid = qid_from_uri(person_uri)

    name = b.get("personLabel", {}).get("value", "").strip()
    given = b.get("givenNameLabel", {}).get("value", "").strip()
    birth = parse_iso_date(b["birthDate"]["value"])
    death_raw = b.get("deathDate", {}).get("value")
    death = parse_iso_date(death_raw) if death_raw else None
    citizenship = b.get("citizenshipLabel", {}).get("value", "").strip()
    sitelinks = int(b["sitelinks"]["value"])

    rec = by_person.get(qid)
    if not rec:
        by_person[qid] = {
            "qid": qid,
            "name": name,
            "given": given,
            "birth": birth,
            "death": death,
            "citizenship": citizenship,
            "sitelinks": sitelinks,
        }
    else:
        # Mantener el mayor sitelinks por si acaso
        rec["sitelinks"] = max(rec["sitelinks"], sitelinks)
        # Rellenar huecos
        if not rec["given"] and given:
            rec["given"] = given
        if not rec["citizenship"] and citizenship:
            rec["citizenship"] = citizenship
        if not rec["death"] and death:
            rec["death"] = death

# Quedarnos con top 100 por sitelinks
people = sorted(by_person.values(), key=lambda x: x["sitelinks"], reverse=True)[:100]

out = []
for i, p in enumerate(people, start=1):
    ref_date = p["death"] if p["death"] else TODAY
    age = calc_age(p["birth"], ref_date)

    alias = p["given"] if p["given"] else first_name_fallback(p["name"])
    country_es = p["citizenship"] if p["citizenship"] else "Desconocida"

    out.append({
        "id": str(i),
        "name": p["name"],
        "aliases": [alias],
        "image": None,
        "age": age,
        "handsome": 0,          # pendiente de vuestro criterio/fuente
        "popularity": p["sitelinks"],  # proxy objetivo de “fama global”
        "tez": 0,               # pendiente
        "country": country_es
    })

with open("people_100.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print("OK -> people_100.json generado con", len(out), "personas")