# Contributing to Lore-Forge

Thanks for helping. Bug reports, ideas, documentation fixes and code are all welcome.

## Reporting a bug or asking for a feature

Use the [issue forms](https://github.com/kaharamamm/Lore-Forge/issues/new/choose). For a bug, include your system, the Lore-Forge version (shown under **About** in the library), what you did and what happened. If a world triggers it, a small world folder that reproduces it helps most; don't share worlds you want to keep private.

## Setting up

You need Node.js 22.18 or newer (Node 24 recommended, see `.nvmrc`) and git.

```bash
git clone https://github.com/kaharamamm/Lore-Forge.git
cd Lore-Forge
npm install
npm run dev
```

On Ubuntu 23.10+ see [Troubleshooting in docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#troubleshooting) if Electron aborts.

## Before you open a pull request

```bash
npm test           # unit, rule, schema, PDF and CLI tests
npm run typecheck
npm run build
```

- Keep pull requests focused: one fix or feature each.
- Add or update tests in `packages/*/test/` for behaviour changes. A new consistency rule needs a case in the rule test world `packages/core/test/fixtures/shifting-sands`.
- Keep the world format backwards compatible. A change to the files Lore-Forge writes needs the JSON Schemas in `packages/core/schemas/` and [docs/INTEGRATION.md](docs/INTEGRATION.md) updated too.
- UI changes should keep text contrast at 4.5:1 or more (`npm run contrast -w @lore-forge/desktop`) and work with the keyboard.
- Don't commit personal worlds. Only the sample world `worlds/camelamamm` belongs in the repository.

## Where things live

`packages/core` (format, dates, rules, story extraction, document model), `packages/pdf` (PDF and Word output), `packages/cli` (the `lore` command), `packages/desktop` (the Electron app). See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Licence

By contributing you agree that your contribution is released under the [MIT License](LICENSE). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
