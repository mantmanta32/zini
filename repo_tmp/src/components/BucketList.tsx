import React, { useState, useMemo } from 'react';
import { 
  ArrowDownRight, 
  ArrowUpRight, 
  Filter, 
  Layers, 
  Search, 
  SlidersHorizontal, 
  Sparkles, 
  Zap 
} from 'lucide-react';
import { BucketStats, SortOption, TimeframeOption } from '../types';

interface BucketListProps {
  buckets: BucketStats[];
  activeTimeframe: TimeframeOption;
  onTimeframeChange: (tf: TimeframeOption) => void;
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  onOpenSettings: () => void;
}

// Standart Finansal Format: Asla "$-100" üretmez, "-$100" veya "+$100" üretir
const formatSignedUsd = (val: number): string => {
  if (val === 0 || isNaN(val)) return '$0';
  const isNeg = val < 0;
  return `${isNeg ? '-$' : '+$'}${Math.round(Math.abs(val)).toLocaleString('en-US')}`;
};

export const BucketList: React.FC<BucketListProps> = ({
  buckets,
  activeTimeframe,
  onTimeframeChange,
  sortBy,
  onSortChange,
  onOpenSettings,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSmartOnly, setFilterSmartOnly] = useState(false);

  const filteredBuckets = useMemo(() => {
    return buckets.filter((b) => {
      if (filterSmartOnly && !b.isSmartMoney) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
    });
  }, [buckets, searchQuery, filterSmartOnly]);

  const totalVolume = useMemo(() => {
    return filteredBuckets.reduce((sum, b) => sum + (b.rollingBuyVol ?? 0) + (b.rollingSellVol ?? 0), 0);
  }, [filteredBuckets]);

  return (
    <div className="space-y-4">
      {/* Top Filter & Sort Bar */}
      <div className="bg-white/95 dark:bg-stone-900 p-4 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-rose-500" />
              <span>Kova & Cüzdan Matrisi</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                {filteredBuckets.length} Aktif
              </span>
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              İşlem büyüklüğüne göre sınıflandırılmış piyasa aktörleri ve anlık delta akışları
            </p>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            {/* Timeframe selector */}
            <div className="flex bg-rose-100/70 dark:bg-stone-800 p-1 rounded-xl border border-rose-200/80 dark:border-stone-700 text-xs font-bold">
              {(['1m', '5m', '15m'] as TimeframeOption[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => onTimeframeChange(tf)}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    activeTimeframe === tf
                      ? 'bg-rose-600 text-white shadow-2xs font-black'
                      : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                  }`}
                >
                  {tf.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Manage Buckets button */}
            <button
              type="button"
              onClick={onOpenSettings}
              className="px-3 py-1.5 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-rose-50 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 text-xs font-bold border border-stone-200 dark:border-stone-700 flex items-center gap-1.5 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-rose-500" />
              <span>Yönet</span>
            </button>
          </div>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-2 border-t border-rose-100 dark:border-stone-800">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Kova ara (isim, aralık)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-rose-400 text-stone-900 dark:text-stone-100"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setFilterSmartOnly(!filterSmartOnly)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
                filterSmartOnly
                  ? 'bg-amber-100 dark:bg-amber-950/70 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200'
                  : 'bg-stone-50 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Sadece Smart</span>
            </button>

            <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500 dark:text-stone-400 flex-1 sm:flex-initial">
              <Filter className="w-3.5 h-3.5 text-stone-400 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => onSortChange(e.target.value as SortOption)}
                className="w-full sm:w-auto bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-2.5 py-1.5 text-xs font-bold text-stone-800 dark:text-stone-200 focus:outline-hidden cursor-pointer"
              >
                <option value="activity">En Çok İşlem (Aktivite)</option>
                <option value="delta_desc">En Çok Alım (Delta +)</option>
                <option value="delta_asc">En Çok Satım (Delta -)</option>
                <option value="volume">En Yüksek Hacim</option>
                <option value="hierarchy">Tutar Sıralaması ($)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Grid of Buckets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredBuckets.map((b) => {
          const delta = b.rollingDelta ?? 0;
          const buyVol = b.rollingBuyVol ?? 0;
          const sellVol = b.rollingSellVol ?? 0;
          const bias = b.directionalBias ?? 50;
          const count = b.rollingCount ?? 0;
          const rangeFormatted = b.minValue !== undefined 
            ? `$${b.minValue.toLocaleString('en-US')} - ${b.maxValue && b.maxValue < 999_999_999 ? '$' + b.maxValue.toLocaleString('en-US') : '∞'}`
            : '';

          return (
            <div
              key={b.id}
              className="p-4 rounded-2xl border border-rose-200/80 dark:border-stone-800 bg-white/95 dark:bg-stone-900 shadow-xs space-y-3 bucket-card hover:border-rose-400 dark:hover:border-rose-700 transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-2xl p-1.5 rounded-xl bg-rose-50 dark:bg-stone-800 border border-rose-100 dark:border-stone-700 flex-shrink-0">
                    {b.icon}
                  </span>
                  <div className="truncate">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-sm text-stone-900 dark:text-stone-100 truncate">
                        {b.name}
                      </span>
                      {b.isSmartMoney && (
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 uppercase flex-shrink-0">
                          Smart
                        </span>
                      )}
                    </div>
                    {rangeFormatted && (
                      <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500">
                        {rangeFormatted}
                      </span>
                    )}
                  </div>
                </div>

                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex-shrink-0">
                  {count} tx ({activeTimeframe})
                </span>
              </div>

              {/* Net Delta Box */}
              <div className="p-2.5 rounded-xl bg-stone-50/80 dark:bg-stone-800/60 border border-stone-100 dark:border-stone-700/60 flex items-center justify-between">
                <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  Net Delta ({activeTimeframe})
                </span>
                <div className={`font-mono text-sm font-black flex items-center gap-1 ${
                  delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : delta < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-stone-500'
                }`}>
                  {delta > 0 ? <ArrowUpRight className="w-4 h-4 stroke-[3]" /> : delta < 0 ? <ArrowDownRight className="w-4 h-4 stroke-[3]" /> : null}
                  <span>{formatSignedUsd(delta)}</span>
                </div>
              </div>

              {/* Buy vs Sell Breakdown */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono text-stone-500 dark:text-stone-400">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    Alım: ${Math.round(buyVol).toLocaleString('en-US')}
                  </span>
                  <span className="text-rose-600 dark:text-rose-400 font-bold">
                    Satım: ${Math.round(sellVol).toLocaleString('en-US')}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2 bg-rose-200/60 dark:bg-stone-800 rounded-full overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${bias}%` }}
                    title={`Alıcı Ağırlığı: %${bias}`}
                  />
                  <div
                    className="bg-rose-500 h-full transition-all duration-300"
                    style={{ width: `${100 - bias}%` }}
                    title={`Satıcı Ağırlığı: %${100 - bias}`}
                  />
                </div>
                <div className="flex justify-between text-[9px] font-mono text-stone-400">
                  <span>%{bias} Alıcı</span>
                  <span>%{100 - bias} Satıcı</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredBuckets.length === 0 && (
        <div className="p-8 text-center bg-white/95 dark:bg-stone-900 rounded-2xl border border-pink-200/80 dark:border-stone-800 text-stone-400">
          Arama kriterine uygun kova bulunamadı.
        </div>
      )}
    </div>
  );
};
