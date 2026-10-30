# The Shifting Sands (example world)

A small desert world used to show and test Lore-Forge. It breaks canon on purpose so every starter rule fires once:

| Rule | Where |
| --- | --- |
| after-death | Orsan the Grey (died 1800) kills Queen Ilsa in "The Fall of Saltmere" (1920) |
| before-birth | Sefa of the Wells (born 1910) takes part in "The Founding of the Wells" (1905) |
| participant-not-existing | The Dune Guard (founded 1930) fights in "The Fall of Saltmere" (1920) |
| place-not-existing | "The Toll Dispute" (1900) happens at the Bronze Gate (destroyed 1850) |
| two-places-at-once | Kadir is at Qarim and at Saltmere on 1920-03-12 |
| dangling-reference | "Songs of the Caravan" links to [[The Lost Oasis]], which does not exist |
| duplicate-name | Kadir's alias "The Red Wind" is also the name of a faction |
| parent-cycle | Mira is Tarik's parent and Tarik is Mira's parent |
| parent-born-after-child | Hadi (born 1930) is the parent of Leyla (born 1900) |
| dead-marked-alive | Zehra died in 1890 but is marked alive |
| invalid-date | The Glass Compass was made in "1750 XX" (no era XX) |
| date-order | The Old Watchtower was destroyed (1650) before it was founded (1700) |
| file-error | notes/broken-draft.md has no name |
| image-view | "Songs of the Caravan" has an image labelled `sketch` (not a usual view for a note) |

The world also shows the v0.2 features: visual descriptions on Kadir, Orsan, Saltmere, the Glass Compass
and the Fall of Saltmere; reference images on a place, an item and an event; and dated lore pages (one
with Turkish verse) for the Story Book. All images are generated placeholders. Try
`npm run lore -- bible examples/shifting-sands -o bible.pdf` and `npm run lore -- book examples/shifting-sands -o book.pdf`.

Nur the Twice-Born acting after death is marked **intended** (a resurrection) in `intended.json`.
