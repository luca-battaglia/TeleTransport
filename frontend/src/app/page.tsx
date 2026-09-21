"use client";

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// The dashboard restores its state from browser storage while it initializes,
// which has no server-side equivalent, so it renders on the client only.
const Dashboard = dynamic(() => import('@/components/Dashboard'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '64px' }}>
      <Loader2 className="animate-spin" size={32} />
    </div>
  ),
});

export default function Home() {
  return <Dashboard />;
}
