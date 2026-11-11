# Command-line interface

`lore` checks, exports and copies worlds without a window. The installed app includes it:

| Install | Command |
| --- | --- |
| `.deb` | `lore` (`/usr/bin/lore`, linked by the package) |
| Windows | `"%LOCALAPPDATA%\Programs\Lore-Forge\resources\bin\lore.cmd"`; add that folder to `PATH` (Settings → System → About → Advanced system settings → Environment Variables → Path → New) to type `lore` |
| macOS | `/Applications/Lore-Forge.app/Contents/Resources/bin/lore`; `sudo ln -s /Applications/Lore-Forge.app/Contents/Resources/bin/lore /usr/local/bin/lore` puts it on the path |
| Source checkout | `npm run lore -- <command> …` (after `npm install`) |

The installed `lore` is a small script in the app's `resources/bin` folder that runs the app's own Electron as plain Node (`ELECTRON_RUN_AS_NODE=1`) on the bundled CLI, so it needs no Node.js and always matches the app's version. Windows installs per user by default; with "for all users" the folder is `C:\Program Files\Lore-Forge\resources\bin`.

```bash
lore check <worldDir>             # human-readable; exit 0 = no errors, 1 = errors, 2 = unreadable or bad usage
lore check <worldDir> --json      # machine-readable check report
lore export <worldDir> --out world.snapshot.json   # versioned JSON snapshot of the world
lore codex <worldDir> -o codex.pdf   # World Codex PDF + codex.md (alias: lore bible)
lore book <worldDir> -o book.pdf     # Story Book PDF + book.md
lore book <worldDir> -o book.docx    # the same book for Word
lore book <worldDir> -o book.epub    # the same book as an e-book (EPUB)
lore book <worldDir> --trim a5       # trim: 6x9 (default, or book.trim), 5.5x8.5, a5, a4, letter
lore duplicate <worldDir> [name] [--into <folder>]   # a copy with a new id; name defaults to "<name> (copy)",
                                                     # the folder to the original's parent folder
lore mcp                          # the MCP server for AI apps, on stdin/stdout (see MCP.md)
```

`lore mcp` is what AI apps such as Claude Desktop, Claude Code, Codex and Cursor start to write books in Lore-Forge. It is not meant to be typed by hand: it waits for an MCP client on stdin. **Connect AI** in the app sets the apps up; [MCP.md](MCP.md) covers the tools, pictures and settings.

`lore duplicate` copies everything (entries, story, images, 3D models, cover) into a new folder named after the new name, gives the world a new id and makes the copy writable, so it also works on the read-only sample world.

After `npm run build`, the compiled CLI is `packages/cli/dist/main.js` (bin name `lore`). No browser or display is needed.

### npm package (prepared, not published)

`@lore-forge/core`, `@lore-forge/pdf` and `@lore-forge/cli` have the metadata npm needs (`files`, `repository`, `engines`, `publishConfig.access: public`) but stay `"private": true`, so nothing can be published by accident. To publish: create the `lore-forge` organisation on npm, remove `"private": true` from the three packages, set the same version in all three (and in the cli's dependencies), run `npm run build`, then `npm publish -w @lore-forge/core -w @lore-forge/pdf -w @lore-forge/cli` in that order. `npx @lore-forge/cli check <worldDir>` then works on any machine with Node.js 22.18+.

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
