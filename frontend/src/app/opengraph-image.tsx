import { ImageResponse } from 'next/og';
import { COLOR, ICON_PATHS, geistFonts } from '@/lib/ogImage';

// The card under a link to the site itself. It is built once, at build time,
// and in English: a link preview is fetched by a crawler, which has no language
// setting to follow. Shared trips have their own card in app/s/[trip].

export const alt = 'TeleTransport: trains and flights ranked by what the trip really costs you';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const TEXT = {
  name: 'TeleTransport',
  subtitle: 'Time is money',
  headline: 'Trains and flights, ranked by what the trip really costs you',
  detail: 'Travel time, early starts, late arrivals and changes, priced in euros.',
  sources: ['Trenitalia', 'Google Flights'],
};

const icon = (paths: string[], size: number, color: string) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {paths.map(d => <path key={d} d={d} />)}
  </svg>
);

export default async function Image() {
  const fonts = await geistFonts(Object.values(TEXT).flat().join(''));

  const source = (name: string, paths: string[]) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px',
      border: `2px solid ${COLOR.border}`, borderRadius: 999, fontSize: 28,
    }}>
      {icon(paths, 30, COLOR.accent)}
      {name}
    </div>
  );

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        background: COLOR.background, color: COLOR.text, padding: '64px 72px', fontFamily: 'Geist',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 88, height: 88, borderRadius: 22, background: COLOR.accent }}>
            {icon(ICON_PATHS.logo, 52, '#ffffff')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: -1, lineHeight: 1 }}>{TEXT.name}</div>
            <div style={{ fontSize: 28, color: COLOR.muted, marginTop: 8 }}>{TEXT.subtitle}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5 }}>{TEXT.headline}</div>
          <div style={{ fontSize: 32, color: COLOR.muted, marginTop: 24 }}>{TEXT.detail}</div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          {source(TEXT.sources[0], ICON_PATHS.trains)}
          {source(TEXT.sources[1], ICON_PATHS.flights)}
        </div>
      </div>
    ),
    { ...size, fonts }
  );
}
