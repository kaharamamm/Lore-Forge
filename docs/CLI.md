# Command-line interface

```bash
npm run lore -- check <worldDir>             # human-readable; exit 0 = no errors, 1 = errors, 2 = unreadable or bad usage
npm run lore -- check <worldDir> --json      # machine-readable check report
npm run lore -- export <worldDir> --out world.snapshot.json   # versioned JSON snapshot of the world
npm run lore -- codex <worldDir> -o codex.pdf   # World Codex PDF + codex.md (alias: lore bible)
npm run lore -- book <worldDir> -o book.pdf     # Story Book PDF + book.md
npm run lore -- book <worldDir> -o book.docx    # the same book for Word
npm run lore -- book <worldDir> --trim a5       # trim: 6x9 (default, or book.trim), 5.5x8.5, a5
```

After `npm run build`, the compiled CLI is `packages/cli/dist/main.js` (bin name `lore`). No browser or display is needed.

## Integration with Other Tools

Worlds are meant to be read by other tools. [docs/INTEGRATION.md](INTEGRATION.md) covers:

- the JSON Schemas in `packages/core/schemas/` (world manifest, entries, story chapters, intended marks, story ignores, check reports, snapshots)
- the world folder field by field: statuses, races, relation types, plain-name mentions and dates
- the check report and warning format
- custom rules on top of the built-in library
- story chapters and the extractor plug-in point, so an AI assistant can supply its own proposals and get the same duplicate checks
- how the World Codex and Story Book are built
- what is stable across versions

`lore check --json` and `lore export` produce versioned JSON for scripts and pipelines.
