# Design Decision Memory

Design decisions for the MMM app are stored in the shared Obsidian vault, not in ad-hoc chat threads.

## Canonical Location

- Vault root: `/Users/kh/paperclip`
- Decision summary: `/Users/kh/paperclip/life/resources/design-decisions/summary.md`
- Decision facts: `/Users/kh/paperclip/life/resources/design-decisions/items.yaml`

## Recording Rule

Record each durable product, UX, or architecture decision as one atomic fact in `items.yaml` using the vault schema:

- `id`
- `fact`
- `category`
- `timestamp`
- `source`
- `status`
- `superseded_by`
- `related_entities`
- `last_accessed`
- `access_count`

## Retrieval Rule

- Open `summary.md` first for current context.
- Use `items.yaml` for exact historical facts and supersession chains.
