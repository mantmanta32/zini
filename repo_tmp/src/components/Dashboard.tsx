import React, { useState, useMemo, useCallback, memo } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Flame,
  Inbox,
  Layers,
  ShieldAlert,
} from 'lucide-react';
import {
  BucketStats,
  RecentTrade,
  SmartMoneyDivergence,
  TimeframeOption,
} from '../types';

interface DashboardProps {
  divergence: SmartMoneyDivergence;
  topBuckets: BucketStats[];
  recentTrades: RecentTrade[];
  activeTimeframe: TimeframeOption;
  onTimeframeChange: (tf: TimeframeOption) => void;
  maxTradesShown: number;
  activeSymbol: string;
  onNavigateToWallets: () => void;
  /* Skeleton ↔ gerçek boş veri ayrımı için */
  isLoading?: boolean;
}

// ============================================================================
// SABİTLER & FORMATTER'LAR (modül seviyesinde — render başına maliyet sıfır)
// ============================================================================

const TIMEFRAMES: readonly TimeframeOption[] = ['1m', '5m', '15m'];

const WHALETHRESHOLD = 50000;
const LEVIATHANTHRESHOLD = 250000;

const timeFmt = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/* Finansal işaretli format: her zaman "-$49.0K" / "+$1.20M", asla "$-49048" */
const formatSignedUsd = (val: number): string => {
  if (!Number.isFinite(val) || val === 0) return '$0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '+';
  const body =
    abs >= 1000000 ? `${(abs / 1000000).toFixed(2)}M`
    : abs >= 10000  ? `${(abs / 1000).toFixed(1)}K`
    : intFmt.format(Math.round(abs));
  return `${sign}$${body}`;
};

const formatPrice = (price: number): string => {
  if (!Number.isFinite(price)) return '—';
  const digits =
    price >= 1000 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 6 : 8;
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits,
  })}`;
};

const formatNotional = (n: number): string => {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${intFmt.format(Math.round(n))}`;
};

/* İç içe ternary yerine tek kaynaklı sinyal stil haritası */
const SIGNALSTYLES: Record<
  string,
  { section: string; icon: string; badge: string }
> = {
  ACCUMULATION: {
    section:
      'bg-emerald-50/95 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 ring-1 ring-emerald-400/25',
    icon: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-600 text-white',
  },
  DISTRIBUTION: {
    section:
      'bg-rose-50/95 dark:bg-rose-950/40 border-rose-300 dark:border-rose-700 ring-1 ring-rose-400/25',
    icon: 'text-rose-600 dark:text-rose-400',
    badge: 'bg-rose-600 text-white',
  },
  BULLMOMENTUM: {
    section:
      'bg-teal-50/95 dark:bg-teal-950/40 border-teal-300 dark:border-teal-700',
    icon: 'text-teal-600 dark:text-teal-400',
    badge: 'bg-teal-600 text-white',
  },
  BEARMOMENTUM: {
    section:
      'bg-amber-50/95 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700',
    icon: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-600 text-white',
  },
  DEFAULT: {
    section:
      'bg-white/95 dark:bg-stone-900/90 border-pink-200/80 dark:border-stone-800',
    icon: 'text-stone-500 dark:text-stone-400',
    badge: 'bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900',
  },
};

const deltaColor = (d: number) =>
  d > 0
    ? 'text-emerald-600 dark:text-emerald-400'
    : d < 0
    ? 'text-rose-600 dark:text-rose-400'
    : 'text-stone-500 dark:text-stone-400';

// ============================================================================
// SIDE BADGE
// ============================================================================

const SideBadge = memo(function SideBadge({ isBuyerMaker }: { isBuyerMaker: boolean }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-md text-[10px] font-bold whitespace-nowrap ${
        isBuyerMaker
          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      }`}
    >
      {isBuyerMaker ? 'SATIŞ' : 'ALIŞ'}
    </span>
  );
});

// ============================================================================
// TRADE SATIRI (desktop tablo) — stabil key + memo, canlı akışta remount yok
// ============================================================================

const TradeRow = memo(function TradeRow({ t }: { t: RecentTrade }) {
  const isWhale = t.notional >= WHALETHRESHOLD;
  const isLeviathan = t.notional >= LEVIATHANTHRESHOLD;
  const isFresh = Date.now() - t.time < 1200;

  return (
    <tr
      className={`transition-colors ${isFresh ? 'trade-flash' : ''} ${
        isLeviathan
          ? 'bg-amber-100/50 dark:bg-amber-950/40 border-l-2 border-amber-500 font-bold'
          : isWhale
          ? 'bg-rose-50/60 dark:bg-stone-800/60 border-l-2 border-rose-500'
          : 'hover:bg-rose-50/50 dark:hover:bg-stone-800/50'
      }`}
    >
      <td className="py-2.5 pl-2 text-stone-500 dark:text-stone-400 whitespace-nowrap tabular-nums">
        {timeFmt.format(t.time)}
      </td>
      <td className={`py-2.5 font-semibold whitespace-nowrap tabular-nums ${t.isBuyerMaker ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
        {formatPrice(t.price)}
      </td>
      <td className="py-2.5 font-bold text-stone-800 dark:text-stone-200 whitespace-nowrap tabular-nums">
        {formatNotional(t.notional)}
        {isLeviathan && <span className="ml-1 text-[10px]" aria-label="Dev işlem">🔥</span>}
      </td>
      <td className="py-2.5">
        <SideBadge isBuyerMaker={t.isBuyerMaker} />
      </td>
      <td className="py-2.5 pr-2 text-right">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border whitespace-nowrap ${
            isLeviathan
              ? 'bg-amber-500 text-white border-amber-600'
              : 'bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-200'
          }`}
        >
          <span aria-hidden>{t.bucketIcon}</span>
          <span>{t.bucketName}</span>
        </span>
      </td>
    </tr>
  );
});

// ============================================================================
// TRADE KARTI (mobil) — yatay scroll'lu tablo yerine premium kart akışı
// ============================================================================

const TradeCard = memo(function TradeCard({ t }: { t: RecentTrade }) {
  const isWhale = t.notional >= WHALETHRESHOLD;
  const isLeviathan = t.notional >= LEVIATHANTHRESHOLD;
  const isFresh = Date.now() - t.time < 1200;

  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border transition-colors ${isFresh ? 'trade-flash' : ''} ${
        isLeviathan
          ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
          : isWhale
          ? 'bg-rose-50/70 dark:bg-stone-800/70 border-rose-200 dark:border-rose-900'
          : 'bg-white dark:bg-stone-900 border-stone-100 dark:border-stone-800'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-lg shrink-0" aria-hidden>{t.bucketIcon}</span>
        <div className="min-w-0">
          <div className={`font-mono font-bold text-sm tabular-nums ${t.isBuyerMaker ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {formatPrice(t.price)}
          </div>
          <div className="text-[10px] font-mono text-stone-400 dark:text-stone-500 tabular-nums">
            {timeFmt.format(t.time)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right">
          <div className="font-mono font-black text-sm text-stone-800 dark:text-stone-100 tabular-nums">
            {formatNotional(t.notional)}{isLeviathan && ' 🔥'}
          </div>
        </div>
        <SideBadge isBuyerMaker={t.isBuyerMaker} />
      </div>
    </div>
  );
});

// ============================================================================
// KOVA KARTI
// ============================================================================

const BucketCard = memo(function BucketCard({
  b,
  activeTimeframe,
}: {
  b: BucketStats;
  activeTimeframe: TimeframeOption;
}) {
  const delta = Number.isFinite(b.rollingDelta) ? b.rollingDelta : 0;
  const bias = clamp(Number.isFinite(b.directionalBias) ? b.directionalBias : 50, 0, 100);

  return (
    <div className="p-3 rounded-2xl border border-rose-200/80 dark:border-stone-800 bg-white/95 dark:bg-stone-900 shadow-sm space-y-1.5 transition-transform active:scale-[0.98] hover:border-rose-300 dark:hover:border-rose-800">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xl shrink-0" aria-hidden>{b.icon}</span>
          <span className="text-xs font-bold text-stone-900 dark:text-stone-100 truncate">{b.name}</span>
        </div>
        <span className="text-[10px] font-mono text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded-md shrink-0 tabular-nums">
          {b.rollingCount || 0} tx
        </span>
      </div>

      <div>
        <div className="text-[10px] text-stone-400 dark:text-stone-500 font-mono">
          Net Delta ({activeTimeframe})
        </div>
        <div className={`font-mono text-base font-black flex items-center gap-0.5 tabular-nums ${deltaColor(delta)}`}>
          {delta > 0 && <ArrowUpRight className="w-4 h-4 stroke-[3]" aria-hidden />}
          {delta < 0 && <ArrowDownRight className="w-4 h-4 stroke-[3]" aria-hidden />}
          <span>{formatSignedUsd(delta)}</span>
        </div>
      </div>

      <div
        className="w-full h-1.5 bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden"
        role="img"
        aria-label={`Alış oranı %${Math.round(bias)}`}
      >
        <div
          className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full transition-[width] duration-500 ease-out"
          style={{ width: `${bias}%` }}
        />
      </div>
    </div>
  );
});

// ============================================================================
// METRİK KUTUSU (radar grid'i için tekrarı azaltan yardımcı)
// ============================================================================

const MetricBox = memo(function MetricBox({
  label,
  children,
  inverted = false,
}: {
  label: string;
  children: React.ReactNode;
  inverted?: boolean;
}) {
  return (
    <div
      className={`p-1.5 rounded-lg shadow-sm flex flex-col justify-center min-w-0 ${
        inverted
          ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
          : 'bg-white/90 dark:bg-stone-800/90 border border-stone-200/80 dark:border-stone-700/80'
      }`}
    >
      <span className="text-stone-400 dark:text-stone-500 text-[8px] uppercase font-sans tracking-wider truncate">
        {label}
      </span>
      {children}
    </div>
  );
});

// ============================================================================
// ANA DASHBOARD
// ============================================================================

export const Dashboard: React.FC<DashboardProps> = ({
  divergence,
  topBuckets,
  recentTrades,
  activeTimeframe,
  onTimeframeChange,
  maxTradesShown,
  activeSymbol,
  onNavigateToWallets,
  isLoading = false,
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const styles = SIGNALSTYLES[divergence.signal] ?? SIGNALSTYLES.DEFAULT;

  const obi = Math.round(Number.isFinite(divergence.overallObi) ? divergence.overallObi! : 0);
  const buyerPct = Math.round(clamp(50 + obi / 2, 5, 95));

  const toggleDetails = useCallback(() => setShowDetails((v) => !v), []);

  const visibleTrades = useMemo(
    () => recentTrades.slice(0, maxTradesShown),
    [recentTrades, maxTradesShown]
  );
  const visibleBuckets = useMemo(() => topBuckets.slice(0, 4), [topBuckets]);

  const isConnected = Boolean(activeSymbol) && !isLoading;

  return (
    <div className="space-y-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* Yeni trade flash animasyonu — plugin bağımlılığı yok */}
      <style>{`
        @keyframes tradeFlash { from { background-color: rgba(16,185,129,0.18); } to { background-color: transparent; } }
        .trade-flash { animation: tradeFlash 1.2s ease-out; }
        @media (prefers-reduced-motion: reduce) { .trade-flash { animation: none; } }
      `}</style>

      {/* ================= SMART MONEY DIVERGENCE RADARI ================= */}
      <section className={`rounded-xl p-2.5 sm:p-3.5 border transition-all shadow-sm backdrop-blur-sm ${styles.section}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldAlert className={`w-4 h-4 shrink-0 ${styles.icon}`} aria-hidden />
            <h2 className="text-xs sm:text-sm font-black tracking-tight text-stone-900 dark:text-stone-100 truncate">
              {divergence.signalTitle}
            </h2>
            <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded-md font-mono font-bold shrink-0 tabular-nums ${styles.badge}`}>
              %{Math.round(divergence.confidence)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <div
              role="group"
              aria-label="Zaman aralığı seçimi"
              className="flex bg-rose-100/70 dark:bg-stone-800 p-0.5 rounded-lg border border-rose-200/80 dark:border-stone-700 text-[10px] font-bold"
            >
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onTimeframeChange(tf)}
                  aria-pressed={activeTimeframe === tf}
                  className={`px-2.5 py-1.5 min-h-[32px] rounded-md transition-all cursor-pointer active:scale-95 ${
                    activeTimeframe === tf
                      ? 'bg-rose-600 text-white shadow-sm font-black'
                      : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleDetails}
              aria-expanded={showDetails}
              aria-label={showDetails ? 'Detayları gizle' : 'Detayları göster'}
              className="p-2 min-h-[32px] rounded-lg text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 bg-white/80 dark:bg-stone-800/80 border border-stone-200/80 dark:border-stone-700 transition-all cursor-pointer active:scale-90"
            >
              {showDetails ? <ChevronUp className="w-3.5 h-3.5" aria-hidden /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden />}
            </button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 font-mono text-center">
          <MetricBox label="Retail">
            <span className={`font-bold text-[11px] sm:text-xs truncate tabular-nums ${deltaColor(divergence.retailDelta)}`}>
              {formatSignedUsd(divergence.retailDelta)}
            </span>
          </MetricBox>

          <MetricBox label="Smart">
            <span className={`font-bold text-[11px] sm:text-xs truncate tabular-nums ${deltaColor(divergence.smartDelta)}`}>
              {formatSignedUsd(divergence.smartDelta)}
            </span>
          </MetricBox>

          <MetricBox label="OBI" inverted>
            <span className={`font-bold text-[11px] sm:text-xs truncate tabular-nums ${
              obi > 10 ? 'text-emerald-400 dark:text-emerald-600'
              : obi < -10 ? 'text-rose-400 dark:text-rose-600'
              : 'text-stone-300 dark:text-stone-600'
            }`}>
              {obi > 0 ? '+' : ''}{obi}%
            </span>
          </MetricBox>

          <MetricBox label="Denge">
            <span className="font-bold text-[10px] sm:text-xs truncate flex items-center justify-center gap-1 tabular-nums">
              <span className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${obi > 0 ? 'bg-emerald-500' : obi < 0 ? 'bg-rose-500' : 'bg-stone-400'}`} />
              <span className="truncate">%{buyerPct} Alıcı</span>
            </span>
          </MetricBox>
        </div>

        {showDetails && (
          <div className="mt-2.5 pt-2 border-t border-stone-200/60 dark:border-stone-800/80 space-y-2">
            <p className="text-[11px] sm:text-xs text-stone-600 dark:text-stone-300 font-medium">
              {divergence.signalDesc}
            </p>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-[9px] font-mono font-bold text-stone-500 dark:text-stone-400 whitespace-nowrap">
                Emir Akışı:
              </span>
              <div className="flex-1 h-1.5 bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full transition-[width] duration-500" style={{ width: `${buyerPct}%` }} />
              </div>
              <span className="text-[9px] font-mono font-black text-stone-700 dark:text-stone-300 whitespace-nowrap">
                {obi > 0 ? 'Alıcı Hakim' : obi < 0 ? 'Satıcı Hakim' : 'Nötr'}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ================= EN AKTİF KOVALAR ================= */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-rose-500" aria-hidden />
            <h3 className="text-xs font-bold text-stone-900 dark:text-stone-100 uppercase tracking-wider">
              En Aktif Kovalar ({activeTimeframe})
            </h3>
          </div>
          <button
            type="button"
            onClick={onNavigateToWallets}
            className="text-xs text-rose-600 dark:text-rose-400 font-bold hover:underline flex items-center gap-1 active:opacity-70 min-h-[32px] cursor-pointer"
          >
            <span>Tümünü Gör ({topBuckets.length})</span>
            <Layers className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[86px] rounded-2xl border border-rose-100 dark:border-stone-800 bg-stone-100/70 dark:bg-stone-900 animate-pulse" />
            ))}
          </div>
        ) : visibleBuckets.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-6 rounded-2xl border border-dashed border-stone-200 dark:border-stone-800 text-stone-400 dark:text-stone-500">
            <Inbox className="w-5 h-5" aria-hidden />
            <p className="text-xs font-medium">Bu zaman aralığında kova aktivitesi yok</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
            {visibleBuckets.map((b) => (
              <BucketCard key={b.id} b={b} activeTimeframe={activeTimeframe} />
            ))}
          </div>
        )}
      </section>

      {/* ================= CANLI İŞLEM AKIŞI ================= */}
      <section className="bg-white/95 dark:bg-stone-900 rounded-2xl p-3 sm:p-5 border border-pink-200/80 dark:border-stone-800 shadow-sm space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
              {isConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            </span>
            <Activity className="w-4 h-4 text-rose-500 shrink-0" aria-hidden />
            <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate">
              Canlı İşlem Akışı {activeSymbol ? `(${activeSymbol})` : ''}
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              isConnected
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
            }`}>
              {isConnected ? 'Canlı' : 'Bağlanıyor'}
            </span>
            <span className="text-xs text-stone-400 dark:text-stone-500 font-mono tabular-nums">
              {visibleTrades.length} işlem
            </span>
          </div>
        </div>

        {visibleTrades.length === 0 ? (
          <div className="py-10 flex flex-col items-center justify-center gap-2.5 text-stone-400 dark:text-stone-500">
            <div className="w-6 h-6 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" aria-hidden />
            <p className="text-xs font-medium">Gerçek zamanlı emir akışına bağlanılıyor...</p>
          </div>
        ) : (
          <>
            {/* MOBİL: kart akışı — yatay kaydırma yok, tek elle kullanım */}
            <div className="sm:hidden space-y-1.5" aria-live="polite" aria-label="Canlı işlemler">
              {visibleTrades.map((t) => (
                <TradeCard key={t.id} t={t} />
              ))}
            </div>

            {/* DESKTOP: tablo */}
            <div className="hidden sm:block">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-rose-100 dark:border-stone-800 text-stone-400 dark:text-stone-500">
                    <th scope="col" className="pb-2 pl-2 font-medium">Zaman</th>
                    <th scope="col" className="pb-2 font-medium">Fiyat</th>
                    <th scope="col" className="pb-2 font-medium">Değer</th>
                    <th scope="col" className="pb-2 font-medium">Taraf</th>
                    <th scope="col" className="pb-2 pr-2 font-medium text-right">Kova</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-50 dark:divide-stone-800/60">
                  {visibleTrades.map((t) => (
                    <TradeRow key={t.id} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
};
