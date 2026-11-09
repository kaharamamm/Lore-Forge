/** Ask AI: the command lines that keep the AI to Lore-Forge's tools, and reading what Claude Code and Codex print. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { AskItem } from '../src/shared/api.ts';
import {
  aboutLabel, aboutText, bookContext, claudeArgs, cleanAbout, MAX_QUOTE, claudeAuth, claudeCaps, ClaudeReader, codexArgs, codexAuth, codexCaps, codexNative, CodexReader, lostSession, shimScript,
  signInProblem, Turn,
} from '../src/main/ask-stream.ts';
import { mdBlocks } from '../src/shared/markdown.ts';

const server = { command: 'C:\\Program Files\\Lore-Forge\\Lore-Forge.exe', args: ['C:\\Program Files\\Lore-Forge\\resources\\app.asar\\dist\\cli.cjs', 'mcp'], env: { ELECTRON_RUN_AS_NODE: '1', LORE_FORGE_DATA: 'C:\\Users\\Ann\\AppData\\Roaming\\Lore-Forge' } };
const caps = { partial: true, dontAsk: true, settingSources: true };

function turnOf(agent: 'claude-code' | 'codex' = 'claude-code') {
  const items: AskItem[] = [];
  let changes = 0;
  const turn = new Turn(agent, 'run1', items, () => changes++);
  return { items, turn, changes: () => changes };
}
const feed = (reader: { line(s: string): void }, events: unknown[]) => { for (const e of events) reader.line(JSON.stringify(e)); };

test('Claude Code runs with Lore-Forge tools only, the prompt on stdin, and continues a conversation by its id', () => {
  const args = claudeArgs({ mcpConfig: 'C:\\data\\ask-ai\\lore-forge-mcp.json', context: 'You are in Lore-Forge.', caps });
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], '-p');
  assert.equal(after('--output-format'), 'stream-json');
  assert.ok(args.includes('--strict-mcp-config'), 'no MCP server but Lore-Forge');
  assert.equal(after('--tools'), '', 'no built-in tool: no shell, no file editing, no web');
  assert.equal(after('--allowedTools'), 'mcp__lore-forge');
  assert.equal(after('--permission-mode'), 'dontAsk');
  assert.equal(after('--setting-sources'), 'user', "the book folder's own settings (hooks) are not read");
  assert.equal(after('--append-system-prompt'), 'You are in Lore-Forge.');
  assert.ok(!args.includes('--resume'));
  assert.deepEqual(claudeArgs({ mcpConfig: 'x', context: 'c', session: 'abc', caps }).slice(-2), ['--resume', 'abc']);
  const old = claudeArgs({ mcpConfig: 'x', context: 'c', caps: { partial: false, dontAsk: false, settingSources: false } });
  assert.ok(!old.includes('--include-partial-messages') && !old.includes('--permission-mode') && !old.includes('--setting-sources'));
  // What --help says decides the options; without --tools or --strict-mcp-config it is too old.
  assert.deepEqual(claudeCaps('--mcp-config --strict-mcp-config --tools <tools...> "stream-json" --include-partial-messages "dontAsk" --setting-sources'), caps);
  assert.equal(claudeCaps('--mcp-config --strict-mcp-config "stream-json"'), null);
});

test('Codex runs read-only with only the Lore-Forge server (written as TOML), its extras off, and resumes a thread', () => {
  const c = codexCaps('  --json\n  --skip-git-repo-check\n  --ignore-user-config\n', 'apps   stable  true\nshell_tool   stable   true\ngoals  stable  true\nhooks stable true\n');
  assert.deepEqual(c, { ignoreUserConfig: true, disable: ['shell_tool', 'apps', 'hooks'] });
  assert.equal(codexCaps('--json', ''), null, 'too old without --skip-git-repo-check');
  const args = codexArgs({ server, dir: 'C:\\Books\\Camelamamm', caps: c! });
  assert.deepEqual(args.slice(0, 3), ['exec', '--json', '--skip-git-repo-check']);
  assert.deepEqual(args.slice(-3), ['-C', 'C:\\Books\\Camelamamm', '-']);
  assert.ok(args.includes('--ignore-user-config'));
  assert.equal(args[args.indexOf('approval_policy="never"') - 1], '-c');
  assert.ok(args.includes('sandbox_mode="read-only"'));
  const table = args.find((a) => a.startsWith('mcp_servers.lore-forge='))!;
  assert.equal(table, 'mcp_servers.lore-forge={command="C:\\\\Program Files\\\\Lore-Forge\\\\Lore-Forge.exe", args=["C:\\\\Program Files\\\\Lore-Forge\\\\resources\\\\app.asar\\\\dist\\\\cli.cjs", "mcp"], env={ELECTRON_RUN_AS_NODE="1", LORE_FORGE_DATA="C:\\\\Users\\\\Ann\\\\AppData\\\\Roaming\\\\Lore-Forge"}, default_tools_approval_mode="approve"}');
  assert.deepEqual(args.filter((a, i) => args[i - 1] === '--disable'), ['shell_tool', 'apps', 'hooks']);
  const resume = codexArgs({ server, dir: 'C:\\Books\\Camelamamm', session: 'thread-1', caps: c! });
  assert.deepEqual(resume.slice(0, 3), ['exec', 'resume', 'thread-1']);
  assert.ok(!resume.includes('-C') && resume.at(-1) === '-');
});

test('Claude Code stream: text in pieces, a tool call with its input and result, the session and the end', () => {
  const { items, turn } = turnOf();
  const r = new ClaudeReader(turn);
  feed(r, [
    { type: 'system', subtype: 'init', session_id: 's-1', mcp_servers: [{ name: 'lore-forge', status: 'connected' }] },
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'mcp__lore-forge__get_book', input: {} } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"book"' } } },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'mcp__lore-forge__get_book', input: { book: 'C:/Books/Camel' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{"name":"Camel"}' }] }] } },
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm2' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'thinking', thinking: '...' }] } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Camel ' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Ask' } } },
  ]);
  assert.deepEqual(items.map((i) => i.kind), ['tool', 'ai']);
  assert.deepEqual(items[0], { kind: 'tool', id: 't1', tool: 'get_book', input: { book: 'C:/Books/Camel' }, state: 'done' });
  assert.equal((items[1] as { text: string }).text, 'Camel Ask', 'pieces join while they stream');
  feed(r, [
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Camel Ask.' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'Camel Ask.', session_id: 's-1' },
  ]);
  assert.equal(items.length, 2, 'the whole block replaces its pieces instead of adding a second reply');
  assert.equal((items[1] as { text: string }).text, 'Camel Ask.');
  assert.equal(turn.session, 's-1');
  assert.ok(turn.done && !turn.failed);
});

test('Claude Code without streamed pieces, a failed tool, a sign-in failure, usage warnings and a server that did not start', () => {
  const { items, turn } = turnOf();
  const r = new ClaudeReader(turn);
  feed(r, [
    { type: 'system', subtype: 'init', session_id: 's-2', mcp_servers: [{ name: 'lore-forge', status: 'failed' }] },
    { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Saving.' }, { type: 'tool_use', id: 't9', name: 'mcp__lore-forge__save_entries', input: { entries: [{ name: 'Ann' }] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't9', is_error: true, content: 'status must be alive or dead' }] } },
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.79, rateLimitType: 'five_hour', resetsAt: 1794155400 } },
    { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', utilization: 0.8, rateLimitType: 'five_hour' } },
    { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' },
  ]);
  assert.deepEqual(items.map((i) => (i.kind === 'note' ? i.note.code : i.kind)), ['no-tools', 'ai', 'tool', 'usage']);
  assert.deepEqual(items[2], { kind: 'tool', id: 't9', tool: 'save_entries', input: { entries: [{ name: 'Ann' }] }, state: 'failed', error: 'status must be alive or dead' });
  assert.deepEqual((items[3] as Extract<AskItem, { kind: 'note' }>).note, { code: 'usage', agent: 'claude-code', percent: 79, window: 'five_hour', resets: 1794155400000 }, 'said once');
  assert.equal(turn.failed, 'Not logged in · Please run /login');
  assert.ok(signInProblem(turn.failed!));
  assert.ok(!signInProblem('The design in chapter 2 is odd') && !signInProblem('Entry not found'));
  const t2 = turnOf();
  feed(new ClaudeReader(t2.turn), [{ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 100 } }]);
  assert.deepEqual((t2.items[0] as Extract<AskItem, { kind: 'note' }>).note, { code: 'limit', agent: 'claude-code', resets: 100000 });
  // A subagent's own steps, and lines that are not JSON, are skipped.
  feed(new ClaudeReader(t2.turn), [{ type: 'assistant', parent_tool_use_id: 'x', message: { id: 'm', content: [{ type: 'text', text: 'inside' }] } }]);
  new ClaudeReader(t2.turn).line('not json');
  assert.equal(t2.items.length, 1);
});

test('Codex events: its thread, messages and MCP tool calls (named per run), a recovered error, a failed turn', () => {
  const { items, turn } = turnOf('codex');
  const r = new CodexReader(turn);
  feed(r, [
    { type: 'thread.started', thread_id: '01a1bbde' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'I’ll look at the book.' } },
    { type: 'item.started', item: { id: 'item_1', type: 'mcp_tool_call', server: 'lore-forge', tool: 'get_book', arguments: { book: 'C:/Books/Camel' }, result: null, error: null, status: 'in_progress' } },
  ]);
  assert.equal((items[1] as Extract<AskItem, { kind: 'tool' }>).state, 'running');
  feed(r, [
    { type: 'item.completed', item: { id: 'item_1', type: 'mcp_tool_call', server: 'lore-forge', tool: 'get_book', arguments: { book: 'C:/Books/Camel' }, result: { content: [{ type: 'text', text: '{}' }] }, error: null, status: 'completed' } },
    { type: 'item.started', item: { id: 'item_2', type: 'reasoning', text: 'thinking' } },
    { type: 'error', message: 'stream disconnected, retrying' },
    { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: 'Camel Ask' } },
    { type: 'turn.completed', usage: { input_tokens: 1 } },
  ]);
  assert.deepEqual(items.map((i) => (i.kind === 'tool' ? `${i.tool}:${i.state}` : i.kind === 'ai' ? i.text : i.kind)), ['I’ll look at the book.', 'get_book:done', 'Camel Ask']);
  assert.equal(items[1]!.kind === 'tool' && items[1]!.id, 'run1:item_1', 'the run names the item: Codex numbers them from 0 every time');
  assert.equal(turn.session, '01a1bbde');
  assert.ok(turn.done && turn.failed === undefined, 'an error it recovered from is no failure');
  const t2 = turnOf('codex');
  feed(new CodexReader(t2.turn), [
    { type: 'item.completed', item: { id: 'item_0', type: 'mcp_tool_call', server: 'lore-forge', tool: 'save_entries', arguments: {}, result: { content: [{ type: 'text', text: 'bad status' }], is_error: true }, status: 'completed' } },
    { type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } },
  ]);
  assert.deepEqual(t2.items[0], { kind: 'tool', id: 'run1:item_0', tool: 'save_entries', state: 'failed', error: 'bad status' });
  assert.ok(t2.turn.done && signInProblem(t2.turn.failed!));
  assert.ok(lostSession('No conversation found with session ID: abc') && lostSession('thread 123 not found') && !lostSession('Entry not found'));
});

test('a run that ends early leaves no step running, and items are only added through the turn', () => {
  const { items, turn } = turnOf();
  turn.toolStart('a', 'write_chapter', { title: 'The Storm' });
  turn.toolStart('a', 'write_chapter');
  assert.equal(items.length, 1, 'the same call is not added twice');
  turn.settle();
  assert.equal((items[0] as Extract<AskItem, { kind: 'tool' }>).state, 'stopped');
});

test('npm command shims, the native Codex program, and sign-in status', () => {
  const shim = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
  assert.equal(shimScript(shim), 'node_modules/@openai/codex/bin/codex.js');
  assert.equal(shimScript('@echo off\r\nclaude.exe %*'), null);
  const native = codexNative(join('npm', 'node_modules', '@openai', 'codex'), 'win32', 'x64');
  assert.equal(native[0], join('npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
  assert.deepEqual(codexNative('x', 'aix' as NodeJS.Platform, 'ppc'), []);
  assert.deepEqual(claudeAuth('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}'), { signedIn: true });
  assert.deepEqual(claudeAuth('{"loggedIn": true, "authMethod": "api_key"}'), { signedIn: true, billed: true });
  assert.deepEqual(claudeAuth('{"loggedIn": false}'), { signedIn: false });
  assert.deepEqual(claudeAuth('error: unknown command auth'), { signedIn: null });
  assert.deepEqual(codexAuth('Logged in using ChatGPT\n'), { signedIn: true });
  assert.deepEqual(codexAuth('Logged in using an API key - sk-...abcd'), { signedIn: true, billed: true });
  assert.deepEqual(codexAuth('Not logged in'), { signedIn: false });
  assert.deepEqual(codexAuth(''), { signedIn: null });
});

test('what the AI is told: the book, its folder, Lore-Forge tools only, and the sample is read-only', () => {
  const c = bookContext({ name: 'Camelamamm', dir: 'C:\\Books\\camelamamm', readOnly: false });
  assert.match(c, /"Camelamamm"/);
  assert.match(c, /book: "C:\\\\Books\\\\camelamamm"/);
  assert.match(c, /lore_forge_guide/);
  assert.doesNotMatch(c, /read-only/);
  assert.match(bookContext({ name: 'Camelamamm', dir: 'x', readOnly: true }), /read-only sample/);
  assert.doesNotMatch(c, /\u2014/, 'no long dashes');
  // Chapter work goes through the brief and partial edits; the book's writing style comes along when it has one.
  assert.match(c, /chapter_brief/);
  assert.match(c, /edit_chapter/);
  assert.doesNotMatch(c, /writing style;/);
  assert.match(bookContext({ name: 'Camelamamm', dir: 'x', readOnly: false, writingStyle: '  First person, present tense.  ' }), /The book's writing style; follow it in everything you write in the book:\nFirst person, present tense\.$/m);
});

test('reply Markdown: paragraphs, headings, lists, quotes, code and tables', () => {
  const md = 'Done. I added **three** people\nwho live in the city.\n\n## What changed\n- Ann, a baker\n- Bo\n  who sings\n\n1. First\n2) Second\n\n> A quote\n> goes on\n\n```\ncode here\n```\n| a | b |\n|---|---|\n| 1 | 2 |\n\nThe end.';
  assert.deepEqual(mdBlocks(md), [
    { kind: 'p', text: 'Done. I added **three** people who live in the city.' },
    { kind: 'h', text: 'What changed' },
    { kind: 'ul', items: ['Ann, a baker', 'Bo who sings'] },
    { kind: 'ol', items: ['First', 'Second'] },
    { kind: 'quote', text: 'A quote goes on' },
    { kind: 'pre', text: 'code here' },
    { kind: 'pre', text: '| a | b |\n|---|---|\n| 1 | 2 |' },
    { kind: 'p', text: 'The end.' },
  ]);
  assert.deepEqual(mdBlocks('- one\n\n- two'), [{ kind: 'ul', items: ['one', 'two'] }], 'a blank line between items keeps one list');
});

test('a message about an entry or a chapter (a part of it): what the AI reads first, and the label in the conversation', () => {
  const entry = { kind: 'entry' as const, id: 'char-mr-camel', name: 'Mr Camel' };
  assert.equal(aboutText(entry), 'This message is about the entry "Mr Camel" (id: char-mr-camel). Read it with get_entry first.');
  assert.equal(aboutLabel(entry), 'Mr Camel');
  const part = { kind: 'chapter' as const, file: 'story/01-the-storm.md', title: 'The Storm', quote: 'The well sang.\nThen it stopped.' };
  assert.equal(aboutText(part), [
    'This message is about the chapter "The Storm" (story/01-the-storm.md). Read it with read_story first.',
    'The part of it I mean:',
    '> The well sang.',
    '> Then it stopped.',
  ].join('\n'));
  assert.equal(aboutLabel(part), 'The Storm: “The well sang. Then it stopped.”');
  assert.equal(aboutLabel({ ...part, quote: 'x'.repeat(100) }).length, 'The Storm: “'.length + 60 + 1);
  assert.deepEqual(cleanAbout({ kind: 'chapter', file: 'story/a.md', title: 'A', quote: 'q'.repeat(MAX_QUOTE + 50) }), { kind: 'chapter', file: 'story/a.md', title: 'A', quote: 'q'.repeat(MAX_QUOTE) });
  assert.deepEqual(cleanAbout({ kind: 'chapter', file: 'story/a.md', title: '', quote: '   ' }), { kind: 'chapter', file: 'story/a.md', title: 'story/a.md' });
  assert.equal(cleanAbout({ kind: 'entry', id: 'x' }), null, 'an entry needs its name');
  assert.equal(cleanAbout('Mr Camel'), null);
  assert.equal(cleanAbout(null), null);
});
