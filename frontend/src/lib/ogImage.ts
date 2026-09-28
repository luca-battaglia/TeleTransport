// What the link preview images share: the site's card (app/opengraph-image.tsx)
// and a shared trip's (app/s/[trip]/opengraph-image.tsx). Both render on the
// server through next/og.

// Solarized light, the app's default theme.
export const COLOR = {
  background: '#fdf6e3',
  text: '#073642',
  muted: '#586e75',
  accent: '#268bd2',
  border: '#d6d0bc',
};

// Lucide icons, inline because the renderer only takes plain SVG: the navbar's
// train (also app/icon.svg), then train-front and plane for the two modes.
export const ICON_PATHS = {
  logo: [
    'M6 3h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M4 11h16',
    'M12 3v8',
    'm8 19-2 3',
    'm18 22-2-3',
    'M8 15h.01',
    'M16 15h.01',
  ],
  trains: [
    'M8 3.1V7a4 4 0 0 0 8 0V3.1',
    'm9 15-1-1',
    'm15 15 1-1',
    'M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z',
    'm8 19-2 3',
    'm16 19 2 3',
  ],
  flights: [
    'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  ],
};

async function loadGeist(weight: 400 | 700, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Geist:wght@${weight}&text=${encodeURIComponent(text)}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) throw new Error('no TrueType source in the stylesheet');
    const font = await fetch(url);
    if (!font.ok) throw new Error(`HTTP ${font.status}`);
    return await font.arrayBuffer();
  } catch (err) {
    console.warn(`Geist ${weight} unavailable, using the bundled font:`, err);
    return null;
  }
}

// The renderer bundles Geist in its regular weight only. Both weights come from
// Google Fonts instead, subset to the characters on the card. Should that fail,
// this returns undefined and the card renders in the bundled font, just without bold.
export async function geistFonts(text: string) {
  const [regular, bold] = await Promise.all([loadGeist(400, text), loadGeist(700, text)]);
  return regular && bold
    ? [
      { name: 'Geist', data: regular, weight: 400 as const, style: 'normal' as const },
      { name: 'Geist', data: bold, weight: 700 as const, style: 'normal' as const },
    ]
    : undefined;
}
