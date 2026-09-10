import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import {
  BarChart3,
  Download,
  GitCompare,
  Layers,
  Scale,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { BucketManager } from '../engine';
import { generateStatsSnapshot, StatsSnapshot, BucketMatrixRow } from '../statsEngine';
import { TimeframeOption } from '../types';

interface StatsViewProps {
  bucketManager: BucketManager;
  activeSymbol: string;
}

export const formatSignedUsd = (val?: number | null): string => {
  if (val === undefined || val === null || isNaN(val)) return '—';
  const abs = Math.round(Math.abs(val));
  if (abs === 0) return '$0';
  return `${val < 0 ? '-$' : '+$'}${abs.toLocaleString('en-US')}`;
};

export const formatCompactSignedUsd = (val?: number | null): string => {
  if (val === undefined || val === null || isNaN(val)) return '—';
  const abs = Math.abs(val);
  const rounded = abs >= 1000 ? abs : Math.round(abs);
  if (rounded === 0) return '$0';
  const sign = val < 0 ? '-$' : '+$';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${Math.round(abs)}`;
};

export const formatPositiveUsd = (val?: number | null): string => {
  if (val === undefined || val === null || isNaN(val)) return '—';
  return `$${Math.round(Math.max(0, val)).toLocaleString('en-US')}`;
};

const getSignalLabel = (signal?: string): { label: string; short: string } => {
  switch (signal) {
    case 'ACCUMULATION':
      return { label: 'Akıllı Para Toplama', short: 'Toplama' };
    case 'DISTRIBUTION':
      return { label: 'Akıllı Para Boşaltma', short: 'Boşaltma' };
    case 'BULL_MOMENTUM':
      return { label: 'Boğa Akışı', short: 'Boğa' };
    case 'BEAR_MOMENTUM':
      return { label: 'Ayı Akışı', short: 'Ayı' };
    case 'NEUTRAL':
      return { label: 'Nötr Akış', short: 'Nötr' };
    default:
      return { label: 'Bilinmeyen / Analiz Ediliyor', short: 'Bekleniyor' };
  }
};

// DRY: Tekrar kullanılabilir, optimize Bipolar OBI Göstergesi
const OBIGauge = memo(function OBIGauge({
  title,
  value,
  note,
  hasVolume = true,
}: {
  title: string;
  value: number;
  note: string;
  hasVolume?: boolean;
}) {
  return (
    <div className="p-3 sm:p-3.5 bg-white/95 dark:bg-stone-900 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-sm space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-stone-800 dark:text-stone-200">{title}</span>
        <span
          className={`text-xs font-mono font-black tabular-nums ${
            !hasVolume ? 'text-stone-400' : value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}
        >
          {hasVolume ? `${value >= 0 ? '+' : ''}${value}%` : 'Veri Bekleniyor'}
        </span>
      </div>
      <div className="relative w-full h-2.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden flex items-center">
        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-stone-400/80 dark:bg-stone-500 z-10" />
        <div className="w-1/2 h-full flex justify-end">
          {hasVolume && value < 0 && (
            <div
              className="h-full bg-rose-500 transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, Math.abs(value))}%` }}
            />
          )}
        </div>
        <div className="w-1/2 h-full flex justify-start">
          {hasVolume && value > 0 && (
            <div
              className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, value)}%` }}
            />
          )}
        </div>
      </div>
      <div className="flex justify-between text-[10px] font-mono text-stone-400">
        <span>Satıcı Baskısı</span>
        <span>Alıcı Baskısı</span>
      </div>
      <p className="text-[10px] text-stone-500 font-mono">{note}</p>
    </div>
  );
});

// Masaüstü Tablo Satırı: Memoized
const TableRow = memo(function TableRow({ row }: { row: BucketMatrixRow }) {
  const d1 = row.b1 ? row.b1.rollingDelta ?? 0 : null;
  const d5 = row.b5 ? row.b5.rollingDelta ?? 0 : null;
  const d15 = row.b15 ? row.b15.rollingDelta ?? 0 : null;
  const vol5 = row.b5 ? (row.b5.rollingBuyVol ?? 0) + (row.b5.rollingSellVol ?? 0) : null;

  return (
    <tr className="hover:bg-rose-50/40 dark:hover:bg-stone-800/40 transition-colors group">
      <td className="p-2.5 whitespace-nowrap sticky left-0 bg-white dark:bg-stone-900 group-hover:bg-rose-50/70 dark:group-hover:bg-stone-800/80 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] min-w-[160px]">
        <div className="flex items-center gap-2">
          <span className="text-lg shrink-0">{row.icon}</span>
          <div className="flex flex-col">
            <span className="font-bold text-stone-900 dark:text-stone-100">{row.name}</span>
            <span
              className={`inline-block w-fit px-1.5 py-0.5 rounded text-[9px] font-bold mt-0.5 ${
                row.isSmartMoney
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                  : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
              }`}
            >
              {row.isSmartMoney ? 'Smart Money' : 'Retail'}
            </span>
          </div>
        </div>
      </td>
      <td
        className={`p-2.5 font-bold text-right whitespace-nowrap min-w-[105px] tabular-nums ${
          d1 === null ? 'text-stone-400' : d1 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {formatSignedUsd(d1)}
      </td>
      <td
        className={`p-2.5 font-bold text-right whitespace-nowrap min-w-[110px] tabular-nums ${
          d5 === null ? 'text-stone-400' : d5 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {formatSignedUsd(d5)}
      </td>
      <td
        className={`p-2.5 font-bold text-right whitespace-nowrap min-w-[115px] tabular-nums ${
          d15 === null ? 'text-stone-400' : d15 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {formatSignedUsd(d15)}
      </td>
      <td className="p-2.5 text-right font-medium text-stone-600 dark:text-stone-400 whitespace-nowrap min-w-[100px] tabular-nums">
        {formatPositiveUsd(vol5)}
      </td>
    </tr>
  );
});

// Mobil Kart Bileşeni: Memoized
const MobileBucketCard = memo(function MobileBucketCard({ row }: { row: BucketMatrixRow }) {
  const d1 = row.b1 ? row.b1.rollingDelta ?? 0 : null;
  const d5 = row.b5 ? row.b5.rollingDelta ?? 0 : null;
  const d15 = row.b15 ? row.b15.rollingDelta ?? 0 : null;
  const vol5 = row.b5 ? (row.b5.rollingBuyVol ?? 0) + (row.b5.rollingSellVol ?? 0) : null;

  return (
    <div className="p-2.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-800/40 active:scale-[0.98] transition-transform">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-base shrink-0">{row.icon}</span>
          <span className="font-bold text-xs text-stone-900 dark:text-stone-100 truncate">{row.name}</span>
        </div>
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold ${
            row.isSmartMoney
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
          }`}
        >
          {row.isSmartMoney ? 'Smart' : 'Retail'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1 font-mono text-[10px] tabular-nums">
        <div className="flex flex-col">
          <span className="text-stone-400">1m</span>
          <span className={`font-bold ${d1 === null ? 'text-stone-400' : d1 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {formatCompactSignedUsd(d1)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-stone-400">5m</span>
          <span className={`font-bold ${d5 === null ? 'text-stone-400' : d5 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {formatCompactSignedUsd(d5)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-stone-400">15m</span>
          <span className={`font-bold ${d15 === null ? 'text-stone-400' : d15 >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {formatCompactSignedUsd(d15)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-stone-400">5m Hacim</span>
          <span className="font-bold text-stone-600 dark:text-stone-400">
            {vol5 === null ? '—' : formatCompactSignedUsd(vol5).replace(/[+-]/, '')}
          </span>
        </div>
      </div>
    </div>
  );
});

export const StatsView: React.FC<StatsViewProps> = ({ bucketManager, activeSymbol }) => {
  const [exportNotice, setExportNotice] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportTimeoutRef = useRef<any>(null);

  // 1 saniyelik interval ile sabitlenen render clock (her mikro-render'da useMemo bozulmasını engeller)
  const [clock, setClock] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    };
  }, []);

  // StatsEngine üzerinden tek seferde snapshot üretilir (1m + 5m + 15m Union & Map O(1))
  const snapshot: StatsSnapshot = useMemo(() => {
    return generateStatsSnapshot(bucketManager, activeSymbol, clock);
  }, [bucketManager, activeSymbol, clock]);

  const { flow5m, timeframes, dataQuality, bucketMatrix, allBucketCount } = snapshot;
  const tfList: TimeframeOption[] = ['1m', '5m', '15m'];

  // Güvenli CSV Dışa Aktarma: Revoke URL + Dosya Adı Güvenliği + Formül Enjeksiyon Koruması
  const handleExportCSV = useCallback(() => {
    if (exporting) return;
    setExporting(true);

    const headers = [
      'Kova ID',
      'Kova Adi',
      'Tur',
      'Min USDT',
      'Max USDT',
      '1m Delta (USDT)',
      '1m Hacim (USDT)',
      '1m Islem Adedi',
      '5m Delta (USDT)',
      '5m Hacim (USDT)',
      '5m Islem Adedi',
      '15m Delta (USDT)',
      '15m Hacim (USDT)',
      '15m Islem Adedi',
    ];

    const sanitizeCsvCell = (val: string): string => {
      let s = val.replace(/"/g, '""');
      if (/^[=+\-@]/.test(s)) {
        s = `'${s}`;
      }
      return `"${s}"`;
    };

    const rows = bucketMatrix.map((row) => {
      const b1 = row.b1;
      const b5 = row.b5;
      const b15 = row.b15;

      return [
        sanitizeCsvCell(row.id),
        sanitizeCsvCell(row.name),
        row.isSmartMoney ? '"Smart Money"' : '"Retail"',
        row.minValue,
        row.maxValue,
        b1 ? Math.round(b1.rollingDelta ?? 0) : '',
        b1 ? Math.round((b1.rollingBuyVol ?? 0) + (b1.rollingSellVol ?? 0)) : '',
        b1 ? b1.rollingCount ?? 0 : '',
        b5 ? Math.round(b5.rollingDelta ?? 0) : '',
        b5 ? Math.round((b5.rollingBuyVol ?? 0) + (b5.rollingSellVol ?? 0)) : '',
        b5 ? b5.rollingCount ?? 0 : '',
        b15 ? Math.round(b15.rollingDelta ?? 0) : '',
        b15 ? Math.round((b15.rollingBuyVol ?? 0) + (b15.rollingSellVol ?? 0)) : '',
        b15 ? b15.rollingCount ?? 0 : '',
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeTimestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    link.setAttribute('href', url);
    link.setAttribute('download', `kara_para_${activeSymbol || 'BTCUSDT'}_${safeTimestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    setExportNotice(true);
    setExporting(false);
    if (exportTimeoutRef.current) clearTimeout(exportTimeoutRef.current);
    exportTimeoutRef.current = setTimeout(() => setExportNotice(false), 3000);
  }, [bucketMatrix, activeSymbol, exporting]);

  return (
    <div className="space-y-2.5 sm:space-y-3 pb-[env(safe-area-inset-bottom)]">
      {/* Minimal Üst Başlık & Parite Göstergesi */}
      <div className="flex items-center justify-between px-1 py-0.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-rose-500 shrink-0" />
          <h2 className="text-xs sm:text-sm font-black tracking-tight text-stone-900 dark:text-stone-100">
            Multi-Timeframe Akıllı Para Matrisi ({activeSymbol || 'BTCUSDT'})
          </h2>
        </div>
        <span className="hidden sm:inline text-[10px] font-mono text-stone-400">
          1m • 5m • 15m Mikro-Akış & OBI
        </span>
      </div>

      {/* Multi-Timeframe Kartlar (3'lü Grid) */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
        {tfList.map((tf) => {
          const div = timeframes[tf];
          const coverage = dataQuality[tf];
          const isAcc = div.signal === 'ACCUMULATION';
          const isDist = div.signal === 'DISTRIBUTION';
          const isBull = div.signal === 'BULL_MOMENTUM';
          const isBear = div.signal === 'BEAR_MOMENTUM';
          const sig = getSignalLabel(div.signal);

          return (
            <div
              key={tf}
              className={`p-2 sm:p-3 rounded-xl border transition-all active:scale-[0.98] shadow-sm flex flex-col justify-between ${
                isAcc
                  ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800'
                  : isDist
                  ? 'bg-rose-50/90 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
                  : isBull
                  ? 'bg-teal-50/90 dark:bg-teal-950/40 border-teal-300 dark:border-teal-800'
                  : isBear
                  ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
                  : 'bg-white/95 dark:bg-stone-900 border-pink-200/80 dark:border-stone-800'
              }`}
            >
              {/* Başlık & Durum */}
              <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-stone-200/60 dark:border-stone-800/80">
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[11px] sm:text-xs font-black px-1.5 py-0.5 rounded bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900">
                    {tf.toUpperCase()}
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                      coverage.isReady
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300'
                    }`}
                  >
                    {coverage.text}
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold text-stone-500 dark:text-stone-400 tabular-nums">
                  %{div.confidence}
                </span>
              </div>

              {/* Sinyal Rozeti */}
              <div className="py-1.5 flex items-center gap-1 font-black text-[11px] sm:text-xs truncate text-stone-900 dark:text-stone-100">
                {isAcc || isBull ? (
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                )}
                <span className="truncate sm:hidden">{sig.short}</span>
                <span className="truncate hidden sm:inline">{sig.label}</span>
              </div>

              {/* Delta Satırları */}
              <div className="pt-1 border-t border-stone-200/60 dark:border-stone-800/80 font-mono text-[10px] sm:text-xs space-y-0.5">
                <div className="flex justify-between items-center" title={`Smart Delta: ${formatSignedUsd(div.smartDelta)}`}>
                  <span className="text-stone-500 dark:text-stone-400">Smart:</span>
                  <span
                    className={`font-bold text-right tabular-nums ${
                      div.smartDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatCompactSignedUsd(div.smartDelta)}
                  </span>
                </div>
                <div className="flex justify-between items-center" title={`Retail Delta: ${formatSignedUsd(div.retailDelta)}`}>
                  <span className="text-stone-500 dark:text-stone-400">Retail:</span>
                  <span
                    className={`font-bold text-right tabular-nums ${
                      div.retailDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatCompactSignedUsd(div.retailDelta)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Trade Flow Imbalance (OBI) Bipolar Göstergeleri - DRY ve Temiz */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3">
        <OBIGauge
          title="Smart Money Imbalance"
          value={flow5m.smart.obi}
          note="Balina & Leviathan net emir dengesizliği (5m)"
          hasVolume={flow5m.hasVolume}
        />
        <OBIGauge
          title="Retail Imbalance"
          value={flow5m.retail.obi}
          note="Karides ve küçük yatırımcı net emir dengesizliği (5m)"
          hasVolume={flow5m.hasVolume}
        />
        <OBIGauge
          title="Piyasa Hacim Dengesizliği"
          value={flow5m.overall.obi}
          note="Tahtadaki tüm hacim üzerinde alıcı / satıcı net akış baskısı (5m)"
          hasVolume={flow5m.hasVolume}
        />
      </div>

      {/* Dominance Ratio & Rolling Net Delta Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
        {/* Smart Money vs Retail Hacim Oranı */}
        <div className="p-3 sm:p-3.5 bg-white/95 dark:bg-stone-900 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-sm space-y-2.5">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-rose-500" />
            <h3 className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100">
              Hacim Hakimiyeti (Smart vs Retail)
            </h3>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-mono font-bold tabular-nums">
              <span className="text-amber-600 dark:text-amber-400">
                {flow5m.hasVolume ? `Smart Money: %${flow5m.smartRatio}` : 'Smart Money: %0'}
              </span>
              <span className="text-stone-500 dark:text-stone-400">
                {flow5m.hasVolume ? `Retail: %${flow5m.retailRatio}` : 'Retail: %0'}
              </span>
            </div>

            <div className="w-full h-2.5 bg-stone-100 dark:bg-stone-800 rounded-full overflow-hidden flex">
              <div
                className="bg-amber-500 h-full transition-all duration-300"
                style={{ width: `${flow5m.smartRatio}%` }}
              />
              <div
                className="bg-stone-400 h-full transition-all duration-300"
                style={{ width: `${flow5m.retailRatio}%` }}
              />
            </div>

            <div className="flex justify-between text-[10px] font-mono text-stone-400 pt-0.5 tabular-nums">
              <span>Smart Hacim: {formatPositiveUsd(flow5m.smart.volume)}</span>
              <span>Retail Hacim: {formatPositiveUsd(flow5m.retail.volume)}</span>
            </div>
          </div>
        </div>

        {/* Rolling Net Delta Dengesi */}
        <div className="p-3 sm:p-3.5 bg-white/95 dark:bg-stone-900 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-sm space-y-2.5">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-rose-500" />
            <h3 className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100">
              Rolling Net Delta Karşılaştırması (5m)
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-0.5 font-mono">
            <div className="p-2.5 bg-amber-50/70 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800">
              <div className="text-[10px] uppercase font-sans text-amber-800 dark:text-amber-300 font-bold">
                Smart Money Net Delta
              </div>
              <div
                className={`text-sm sm:text-base font-black mt-0.5 tabular-nums ${
                  flow5m.smart.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatSignedUsd(flow5m.smart.delta)}
              </div>
            </div>

            <div className="p-2.5 bg-stone-50 dark:bg-stone-800/80 rounded-xl border border-stone-200 dark:border-stone-700">
              <div className="text-[10px] uppercase font-sans text-stone-600 dark:text-stone-400 font-bold">
                Retail Net Delta
              </div>
              <div
                className={`text-sm sm:text-base font-black mt-0.5 tabular-nums ${
                  flow5m.retail.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatSignedUsd(flow5m.retail.delta)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Timeframe Kova Matrisi (Mobil Kartlar & Masaüstü Tablo) */}
      <div className="bg-white/95 dark:bg-stone-900 p-3.5 sm:p-4 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-sm space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-rose-500 shrink-0" />
            <h3 className="text-xs sm:text-sm font-bold text-stone-900 dark:text-stone-100">
              Kova Bazında Multi-Timeframe Delta & Hacim Matrisi
            </h3>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="text-[10px] font-mono text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-md tabular-nums">
              {allBucketCount} Toplam Kova
            </span>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={exporting}
              aria-label="Kova matrisini CSV olarak indir"
              className="px-2.5 py-1.5 rounded-lg bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 text-[11px] font-bold flex items-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60 shadow-sm cursor-pointer"
            >
              <Download className="w-3 h-3 text-rose-400 dark:text-rose-600" />
              <span>{exportNotice ? 'İndirildi!' : 'CSV İndir'}</span>
            </button>
          </div>
        </div>

        {bucketMatrix.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-stone-400">Henüz kova verisi yok.</div>
        ) : (
          <>
            {/* Mobil Görünüm: Yatay Kaydırmasız, Dokunma Dostu Dikey Kartlar */}
            <div className="sm:hidden space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-thumb]:rounded-full">
              {bucketMatrix.map((row) => (
                <MobileBucketCard key={row.id} row={row} />
              ))}
            </div>

            {/* Masaüstü Görünüm: Dondurulmuş İlk Sütunlu Matris Tablosu */}
            <div className="hidden sm:block overflow-x-auto max-h-[420px] overflow-y-auto border border-stone-200 dark:border-stone-800 rounded-xl relative [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-stone-300 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700 [&::-webkit-scrollbar-thumb]:rounded-full">
              <table className="w-full min-w-[590px] text-left text-xs font-mono border-collapse">
                <thead className="bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400 sticky top-0 z-30">
                  <tr>
                    <th className="p-2.5 whitespace-nowrap sticky left-0 bg-stone-100 dark:bg-stone-800 z-40 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] min-w-[160px]">
                      Kova Adı & Tür
                    </th>
                    <th className="p-2.5 whitespace-nowrap text-right min-w-[105px]">1m Delta</th>
                    <th className="p-2.5 whitespace-nowrap text-right min-w-[110px]">5m Delta</th>
                    <th className="p-2.5 whitespace-nowrap text-right min-w-[115px]">15m Delta</th>
                    <th className="p-2.5 whitespace-nowrap text-right min-w-[100px]">5m Hacim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
                  {bucketMatrix.map((row) => (
                    <TableRow key={row.id} row={row} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
