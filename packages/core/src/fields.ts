/**
 * A book's own fields (world.json "fields"): for each entry type, fields such as HP and Strength for characters or
 * Damage and Rarity for items. An entry keeps its values under "fields" in its file, by the field's key. They show in
 * the editor and the World Codex, and go into game data (the snapshot) as they are: numbers as numbers, yes or no as
 * true or false.
 */
import { msg, verbatim } from './i18n.ts';
import { ENTRY_TYPES, type CustomField, type CustomFieldKind, type CustomFieldValue, type EntryType, type WorldManifest } from './types.ts';

export const CUSTOM_FIELD_KINDS: readonly CustomFieldKind[] = ['text', 'number', 'yes-no', 'choice'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The fields a book gives one entry type, in their order. */
export function customFields(manifest: Pick<WorldManifest, 'fields'>, type: EntryType): readonly CustomField[] {
  return manifest.fields?.[type] ?? [];
}

/**
 * A key for a new field, made from its name the way code names things: "Hit points" -> "hitPoints", "Güç" -> "guc".
 * Never one of `taken` (compared without case).
 */
export function fieldKey(name: string, taken: Iterable<string> = []): string {
  const words = name.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/\p{M}/gu, '').split(/[^a-z0-9]+/).filter(Boolean);
  let base = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join('') || 'field';
  if (/^\d/.test(base)) base = `field${base}`;
  const used = new Set([...taken].map((k) => k.toLowerCase()));
  let key = base;
  for (let n = 2; used.has(key.toLowerCase()); n++) key = `${base}${n}`;
  return key;
}

/** A value as the World Codex shows it: yes or no in words, numbers and text as they are. */
export function fieldValueText(value: CustomFieldValue | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value ? msg`Yes` : msg`No`;
  return String(value);
}

/** What a value lacks for its field: a number, yes or no, or one of the choices; undefined when it fits. */
export function fieldValueProblem(field: CustomField, value: CustomFieldValue): 'number' | 'yes-no' | 'choice' | undefined {
  switch (field.kind) {
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? undefined : 'number';
    case 'yes-no': return typeof value === 'boolean' ? undefined : 'yes-no';
    case 'choice': return field.choices?.includes(String(value)) ? undefined : 'choice';
    default: return undefined;
  }
}

/**
 * world.json "fields": for each entry type a list of fields, each with a key, a name and a kind (text when left out;
 * a choice also needs its choices). Fields that cannot be used are set aside with an issue, so the others still work;
 * keys Lore-Forge does not know stay on the field.
 */
export function parseCustomFields(v: unknown, issues: string[]): WorldManifest['fields'] {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) {
    issues.push(msg`"fields" should list fields for each type of entry, such as { "character": [{ "key": "hp", "name": "HP", "kind": "number" }] }. The fields were left out.`);
    return undefined;
  }
  const out: Partial<Record<EntryType, CustomField[]>> = {};
  for (const [type, list] of Object.entries(v)) {
    if (!(ENTRY_TYPES as readonly string[]).includes(type)) {
      issues.push(msg`"fields" has "${verbatim(type)}", which is not a type of entry (${verbatim(ENTRY_TYPES.join(', '))}). Those fields were left out.`);
      continue;
    }
    if (!Array.isArray(list)) {
      issues.push(msg`"fields.${verbatim(type)}" should be a list of fields. They were left out.`);
      continue;
    }
    const seen = new Set<string>();
    const fields: CustomField[] = [];
    list.forEach((f: unknown, i) => {
      const text = (k: string): string => (isObj(f) && typeof f[k] === 'string' ? (f[k] as string).trim() : '');
      const kind = isObj(f) ? (f['kind'] ?? 'text') : undefined;
      if (!isObj(f) || !text('key') || !text('name') || !(CUSTOM_FIELD_KINDS as readonly unknown[]).includes(kind)) {
        return void issues.push(msg`Field ${i + 1} in "fields.${verbatim(type)}" needs a text "key" and "name", and a "kind" of text, number, yes-no or choice. It was left out.`);
      }
      const key = text('key');
      if (seen.has(key.toLowerCase())) return void issues.push(msg`Field ${i + 1} in "fields.${verbatim(type)}" has the key of an earlier field ("${verbatim(key)}"). It was left out.`);
      seen.add(key.toLowerCase());
      const { choices: rawChoices, ...rest } = f;
      const choices = Array.isArray(rawChoices) ? [...new Set(rawChoices.filter((c) => typeof c === 'string' || typeof c === 'number').map((c) => String(c).trim()).filter(Boolean))] : [];
      if (kind === 'choice' && !choices.length) return void issues.push(msg`The choice field "${verbatim(text('name'))}" in "fields.${verbatim(type)}" needs its "choices". It was left out.`);
      fields.push({ ...rest, key, name: text('name'), kind: kind as CustomFieldKind, ...(kind === 'choice' ? { choices } : {}) } as CustomField);
    });
    if (fields.length) out[type as EntryType] = fields;
  }
  return Object.keys(out).length ? out : undefined;
}
