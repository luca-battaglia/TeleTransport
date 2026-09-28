import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink } from 'lucide-react';
import { arrivalLabel, bookingUrl, changesLabel, decodeTrip, shareWords, viewOf } from '@/lib/share';

// Where a shared link lands. WhatsApp and Telegram only read its metadata and
// the card next to it; a person who opens it gets the card and the operator's
// booking page one click away.

type Props = { params: Promise<{ trip: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trip = decodeTrip((await params).trip);
  if (!trip) return {};
  const view = viewOf(trip);
  const title = `${view.route} · ${view.price}`;
  const description = `${view.kind} · ${view.shortDay} · ${view.depTime} → ${arrivalLabel(view)} · ${view.duration} · ${changesLabel(view)}`;
  return {
    title,
    description,
    openGraph: { title, description, siteName: 'TeleTransport', type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: false },
  };
}

export default async function SharedTripPage({ params }: Props) {
  const { trip: token } = await params;
  const trip = decodeTrip(token);
  if (!trip) notFound();

  const view = viewOf(trip);
  const words = shareWords(trip.lang);

  return (
    <div className="shared-trip">
      {/* Already a PNG at its final size, so it skips the image optimizer. */}
      <Image
        className="shared-trip-card"
        src={`/s/${token}/opengraph-image`}
        alt={`${view.route}, ${view.shortDay}, ${view.depTime} → ${arrivalLabel(view)}, ${changesLabel(view)}, ${view.price}`}
        width={1200}
        height={630}
        unoptimized
        loading="eager"
      />
      <div className="shared-trip-actions">
        <a className="btn-primary with-icon" href={bookingUrl(trip)} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={16} />
          {trip.mode === 'trains' ? words.book_trains : words.book_flights}
        </a>
        <Link className="btn-outline" href="/">{words.search_own}</Link>
      </div>
    </div>
  );
}
