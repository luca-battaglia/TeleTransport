"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, MessageCircle, Send, Share2, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';
import { encodeTrip, shareMessage, type SharedTrip } from '@/lib/share';

interface ShareModalProps {
  trip: SharedTrip | null;
  onClose: () => void;
}

export default function ShareModal({ trip, onClose }: ShareModalProps) {
  useEffect(() => {
    if (!trip) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [trip, onClose]);

  // Keyed by the trip, so "Copied" never carries over to the next solution.
  return trip ? <SharePanel key={encodeTrip(trip)} trip={trip} onClose={onClose} /> : null;
}

function SharePanel({ trip, onClose }: { trip: SharedTrip; onClose: () => void }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const path = `/s/${encodeTrip(trip)}`;
  const url = `${window.location.origin}${path}`;
  const message = shareMessage(trip);
  // The link goes last: WhatsApp and Telegram build the preview card from it.
  const fullText = `${message}\n${url}`;
  const canShareNatively = typeof navigator.share === 'function';

  const copy = () => {
    navigator.clipboard
      .writeText(fullText)
      .then(() => setCopied(true))
      .catch(err => console.error('Clipboard error', err));
  };

  // Dismissing the system share sheet rejects with an AbortError, which is not a failure.
  const shareNatively = () => {
    navigator.share({ text: fullText }).catch(err => {
      if (err?.name !== 'AbortError') console.error('Share error', err);
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="glass-panel modal-panel" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>
          <X size={24} />
        </button>

        <h2 id="share-title" className="modal-title">
          <Share2 size={22} />
          {t('share_title')}
        </h2>

        <a className="share-preview" href={path} target="_blank" rel="noopener" title={t('share_open_page')}>
          <Image src={`${path}/opengraph-image`} alt={t('share_preview_alt')} width={1200} height={630} unoptimized />
        </a>

        <div className="share-actions">
          <a
            className="btn-outline with-icon"
            href={`https://wa.me/?text=${encodeURIComponent(fullText)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle size={18} />
            WhatsApp
          </a>
          <a
            className="btn-outline with-icon"
            href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Send size={18} />
            Telegram
          </a>
          <button type="button" className="btn-outline with-icon" onClick={copy}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? t('share_copied') : t('share_copy')}
          </button>
          {canShareNatively && (
            <button type="button" className="btn-outline with-icon" onClick={shareNatively}>
              <Share2 size={18} />
              {t('share_more')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
