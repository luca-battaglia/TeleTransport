import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "TeleTransport",
  description: "Search and compare trains and flights ranked by their real cost, not just the ticket price.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Applies the stored theme and language before first paint, so the page
            does not flash light or English before React takes over. */}
        <Script
          id="preferences-script"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var pref = localStorage.getItem('theme_preference') || 'system';
                  var isDark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                  if (isDark) { document.documentElement.classList.add('dark'); document.body.classList.add('dark'); }
                  var lang = localStorage.getItem('app_language');
                  if (lang === 'it' || lang === 'en') { document.documentElement.lang = lang; }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <LanguageProvider>
          <div className="container" style={{ paddingTop: '24px', paddingBottom: '32px' }}>
            <Navbar />
            <main>
              {children}
            </main>
            <Footer />
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
