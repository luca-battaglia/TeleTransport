import { ImageResponse } from 'next/og';
import { COLOR, ICON_PATHS, geistFonts } from '@/lib/ogImage';
import { decodeTrip, shareWords, viewOf } from '@/lib/share';

// The card WhatsApp and Telegram show under a shared link, laid out like an
// operator's results row: times large, stations under them, price last.

export const alt = 'A train or flight shared from TeleTransport';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Long station names ("Torino ( Tutte Le Stazioni )") shrink before they wrap.
const placeSize = (name: string) => (name.length <= 16 ? 44 : name.length <= 26 ? 36 : 30);

export default async function Image({ params }: { params: Promise<{ trip: string }> }) {
  const trip = decodeTrip((await params).trip);
  if (!trip) return new Response(null, { status: 404 });

  const view = viewOf(trip);
  const words = shareWords(trip.lang);
  const kind = view.kind.toUpperCase();
  const dayOffset = view.arrDayOffset > 0 ? `+${view.arrDayOffset}` : '';

  const glyphs = [kind, view.longDay, view.depTime, view.arrTime, dayOffset, trip.origin, trip.destination,
    view.duration, view.changes, view.legs, view.price, words.price_note, 'TeleTransport'].join('');
  const fonts = await geistFonts(glyphs);

  const place = (name: string, align: 'flex-start' | 'flex-end') => (
    <div style={{ display: 'flex', justifyContent: align, textAlign: align === 'flex-end' ? 'right' : 'left', fontSize: placeSize(name), marginTop: 12, lineHeight: 1.15 }}>
      {name}
    </div>
  );

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: COLOR.background, color: COLOR.text, padding: '56px 64px', fontFamily: 'Geist',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 18, background: COLOR.accent }}>
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {ICON_PATHS[trip.mode].map(d => <path key={d} d={d} />)}
              </svg>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3, color: COLOR.accent }}>{kind}</div>
              <div style={{ fontSize: 32 }}>{view.longDay}</div>
            </div>
          </div>
          <div style={{ fontSize: 28, color: COLOR.muted }}>TeleTransport</div>
        </div>

        <div style={{ display: 'flex', flex: 1, alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 380 }}>
            <div style={{ fontSize: 112, fontWeight: 700, lineHeight: 1 }}>{view.depTime}</div>
            {place(trip.origin, 'flex-start')}
          </div>

          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', padding: '0 28px' }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{view.duration}</div>
            <div style={{ display: 'flex', alignItems: 'center', width: '100%', margin: '14px 0' }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, background: COLOR.accent }} />
              <div style={{ flex: 1, height: 4, background: COLOR.accent }} />
              <div style={{ width: 16, height: 16, borderRadius: 8, background: COLOR.accent }} />
            </div>
            <div style={{ fontSize: 30, color: COLOR.muted }}>{view.changes}</div>
            {view.legs ? <div style={{ fontSize: 24, color: COLOR.muted, marginTop: 8, textAlign: 'center' }}>{view.legs}</div> : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: 380 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div style={{ fontSize: 112, fontWeight: 700, lineHeight: 1 }}>{view.arrTime}</div>
              {dayOffset ? <div style={{ fontSize: 34, fontWeight: 700, color: COLOR.accent, marginLeft: 8 }}>{dayOffset}</div> : null}
            </div>
            {place(trip.destination, 'flex-end')}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: `2px solid ${COLOR.border}`, paddingTop: 28 }}>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1 }}>{view.price}</div>
          <div style={{ fontSize: 26, color: COLOR.muted, marginBottom: 8 }}>{words.price_note}</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
      // Without the right fonts, retry soon rather than keep the plain card for a year.
      ...(fonts ? {} : { headers: { 'Cache-Control': 'public, max-age=300' } }),
    }
  );
}
