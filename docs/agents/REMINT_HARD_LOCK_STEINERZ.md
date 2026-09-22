# Remint hard lock — SteinerZ / TLY-271 (2026-09-22 CT)

## Gate order (mandatory, stop at first match → attach-only)

Before minting **any** new TLY:

1. **Listing URL identical** (`listing_url`) — same listing link / Axial pursue URL / BBS path after normalize.
2. **Broker deal ID** (`source_id`) — Axial hex / `;id=`, BBS `q=`, V-AID, Transworld, Buildout slug, …
3. **Headline / aliases** (`title_source` then `alias`) — normalize + `alias_names`; title+source domain; alias overlap with shared geo|broker.
4. **Fingerprint confirm** (`fingerprint`) — teaser + broker + round(EBITDA|SDE) + geo.

If unsure → orphan to Tristan/Dirk. Never mint a second Review card for the same business at NDA/CIM/follow-up. Mid-pipeline → `duplicateOf` + `ingestDisposition` `attached`|`remint`.

Wired in:

- Flow: `web/lib/next/identity.ts` → `findIdentityMatch`
- Shelf: `pipeline/db.py` → `upsert` (URL → headline → fingerprint)

## SteinerZ lock (canonical **TLY-271** only)

Live attach-only POSTs to `POST /api/next/import` (no new Review cards):

- Alias stamp: `dealsNew=0`, `dealsUpdated=1`, `dealIds=[271]`
- Remint stamp TLY-240 / TLY-382: `dealsNew=0`, `dealsUpdated=2`, `dealIds=[271,271]`

Aliases merged onto `deals_next.alias_names` for TLY-271:

- SteinerZ
- Steiner Z
- SteinerZ Fabrication
- SteinerZ Fabrication LLC
- Steiner Z Fabrication
- SteinerZ Fabrication — Russellville MO Metal Fab
- SteinerZ Fabrication — Russellville MO Metal Fab — Russellville, MO
- Integrated Industrial Fabrication
- Integrated Industrial Fabrication Services Provider

Also stamped Axial listing URL / id `f8287cd110d64478b187f2df6709022b` onto the attach path (`source_deal_id` COALESCE + `source_ids`).

TLY-240 and TLY-382 remain Closed remint/dupe rows of TLY-271 (attach-only; no mint).

## Where aliases live

Postgres `deals_next.alias_names` (jsonb), joined by `findIdentityMatch` step 3. Not in shelf SQLite.
