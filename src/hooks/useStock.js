import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchDartAnnual,
  fetchDartCompany,
  fetchPrice,
  fetchYahooMonthly,
  searchCorpList,
} from '../lib/api.js';
import { enrichAnnualData } from '../lib/calc.js';

const DEFAULT_QUERY = '삼성전자';

export function useStock() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedCorp, setSelectedCorp] = useState(null);
  const [loading, setLoading] = useState(false);
  const [priceData, setPriceData] = useState(null);
  const [monthlyData, setMonthlyData] = useState([]);
  const [annualData, setAnnualData] = useState([]);
  const [companyData, setCompanyData] = useState(null);
  const [status, setStatus] = useState({ price: 'idle', yahoo: 'idle', dart: 'idle' });
  const [error, setError] = useState('');
  const latestRequestRef = useRef(0);

  const runSearch = useCallback(async (term) => {
    try {
      const results = await searchCorpList(term);
      setSuggestions(results);
      return results;
    } catch {
      setSuggestions([]);
      return [];
    }
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => { runSearch(trimmed); }, 120);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const loadCorp = useCallback(async (corp) => {
    const requestId = Date.now();
    latestRequestRef.current = requestId;
    setLoading(true);
    setSelectedCorp(corp);
    setError('');
    setStatus({ price: 'loading', yahoo: 'loading', dart: 'loading' });

    try {
      const [priceResult, yahooResult, companyResult, financialResult] = await Promise.allSettled([
        fetchPrice(corp.stock_code),
        fetchYahooMonthly(corp.stock_code, corp.market || 'KOSDAQ'),
        fetchDartCompany(corp.corp_code),
        fetchDartAnnual(corp.corp_code),
      ]);

      if (latestRequestRef.current !== requestId) return;

      let nextCompany = null;
      let nextAnnual = [];

      if (companyResult.status === 'fulfilled') {
        nextCompany = companyResult.value;
        setCompanyData(nextCompany);
      } else {
        setCompanyData(null);
      }

      if (financialResult.status === 'fulfilled') {
        nextAnnual = enrichAnnualData(financialResult.value.annualData || [], nextCompany?.shares || 0);
        setAnnualData(nextAnnual);
      } else {
        setAnnualData([]);
      }

      if (priceResult.status === 'fulfilled' && priceResult.value?.price) {
        setPriceData(priceResult.value);
      } else {
        setPriceData(priceResult.status === 'fulfilled' ? priceResult.value : null);
      }

      if (yahooResult.status === 'fulfilled' && Array.isArray(yahooResult.value?.monthly)) {
        setMonthlyData(yahooResult.value.monthly);
      } else {
        setMonthlyData([]);
      }

      setStatus({
        price: priceResult.status === 'fulfilled' && priceResult.value?.price ? 'ready' : 'fallback',
        yahoo: yahooResult.status === 'fulfilled' && yahooResult.value?.monthly?.length ? 'ready' : 'failed',
        dart: financialResult.status === 'fulfilled' && (financialResult.value?.annualData?.length || companyResult.status === 'fulfilled') ? 'ready' : 'failed',
      });

      if (financialResult.status === 'rejected') {
        setError('최근 공시 데이터 확인 불가');
      }
    } finally {
      if (latestRequestRef.current === requestId) setLoading(false);
    }
  }, []);

  const submitSearch = useCallback(async () => {
    const term = query.trim();
    if (!term) return;
    const results = await runSearch(term);
    const selected = results[0];
    if (selected) {
      await loadCorp(selected);
      setSuggestions(results);
    }
  }, [loadCorp, query, runSearch]);

  const selectSuggestion = useCallback(async (corp) => {
    setQuery(corp.corp_name);
    setSuggestions([]);
    await loadCorp(corp);
  }, [loadCorp]);

  useEffect(() => {
    searchCorpList(DEFAULT_QUERY).then((results) => {
      if (results[0]) {
        loadCorp(results[0]);
        setSuggestions(results);
      }
    }).catch(() => undefined);
  }, [loadCorp]);

  const latestAnnual = useMemo(() => annualData.at(-1) || null, [annualData]);

  return {
    query,
    setQuery,
    suggestions,
    selectedCorp,
    loading,
    priceData,
    monthlyData,
    annualData,
    latestAnnual,
    companyData,
    status,
    error,
    submitSearch,
    selectSuggestion,
  };
}
