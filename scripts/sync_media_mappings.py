#!/usr/bin/env python3
"""
sync_media_mappings.py — build public.media_id_map seed SQL.

Sources:
  ANIME: Fribb/anime-lists anime-list-mini.json (~6MB, weekly)
         has anilist_id + mal_id + simkl_id per row.
  MANGA: AniList GraphQL crawl (Page.media type:MANGA -> id, idMal).
         Simkl has no manga, so manga maps anilist<->mal only.

Output: single .sql file with batched
  INSERT ... ON CONFLICT (client_type, media_id) DO UPDATE
so re-running is idempotent and map_keys converge (they are
deterministic: prefer mal, then anilist, then simkl).

Usage:
  python3 scripts/sync_media_mappings.py --out /tmp/seed.sql
      --anime              include anime mappings from Fribb (default: on)
      --no-anime           skip anime
      --manga              include manga crawl (takes ~20 min, AniList rate limit)
      --manga-pages N      cap manga pages (0 = unlimited, default 0)
"""
import json
import re
import sys
import time
import urllib.request
import urllib.error

FRIBB_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json"
ANILIST_API = "https://graphql.anilist.co"

VALID_ID = re.compile(r"^[A-Za-z0-9_.\-:]+$")  # SQL + PostgREST safe
BATCH = 1000
# Cloudflare (AniList) blocks the default "Python-urllib/x" user-agent with 403.
USER_AGENT = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def sql_str(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def build_map_key(media_type: str, mal=None, anilist=None, simkl=None):
    """Deterministic group key: prefer mal, then anilist, then simkl."""
    if mal is not None:
        return f"{media_type}:mal:{mal}"
    if anilist is not None:
        return f"{media_type}:anilist:{anilist}"
    if simkl is not None:
        return f"{media_type}:simkl:{simkl}"
    return None


class Mapper:
    """Claims (client_type, media_id) -> map_key. First claim wins; conflicts skipped."""

    def __init__(self):
        self.claims = {}   # (client_type, media_id) -> map_key
        self.rows = set()  # (client_type, media_id, map_key, media_type)
        self.conflicts = 0

    def add(self, media_type: str, mal=None, anilist=None, simkl=None):
        ids = []
        for client, val in (("mal", mal), ("anilist", anilist), ("simkl", simkl)):
            if val is not None and str(val).strip().isdigit():
                ids.append((client, str(val)))
        if len(ids) < 2:
            return  # nothing to merge
        key = build_map_key(media_type, mal, anilist, simkl)
        if not key:
            return
        for client, i in ids:
            if not VALID_ID.match(i):
                continue
            claim = (client, i)
            prev = self.claims.get(claim)
            if prev is not None:
                if prev != key:
                    self.conflicts += 1
                continue  # first claim wins
            self.claims[claim] = key
            self.rows.add((client, i, key, media_type))

    def stats(self) -> str:
        by_client = {}
        groups = set()
        for c, _i, k, _m in self.rows:
            by_client[c] = by_client.get(c, 0) + 1
            groups.add(k)
        return (
            f"rows={len(self.rows)} groups={len(groups)} "
            f"by_client={by_client} conflicts_skipped={self.conflicts}"
        )


def load_fribb():
    print(f"⬇️  Downloading {FRIBB_URL} ...", flush=True)
    req = urllib.request.Request(FRIBB_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode("utf-8"))
    print(f"   {len(data)} anime entries", flush=True)
    return data


def seed_anime(mapper: Mapper):
    for row in load_fribb():
        mapper.add("anime", mal=row.get("mal_id"), anilist=row.get("anilist_id"), simkl=row.get("simkl_id"))


def seed_manga(mapper: Mapper, max_pages: int = 0):
    query = """
    query ($page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { lastPage hasNextPage }
        media(type: MANGA, sort: ID) { id idMal }
      }
    }"""
    page = 1
    last_page = None
    while True:
        body = json.dumps({"query": query, "variables": {"page": page}}).encode()
        req = urllib.request.Request(
            ANILIST_API,
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
        )
        payload = None
        for _attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    payload = json.loads(r.read().decode())
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    wait = int(e.headers.get("Retry-After", "10") or 10)
                    print(f"   429 on page {page}, waiting {wait}s", flush=True)
                    time.sleep(wait)
                    continue
                raise
        if payload is None:
            print(f"   giving up on page {page}", flush=True)
            return
        pg = payload.get("data", {}).get("Page", {})
        media = pg.get("media", [])
        info = pg.get("pageInfo", {})
        last_page = info.get("lastPage") or last_page
        for m in media:
            if m.get("idMal"):
                mapper.add("manga", mal=m["idMal"], anilist=m["id"])
        print(f"   manga page {page}/{last_page or '?'} (+{len(media)})", flush=True)
        if info.get("hasNextPage") is False or not media:
            break
        if max_pages and page >= max_pages:
            print(f"   --manga-pages cap reached ({max_pages})", flush=True)
            break
        page += 1
        time.sleep(1.4)  # stay under AniList 90 req/min with margin


def write_sql(mapper: Mapper, out_path: str):
    rows = sorted(mapper.rows)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("-- Generated by scripts/sync_media_mappings.py\n")
        f.write("BEGIN;\n")
        for i in range(0, len(rows), BATCH):
            chunk = rows[i: i + BATCH]
            values = ",\n".join(
                f"({sql_str(c)}, {sql_str(m)}, {sql_str(k)}, {sql_str(mt)})"
                for c, m, k, mt in chunk
            )
            f.write(
                "INSERT INTO public.media_id_map (client_type, media_id, map_key, media_type) VALUES\n"
                + values
                + "\nON CONFLICT (client_type, media_id) DO UPDATE\n"
                "SET map_key = EXCLUDED.map_key, media_type = EXCLUDED.media_type, updated_at = NOW();\n"
            )
        f.write("COMMIT;\n")
    print(f"📝 wrote {out_path} ({len(rows)} rows)", flush=True)


def main():
    args = sys.argv[1:]
    do_anime = "--no-anime" not in args
    do_manga = "--manga" in args
    max_pages = 0
    if "--manga-pages" in args:
        max_pages = int(args[args.index("--manga-pages") + 1])
    out = "/tmp/media_mappings_seed.sql"
    if "--out" in args:
        out = args[args.index("--out") + 1]

    mapper = Mapper()
    t0 = time.time()
    if do_anime:
        seed_anime(mapper)
        print(f"anime: {mapper.stats()}", flush=True)
    if do_manga:
        seed_manga(mapper, max_pages)
        print(f"anime+manga: {mapper.stats()}", flush=True)
    if not mapper.rows:
        print("❌ no rows produced — refusing to write SQL", flush=True)
        sys.exit(1)
    write_sql(mapper, out)
    print(f"✅ done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
