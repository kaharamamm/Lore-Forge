/**
 * Cover title fonts that ship with the app (all SIL Open Font License 1.1). The desktop app loads them as web fonts and
 * the PDF embeds the same faces (as .woff, which pdfkit can embed), so a cover looks alike on the shelf and in print. Any other family name in world.json
 * "cover.font" is a system font: used when this computer has it, else the title style's lettering.
 */
export interface BundledFont {
  family: string;
  /** Rough look, shown next to the name in the picker. */
  kind: 'serif' | 'sans' | 'decorative' | 'blackletter' | 'script';
  /** @fontsource package id (files/<id>-latin-<weight>-normal.woff2 on screen, .woff in the PDF), or "liberation" for the TTFs in packages/pdf/fonts. */
  source: string;
  /** The weights shipped; the first is the regular face. */
  weights: number[];
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { family: 'Almendra', kind: 'decorative', source: 'almendra', weights: [400, 700] },
  { family: 'Caladea', kind: 'serif', source: 'caladea', weights: [400, 700] },
  { family: 'Carlito', kind: 'sans', source: 'carlito', weights: [400, 700] },
  { family: 'Cinzel Decorative', kind: 'decorative', source: 'cinzel-decorative', weights: [400, 700] },
  { family: 'Cormorant Garamond', kind: 'serif', source: 'cormorant-garamond', weights: [400, 700] },
  { family: 'EB Garamond', kind: 'serif', source: 'eb-garamond', weights: [400, 700] },
  { family: 'Great Vibes', kind: 'script', source: 'great-vibes', weights: [400] },
  { family: 'IM Fell English', kind: 'serif', source: 'im-fell-english', weights: [400] },
  { family: 'Liberation Sans', kind: 'sans', source: 'liberation', weights: [400, 700] },
  { family: 'Liberation Serif', kind: 'serif', source: 'liberation', weights: [400, 700] },
  { family: 'MedievalSharp', kind: 'decorative', source: 'medievalsharp', weights: [400] },
  { family: 'Metamorphous', kind: 'decorative', source: 'metamorphous', weights: [400] },
  { family: 'Pirata One', kind: 'blackletter', source: 'pirata-one', weights: [400] },
  { family: 'Playfair Display', kind: 'serif', source: 'playfair-display', weights: [400, 700] },
  { family: 'Uncial Antiqua', kind: 'decorative', source: 'uncial-antiqua', weights: [400] },
  { family: 'UnifrakturMaguntia', kind: 'blackletter', source: 'unifrakturmaguntia', weights: [400] },
];

/** The bundled font with this family name (any case), if there is one. */
export function bundledFont(family: string | undefined): BundledFont | undefined {
  const f = family?.trim().toLowerCase();
  return f ? BUNDLED_FONTS.find((b) => b.family.toLowerCase() === f) : undefined;
}
