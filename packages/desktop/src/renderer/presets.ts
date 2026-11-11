/**
 * Ready writing and picture styles: World settings offers them under its style fields, and a new book's template
 * starts from them (templates.ts).
 */
import { t } from '../shared/i18n.ts';

/** A ready style: its id (for templates), its name on the button, and the text it puts in the field. */
export interface Preset {
  id: string;
  name: string;
  text: string;
}

/** Ready writing styles to start from: one fills the field, to use as it is or to change. In the app's language. */
export const writingPresets = (): Preset[] => [
  { id: 'cozy', name: t('Cozy'), text: t('Third person, past tense. Warm and unhurried: small comforts, kind people, and troubles that feel big to the characters but end well. Clear, gentle sentences; humour from the characters.') },
  { id: 'funny', name: t('Funny'), text: t('Third person, past tense. Light and funny: comic timing, dry understatement and quick dialogue. The humour comes from the characters and their situation, never from winking at the reader. Short scenes.') },
  { id: 'adventure', name: t('Adventure'), text: t('Third person, past tense. Fast and vivid: journeys, danger and narrow escapes. Every chapter moves the quest on and ends on a hook. Strong verbs; short paragraphs when the action starts.') },
  { id: 'epic', name: t('Epic'), text: t('Third person, past tense, moving between a few points of view. Serious and wide in scope: kingdoms, old powers and hard choices with a cost. Rich but clear description of places, customs and history.') },
  { id: 'sci-fi', name: t('Science fiction'), text: t('Third person, past tense. Clear and grounded: technology with rules of its own, shown through what people do with it, never explained in lectures. Wonder, with costs that follow. Precise, plain sentences.') },
  { id: 'mystery', name: t('Mystery'), text: t('Close third person, past tense. Quiet and puzzling: fair clues, secrets that come out slowly, and every scene holding something back. Precise detail and short, guarded dialogue.') },
  { id: 'creepy', name: t('Creepy'), text: t('Close third person, past tense. Slow and unsettling: ordinary things that are slightly wrong, sounds and silences, a dread that grows. Little gore; what is not shown matters most.') },
  { id: 'horror', name: t('Horror'), text: t('Close third person, past tense. Dark and frightening: real danger, fear felt in the body, and threats that can win. Specific, sensory detail; short sentences when it strikes. Violence when the story needs it, never for its own sake.') },
  { id: 'dark', name: t('Dark and gritty'), text: t('Close third person, past tense. Harsh and grounded: flawed people, hard choices and costs that stay. Plain, blunt prose; no clean heroes and no easy wins.') },
  { id: 'fairy-tale', name: t('Fairy tale'), text: t('Told like an old tale, in the third person and the past tense: once upon a time, magic with rules, clear good and bad, and a simple, wise voice for readers of every age.') },
];

/**
 * Ready picture styles. Their text stays in English in every language, like the rest of a picture prompt: image
 * models read English best.
 */
export const picturePresets = (): Preset[] => [
  { id: 'painterly', name: t('Painterly fantasy'), text: 'Painterly fantasy concept art, rich colour, soft brushwork, warm dramatic light' },
  { id: 'storybook', name: t('Storybook'), text: 'Storybook watercolour illustration, soft edges, gentle colours, hand-drawn ink lines' },
  { id: 'comic', name: t('Comic book'), text: 'Bold comic book art, clean ink outlines, flat bright colours, dynamic angles' },
  { id: 'anime', name: t('Anime'), text: 'Anime illustration, clean line art, cel shading, vivid colours, expressive faces' },
  { id: 'dark-ink', name: t('Dark ink'), text: 'Dark ink and wash illustration, heavy shadows, muted colours, an uneasy mood' },
  { id: 'gothic', name: t('Gothic horror'), text: 'Gothic horror oil painting, deep shadows, candlelight, desaturated colours' },
  { id: 'pixel', name: t('Pixel art'), text: 'Detailed pixel art in a 16-bit game style, limited palette, crisp edges' },
  { id: 'cinematic', name: t('Cinematic'), text: 'Cinematic realistic concept art, natural light, detailed textures, like a film still' },
];
