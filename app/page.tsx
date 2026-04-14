import ClientDashboard from './components/ClientDashboard';

export const dynamic = 'force-dynamic';

export default function Page({ searchParams }: { searchParams?: { symbol?: string } }) {
  const symbol = (searchParams?.symbol || '005930').replace(/[^0-9A-Za-z.]/g, '');
  return <ClientDashboard initialSymbol={symbol} />;
}
