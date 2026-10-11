import './globals.css';
import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: env.APP_NAME,
  description: `${env.APP_NAME} community chat`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="oled">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
