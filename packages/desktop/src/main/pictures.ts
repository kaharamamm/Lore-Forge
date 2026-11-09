/**
 * Making a picture from the app (an entry's picture tiles): the picture service set in Connect AI → Pictures, the same
 * one the AI tools use, with the prompt the window shows (core picturePrompt). The picture is saved into the world
 * folder and the editor adds it to the entry, like a picked file. Keys stay here: the window only learns which
 * service and model will draw.
 */
import { ipcMain } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  aspectFor, generateImage, imageSetup, listImageModels, pickImageModel, PROVIDER_INFO, readImageSettings, writeImageSettings, type ImageSetup,
} from '@lore-forge/mcp/images';
import type { PictureMade, PictureService } from '../shared/api.ts';
import { t } from '../shared/i18n.ts';
import { ownTouch } from './watch.ts';

/** A model id a service no longer knows: the next best is found and tried once more. */
const lostModel = (msg: string): boolean => /model/i.test(msg) && /not found|does not exist|unknown|invalid|no longer|deprecated|retired|not supported/i.test(msg);

export function registerPictures(dataDir: () => string): void {
  /** The model found for a service and key, this session. */
  const found = new Map<string, string>();
  const modelFor = async (setup: ImageSetup, avoid?: string): Promise<string> => {
    if (setup.model && setup.model !== avoid) return setup.model;
    const known = found.get(`${setup.provider}\n${setup.key}`);
    if (known && known !== avoid) return known;
    let model: string | undefined;
    try {
      model = pickImageModel(setup.provider, (await listImageModels(setup.provider, setup.key)).filter((m) => m !== avoid));
    } catch { /* fall back below */ }
    model ??= PROVIDER_INFO[setup.provider].fallbackModel;
    found.set(`${setup.provider}\n${setup.key}`, model);
    const s = readImageSettings(dataDir());
    if (s.keys?.[setup.provider]) writeImageSettings(dataDir(), { ...s, models: { ...s.models, [setup.provider]: model } });
    return model;
  };

  // Tests: a picture file that stands in for a service (it "draws" after LORE_FORGE_PICTURE_DELAY ms).
  const fake = process.env['LORE_FORGE_PICTURE_FILE'];

  ipcMain.handle('pictureService', (): PictureService | null => {
    if (fake) return { service: 'Test pictures', model: 'a file' };
    const setup = imageSetup(dataDir());
    if (!setup) return null;
    const model = setup.model ?? found.get(`${setup.provider}\n${setup.key}`);
    return { service: PROVIDER_INFO[setup.provider].label, ...(model ? { model } : {}) };
  });

  ipcMain.handle('pictureMake', async (_e, dir: string, entryId: string, type: string, view: string, look: string | null, prompt: string): Promise<PictureMade> => {
    const setup = fake ? null : imageSetup(dataDir());
    if (!setup && !fake) throw new Error(t('No picture service is set up. In the library, open Connect AI and add a key under Pictures.'));
    const text = String(prompt ?? '').trim().slice(0, 8000);
    if (!text) throw new Error(t('Write what the picture should show first.'));
    const aspect = aspectFor(type, view);
    let img: { data: Uint8Array; ext: string; model: string };
    let label = 'Test pictures';
    if (fake || !setup) {
      await new Promise((r) => setTimeout(r, Number(process.env['LORE_FORGE_PICTURE_DELAY'] ?? 0)));
      img = { data: await readFile(fake!), ext: 'png', model: `${aspect} test` };
    } else {
      label = PROVIDER_INFO[setup.provider].label;
      let model = await modelFor(setup);
      try {
        img = await generateImage({ provider: setup.provider, key: setup.key, model, prompt: text, aspect });
      } catch (e) {
        if (!lostModel((e as Error).message)) throw e;
        model = await modelFor({ ...setup, model: '' }, model);
        img = await generateImage({ provider: setup.provider, key: setup.key, model, prompt: text, aspect });
      }
    }
    // Next to the entry's other pictures (a look's in its own folder), named by view and when it was made.
    const safe = (s: string): string => s.replace(/[^\w-]+/g, '-');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const rel = `images/${safe(entryId)}/${look ? `${safe(look)}/` : ''}${safe(view)}-made-${stamp}.${img.ext}`;
    const full = resolve(dir, rel);
    const inside = relative(resolve(dir), full);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(t('Refusing to touch a file outside the world folder: {path}', { path: rel }));
    await mkdir(dirname(full), { recursive: true });
    ownTouch(full);
    await writeFile(full, img.data);
    return { file: rel, tool: `${label} ${img.model} via Lore-Forge`, model: img.model };
  });
}
