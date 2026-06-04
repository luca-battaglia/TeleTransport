import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Script from "next/script";

export const metadata: Metadata = {
  title: "TeleTransport | Full-Stack",
  description: "Ricerca Treni e Voli",
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
            id="theme-script"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  try {
                    var pref = localStorage.getItem('theme_preference') || 'system';
                    var isDark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                    if (isDark) { document.documentElement.classList.add('dark'); document.body.classList.add('dark'); }
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
