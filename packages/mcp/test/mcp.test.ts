import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { check } from '@lore-forge/core';
import { loadWorld } from '@lore-forge/core/node';
import { createServer, type ServerOptions } from '../src/server.ts';
import { pickImageModel, sniffImage } from '../src/images.ts';

const schemaDir = join(import.meta.dirname, '..', '..', 'core', 'schemas');
const sampleDir = join(import.meta.dirname, '..', '..', '..', 'worlds', 'camelamamm');
const ajv = new Ajv2020({ allErrors: true });
for (const f of readdirSync(schemaDir)) ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, f), 'utf8')));
const valid = (schema: string, data: unknown): void => {
  const v = ajv.getSchema(`https://lore-forge.local/schemas/v1/${schema}`)!;
  assert.ok(v(data), `${schema}: ${ajv.errorsText(v.errors)}`);
};

/** A 1x1 PNG. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function connect(opts: ServerOptions) {
  const server = createServer(opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0]!.text;
    return { error: !!r.isError, text, json: () => JSON.parse(text) as Record<string, any> };
  };
  return { client, call };
}

async function home() {
  const root = await mkdtemp(join(tmpdir(), 'lore-mcp-'));
  return { root, dataDir: join(root, 'data'), worlds: join(root, 'worlds') };
}

test('the server offers the tools, the guide and the write_story prompt', async () => {
  const h = await home();
  try {
    const { client, call } = await connect({ dataDir: h.dataDir, defaultWorldsDir: h.worlds, sampleDir: null });
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ['add_image', 'check_book', 'create_book', 'create_image', 'delete_entry', 'duplicate_book', 'export_book', 'get_book', 'get_entry', 'link_entries', 'list_books', 'look_at', 'lore_forge_guide', 'mark_intended', 'read_story', 'save_entries', 'story_proposals', 'update_book', 'write_chapter']);
    assert.match(client.getInstructions() ?? '', /lore_forge_guide/);
    const guide = (await call('lore_forge_guide')).text;
    for (const s of ['create_book', 'save_entries', 'write_chapter', 'check_book', 'create_image', 'three-quarter', 'parent-of', 'after-death', 'personality', 'look_at', 'look-overlap']) assert.ok(guide.includes(s), `the guide mentions ${s}`);
    const prompt = await client.getPrompt({ name: 'write_story', arguments: { idea: 'a story about camels' } });
    assert.match((prompt.messages[0]!.content as { text: string }).text, /a story about camels[\s\S]*lore_forge_guide/);
    assert.deepEqual((await call('list_books')).json().books, []);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('an assistant writes a whole book: entries, links, chapters, proposals, checks, pictures and a PDF', async () => {
  const h = await home();
  mkdirSync(h.dataDir, { recursive: true });
  writeFileSync(join(h.dataDir, 'ai-images.json'), JSON.stringify({ provider: 'openai', keys: { openai: 'test-key' } }));
  const requests: { url: string; body?: any }[] = [];
  const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    assert.equal((init?.headers as Record<string, string>)['Authorization'], 'Bearer test-key');
    if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'gpt-image-2.5-flare' }, { id: 'gpt-image-2-mini' }] });
    if (url.endsWith('/v1/images/generations')) return Response.json({ data: [{ b64_json: PNG_B64 }] });
    return new Response('not found', { status: 404 });
  };
  try {
    const { call } = await connect({ dataDir: h.dataDir, defaultWorldsDir: h.worlds, sampleDir: null, fetch: fakeFetch as never });
    const made = await call('create_book', {
      name: 'The Salt Caravans',
      description: 'Camel-folk caravans cross a sea of salt.',
      artStyle: 'painterly fantasy concept art, warm desert light',
      calendar: { eras: [{ id: 'SR', name: 'Salt Reckoning', start: 1, color: '#c9822f' }], defaultEra: 'SR' },
      details: { title: 'The Salt Caravans', author: 'Test Author', trim: 'a5' },
      cover: { color: '#8a5a1c', icon: 'camel-head' },
    });
    assert.ok(!made.error, made.text);
    const book = made.json().book;
    assert.equal(book.id, 'the-salt-caravans');
    const manifest = JSON.parse(readFileSync(join(book.dir, 'world.json'), 'utf8'));
    valid('world-manifest.schema.json', manifest);
    assert.equal(manifest.artStyle, 'painterly fantasy concept art, warm desert light');
    assert.equal(manifest.book.trim, 'a5');

    // Entries refer to each other by name inside one call, before any of them exists.
    const saved = await call('save_entries', {
      book: 'The Salt Caravans',
      entries: [
        { type: 'character', name: 'Hadi', status: 'alive', born: 480, race: 'camel-folk', gender: 'male', title: 'Caravan Master', home: 'Saltmere', affiliations: 'The Dune Guard', possessions: ['The Glass Compass'], visual: { appearance: 'Tall camel-folk with a grey muzzle' }, summary: 'The oldest caravan master.', body: 'Hadi has crossed the salt flats forty times.', relations: [{ type: 'parent of', target: 'Leyla' }] },
        { type: 'character', name: 'Leyla', status: 'alive', born: '505', race: 'camel-folk' },
        { type: 'place', name: 'Saltmere', kind: 'city', founded: '100', ruler: 'Hadi', visual: { architecture: 'White salt-brick domes' } },
        { type: 'faction', name: 'The Dune Guard', kind: 'order', leader: 'Hadi', founded: '300' },
        { type: 'item', name: 'The Glass Compass', kind: 'tool', owners: 'Hadi', created: '450' },
        { type: 'event', name: 'The Storm Crossing', date: '520', place: 'Saltmere', participants: ['Hadi', { id: 'Leyla', role: 'scout' }], actions: [{ actor: 'Leyla', verb: 'saved', target: 'Hadi' }], outcome: 'Everyone reached Saltmere.' },
        { type: 'note', name: 'Song of the Salt', body: 'A walking song of the caravans.', mood: 'not a note field' },
      ],
    });
    assert.ok(!saved.error, saved.text);
    const s = saved.json();
    assert.deepEqual(s.saved.map((x: any) => x.id), ['char-hadi', 'char-leyla', 'place-saltmere', 'fac-the-dune-guard', 'item-the-glass-compass', 'evt-the-storm-crossing', 'note-song-of-the-salt']);
    assert.match(s.notes.join(' '), /"mood" is not a note field/);
    let world = await loadWorld(book.dir);
    const hadi = world.entries.find((e) => e.id === 'char-hadi')! as any;
    assert.equal(hadi.born, '480', 'a number date is stored as text');
    assert.equal(hadi.details.home, 'place-saltmere', 'a name in a ref field becomes the id');
    assert.deepEqual(hadi.details.affiliations, ['fac-the-dune-guard']);
    assert.deepEqual(hadi.relations, [{ type: 'parent-of', target: 'char-leyla' }]);
    const storm = world.entries.find((e) => e.id === 'evt-the-storm-crossing')! as any;
    assert.deepEqual(storm.participants, [{ id: 'char-hadi' }, { id: 'char-leyla', role: 'scout' }]);
    assert.deepEqual(storm.actions, [{ actor: 'char-leyla', verb: 'saved', target: 'char-hadi' }]);
    for (const { body: _b, ...front } of world.entries) valid('entry.schema.json', front);

    // An update changes only what it names; null removes a field.
    const upd = await call('save_entries', { book: book.id, entries: [{ id: 'char-leyla', title: 'Scout', race: null }] });
    assert.ok(!upd.error, upd.text);
    world = await loadWorld(book.dir);
    const leyla = world.entries.find((e) => e.id === 'char-leyla')! as any;
    assert.equal(leyla.details.title, 'Scout');
    assert.equal(leyla.race, undefined);
    assert.equal(leyla.born, '505');

    const bad = await call('save_entries', { book: book.id, entries: [{ type: 'character', name: 'Ghost', status: 'haunting' }] });
    assert.match(bad.json().problems[0], /status/);

    // Relationships: written once; a symmetric link is not doubled from the other side.
    const links = await call('link_entries', { book: book.id, links: [{ entry: 'Hadi', type: 'ally-of', target: 'The Dune Guard' }, { entry: 'The Dune Guard', type: 'ally-of', target: 'Hadi' }, { entry: 'Leyla', type: 'lives in', target: 'Saltmere', from: '520' }] });
    const l = links.json();
    assert.deepEqual(l.problems, []);
    assert.match(l.done[1], /Already linked/);
    world = await loadWorld(book.dir);
    assert.deepEqual((world.entries.find((e) => e.id === 'char-leyla') as any).relations, [{ type: 'lives-in', target: 'place-saltmere', from: '520' }]);
    const unlink = await call('link_entries', { book: book.id, links: [{ entry: 'Leyla', type: 'lives-in', target: 'Saltmere', remove: true }] });
    assert.match(unlink.json().done[0], /Removed/);

    // A chapter that names someone new proposes them; accepting adds the entry.
    const ch = await call('write_chapter', { book: book.id, title: 'The Storm', date: '520', text: 'Hadi led the caravan out of Saltmere at dawn. Captain Idris was born in 470. Leyla rode ahead.' });
    assert.ok(!ch.error, ch.text);
    const chapter = ch.json();
    assert.equal(chapter.chapter.number, 1);
    const idris = chapter.proposals.find((p: any) => p.name === 'Idris');
    assert.ok(idris, `Idris is proposed: ${ch.text}`);
    const acc = await call('story_proposals', { book: book.id, accept: [idris.key] });
    assert.match(acc.json().done[0], /Created character "Idris"/);
    await call('write_chapter', { book: book.id, title: 'The Salt Sea', text: 'They crossed the salt sea.' });
    const re = await call('write_chapter', { book: book.id, title: 'The Storm', text: 'Hadi led the caravan out of Saltmere at dawn, with Leyla beside him.' });
    assert.equal(re.json().chapter.replaced, true);
    const story = (await call('read_story', { book: book.id })).json();
    assert.deepEqual(story.chapters.map((c: any) => c.title), ['The Storm', 'The Salt Sea']);
    assert.match((await call('read_story', { book: book.id, chapter: 1 })).json().text, /Leyla beside him/);
    for (const c of (await loadWorld(book.dir)).story!) valid('story-chapter.schema.json', { title: c.title, order: c.order, ...(c.date ? { date: c.date } : {}) });

    // A contradiction is reported, then kept on purpose.
    const dead = await call('save_entries', { book: book.id, entries: [{ id: 'char-hadi', status: 'dead', died: '510' }] });
    const err = dead.json().warnings.find((w: any) => w.rule === 'after-death');
    assert.ok(err, `after-death is reported: ${dead.text}`);
    const checked = (await call('check_book', { book: book.id })).json();
    assert.ok(checked.counts.errors >= 1);
    const marked = await call('mark_intended', { book: book.id, warning: err.id, note: 'His ghost leads the caravan.' });
    assert.ok(!marked.error, marked.text);
    assert.ok(!(await call('check_book', { book: book.id })).json().warnings.some((w: any) => w.id === err.id));

    // Pictures: the newest general image model is picked, the size fits a portrait, the file and card are set.
    const pic = await call('create_image', { book: book.id, entry: 'Hadi' });
    assert.ok(!pic.error, pic.text);
    const gen = requests.find((r) => r.url.endsWith('/images/generations'))!;
    assert.equal(gen.body.model, 'gpt-image-2.5-flare');
    assert.equal(gen.body.size, '1024x1536');
    assert.match(gen.body.prompt, /Hadi[\s\S]*grey muzzle[\s\S]*Style: painterly fantasy concept art/);
    world = await loadWorld(book.dir);
    const withPic = world.entries.find((e) => e.id === 'char-hadi')!;
    assert.equal(withPic.images?.[0]?.file, 'images/char-hadi/three-quarter.png');
    assert.equal(withPic.picture?.image, 'images/char-hadi/three-quarter.png');
    assert.match(withPic.images![0]!.provenance!.tool!, /OpenAI gpt-image-2\.5-flare/);
    assert.ok(existsSync(join(book.dir, 'images', 'char-hadi', 'three-quarter.png')));
    assert.equal(JSON.parse(readFileSync(join(h.dataDir, 'ai-images.json'), 'utf8')).models.openai, 'gpt-image-2.5-flare', 'the found model is saved');
    const place = await call('create_image', { book: book.id, entry: 'Saltmere' });
    assert.equal(place.json().view, 'establishing');
    assert.equal(requests.filter((r) => r.url.endsWith('/images/generations')).at(-1)!.body.size, '1536x1024');
    const cover = await call('create_image', { book: book.id, entry: 'cover' });
    assert.ok(!cover.error, cover.text);
    assert.match(JSON.parse(readFileSync(join(book.dir, 'world.json'), 'utf8')).cover.image, /^images\/cover-.*\.png$/);
    const added = await call('add_image', { book: book.id, entry: 'The Glass Compass', source: `data:image/png;base64,${PNG_B64}` });
    assert.equal(added.json().saved, 'images/item-the-glass-compass/front.png');

    // The book overview and a PDF.
    const overview = (await call('get_book', { book: 'the salt caravans' })).json();
    assert.equal(overview.counts.characters, 3);
    assert.equal(overview.chapters.length, 2);
    const pdf = await call('export_book', { book: book.id });
    assert.ok(!pdf.error, pdf.text);
    assert.ok(existsSync(pdf.json().file));
    assert.ok(readFileSync(pdf.json().file).subarray(0, 4).toString() === '%PDF');

    // The world is still clean apart from the warnings the test made on purpose.
    world = await loadWorld(book.dir);
    assert.deepEqual(world.issues, []);
    assert.ok(!check(world).some((w) => w.severity === 'error' && !w.intended), JSON.stringify(check(world).filter((w) => w.severity === 'error')));
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('the sample that ships with the app is read-only; duplicate_book makes an editable copy', async () => {
  const h = await home();
  const sample = join(h.root, 'resources', 'worlds', 'camelamamm');
  cpSync(sampleDir, sample, { recursive: true });
  try {
    const { call } = await connect({ dataDir: h.dataDir, defaultWorldsDir: h.worlds, sampleDir: sample });
    const books = (await call('list_books')).json().books;
    assert.equal(books[0].readOnly, true);
    const blocked = await call('save_entries', { book: 'Camelamamm', entries: [{ type: 'character', name: 'Nobody' }] });
    assert.ok(blocked.error);
    assert.match(blocked.text, /duplicate_book/);
    const copy = await call('duplicate_book', { book: 'Camelamamm', name: 'My Camelamamm' });
    assert.ok(!copy.error, copy.text);
    const ok = await call('save_entries', { book: 'My Camelamamm', entries: [{ type: 'character', name: 'Nobody', status: 'alive' }] });
    assert.ok(!ok.error, ok.text);
    assert.equal(ok.json().saved[0].id, 'char-nobody');
    const missing = await call('get_entry', { book: 'My Camelamamm', entry: 'Samra' });
    assert.ok(missing.error);
    assert.match(missing.text, /No entry "Samra"/);
    const samira = (await call('get_entry', { book: 'My Camelamamm', entry: 'Samira' })).json();
    assert.equal(samira.id, 'char-samira');
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('without a picture service list_books and create_image explain how to set one up', async () => {
  const h = await home();
  try {
    const { call } = await connect({ dataDir: h.dataDir, defaultWorldsDir: h.worlds, sampleDir: null, env: {} });
    assert.match((await call('list_books')).json().pictures, /^not set up\. .*Connect AI/);
    await call('create_book', { name: 'Plain' });
    await call('save_entries', { book: 'Plain', entries: [{ type: 'character', name: 'Ann' }] });
    const r = await call('create_image', { book: 'Plain', entry: 'Ann' });
    assert.ok(r.error);
    assert.match(r.text, /Connect AI/);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('image models are picked sensibly and pictures are recognised', () => {
  assert.equal(pickImageModel('openai', ['gpt-image-1', 'gpt-image-2-mini', 'gpt-image-2', 'dall-e-3']), 'gpt-image-2');
  assert.equal(pickImageModel('openai', ['dall-e-3']), 'dall-e-3');
  assert.equal(pickImageModel('gemini', ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview']), 'gemini-3.1-flash-image-preview');
  assert.equal(pickImageModel('xai', ['grok-imagine-image-quality', 'grok-imagine-image', 'grok-2-image-1212']), 'grok-imagine-image');
  assert.deepEqual(sniffImage(Buffer.from(PNG_B64, 'base64')), { mime: 'image/png', ext: 'png' });
  assert.equal(sniffImage(new Uint8Array([1, 2, 3, 4])), null);
});

test('looks: an assistant adds, changes and removes looks, asks how entries look on a date, and makes pictures of a look', async () => {
  const h = await home();
  mkdirSync(h.dataDir, { recursive: true });
  writeFileSync(join(h.dataDir, 'ai-images.json'), JSON.stringify({ provider: 'openai', keys: { openai: 'test-key' }, models: { openai: 'gpt-image-1' } }));
  const prompts: string[] = [];
  const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/v1/images/generations')) {
      prompts.push(JSON.parse(String(init?.body)).prompt);
      return Response.json({ data: [{ b64_json: PNG_B64 }] });
    }
    if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'gpt-image-1' }] });
    return new Response('not found', { status: 404 });
  };
  try {
    const { call } = await connect({ dataDir: h.dataDir, defaultWorldsDir: h.worlds, sampleDir: null, fetch: fakeFetch as never });
    const book = (await call('create_book', { name: 'Looks Test', calendar: { eras: [{ id: 'SR', name: 'Salt Reckoning', start: 1 }], defaultEra: 'SR' } })).json().book;

    // New looks in the same call as the event they follow: the event's name becomes its id.
    const first = await call('save_entries', {
      book: book.id,
      entries: [
        {
          type: 'character', name: 'Hadi', status: 'alive', born: '480', visual: { appearance: 'Grey muzzle', clothing: 'Caravan robes' },
          looks: [
            { name: 'Battle scars', reason: 'Lost an eye in the storm', after: 'The Storm Crossing', visual: { features: 'An eye patch' } },
            { name: 'Old age', from: 560 },
          ],
        },
        { type: 'event', name: 'The Storm Crossing', date: '520', participants: ['Hadi'] },
      ],
    });
    assert.ok(!first.error, first.text);
    let world = await loadWorld(book.dir);
    let hadi = world.entries.find((e) => e.id === 'char-hadi')!;
    assert.deepEqual(hadi.looks, [
      { id: 'battle-scars', name: 'Battle scars', reason: 'Lost an eye in the storm', after: 'evt-the-storm-crossing', visual: { features: 'An eye patch' } },
      { id: 'old-age', name: 'Old age', from: '560' },
    ]);
    for (const { body: _b, ...front } of world.entries) valid('entry.schema.json', front);

    // Looks are matched one by one: only the fields given change, looks left out stay, a new name adds one.
    const second = await call('save_entries', {
      book: book.id,
      entries: [{ id: 'char-hadi', looks: [{ name: 'battle scars', reason: 'Lost an eye at the Storm Crossing' }, { name: 'Coronation robes', from: '540', to: '545', visual: { clothing: 'Gold robes' }, colour: 'gold' }] }],
    });
    assert.ok(!second.error, second.text);
    assert.match(second.json().notes.join(' '), /"colour" is not a look field/);
    world = await loadWorld(book.dir);
    hadi = world.entries.find((e) => e.id === 'char-hadi')!;
    assert.deepEqual(hadi.looks?.map((l) => l.id), ['battle-scars', 'old-age', 'coronation-robes']);
    assert.equal(hadi.looks?.[0]?.reason, 'Lost an eye at the Storm Crossing');
    assert.deepEqual(hadi.looks?.[0]?.visual, { features: 'An eye patch' }, 'fields not given stay');
    assert.deepEqual(second.json().warnings, [], 'a look that gives way to the next one is no clash');

    // How Hadi looks on a date: the event day itself is still the Default look; the newest look that covers a date wins.
    const on = async (date: string, entry?: string) => (await call('look_at', { book: book.id, date, ...(entry ? { entry } : {}) })).json();
    assert.equal((await on('520', 'Hadi')).looks[0].look, 'Default');
    const scarred = (await on('530', 'Hadi')).looks[0];
    assert.equal(scarred.look, 'Battle scars');
    assert.equal(scarred.why, 'Lost an eye at the Storm Crossing');
    assert.equal(scarred.when, 'after The Storm Crossing');
    assert.deepEqual(scarred.visual, { appearance: 'Grey muzzle', clothing: 'Caravan robes', features: 'An eye patch' });
    assert.deepEqual(scarred.changes, ['features']);
    assert.equal((await on('542', 'Hadi')).looks[0].look, 'Coronation robes');
    assert.equal((await on('550', 'Hadi')).looks[0].look, 'Battle scars', 'after the coronation, back to the scars');
    assert.deepEqual((await on('600')).looks.map((l: any) => `${l.entry}: ${l.look}`), ['Hadi: Old age']);
    assert.match((await on('500')).note, /every entry has its Default look/);
    assert.ok((await call('look_at', { book: book.id, date: 'tomorrow' })).error);

    // A dated chapter lists the looks of the entries it names; an undated one does not.
    const dated = (await call('write_chapter', { book: book.id, title: 'The Crowning', date: '542', text: 'Hadi wore the crown at last.' })).json();
    assert.deepEqual(dated.looks, [{ entry: 'Hadi', look: 'Coronation robes', changes: { clothing: 'Gold robes' } }]);
    assert.equal((await call('write_chapter', { book: book.id, title: 'Before', text: 'Hadi slept.' })).json().looks, undefined);

    // A picture of a look: its own folder, the look's description and reason in the prompt, not the card picture.
    const pic = await call('create_image', { book: book.id, entry: 'Hadi', look: 'battle-scars' });
    assert.ok(!pic.error, pic.text);
    assert.equal(pic.json().saved, 'images/char-hadi/battle-scars/three-quarter.png');
    assert.equal(pic.json().look, 'Battle scars');
    assert.match(prompts.at(-1)!, /As they look in "Battle scars": Lost an eye at the Storm Crossing\.[\s\S]*An eye patch/);
    const added = await call('add_image', { book: book.id, entry: 'Hadi', look: 'Old age', source: `data:image/png;base64,${PNG_B64}` });
    assert.equal(added.json().saved, 'images/char-hadi/old-age/three-quarter.png');
    world = await loadWorld(book.dir);
    hadi = world.entries.find((e) => e.id === 'char-hadi')!;
    assert.deepEqual(hadi.images?.map((i) => i.look), ['battle-scars', 'old-age']);
    assert.equal(hadi.picture?.image, undefined, 'the card shows the Default look only');
    const wrong = await call('create_image', { book: book.id, entry: 'Hadi', look: 'Wedding' });
    assert.ok(wrong.error);
    assert.match(wrong.text, /no look "Wedding"[\s\S]*"Battle scars" \(battle-scars\)/);
    assert.match((await call('add_image', { book: book.id, entry: 'cover', look: 'Old age', source: `data:image/png;base64,${PNG_B64}` })).text, /cover has no looks/);

    // Removing a look: its pictures and 3D models go back to the Default look.
    mkdirSync(join(book.dir, 'models', 'char-hadi', 'battle-scars'), { recursive: true });
    writeFileSync(join(book.dir, 'models', 'char-hadi', 'battle-scars', 'scarred.glb'), 'glTF');
    const removed = await call('save_entries', { book: book.id, entries: [{ id: 'char-hadi', looks: [{ id: 'battle-scars', remove: true }, { name: 'Wedding', remove: true }] }] });
    assert.ok(!removed.error, removed.text);
    const notes = removed.json().notes.join(' ');
    assert.match(notes, /removed the look "Battle scars"\. Its 1 picture and 1 3D model now belong to the Default look\./);
    assert.match(notes, /there is no look "Wedding" to remove/);
    world = await loadWorld(book.dir);
    hadi = world.entries.find((e) => e.id === 'char-hadi')!;
    assert.deepEqual(hadi.looks?.map((l) => l.id), ['old-age', 'coronation-robes']);
    assert.deepEqual(hadi.images?.map((i) => i.look), [undefined, 'old-age']);
    assert.ok(existsSync(join(book.dir, 'models', 'char-hadi', 'scarred.glb')));
    assert.ok(!existsSync(join(book.dir, 'models', 'char-hadi', 'battle-scars')));

    // A new look never takes the id of a removed one in the same call, and check_book sees looks.
    const lost = (await call('save_entries', { book: book.id, entries: [{ id: 'char-hadi', looks: [{ name: 'Lost at sea', after: 'The Sinking' }] }] })).json();
    assert.ok(lost.warnings.some((w: any) => w.rule === 'look-time' && /The Sinking/.test(w.message)));
    const overview = (await call('get_book', { book: book.id })).json();
    assert.deepEqual(overview.entries.find((e: any) => e.id === 'char-hadi').looks, ['Old age', 'Coronation robes', 'Lost at sea']);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});
