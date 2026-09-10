import React, { 
  useState, 
  useMemo, 
  useRef, 
  useEffect, 
  useCallback, 
  memo 
} from 'react';
import { 
  AlertCircle, 
  CheckCircle2, 
  Download, 
  Filter, 
  Info, 
  Search, 
  Terminal, 
  Trash2,
  X,
  ChevronDown,
  FileText
} from 'lucide-react';
import { TerminalLog } from '../types';

// ============================================================================
// TYPES
// ============================================================================

type LogLevel = 'all' | 'info' | 'success' | 'warn' | 'error';

interface LogsViewProps {
  logs: TerminalLog[];
  onClearLogs: () => void;
  maxHeight?: string;         // varsayılan: 480px
  title?: string;             // varsayılan: "Terminal & Sistem Günlükleri"
  className?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const LOGLEVELS: { value: LogLevel; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'info', label: 'Bilgi' },
  { value: 'success', label: 'Başarılı' },
  { value: 'warn', label: 'Uyarı' },
  { value: 'error', label: 'Hata' },
];

const LOGCOLORS = {
  error: {
    badge: 'bg-red-950/80 text-red-400 border-red-800',
    text: 'text-red-300',
    icon: 'text-red-400',
  },
  warn: {
    badge: 'bg-amber-950/80 text-amber-400 border-amber-800',
    text: 'text-amber-300',
    icon: 'text-amber-400',
  },
  success: {
    badge: 'bg-emerald-950/80 text-emerald-400 border-emerald-800',
    text: 'text-emerald-300',
    icon: 'text-emerald-400',
  },
  info: {
    badge: 'bg-sky-950/80 text-sky-400 border-sky-800',
    text: 'text-sky-300',
    icon: 'text-sky-400',
  },
} as const;

// ============================================================================
// UTILITY COMPONENTS
// ============================================================================

const LogIcon = memo(({ type }: { type: TerminalLog['type'] }) => {
  switch (type) {
    case 'error': return <AlertCircle className="w-3 h-3 text-red-400 shrink-0" aria-hidden="true" />;
    case 'warn': return <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" aria-hidden="true" />;
    case 'success': return <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" aria-hidden="true" />;
    default: return <Info className="w-3 h-3 text-sky-400 shrink-0" aria-hidden="true" />;
  }
});
LogIcon.displayName = 'LogIcon';

// ============================================================================
// VIRTUAL LIST (performans için, 500+ log için)
// ============================================================================

interface VirtualListProps {
  items: TerminalLog[];
  itemHeight: number;
  containerHeight: number;
}

const VirtualLogList = memo(({ items, itemHeight, containerHeight }: VirtualListProps) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const startIndex = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(containerHeight / itemHeight) + 2; // buffer
  const endIndex = Math.min(startIndex + visibleCount, items.length);
  const visibleItems = items.slice(startIndex, endIndex);
  const offsetY = startIndex * itemHeight;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto overscroll-contain"
      style={{ scrollBehavior: 'smooth' }}
      role="log"
      aria-live="polite"
      aria-label="Terminal çıktıları"
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((log, idx) => {
            const colors = LOGCOLORS[log.type] || LOGCOLORS.info;
            const realIndex = startIndex + idx;
            
            return (
              <div
                key={`${log.id}_${realIndex}`}
                className="flex items-start gap-2 sm:gap-3 py-1 px-2 sm:px-3 hover:bg-stone-900/60 active:bg-stone-900/80 rounded transition-colors min-h-[24px]"
                style={{ height: itemHeight }}
              >
                <span className="text-stone-600 shrink-0 text-[10px] sm:text-[11px] select-none font-mono mt-0.5">
                  [{log.time}]
                </span>
                
                <span
                  className={`font-bold uppercase text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 border ${colors.badge} flex items-center gap-1`}
                >
                  <LogIcon type={log.type} />
                  {log.type}
                </span>
                
                <span className={`break-all leading-relaxed text-[11px] sm:text-xs ${colors.text}`}>
                  {log.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
VirtualLogList.displayName = 'VirtualLogList';

// ============================================================================
// MOBILE FILTER SHEET COMPONENT
// ============================================================================

const MobileFilterSheet = memo(({
  isOpen,
  onClose,
  currentFilter,
  onFilterChange,
  currentCount,
  totalCount
}: {
  isOpen: boolean;
  onClose: () => void;
  currentFilter: LogLevel;
  onFilterChange: (f: LogLevel) => void;
  currentCount: number;
  totalCount: number;
}) => {
  if (!isOpen) return null;

  return (
    <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end">
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-xs" 
        onClick={onClose}
        aria-hidden="true"
      />
      <div 
        className="relative bg-stone-900 border-t border-stone-700 rounded-t-2xl p-4 animate-in slide-in-from-bottom-10 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Filtre seçenekleri"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-stone-200">Log Filtreleri</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-stone-800 active:bg-stone-700 transition-colors cursor-pointer"
            aria-label="Kapat"
          >
            <X className="w-4 h-4 text-stone-400" />
          </button>
        </div>
        
        <div className="space-y-1">
          {LOGLEVELS.map((level) => (
            <button
              key={level.value}
              onClick={() => {
                onFilterChange(level.value);
                onClose();
              }}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-medium transition-all active:scale-[0.98] cursor-pointer ${
                currentFilter === level.value
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/20'
                  : 'text-stone-300 hover:bg-stone-800 active:bg-stone-700'
              }`}
            >
              <span className="capitalize">{level.label}</span>
              {currentFilter === level.value && (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </button>
          ))}
        </div>
        
        <div className="mt-4 pt-3 border-t border-stone-800 text-center">
          <span className="text-xs text-stone-500 font-mono">
            {currentCount} / {totalCount} kayıt gösteriliyor
          </span>
        </div>
      </div>
    </div>
  );
});
MobileFilterSheet.displayName = 'MobileFilterSheet';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const LogsView: React.FC<LogsViewProps> = ({
  logs,
  onClearLogs,
  maxHeight = '480px',
  title = 'Terminal & Sistem Günlükleri',
  className = ''
}) => {
  const [filterType, setFilterType] = useState<LogLevel>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Optimized filtering
  const filteredLogs = useMemo(() => {
    if (!logs.length) return [];
    
    const query = searchQuery.trim().toLowerCase();
    const hasQuery = query.length > 0;
    const hasFilter = filterType !== 'all';

    if (!hasQuery && !hasFilter) return logs;

    return logs.filter((log) => {
      if (hasFilter && log.type !== filterType) return false;
      if (hasQuery && !log.text.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [logs, filterType, searchQuery]);

  // Auto-scroll for both native and virtual list
  useEffect(() => {
    if (!autoScroll || !logContainerRef.current || filteredLogs.length === 0) return;
    
    const container = logContainerRef.current;
    const timer = requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    });
    
    return () => cancelAnimationFrame(timer);
  }, [filteredLogs, autoScroll, logs.length]);

  // Keyboard shortcut: focus search (Ctrl/Cmd + K)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Export with error handling
  const handleExportLogs = useCallback(async () => {
    if (isExporting || !logs.length) return;
    
    setIsExporting(true);
    try {
      const content = logs
        .map((l) => `[${l.time}] [${l.type.toUpperCase()}] ${l.text}`)
        .join('\n');
      
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `kara-para-terminal-logs-${Date.now()}.txt`;
      
      // iOS workaround
      if ('download' in link) {
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        window.open(url, '_blank');
      }
      
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [logs, isExporting]);

  // Clear with confirmation on mobile
  const handleClear = useCallback(() => {
    if (window.innerWidth < 640) {
      if (window.confirm('Tüm logları silmek istediğinize emin misiniz?')) {
        onClearLogs();
      }
    } else {
      onClearLogs();
    }
  }, [onClearLogs]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  }, []);

  // Touch-optimised log count display
  const activeFilterLabel = LOGLEVELS.find(l => l.value === filterType)?.label;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* HEADER CARD - Mobil: sticky top bar gibi davranır */}
      <div className="bg-white/95 dark:bg-stone-900 p-3 sm:p-4 rounded-2xl border border-rose-200/80 dark:border-stone-800 shadow-sm space-y-3 sticky top-0 z-20">
        
        {/* Title Row */}
        <div className="flex items-center justify-between gap-2 min-h-[40px]">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 shrink-0">
              <Terminal className="w-4 h-4 sm:w-5 sm:h-5 text-rose-500" aria-hidden="true" />
            </div>
            <h2 className="text-sm sm:text-base font-black text-stone-900 dark:text-stone-100 truncate">
              {title}
            </h2>
            <span className="hidden sm:inline-flex text-[10px] sm:text-xs px-2 py-1 rounded-full font-mono font-bold bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 shrink-0">
              {filteredLogs.length} / {logs.length}
            </span>
          </div>

          {/* Actions - Mobil: ikonları büyült */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportLogs}
              disabled={isExporting || logs.length === 0}
              className="group px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 text-xs font-bold border border-stone-200 dark:border-stone-700 flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 min-h-[40px] sm:min-h-[32px] cursor-pointer"
              title="Logları indir (.txt)"
            >
              <Download className={`w-4 h-4 sm:w-3.5 sm:h-3.5 ${isExporting ? 'animate-bounce' : ''}`} />
              <span className="hidden sm:inline">İndir (.txt)</span>
            </button>

            <button
              type="button"
              onClick={handleClear}
              className="px-2.5 sm:px-3 py-2 sm:py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900 text-rose-700 dark:text-rose-300 text-xs font-bold border border-rose-200 dark:border-rose-800 flex items-center gap-1.5 transition-all active:scale-95 min-h-[40px] sm:min-h-[32px] cursor-pointer"
              title="Tüm logları temizle"
            >
              <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-rose-600" />
              <span className="hidden sm:inline">Temizle</span>
            </button>
          </div>
        </div>

        {/* FILTER BAR - Mobil: alt satıra geçer, touch-friendly */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-3 border-t border-rose-100 dark:border-stone-800">
          
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Loglarda ara... (⌘K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-9 py-2.5 sm:py-1.5 text-xs sm:text-sm bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-400 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 transition-shadow"
              enterKeyHint="search"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors cursor-pointer"
                aria-label="Aramayı temizle"
              >
                <X className="w-3.5 h-3.5 text-stone-500" />
              </button>
            )}
          </div>

          {/* Desktop: Inline filters */}
          <div className="hidden sm:flex items-center gap-0.5 bg-stone-100 dark:bg-stone-800 p-1 rounded-xl text-xs font-bold">
            {LOGLEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => setFilterType(level.value)}
                className={`px-2.5 py-1.5 rounded-lg capitalize transition-all cursor-pointer ${
                  filterType === level.value
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 shadow-sm'
                    : 'text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white'
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>

          {/* Mobile: Filter trigger button */}
          <button
            type="button"
            onClick={() => setShowMobileFilters(true)}
            className="sm:hidden flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-200 text-xs font-bold border border-stone-200 dark:border-stone-700 active:bg-stone-200 transition-colors min-h-[44px] cursor-pointer"
          >
            <Filter className="w-4 h-4" />
            <span>{activeFilterLabel}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* MOBILE FILTER SHEET */}
      <MobileFilterSheet
        isOpen={showMobileFilters}
        onClose={() => setShowMobileFilters(false)}
        currentFilter={filterType}
        onFilterChange={setFilterType}
        currentCount={filteredLogs.length}
        totalCount={logs.length}
      />

      {/* TERMINAL DISPLAY */}
      <div
        ref={logContainerRef}
        className="bg-stone-950 text-stone-200 font-mono text-xs p-3 sm:p-4 rounded-2xl border border-stone-800 overflow-hidden shadow-inner"
        style={{ height: maxHeight }}
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-stone-500 italic gap-3">
            <FileText className="w-8 h-8 opacity-40" aria-hidden="true" />
            <span className="text-center text-sm">
              {searchQuery 
                ? 'Arama sonuçlarına uygun log bulunamadı.'
                : 'Kayıtlı terminal mesajı bulunmuyor.'
              }
            </span>
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="text-rose-400 font-medium text-xs hover:underline cursor-pointer"
              >
                Aramayı temizle
              </button>
            )}
          </div>
        ) : logs.length > 500 ? (
          // Virtual scrolling for large lists
          <VirtualLogList
            items={filteredLogs}
            itemHeight={28}
            containerHeight={parseInt(maxHeight, 10) || 480}
          />
        ) : (
          // Simple list for small sets
          <div className="space-y-1 h-full overflow-y-auto overscroll-contain" role="log" aria-live="polite">
            {filteredLogs.map((log) => {
              const colors = LOGCOLORS[log.type] || LOGCOLORS.info;
              
              return (
                <div
                  key={log.id}
                  className="flex items-start gap-2 sm:gap-2.5 py-1 px-2 hover:bg-stone-900/60 active:bg-stone-900/80 rounded-lg transition-colors cursor-default select-text"
                >
                  <span className="text-stone-600 shrink-0 text-[10px] sm:text-[11px] select-none mt-0.5 font-mono">
                    [{log.time}]
                  </span>
                  <span className={`font-bold uppercase text-[9px] sm:text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 border ${colors.badge}`}>
                    {log.type}
                  </span>
                  <span className={`break-all leading-relaxed text-[11px] sm:text-xs ${colors.text}`}>
                    {log.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] sm:text-xs text-stone-500 font-mono px-1 sm:px-2">
        <label className="flex items-center gap-2.5 cursor-pointer select-none py-2 sm:py-0 min-h-[44px] sm:min-h-0">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-stone-300 cursor-pointer"
          />
          <span className="text-stone-600 dark:text-stone-400">Yeni loglarda otomatik aşağı kaydır</span>
        </label>
        
        <div className="flex items-center gap-3 text-stone-400">
          <span>WebSocket Log Stream v3.1</span>
          {filteredLogs.length !== logs.length && (
            <span className="text-rose-500 font-medium">
              Filtre aktif: {filteredLogs.length}/{logs.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogsView;
