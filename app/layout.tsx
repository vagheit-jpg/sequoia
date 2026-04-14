import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'sequoia quantum system',
  description: '키움 시세, OpenDART 재무, 월봉 60월선과 이격도 신호를 결합한 국내주식 대시보드',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
