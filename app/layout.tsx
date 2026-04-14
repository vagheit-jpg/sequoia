import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sequoia MVP',
  description: '실시간 주가, 월봉 60월선, 재무 그래프, DCF를 담은 국내주식 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
