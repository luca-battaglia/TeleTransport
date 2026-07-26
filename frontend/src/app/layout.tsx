import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Script from "next/script";

export const metadata: Metadata = {
  title: "TeleTransport",
  description: "Search and compare trains and flights ranked by their real cost, not just the ticket price.",
};
import { LanguageProvider } from "@/lib/i18n";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
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
          <div className="container" style={{ paddingTop: '24px', paddingBottom: '64px' }}>
            <Navbar />
            <main>
              {children}
            </main>
          </div>
        </LanguageProvider>
      </body>
    </html>
  );
}
