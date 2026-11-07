# AI assistants (MCP)

Lore-Forge works with AI apps such as Claude, Codex and Cursor. Connect your app once, then ask it something like:

> Write me a story about camels in Lore-Forge.

The assistant writes the whole book in Lore-Forge, not only in the chat. It creates a new book on your shelf with a description, an art style, a calendar and a cover. Then it adds the characters, places, factions, items, events and notes with their details, the relationships between them, and the story chapter by chapter. It runs the consistency checks and fixes what they find, makes pictures when a picture service is set up, and ends with a short summary. If Lore-Forge is open, you can watch the book fill in. Afterwards it is an ordinary book that you keep editing.

The connection uses the [Model Context Protocol](https://modelcontextprotocol.io) (MCP). Lore-Forge includes an MCP server, `lore mcp`. Your AI app starts it on your computer when it needs it, and it reads and writes your books there.

## Connect an AI app

In the library, choose **Connect AI** (top right), then **Connect** next to your app.

| App | What Connect does | Then |
| --- | --- | --- |
| **Claude Desktop** | Adds Lore-Forge to `claude_desktop_config.json` in the folder Claude Desktop reads: on Windows `%APPDATA%\Claude`, or for the Microsoft Store version `%LOCALAPPDATA%\Claude-Data\claude_…` (older Store versions: `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\Claude`); on macOS `~/Library/Application Support/Claude`; on Linux `~/.config/Claude` | Quit Claude Desktop completely (also from the tray or menu bar) and open it again |
| **Claude Code** | Runs `claude mcp add --scope user lore-forge …`, so every project sees it | Start a new session |
| **Codex** | Adds `[mcp_servers.lore-forge]` to `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), which the Codex CLI and IDE extension share | Start a new session |
| **Cursor** | Adds Lore-Forge to `~/.cursor/mcp.json` | Reload Cursor, or open **Settings → MCP** |

- The first change to a settings file keeps a copy of the original next to it, as `<file>.before-lore-forge`. Only the `lore-forge` entry is added or removed; everything else in the file stays as it was. A file that is not valid JSON is left alone, with a message.
- **Remove** takes Lore-Forge out of that app again.
- When Claude Code's `claude` command is not found, **Copy command** copies the command instead; paste it into a terminal.
- *Connected to another copy of Lore-Forge* means the app points at another install (for example a source checkout). **Connect this copy** switches it to this one.
- **Another app** (Windsurf, VS Code, Gemini CLI, LM Studio and others): **Copy the settings** copies the JSON block for this install. Paste it into the app's MCP servers. Some apps call the list `servers` instead of `mcpServers`.
- On macOS, move Lore-Forge to **Applications** before you connect, because the AI app starts it from where it was when you connected. Updates keep the same place on every system.
- The AppImage cannot be connected, because it unpacks itself to a new folder each time it starts. Use the `.deb`, or run Lore-Forge from source.

Any app that can start a local MCP server (a "stdio" server) works. Apps that only connect to servers on the internet cannot start Lore-Forge on your computer.

### By hand

Connect AI writes settings that start the app's own program as plain Node and run the bundled server. For the default Windows install:

```json
{
  "mcpServers": {
    "lore-forge": {
      "command": "C:\\Users\\YOU\\AppData\\Local\\Programs\\Lore-Forge\\Lore-Forge.exe",
      "args": ["C:\\Users\\YOU\\AppData\\Local\\Programs\\Lore-Forge\\resources\\app.asar\\dist\\cli.cjs", "mcp"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

On macOS and Linux, the [`lore` command](CLI.md) does the same:

```json
{ "mcpServers": { "lore-forge": { "command": "/usr/bin/lore", "args": ["mcp"] } } }
```

On macOS the command is `/Applications/Lore-Forge.app/Contents/Resources/bin/lore`. For Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.lore-forge]
command = "/usr/bin/lore"
args = ["mcp"]
```

For Claude Code: `claude mcp add --scope user lore-forge -- /usr/bin/lore mcp`.

From a source checkout, start the app with `npm run dev` and use **Connect AI**. It points the AI app at the checkout's build, and new books go to the checkout's `worlds/` folder, as in the app. Run `npm run build` again after changing the server.

## Pictures

The assistant can make a picture for every character, place, faction, item and event, and for the book cover. It uses an image service you choose, with your own API key and account:

| Service | Key | Model |
| --- | --- | --- |
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | the newest GPT Image model your key can use |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | the newest Gemini image model |
| **xAI Grok** | [console.x.ai](https://console.x.ai) | the newest Grok Imagine image model |

In **Connect AI → Pictures**, choose the service, paste the key and choose **Check and save**. Lore-Forge checks the key with the service, finds the newest image model it can use and saves both. **Check and save** again later looks for a newer model; if the saved model is retired, Lore-Forge finds a new one by itself. **Delete the saved key** removes the key from this computer, and **None** turns pictures off.

- The service bills each picture to your account. It usually costs a few cents.
- The prompt is built from the entry's visual description and summary and the book's **art style** (`artStyle` in `world.json`), so all pictures in a book look alike. Portraits are tall, places and events wide, and the cover is book-shaped. The cover prompt asks for no lettering, since Lore-Forge sets the title.
- A picture is saved as `images/<entry-id>/<view>.png` (or `.jpg`/`.webp`), with its provenance (the service, the model, the prompt and the date), and becomes the entry's card picture unless one was chosen. The cover goes to `images/cover-*.png`.
- Without a picture service, the assistant still fills in the visual descriptions. The World Codex prints them as art briefs. It can also attach pictures it already has, from a file, a web address or a `data:` URL.

## What the assistant can do

The server gives the assistant these tools. Most apps show them under **lore-forge**, and some ask you before each use.

| Tool | Does |
| --- | --- |
| `lore_forge_guide` | The playbook for writing a whole book, and every field name of the format |
| `list_books`, `get_book` | The books on your shelf; one book at a glance (entries, chapters, warning counts) |
| `create_book`, `update_book`, `duplicate_book` | A new book with its calendar, cover and Story Book details; change them; copy a book (such as the read-only sample) |
| `get_entry`, `save_entries`, `delete_entry` | Read, create and update up to 40 entries at once (by name; entries can refer to each other in the same call), delete one |
| `link_entries` | Relationships: family, friends and enemies, rulers, owners, places, who killed whom |
| `write_chapter`, `read_story` | Write or replace a chapter; read the chapter list or one chapter |
| `story_proposals` | What the chapters mention that the book does not have yet: add it or ignore it |
| `check_book`, `mark_intended` | The consistency rules the app runs; keep a contradiction on purpose with a note |
| `create_image`, `add_image` | Make a picture with your service, or attach one, for an entry or the cover |
| `export_book` | The Story Book (PDF or Word) or the World Codex (PDF), to the book's `exports/` folder or a path you give |

Apps that show MCP prompts also list **Write a story in Lore-Forge** (`write_story`): give it the idea, and optionally the number of chapters, the audience and a style.

To change a book you already have, name it: *"Add a chapter to Camelamamm where Mr Camel visits the coast."* The sample world is read-only, so the assistant first makes a copy of it.

## Where books go

- New books go to your worlds folder (**Library settings**), like books made in the app.
- The assistant sees the same shelf as the app: the worlds folder, the worlds you opened from elsewhere and the sample world.
- While Lore-Forge is open, new books appear on the shelf and an open book updates as the assistant writes. If you are typing in the same book at that moment, its changes are loaded right after your edit is saved, so nothing you type is lost. The same goes for changes from a text editor or `git pull`.
- Lore-Forge does not need to be open. The assistant works on the files, and the next time you open the book it is all there.

## Privacy

- The server runs on your computer, started by your AI app. It reads and writes only your books (the worlds folder and the worlds you opened) and Lore-Forge's own settings.
- What you ask and what the assistant reads (your book's text, to write and check it) go to your AI app's service, as in any chat with that app. Lore-Forge sends nothing there itself.
- Picture prompts go to the picture service you chose, with your key. Nothing else leaves your computer.
- The keys are saved on this computer in `<user data>/ai-images.json` (readable only by your user account on macOS and Linux). The Connect AI window shows only their last four characters. `<user data>` is the folder listed under [App settings and storage](USER-GUIDE.md#app-settings-and-storage).

## Settings for advanced use

The server reads these environment variables, which can be set in the AI app's settings (`env`):

| Variable | Means |
| --- | --- |
| `LORE_FORGE_DATA` | Lore-Forge's user-data folder (library settings, recent worlds, picture settings). Default: the app's own |
| `LORE_FORGE_WORLDS` | The worlds folder, when **Library settings** has not chosen one |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `XAI_API_KEY` | A key, when none is saved in Connect AI |
| `LORE_FORGE_IMAGE_PROVIDER`, `LORE_FORGE_IMAGE_MODEL` | The service (`openai`, `gemini`, `xai` or `none`) and model, when none is chosen in Connect AI |
| `LORE_FORGE_FONTS`, `LORE_FORGE_COVER_FONTS` | Fonts for `export_book` (default: the app's bundled fonts) |

## Troubleshooting

- **The app does not show the Lore-Forge tools.** Restart it completely after connecting. Claude Desktop keeps running in the tray or menu bar until you quit it there.
- **The AI app says the lore-forge server failed or disconnected.** Lore-Forge was probably moved or uninstalled after you connected. Open **Connect AI** again and choose **Connect**.
- **"No picture service is set up."** Set one up in **Connect AI → Pictures**. The assistant finishes everything else without pictures.
- **"This book is read-only."** It is the sample world. Ask the assistant to make a copy (it uses `duplicate_book`), or use **Duplicate** on the shelf.
- **The assistant answers in the chat but writes nothing.** Say "in Lore-Forge" in your request, or ask it to use the Lore-Forge tools.
