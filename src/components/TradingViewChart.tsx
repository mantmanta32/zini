import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  Time,
  MouseEventParams,
} from 'lightweight-charts';
import { soundEngine } from '../audio';
import { ArrowLeft, RefreshCw, ZoomIn, ZoomOut, RotateCcw, ChevronDown, Search, X, Check, Volume2, VolumeX, WifiOff } from 'lucide-react';

interface TradingViewChartProps {
  symbol: string;
  onBackToDashboard: () => void;
  isDark?: boolean;
  isActive?: boolean;
  onSelectSymbol?: (sym: string) => void;
  /** Hızlı geçiş listesi — çağıran taraf besler, bileşen içinde sabit coin listesi tutulmaz. */
  quickCoins: string[];
}

type ChartTimeframe = '1m' | '3m' | '5m' | '15m' | '1h' | '4h';
const TF_ORDER: ChartTimeframe[] = ['1m', '3m', '5m', '15m', '1h', '4h'];

const STORAGE_TF_KEY = 'orderflow_chart_timeframe';
const STORAGE_BAR_SPACING_KEY = 'orderflow_bar_spacing';
const DEFAULT_BAR_SPACING = 18;
const WHALE_NOTIONAL_USD = 50_000;
const WHALE_CHIME_MIN_GAP_MS = 700;
const DISCONNECT_BANNER_DELAY_MS = 1500;

// Fiyat aralığına göre tutarlı hassasiyet — grafik ve header aynı fonksiyonu kullanır, uyuşmazlık riski kalmaz.
function precisionForPrice(price: number): number {
  if (price >= 10) return 2;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  if (price >= 0.0001) return 6;
  return 8;
}

function safeVibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
  } catch {}
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({
  symbol,
  onBackToDashboard,
  isDark = true,
  isActive = true,
  onSelectSymbol,
  quickCoins,
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram', Time> | null>(null);

  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_TF_KEY) as ChartTimeframe;
      if (saved && TF_ORDER.includes(saved)) return saved;
    } catch {}
    return '1m';
  });

  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');
  const [priceChange24h, setPriceChange24h] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTickPulsing, setIsTickPulsing] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [showDisconnectBanner, setShowDisconnectBanner] = useState<boolean>(false);
  const [tickCount, setTickCount] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showCoinSelector, setShowCoinSelector] = useState<boolean>(false);
  const [coinSearchInput, setCoinSearchInput] = useState<string>('');
  const [ohlcTooltip, setOhlcTooltip] = useState<{ x: number; y: number; o: number; h: number; l: number; c: number } | null>(null);

  const currentBarRef = useRef<{
    time: number; open: number; high: number; low: number; close: number; volume: number;
  } | null>(null);

  const prevPriceRef = useRef<number | null>(null);
  const pulseTimeoutRef = useRef<any>(null);
  const chartWsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const saveTimeoutRef = useRef<any>(null);
  const disconnectTimerRef = useRef<any>(null);
  const lastChimeAtRef = useRef<number>(0);

  // BUG FIX: artışlı requestId + AbortController ile yarış durumu engellendi
  const historyReqIdRef = useRef(0);
  const tickerReqIdRef = useRef(0);
  const historyAbortRef = useRef<AbortController | null>(null);
  const tickerAbortRef = useRef<AbortController | null>(null);

  const timeframeSecondsMap: Record<ChartTimeframe, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400,
  };

  const handleTimeframeChange = useCallback((newTf: ChartTimeframe) => {
    setTimeframe(newTf);
    try { localStorage.setItem(STORAGE_TF_KEY, newTf); } catch {}
  }, []);

  // 1. Chart kurulumu
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    container.innerHTML = '';

    let initialBarSpacing = DEFAULT_BAR_SPACING;
    try {
      const saved = parseFloat(localStorage.getItem(STORAGE_BAR_SPACING_KEY) || '');
      if (!isNaN(saved) && saved >= 6 && saved <= 60) initialBarSpacing = saved;
    } catch {}

    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: '#090a0f' }, textColor: '#94a3b8' },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#f43f5e', width: 1, style: 3, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#f43f5e', width: 1, style: 3, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        visible: true,
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.08, bottom: 0.20 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: initialBarSpacing,
        minBarSpacing: 5,
        rightOffset: 12,
        lockVisibleTimeRangeOnResize: true,
      },
      autoSize: false,
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    const onRangeChanged = () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        try {
          const opts = chart.timeScale().options();
          if (opts && typeof opts.barSpacing === 'number') {
            localStorage.setItem(STORAGE_BAR_SPACING_KEY, opts.barSpacing.toString());
          }
        } catch {}
      }, 300);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRangeChanged);

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: true,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      borderUpColor: '#10b981',
      borderDownColor: '#f43f5e',
      priceScaleId: 'right',
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeriesRef.current = volumeSeries;

    // Uzun-basış / crosshair OHLC etiketi (mobilde hover olmadığı için)
    const onCrosshairMove = (param: MouseEventParams) => {
      if (!param.point || !param.time || !candleSeriesRef.current) {
        setOhlcTooltip(null);
        return;
      }
      const bar = param.seriesData.get(candleSeriesRef.current) as CandlestickData<Time> | undefined;
      if (!bar) { setOhlcTooltip(null); return; }
      setOhlcTooltip({ x: param.point.x, y: param.point.y, o: bar.open, h: bar.high, l: bar.low, c: bar.close });
    };
    chart.subscribeCrosshairMove(onCrosshairMove);

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries.length || !entries[0].contentRect) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChanged);
      chart.unsubscribeCrosshairMove(onCrosshairMove);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isActive && chartRef.current && chartContainerRef.current) {
      const { clientWidth, clientHeight } = chartContainerRef.current;
      if (clientWidth > 0 && clientHeight > 0) {
        chartRef.current.applyOptions({ width: clientWidth, height: clientHeight });
      }
    }
  }, [isActive]);

  // 2. Geçmiş mumlar — requestId + AbortController ile yarış durumu düzeltildi
  const fetchHistoricalCandles = useCallback(async (activeSymbol: string, activeTf: ChartTimeframe) => {
    const reqId = ++historyReqIdRef.current;
    historyAbortRef.current?.abort();
    const controller = new AbortController();
    historyAbortRef.current = controller;

    setIsLoading(true);
    const sym = activeSymbol.toUpperCase().trim();

    try {
      const res = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${activeTf}&limit=600`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();

      if (reqId !== historyReqIdRef.current) return;
      if (!Array.isArray(raw) || raw.length === 0) { setIsLoading(false); return; }

      const candleData: CandlestickData<Time>[] = [];
      const volumeData: HistogramData<Time>[] = [];

      for (const c of raw) {
        const timeSec = Math.floor(c[0] / 1000) as Time;
        const open = parseFloat(c[1]);
        const high = parseFloat(c[2]);
        const low = parseFloat(c[3]);
        const close = parseFloat(c[4]);
        const volume = parseFloat(c[5]);
        candleData.push({ time: timeSec, open, high, low, close });
        volumeData.push({
          time: timeSec, value: volume,
          color: close >= open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
        });
      }

      if (candleSeriesRef.current && volumeSeriesRef.current && chartRef.current) {
        const last = raw[raw.length - 1];
        const lastTime = Math.floor(last[0] / 1000);
        const lastClose = parseFloat(last[4]);
        const precision = precisionForPrice(lastClose);
        const minMove = 1 / Math.pow(10, precision);

        candleSeriesRef.current.applyOptions({ priceFormat: { type: 'price', precision, minMove } });
        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        chartRef.current.priceScale('volume').applyOptions({ autoScale: true });
        candleSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        let userBarSpacing = DEFAULT_BAR_SPACING;
        try {
          const saved = parseFloat(localStorage.getItem(STORAGE_BAR_SPACING_KEY) || '');
          if (!isNaN(saved) && saved >= 6 && saved <= 60) userBarSpacing = saved;
        } catch {}

        chartRef.current.timeScale().applyOptions({ barSpacing: userBarSpacing, rightOffset: 12 });
        const total = candleData.length;
        if (total > 0) {
          chartRef.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, total - 75), to: total + 12 });
        }

        currentBarRef.current = {
          time: lastTime,
          open: parseFloat(last[1]),
          high: parseFloat(last[2]),
          low: parseFloat(last[3]),
          close: lastClose,
          volume: parseFloat(last[5]),
        };
        prevPriceRef.current = lastClose;
        setCurrentPrice(lastClose);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('Klines yükleme hatası:', err);
    } finally {
      if (reqId === historyReqIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    currentBarRef.current = null;
    prevPriceRef.current = null;
    setCurrentPrice(null);
    setTickCount(0);
    setOhlcTooltip(null);

    if (candleSeriesRef.current) candleSeriesRef.current.setData([]);
    if (volumeSeriesRef.current) volumeSeriesRef.current.setData([]);
    if (chartRef.current) {
      try {
        chartRef.current.priceScale('right').applyOptions({ autoScale: true });
        chartRef.current.priceScale('volume').applyOptions({ autoScale: true });
      } catch {}
    }

    fetchHistoricalCandles(symbol, timeframe);
    return () => historyAbortRef.current?.abort();
  }, [symbol, timeframe, fetchHistoricalCandles]);

  // 3. 24h değişim
  useEffect(() => {
    const reqId = ++tickerReqIdRef.current;
    tickerAbortRef.current?.abort();
    const controller = new AbortController();
    tickerAbortRef.current = controller;

    const sym = symbol.toUpperCase().trim();
    fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (reqId !== tickerReqIdRef.current) return;
        if (d.priceChangePercent) setPriceChange24h(parseFloat(d.priceChangePercent));
      })
      .catch((err) => { if (err?.name !== 'AbortError') {} });

    return () => controller.abort();
  }, [symbol]);

  // 4. Canlı @trade + @kline akışı
  useEffect(() => {
    const cleanSym = symbol.toLowerCase().trim();
    if (!cleanSym) return;

    let isDisposed = false;
    const tfSec = timeframeSecondsMap[timeframe];

    if (chartWsRef.current) {
      try {
        chartWsRef.current.onclose = null;
        chartWsRef.current.onerror = null;
        chartWsRef.current.close();
      } catch {}
      chartWsRef.current = null;
    }
    if (reconnectTimeoutRef.current) { clearTimeout(reconnectTimeoutRef.current); reconnectTimeoutRef.current = null; }
    if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
    setShowDisconnectBanner(false);

    const markDisconnected = () => {
      setWsConnected(false);
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = setTimeout(() => {
        if (!isDisposed) setShowDisconnectBanner(true);
      }, DISCONNECT_BANNER_DELAY_MS);
    };
    const markConnected = () => {
      setWsConnected(true);
      setShowDisconnectBanner(false);
      if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
    };

    const connectChartStream = () => {
      if (isDisposed) return;
      const streamUrl = `wss://fstream.binance.com/stream?streams=${cleanSym}@trade/${cleanSym}@kline_${timeframe}`;

      try {
        const ws = new WebSocket(streamUrl);
        chartWsRef.current = ws;

        ws.onopen = () => { if (!isDisposed) markConnected(); };

        ws.onmessage = (event: MessageEvent) => {
          if (isDisposed) return;
          try {
            const raw = JSON.parse(event.data);
            const data = raw.data || raw;

            const isTrade = data.e === 'trade' || (typeof raw.stream === 'string' && raw.stream.endsWith('@trade'));
            if (isTrade && data.p && data.q) {
              const price = parseFloat(data.p);
              const qty = parseFloat(data.q);
              if (isNaN(price) || price <= 0 || isNaN(qty) || qty < 0) return;

              const current = currentBarRef.current;
              if (current && current.close > 0 && (price < current.close * 0.25 || price > current.close * 4.0)) {
                return; // glitch filtresi
              }

              const prev = prevPriceRef.current;
              if (prev !== null && prev !== price) setPriceDirection(price > prev ? 'up' : 'down');
              prevPriceRef.current = price;

              setCurrentPrice(price);
              setTickCount((c) => c + 1);
              setIsTickPulsing(true);
              safeVibrate(8);
              if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
              pulseTimeoutRef.current = setTimeout(() => setIsTickPulsing(false), 90);

              const notional = price * qty;
              if (notional >= WHALE_NOTIONAL_USD && !isMuted) {
                const now = Date.now();
                if (now - lastChimeAtRef.current >= WHALE_CHIME_MIN_GAP_MS) {
                  lastChimeAtRef.current = now;
                  soundEngine.playSignalChime(!data.m ? 'bull' : 'bear');
                  safeVibrate([0, 25, 40, 25]);
                }
              }

              const tradeTimeMs = data.T || Date.now();
              const tradeTimeSec = Math.floor(tradeTimeMs / 1000);
              const barTimeSec = Math.floor(tradeTimeSec / tfSec) * tfSec;

              // Eski trade mumu bozamaz
              if (current && barTimeSec < current.time) return;

              if (!current || barTimeSec > current.time) {
                const newBar = { time: barTimeSec, open: price, high: price, low: price, close: price, volume: qty };
                currentBarRef.current = newBar;
                candleSeriesRef.current?.update({ time: barTimeSec as Time, open: price, high: price, low: price, close: price });
                volumeSeriesRef.current?.update({ time: barTimeSec as Time, value: qty, color: 'rgba(16, 185, 129, 0.4)' });
              } else if (barTimeSec === current.time) {
                current.high = Math.max(current.high, price);
                current.low = Math.min(current.low, price);
                current.close = price;
                current.volume += qty;
                candleSeriesRef.current?.update({ time: current.time as Time, open: current.open, high: current.high, low: current.low, close: current.close });
                volumeSeriesRef.current?.update({
                  time: current.time as Time, value: current.volume,
                  color: current.close >= current.open ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
                });
              }
            }

            const isKline = data.e === 'kline' || (typeof raw.stream === 'string' && raw.stream.includes('@kline'));
            if (isKline && data.k) {
              const k = data.k;
              const kTimeSec = Math.floor(k.t / 1000);
              const kOpen = parseFloat(k.o);
              const kHigh = parseFloat(k.h);
              const kLow = parseFloat(k.l);
              const kClose = parseFloat(k.c);
              const kVol = parseFloat(k.v);

              if (currentBarRef.current && kTimeSec < currentBarRef.current.time) return;

              if (currentBarRef.current && kTimeSec === currentBarRef.current.time) {
                currentBarRef.current.open = kOpen;
                currentBarRef.current.high = Math.max(currentBarRef.current.high, kHigh);
                currentBarRef.current.low = Math.min(currentBarRef.current.low, kLow);
                currentBarRef.current.close = kClose;
                currentBarRef.current.volume = kVol;
              } else if (!currentBarRef.current || kTimeSec > currentBarRef.current.time) {
                currentBarRef.current = { time: kTimeSec, open: kOpen, high: kHigh, low: kLow, close: kClose, volume: kVol };
              }

              candleSeriesRef.current?.update({
                time: kTimeSec as Time,
                open: currentBarRef.current?.open ?? kOpen,
                high: currentBarRef.current?.high ?? kHigh,
                low: currentBarRef.current?.low ?? kLow,
                close: kClose,
              });
              volumeSeriesRef.current?.update({
                time: kTimeSec as Time, value: kVol,
                color: kClose >= kOpen ? 'rgba(16, 185, 129, 0.4)' : 'rgba(244, 63, 94, 0.4)',
              });
            }
          } catch (err) {
            console.error('Doğrudan grafik WS parse hatası:', err);
          }
        };

        ws.onerror = () => { markDisconnected(); };
        ws.onclose = () => {
          markDisconnected();
          if (!isDisposed) reconnectTimeoutRef.current = setTimeout(connectChartStream, 1500);
        };
      } catch (err) {
        console.error('Chart WS bağlantı hatası:', err);
        if (!isDisposed) reconnectTimeoutRef.current = setTimeout(connectChartStream, 2000);
      }
    };

    connectChartStream();

    return () => {
      isDisposed = true;
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
      if (chartWsRef.current) {
        try {
          chartWsRef.current.onclose = null;
          chartWsRef.current.onerror = null;
          chartWsRef.current.close();
        } catch {}
        chartWsRef.current = null;
      }
    };
  }, [symbol, timeframe, isMuted]);

  const handleZoomIn = useCallback(() => {
    if (!chartRef.current) return;
    const spacing = chartRef.current.timeScale().options()?.barSpacing || DEFAULT_BAR_SPACING;
    const next = Math.min(50, spacing + 4);
    chartRef.current.timeScale().applyOptions({ barSpacing: next });
    try { localStorage.setItem(STORAGE_BAR_SPACING_KEY, next.toString()); } catch {}
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!chartRef.current) return;
    const spacing = chartRef.current.timeScale().options()?.barSpacing || DEFAULT_BAR_SPACING;
    const next = Math.max(6, spacing - 4);
    chartRef.current.timeScale().applyOptions({ barSpacing: next });
    try { localStorage.setItem(STORAGE_BAR_SPACING_KEY, next.toString()); } catch {}
  }, []);

  const handleResetZoom = useCallback(() => {
    if (!chartRef.current) return;
    try {
      chartRef.current.priceScale('right').applyOptions({ autoScale: true });
      chartRef.current.priceScale('volume').applyOptions({ autoScale: true });
    } catch {}
    chartRef.current.timeScale().applyOptions({ barSpacing: DEFAULT_BAR_SPACING, rightOffset: 12 });
    chartRef.current.timeScale().scrollToRealTime();
    try { localStorage.setItem(STORAGE_BAR_SPACING_KEY, DEFAULT_BAR_SPACING.toString()); } catch {}
  }, []);

  // Mobil jest: fiyat başlığında yatay kaydırma ile timeframe değiştir
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const onHeaderTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const onHeaderTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const idx = TF_ORDER.indexOf(timeframe);
    if (dx < 0 && idx < TF_ORDER.length - 1) { handleTimeframeChange(TF_ORDER[idx + 1]); safeVibrate(12); }
    else if (dx > 0 && idx > 0) { handleTimeframeChange(TF_ORDER[idx - 1]); safeVibrate(12); }
  };

  const formattedPrice = useMemo(() => {
    if (currentPrice === null) return null;
    const p = precisionForPrice(currentPrice);
    return `$${currentPrice.toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p })}`;
  }, [currentPrice]);

  const closeCoinSheet = useCallback(() => { setShowCoinSelector(false); setCoinSearchInput(''); }, []);

  return (
    <div className="relative w-full h-[calc(100dvh-56px)] sm:h-[calc(100vh-56px)] bg-[#090a0f] overflow-hidden select-none">
      <div id="tradingview-lightweight-chart-container" ref={chartContainerRef} className="w-full h-full" />

      {/* OHLC ipucu — mobilde hover olmadığı için crosshair/uzun-basış ile gösterilir */}
      {ohlcTooltip && (
        <div
          className="absolute z-40 pointer-events-none bg-stone-900/95 border border-stone-700/80 rounded-lg px-2 py-1.5 text-[10px] font-mono text-stone-200 shadow-xl"
          style={{
            left: Math.min(Math.max(ohlcTooltip.x + 10, 8), (chartContainerRef.current?.clientWidth || 300) - 130),
            top: Math.min(Math.max(ohlcTooltip.y + 10, 8), (chartContainerRef.current?.clientHeight || 300) - 90),
          }}
        >
          <div>O <span className="text-stone-400">{ohlcTooltip.o.toFixed(precisionForPrice(ohlcTooltip.o))}</span></div>
          <div>H <span className="text-emerald-400">{ohlcTooltip.h.toFixed(precisionForPrice(ohlcTooltip.h))}</span></div>
          <div>L <span className="text-rose-400">{ohlcTooltip.l.toFixed(precisionForPrice(ohlcTooltip.l))}</span></div>
          <div>C <span className="text-stone-200">{ohlcTooltip.c.toFixed(precisionForPrice(ohlcTooltip.c))}</span></div>
        </div>
      )}

      {/* Bağlantı kesildi bandı */}
      {showDisconnectBanner && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 bg-rose-950/90 border border-rose-800/80 text-rose-300 text-[11px] font-mono font-bold px-3 py-1.5 rounded-full shadow-xl animate-in fade-in slide-in-from-top-2"
          style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        >
          <WifiOff className="w-3.5 h-3.5" />
          <span>Bağlantı koptu, yeniden bağlanılıyor…</span>
        </div>
      )}

      {/* Üst kontrol paneli */}
      <div
        className="absolute left-3 z-30 flex items-center gap-1.5 sm:gap-2 bg-stone-900/90 backdrop-blur-md border border-stone-800/80 rounded-xl px-2 py-1.5 sm:px-2.5 sm:py-1.5 shadow-2xl max-w-[calc(100vw-24px)] overflow-x-auto scrollbar-none"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top))' }}
        onTouchStart={onHeaderTouchStart}
        onTouchEnd={onHeaderTouchEnd}
      >
        <button
          type="button"
          onClick={onBackToDashboard}
          title="Dashboard'a Dön"
          className="flex items-center gap-1 text-xs font-bold text-stone-300 hover:text-white bg-stone-800/80 hover:bg-rose-600/80 active:bg-rose-600 px-2 py-1 rounded-lg transition-all cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Dön</span>
        </button>

        <div className="h-4 w-[1px] bg-stone-700/60 shrink-0" />

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowCoinSelector(true)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-800/90 hover:bg-stone-700 text-xs font-black text-white hover:text-rose-400 tracking-wider font-mono transition-all border border-stone-700/60 cursor-pointer"
            title="Parite Değiştir"
          >
            <span>{symbol.toUpperCase()}</span>
            <ChevronDown className="w-3 h-3 text-stone-400" />
          </button>

          <span
            className={`text-xs sm:text-sm font-mono font-black px-1.5 py-0.5 rounded transition-all duration-75 ${
              isTickPulsing
                ? priceDirection === 'up'
                  ? 'bg-emerald-500/30 text-emerald-300 scale-105 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
                  : 'bg-rose-500/30 text-rose-300 scale-105 shadow-[0_0_12px_rgba(244,63,94,0.5)]'
                : priceDirection === 'up' ? 'text-emerald-400' : priceDirection === 'down' ? 'text-rose-400' : 'text-stone-200'
            }`}
          >
            {formattedPrice ?? 'Yükleniyor...'}
          </span>

          <span className={`text-[10px] font-mono font-bold px-1 rounded hidden xs:inline ${priceChange24h >= 0 ? 'text-emerald-400 bg-emerald-950/60' : 'text-rose-400 bg-rose-950/60'}`}>
            {priceChange24h >= 0 ? '+' : ''}{priceChange24h.toFixed(2)}%
          </span>

          <div className="flex items-center gap-1.5 bg-black/50 border border-stone-800 px-1.5 py-0.5 rounded-lg shrink-0">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${wsConnected ? 'bg-emerald-400' : 'bg-rose-500'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${wsConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
            </span>
            <span className="text-[10px] font-mono font-bold text-emerald-400">@trade</span>
            {tickCount > 0 && <span className="text-[9px] font-mono text-stone-400 hidden lg:inline">{tickCount}</span>}
          </div>
        </div>

        <div className="h-4 w-[1px] bg-stone-700/60 shrink-0" />

        <div className="flex items-center gap-1 shrink-0">
          {TF_ORDER.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => handleTimeframeChange(tf)}
              className={`text-[11px] font-mono px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                timeframe === tf ? 'bg-rose-600 text-white font-black shadow-sm' : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="h-4 w-[1px] bg-stone-700/60 hidden sm:block shrink-0" />

        <div className="hidden sm:flex items-center gap-1 shrink-0">
          <button type="button" onClick={handleZoomIn} title="Mumları Büyüt (+)" className="p-1 text-stone-400 hover:text-white hover:bg-stone-800 rounded transition-all cursor-pointer">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={handleZoomOut} title="Mumları Küçült (-)" className="p-1 text-stone-400 hover:text-white hover:bg-stone-800 rounded transition-all cursor-pointer">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={handleResetZoom} title="Canlıya Odakla" className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-bold text-stone-300 hover:text-emerald-400 hover:bg-stone-800 rounded transition-all cursor-pointer">
            <RotateCcw className="w-3 h-3" />
            <span>Odak</span>
          </button>
        </div>

        <div className="h-4 w-[1px] bg-stone-700/60 shrink-0" />

        <button
          type="button"
          onClick={() => {
            const nextMuted = !isMuted;
            setIsMuted(nextMuted);
            soundEngine.setMuted(nextMuted);
            if (!nextMuted) soundEngine.playSignalChime('bull');
          }}
          title={isMuted ? 'Balina Seslerini Aç' : 'Sesi Kapat'}
          className={`p-1 rounded-lg transition-all cursor-pointer shrink-0 ${isMuted ? 'text-stone-500 hover:text-stone-300' : 'text-emerald-400 hover:text-emerald-300 bg-emerald-950/40'}`}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 animate-pulse" />}
        </button>

        <div className="flex items-center gap-1 pl-1 shrink-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase hidden md:inline">TİC TİC CANLI</span>
        </div>
      </div>

      {/* Parite değiştirme — mobilde alttan açılan sheet, masaüstünde küçük panel */}
      {showCoinSelector && (
        <>
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150" onClick={closeCoinSheet} />
          <div
            className="fixed sm:absolute bottom-0 sm:bottom-auto left-0 sm:left-3 right-0 sm:right-auto sm:top-14 z-50 sm:w-72 sm:max-w-[calc(100vw-24px)] bg-stone-900/98 sm:bg-stone-900/95 backdrop-blur-xl border-t sm:border border-stone-700/80 rounded-t-3xl sm:rounded-2xl p-3 shadow-2xl animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <div className="sm:hidden w-10 h-1 bg-stone-700 rounded-full mx-auto mb-2.5" />

            <div className="flex items-center justify-between pb-2 border-b border-stone-800">
              <span className="text-xs font-bold text-stone-200 font-mono flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-rose-500" />
                Parite Değiştir
              </span>
              <button type="button" onClick={closeCoinSheet} className="text-stone-400 hover:text-white p-1.5 rounded-lg hover:bg-stone-800 transition-all cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                let clean = coinSearchInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (!clean) return;
                if (!clean.endsWith('USDT')) clean += 'USDT';
                onSelectSymbol?.(clean);
                closeCoinSheet();
              }}
              className="mt-2.5 flex items-center gap-1.5"
            >
              <input
                type="text"
                inputMode="text"
                value={coinSearchInput}
                onChange={(e) => setCoinSearchInput(e.target.value.toUpperCase())}
                placeholder="Örn: DOGE, SOL, PEPE..."
                autoFocus
                className="flex-1 px-3 py-2.5 sm:py-1.5 bg-stone-800/90 border border-stone-700 rounded-xl text-sm sm:text-xs font-mono text-white placeholder-stone-500 focus:outline-none focus:border-rose-500"
              />
              <button type="submit" className="px-3.5 py-2.5 sm:py-1.5 bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white rounded-xl text-xs font-bold font-mono transition-all cursor-pointer">
                Seç
              </button>
            </form>

            {quickCoins.length > 0 && (
              <div className="mt-3">
                <span className="text-[10px] font-mono text-stone-400 uppercase tracking-wider block mb-1.5 font-bold">
                  Hızlı Erişim
                </span>
                <div className="grid grid-cols-3 gap-1.5 max-h-56 sm:max-h-48 overflow-y-auto pr-0.5">
                  {quickCoins.map((c) => {
                    const isCurrent = c.toUpperCase() === symbol.toUpperCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => { onSelectSymbol?.(c); closeCoinSheet(); }}
                        className={`flex items-center justify-between px-2 py-2 sm:py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                          isCurrent ? 'bg-rose-600 text-white shadow-xs' : 'bg-stone-800/70 hover:bg-stone-700 active:bg-stone-600 text-stone-300 hover:text-white border border-stone-700/50'
                        }`}
                      >
                        <span>{c.replace('USDT', '')}</span>
                        {isCurrent && <Check className="w-3 h-3 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Mobil hızlı zoom paneli */}
      <div
        className="absolute right-3 z-30 flex sm:hidden items-center gap-1 bg-stone-900/90 backdrop-blur-md border border-stone-700/80 rounded-xl p-1 shadow-2xl"
        style={{ bottom: 'max(4rem, calc(4rem + env(safe-area-inset-bottom)))' }}
      >
        <button type="button" onClick={handleZoomIn} title="Büyüt" className="p-2.5 text-stone-200 hover:text-white active:bg-stone-700 bg-stone-800/80 rounded-lg cursor-pointer">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button type="button" onClick={handleZoomOut} title="Küçült" className="p-2.5 text-stone-200 hover:text-white active:bg-stone-700 bg-stone-800/80 rounded-lg cursor-pointer">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button type="button" onClick={handleResetZoom} title="Odakla" className="p-2.5 text-emerald-400 hover:text-emerald-300 active:bg-stone-700 bg-stone-800/80 rounded-lg cursor-pointer">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Yükleniyor — shimmer iskelet */}
      {isLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center gap-3 w-56">
            <div className="flex items-end gap-1 h-16 w-full">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 bg-stone-700/50 rounded-sm animate-pulse"
                  style={{ height: `${20 + ((i * 37) % 60)}%`, animationDelay: `${i * 60}ms` }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 bg-stone-900 border border-stone-800 px-4 py-2 rounded-xl text-stone-200 font-mono text-xs">
              <RefreshCw className="w-4 h-4 animate-spin text-rose-500" />
              <span>{symbol.toUpperCase()} yükleniyor…</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
