/**
 * Pictures for entries and covers, made by the image service the user chose in Lore-Forge (Connect AI → Pictures),
 * with the user's own API key: OpenAI, Google Gemini or xAI Grok. The key is kept in <user data>/ai-images.json on
 * the user's computer and only ever sent to that service. Environment variables (OPENAI_API_KEY, GEMINI_API_KEY,
 * XAI_API_KEY) work too, for setups without the app.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE_PROVIDERS = ['openai', 'gemini', 'xai'] as const;
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number];
export type Aspect = 'portrait' | 'landscape' | 'square' | 'cover';
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PROVIDER_INFO: Record<ImageProvider, { label: string; env: readonly string[]; keyPage: string; fallbackModel: string }> = {
  openai: { label: 'OpenAI', env: ['OPENAI_API_KEY'], keyPage: 'https://platform.openai.com/api-keys', fallbackModel: 'gpt-image-2' },
  gemini: { label: 'Google Gemini', env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], keyPage: 'https://aistudio.google.com/apikey', fallbackModel: 'gemini-2.5-flash-image' },
  xai: { label: 'xAI Grok', env: ['XAI_API_KEY'], keyPage: 'https://console.x.ai', fallbackModel: 'grok-imagine-image' },
};

export const IMAGE_SETTINGS_FILE = 'ai-images.json';

export interface ImageSettings {
  /** The service pictures are made with; "none" (or missing) turns picture making off. */
  provider?: ImageProvider | 'none';
  /** API key per service. */
  keys?: Partial<Record<ImageProvider, string>>;
  /** Image model per service; found automatically when missing. */
  models?: Partial<Record<ImageProvider, string>>;
}

export function readImageSettings(dataDir: string): ImageSettings {
  try {
    const s = JSON.parse(readFileSync(join(dataDir, IMAGE_SETTINGS_FILE), 'utf8')) as ImageSettings;
    return typeof s === 'object' && s ? s : {};
  } catch {
    return {};
  }
}

/** Writes the settings readable by this user only (where the system supports it). */
export function writeImageSettings(dataDir: string, s: ImageSettings): void {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, IMAGE_SETTINGS_FILE);
  writeFileSync(file, JSON.stringify(s, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* not supported here */ }
}

export interface ImageSetup {
  provider: ImageProvider;
  key: string;
  /** Saved model, or undefined: found on first use. */
  model?: string;
}

/** The service and key to use, from the settings file, else the environment. Null when pictures are not set up. */
export function imageSetup(dataDir: string, env: NodeJS.ProcessEnv = process.env): ImageSetup | null {
  const s = readImageSettings(dataDir);
  const fromEnv = (p: ImageProvider) => PROVIDER_INFO[p].env.map((k) => env[k]).find((v) => !!v?.trim())?.trim();
  const chosen = s.provider ?? (env['LORE_FORGE_IMAGE_PROVIDER'] as ImageProvider | undefined);
  if (chosen === 'none') return null;
  const order: ImageProvider[] = chosen && IMAGE_PROVIDERS.includes(chosen) ? [chosen] : [...IMAGE_PROVIDERS];
  for (const p of order) {
    const key = s.keys?.[p]?.trim() || fromEnv(p);
    if (key) return { provider: p, key, ...(s.models?.[p] || env['LORE_FORGE_IMAGE_MODEL'] ? { model: s.models?.[p] || env['LORE_FORGE_IMAGE_MODEL'] } : {}) };
  }
  return null;
}

/** The message an assistant gets when no image service is set up. */
export const NO_IMAGE_SETUP =
  'Pictures are not set up in Lore-Forge yet. Tell the user: open Lore-Forge, click "Connect AI" on the library screen, choose a picture service (OpenAI, Google Gemini or xAI Grok) and paste an API key. Until then, keep writing: fill in each entry\'s "visual" description so pictures can be made later.';

// ------------------------------------------------------------------------------------------------ models

const versionOf = (id: string): number[] => (id.match(/\d+(?:\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The best image model in a service's list: the newest general one (not a "mini" or "pro" variant when another exists). */
export function pickImageModel(provider: ImageProvider, models: readonly string[]): string | undefined {
  const ids = models.map((m) => m.replace(/^models\//, ''));
  // Kind first (no mini/pro/quality variant when a general one exists), then the newest version; a preview loses a tie.
  const newest = (list: string[], penalty: (id: string) => number, tie: (id: string) => number = () => 0) =>
    [...list].sort((a, b) => penalty(a) - penalty(b) || compareVersions(versionOf(b), versionOf(a)) || tie(a) - tie(b) || a.length - b.length)[0];
  if (provider === 'openai') {
    const gpt = ids.filter((id) => /^gpt-image-\d/.test(id));
    if (gpt.length) return newest(gpt, (id) => (/mini/.test(id) ? 1 : 0));
    return ids.find((id) => id === 'chatgpt-image-latest') ?? ids.find((id) => /^dall-e-3/.test(id));
  }
  if (provider === 'gemini') {
    const gem = ids.filter((id) => /^gemini-.*image/.test(id) && !/imagen|edit/.test(id));
    return gem.length ? newest(gem, (id) => (/pro/.test(id) ? 1 : 0), (id) => (/preview|exp/.test(id) ? 1 : 0)) : undefined;
  }
  // xAI's "imagine" models replaced the numbered grok-N-image ones.
  const grok = ids.filter((id) => /imag/.test(id));
  return grok.length ? newest(grok, (id) => (/imagine/.test(id) ? 0 : 2) + (/pro|quality/.test(id) ? 1 : 0)) : undefined;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function errorText(service: string, status: number, body: Record<string, unknown>): string {
  const err = body['error'];
  const msg = typeof err === 'string' ? err : (err as { message?: string } | undefined)?.message ?? (body['message'] as string | undefined) ?? 'no details';
  const hint = status === 401 || status === 403 ? ' Check the API key in Lore-Forge → Connect AI.' : status === 429 ? ' The account is out of credit or over its rate limit.' : '';
  return `${service} answered ${status}: ${msg}.${hint}`;
}

/** The image models this key can use, newest first is not guaranteed. */
export async function listImageModels(provider: ImageProvider, key: string, fetchFn: FetchLike = fetch): Promise<string[]> {
  const signal = AbortSignal.timeout(30_000);
  if (provider === 'openai') {
    const res = await fetchFn('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal });
    const body = await readJson(res);
    if (!res.ok) throw new Error(errorText('OpenAI', res.status, body));
    return ((body['data'] as { id: string }[] | undefined) ?? []).map((m) => m.id).filter((id) => /image|dall-e/.test(id));
  }
  if (provider === 'gemini') {
    const res = await fetchFn('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, signal });
    const body = await readJson(res);
    if (!res.ok) throw new Error(errorText('Google Gemini', res.status, body));
    return ((body['models'] as { name: string; supportedGenerationMethods?: string[] }[] | undefined) ?? [])
      .filter((m) => /image/.test(m.name) && (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  }
  for (const path of ['image-generation-models', 'models']) {
    const res = await fetchFn(`https://api.x.ai/v1/${path}`, { headers: { Authorization: `Bearer ${key}` }, signal });
    const body = await readJson(res);
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(errorText('xAI', res.status, body));
    const list = (body['models'] ?? body['data']) as { id: string }[] | undefined;
    return (list ?? []).map((m) => m.id).filter((id) => /imag/.test(id));
  }
  return [];
}

// ------------------------------------------------------------------------------------------------ making

export interface GeneratedImage {
  data: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  ext: 'png' | 'jpg' | 'webp';
  model: string;
}

/** PNG, JPEG or WebP, from the first bytes. */
export function sniffImage(data: Uint8Array): Pick<GeneratedImage, 'mime' | 'ext'> | null {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

const RATIO: Record<Aspect, string> = { portrait: '3:4', landscape: '16:9', square: '1:1', cover: '2:3' };

async function bytesFrom(item: { b64_json?: string; url?: string } | undefined, fetchFn: FetchLike, service: string): Promise<Uint8Array> {
  if (item?.b64_json) return Uint8Array.from(Buffer.from(item.b64_json, 'base64'));
  if (item?.url) {
    const res = await fetchFn(item.url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${service} made the picture but it could not be downloaded (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error(`${service} sent no picture back.`);
}

type Body = Record<string, unknown>;

/**
 * POSTs JSON. When the service answers 400, `simpler` may return a plainer request for one more try: older models
 * reject an aspect ratio or a quality setting they do not know.
 */
async function postJson(fetchFn: FetchLike, url: string, headers: Record<string, string>, body: Body, service: string, simpler?: (error: string) => Body | null): Promise<Body> {
  const send = async (b: Body) => {
    const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(b), signal: AbortSignal.timeout(240_000) });
    return { res, json: await readJson(res) };
  };
  let { res, json } = await send(body);
  const retry = res.status === 400 && simpler ? simpler(JSON.stringify(json).toLowerCase()) : null;
  if (retry) ({ res, json } = await send(retry));
  if (!res.ok) throw new Error(errorText(service, res.status, json));
  return json;
}

const without = (b: Body, ...keys: string[]): Body => Object.fromEntries(Object.entries(b).filter(([k]) => !keys.includes(k)));

export interface GenerateRequest {
  provider: ImageProvider;
  key: string;
  model: string;
  prompt: string;
  aspect: Aspect;
}

export async function generateImage(r: GenerateRequest, fetchFn: FetchLike = fetch): Promise<GeneratedImage> {
  let data: Uint8Array;
  const service = PROVIDER_INFO[r.provider].label;
  if (r.provider === 'openai') {
    const dalle = /^dall-e/.test(r.model);
    const size = dalle
      ? { portrait: '1024x1792', landscape: '1792x1024', square: '1024x1024', cover: '1024x1792' }[r.aspect]
      : { portrait: '1024x1536', landscape: '1536x1024', square: '1024x1024', cover: '1024x1536' }[r.aspect];
    const body: Body = { model: r.model, prompt: r.prompt, n: 1, size, ...(dalle ? { response_format: 'b64_json' } : { quality: 'medium' }) };
    const json = await postJson(fetchFn, 'https://api.openai.com/v1/images/generations', { Authorization: `Bearer ${r.key}` }, body, service,
      (e) => (/quality|size/.test(e) ? without(body, 'quality', 'size') : null));
    data = await bytesFrom((json['data'] as { b64_json?: string; url?: string }[] | undefined)?.[0], fetchFn, service);
  } else if (r.provider === 'gemini') {
    const name = r.model.startsWith('models/') ? r.model : `models/${r.model}`;
    const contents = [{ role: 'user', parts: [{ text: r.prompt }] }];
    const json = await postJson(fetchFn, `https://generativelanguage.googleapis.com/v1beta/${name}:generateContent`, { 'x-goog-api-key': r.key },
      { contents, generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: RATIO[r.aspect] } } }, service,
      // Older image models want TEXT with IMAGE and know no image settings.
      (e) => (/imageconfig|image_config|aspect|modalit/.test(e) ? { contents, generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } } : null));
    const cand = (json['candidates'] as { content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] }; finishReason?: string }[] | undefined)?.[0];
    const part = cand?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
    const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
    if (!b64) {
      const why = (json['promptFeedback'] as { blockReason?: string } | undefined)?.blockReason ?? cand?.finishReason ?? 'no picture in the answer';
      throw new Error(`Google Gemini made no picture (${why}). Try a gentler or more concrete prompt.`);
    }
    data = Uint8Array.from(Buffer.from(b64, 'base64'));
  } else {
    const body: Body = { model: r.model, prompt: r.prompt, n: 1, response_format: 'b64_json', aspect_ratio: RATIO[r.aspect] };
    const json = await postJson(fetchFn, 'https://api.x.ai/v1/images/generations', { Authorization: `Bearer ${r.key}` }, body, service,
      (e) => (/aspect/.test(e) ? without(body, 'aspect_ratio') : null));
    data = await bytesFrom((json['data'] as { b64_json?: string; url?: string }[] | undefined)?.[0], fetchFn, service);
  }
  const kind = sniffImage(data);
  if (!kind) throw new Error(`${service} sent something that is not a PNG, JPEG or WebP picture.`);
  return { data, ...kind, model: r.model };
}

/** Which aspect suits a view: portraits for people, wide shots for places and scenes, square for objects and emblems. */
export function aspectFor(type: string, view: string): Aspect {
  if (view === 'cover') return 'cover';
  if (['establishing', 'map', 'exterior', 'interior', 'mood', 'scene', 'headquarters'].includes(view)) return 'landscape';
  if (['front', 'back', 'left', 'right', 'three-quarter', 'a-pose', 'uniform', 'banner'].includes(view)) return type === 'item' ? 'square' : 'portrait';
  if (view === 'illustration') return 'landscape';
  if (type === 'character') return 'portrait';
  if (type === 'place' || type === 'event') return 'landscape';
  return 'square';
}
