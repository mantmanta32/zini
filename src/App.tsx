import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  ArrowDownRight, 
  ArrowUpRight, 
  Play, 
  Plus,
  Radio, 
  Square, 
  Volume2, 
  VolumeX, 
  X,
  Zap 
} from 'lucide-react';
import { soundEngine } from './audio';
import { BucketManager, WSManager } from './engine';
import { 
  ActiveTab, 
  AppSettings, 
  BucketStats, 
  BucketThresholds, 
  CustomBucket, 
  RecentTrade, 
  SmartMoneyDivergence, 
  SortOption, 
  TerminalLog, 
  TimeframeOption 
} from './types';
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { BucketList } from './components/BucketList';
import { StatsView } from './components/StatsView';
import { LogsView } from './components/LogsView';
import { SettingsView } from './components/SettingsView';
import { TradingViewChart } from './components/TradingViewChart';

const DEFAULT_QUICK_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', '1000PEPEUSDT', 'TRBUSDT', 'XRPUSDT', 'BNBUSDT'];

export default function App() {
  // Navigation & Settings (URL Hash & LocalStorage ile kalıcı tab)
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const validTabs: ActiveTab[] = ['dashboard', 'chart', 'wallets', 'stats', 'logs', 'settings'];
    const hash = window.location.hash.replace('#', '') as ActiveTab;
    if (validTabs.includes(hash)) return hash;
    try {
      const saved = localStorage.getItem('kara_para_active_tab') as ActiveTab;
      if (validTabs.includes(saved)) return saved;
    } catch {}
    return 'dashboard';
  });

  const [appSettings, setAppSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem('kara_para_settings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      theme: 'dark',
      soundEnabled: true,
      activeTimeframe: '1m',
      bufferSize: 1000,
      maxRecentTrades: 30,
      autoReconnect: true,
    };
  });

  // Trading Symbol & State (LocalStorage'da kalıcı son parite)
  const [symbolInput, setSymbolInput] = useState<string>(() => {
    try {
      return localStorage.getItem('kara_para_last_symbol') || 'BTCUSDT';
    } catch {
      return 'BTCUSDT';
    }
  });

  // Quick Coins (Kullanıcı Özelleştirilebilir Hızlı Parite Listesi)
  const [quickCoins, setQuickCoins] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('kara_para_quick_coins');
      return saved ? JSON.parse(saved) : DEFAULT_QUICK_COINS;
    } catch {
      return DEFAULT_QUICK_COINS;
    }
  });
  const [showAddCoinModal, setShowAddCoinModal] = useState(false);
  const [newCoinInput, setNewCoinInput] = useState('');

  const [activeSymbol, setActiveSymbol] = useState<string>(() => {
    try {
      return localStorage.getItem('kara_para_last_symbol') || 'BTCUSDT';
    } catch {
      return 'BTCUSDT';
    }
  });
  const [isRunning, setIsRunning] = useState(false);
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');

  // Quant Engine State
  const [thresholds, setThresholds] = useState<BucketThresholds>({
    shrimpMax: 1000,
    crabMax: 10000,
    whaleMax: 100000,
  });
  const [customBuckets, setCustomBuckets] = useState<CustomBucket[]>([]);
  const [sortedBuckets, setSortedBuckets] = useState<BucketStats[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>('activity');
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [divergence, setDivergence] = useState<SmartMoneyDivergence>({
    timeframe: '1m',
    retailDelta: 0,
    smartDelta: 0,
    signal: 'NEUTRAL',
    signalTitle: '⚖️ DENGELİ / NÖTR PİYASA (1M)',
    signalDesc: 'Gerçek Binance Futures akışı bekleniyor...',
    confidence: 50,
    timestamp: Date.now(),
  });

  // Terminal Logs (LocalStorage'da saklanan log geçmişi)
  const [terminalLogs, setTerminalLogs] = useState<TerminalLog[]>(() => {
    try {
      const saved = localStorage.getItem('kara_para_terminal_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Engine & WS Refs
  const bucketManagerRef = useRef<BucketManager | null>(null);
  const wsManagerRef = useRef<WSManager | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const tradeBatchRef = useRef<RecentTrade[]>([]);
  const lastSignalRef = useRef<string>('NEUTRAL');

  if (!bucketManagerRef.current) {
    bucketManagerRef.current = new BucketManager(appSettings.bufferSize);
  }
  if (!wsManagerRef.current) {
    wsManagerRef.current = new WSManager(bucketManagerRef.current);
  }

  // Active Tab Senkronizasyonu (URL Hash + LocalStorage)
  useEffect(() => {
    window.location.hash = activeTab;
    try {
      localStorage.setItem('kara_para_active_tab', activeTab);
    } catch {}
  }, [activeTab]);

  // Terminal Logger & LocalStorage Kalıcılığı
  const addLog = useCallback((text: string, type: 'info' | 'warn' | 'success' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setTerminalLogs((prev) => {
      const updated = [
        ...prev.slice(-150),
        { id: Date.now() + Math.random(), text, type, time, timestamp: Date.now() },
      ];
      try {
        localStorage.setItem('kara_para_terminal_logs', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const handleClearLogs = useCallback(() => {
    setTerminalLogs([]);
    try {
      localStorage.removeItem('kara_para_terminal_logs');
    } catch {}
  }, []);

  // Theme Synchronizer
  useEffect(() => {
    const root = document.documentElement;
    if (appSettings.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [appSettings.theme]);

  // Audio mute state
  useEffect(() => {
    soundEngine.setMuted(!appSettings.soundEnabled);
  }, [appSettings.soundEnabled]);

  // Save settings
  const handleUpdateSettings = (partial: Partial<AppSettings>) => {
    setAppSettings((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem('kara_para_settings', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Quick Coin Ekle / Çıkar
  const handleAddQuickCoin = (coinRaw: string) => {
    let clean = coinRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!clean) return;
    if (!clean.endsWith('USDT')) clean += 'USDT';
    if (!quickCoins.includes(clean)) {
      const updated = [clean, ...quickCoins].slice(0, 16);
      setQuickCoins(updated);
      try {
        localStorage.setItem('kara_para_quick_coins', JSON.stringify(updated));
      } catch {}
      addLog(`✨ Yeni hızlı parite eklendi: ${clean}`, 'success');
    }
    setNewCoinInput('');
    setShowAddCoinModal(false);
  };

  const handleRemoveQuickCoin = (e: React.MouseEvent, coin: string) => {
    e.stopPropagation();
    if (quickCoins.length <= 1) return;
    const updated = quickCoins.filter(c => c !== coin);
    setQuickCoins(updated);
    try {
      localStorage.setItem('kara_para_quick_coins', JSON.stringify(updated));
    } catch {}
    addLog(`🗑️ Parite listeden çıkarıldı: ${coin}`, 'info');
  };

  // Setup callbacks
  useEffect(() => {
    const bm = bucketManagerRef.current;
    const ws = wsManagerRef.current;
    if (!bm || !ws) return;

    setCustomBuckets([...bm.customBuckets]);

    bm.onThresholdUpdate = (t) => {
      setThresholds({ ...t });
    };

    bm.onCustomBucketsUpdate = (buckets) => {
      setCustomBuckets([...buckets]);
    };

    ws.onStatusChange = (status) => {
      setConnectionState(status);
      if (status === 'connected') setIsRunning(true);
      else if (status === 'disconnected' || status === 'error') setIsRunning(false);
    };

    ws.onLog = (msg, type) => {
      addLog(msg, type);
    };

    ws.onTrade = (trade) => {
      tradeBatchRef.current.push(trade);
      if (tradeBatchRef.current.length > 50) {
        tradeBatchRef.current.shift();
      }

      const prev = prevPriceRef.current;
      if (prev !== null) {
        if (trade.price > prev) setPriceDirection('up');
        else if (trade.price < prev) setPriceDirection('down');
      }
      prevPriceRef.current = trade.price;
      setCurrentPrice(trade.price);
    };

    const initialSym = (() => {
      try {
        return localStorage.getItem('kara_para_last_symbol') || 'BTCUSDT';
      } catch {
        return 'BTCUSDT';
      }
    })();
    setActiveSymbol(initialSym);
    setSymbolInput(initialSym);

    addLog(`Terminal başlatıldı. ${initialSym} Binance Futures canlı verisine bağlanılıyor...`, 'info');
    // Sayfa açılır açılmaz otomatik canlı piyasa akışını başlat (0 işlem beklemesini yok et)
    ws.connect(initialSym);
    bm.bootstrapFromRest(initialSym).then((count) => {
      if (count > 0) {
        addLog(`⚡ ${count} geçmiş işlem REST API'den yüklendi (1m/5m/15m ayrışması hazır).`, 'success');
      }
    });
    setIsRunning(true);
  }, [addLog]);

  // Decoupled 120ms React UI Refresh Loop
  useEffect(() => {
    const interval = setInterval(() => {
      const bm = bucketManagerRef.current;
      if (!bm) return;

      const now = Date.now();
      const div = bm.getSmartMoneyDivergence(appSettings.activeTimeframe, now);
      setDivergence(div);

      // Dopamin Ses Tetikleyici: Boğa Emilimi ya da Dağıtım tespit edildiğinde
      if (div.signal !== lastSignalRef.current) {
        if (div.signal === 'ACCUMULATION') {
          soundEngine.playSignalChime('bull');
          addLog(`💥 SİNYAL ALARMI: ${div.signalTitle}`, 'success');
        } else if (div.signal === 'DISTRIBUTION') {
          soundEngine.playSignalChime('bear');
          addLog(`🚨 SİNYAL ALARMI: ${div.signalTitle}`, 'warn');
        }
        lastSignalRef.current = div.signal;
      }

      // Kovaları sırala
      const sorted = bm.getAllBucketsSorted(sortOption, appSettings.activeTimeframe, now);
      setSortedBuckets(sorted);

      // İşlem akışını güvenli ve eşzamanlı aktar (Deduplication ile key collision engellenir)
      if (tradeBatchRef.current.length > 0) {
        const incoming = [...tradeBatchRef.current].reverse();
        tradeBatchRef.current = [];
        setRecentTrades((prev) => {
          const seen = new Set<string | number>();
          const deduped: typeof prev = [];
          for (const item of [...incoming, ...prev]) {
            if (!seen.has(item.id)) {
              seen.add(item.id);
              deduped.push(item);
            }
          }
          return deduped.slice(0, 100);
        });
      }
    }, 120);

    return () => clearInterval(interval);
  }, [appSettings.activeTimeframe, sortOption, addLog]);

  // Fiyat Formatlama Yardımcısı (İngilizce US Locale ile Standart)
  const formatPrice = (price: number | null): string => {
    if (price === null || isNaN(price)) return '---';
    if (price >= 1000) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (price >= 1) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    if (price >= 0.0001) return `$${price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
    return `$${price.toFixed(8)}`;
  };

  // Start Stream Handler (Gelişmiş Sanitizasyon ve Doğrulama)
  const handleStart = (symbolToStart?: string) => {
    let sym = (symbolToStart || symbolInput).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!sym) {
      addLog('❌ Lütfen bir parite sembolü girin (Örn: BTCUSDT)', 'error');
      return;
    }

    // Otomatik USDT tamamlayıcı
    if (!sym.endsWith('USDT')) {
      sym += 'USDT';
    }

    if (sym.length < 5) {
      addLog('❌ Geçersiz sembol formatı!', 'error');
      return;
    }

    if (activeSymbol && activeSymbol !== sym) {
      setRecentTrades([]);
      tradeBatchRef.current = [];
      setCurrentPrice(null);
      prevPriceRef.current = null;
      bucketManagerRef.current?.reset();
      if (bucketManagerRef.current) {
        setSortedBuckets(bucketManagerRef.current.getAllBucketsSorted(sortOption, appSettings.activeTimeframe, Date.now()));
      }
    }

    setActiveSymbol(sym);
    setSymbolInput(sym);
    try {
      localStorage.setItem('kara_para_last_symbol', sym);
    } catch {}

    setIsRunning(true);
    addLog(`🚀 ${sym} Binance Futures canlı emir akışına bağlanılıyor...`, 'info');
    wsManagerRef.current?.connect(sym);
    bucketManagerRef.current?.bootstrapFromRest(sym).then((count) => {
      if (count > 0) {
        addLog(`⚡ ${count} geçmiş işlem REST API'den yüklendi (${sym} 1m/5m/15m hazır).`, 'success');
      }
    });
  };

  // Stop Stream Handler
  const handleStop = () => {
    wsManagerRef.current?.disconnect();
    setIsRunning(false);
    setConnectionState('disconnected');
    setCurrentPrice(null);
    prevPriceRef.current = null;
    addLog('🛑 Canlı veri akışı durduruldu.', 'warn');
  };

  return (
    <div className={`min-h-screen ${activeTab === 'chart' ? 'bg-[#090a0f] h-screen overflow-hidden p-0 m-0' : 'bg-pink-50/50 dark:bg-stone-950 pb-24'} text-stone-900 dark:text-stone-100 font-sans transition-colors`}>
      
      {/* ==================================================================== */}
      {/* TOP HEADER & STREAM CONTROL BAR (Grafik modunda tam ekran için gizlenir) */}
      {/* ==================================================================== */}
      {activeTab !== 'chart' && (
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-stone-900/95 backdrop-blur-md border-b border-rose-200/80 dark:border-stone-800 shadow-xs px-2.5 sm:px-4 py-1.5 sm:py-2 transition-colors">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          
          {/* Sol Kısım: Logo */}
          <div className="flex items-center gap-1 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-rose-600 to-pink-500 flex items-center justify-center text-white font-black shadow-xs shrink-0">
              <Zap className="w-4 h-4 fill-white" />
            </div>
            <div>
              <h1 className="text-xs font-black tracking-tight leading-none text-stone-900 dark:text-stone-100">
                KARA PARA <span className="text-rose-600 dark:text-rose-400">FUTURES</span>
              </h1>
              <span className="hidden md:inline-block text-[9px] font-mono font-bold text-stone-500 dark:text-stone-400 leading-tight">
                Akıllı Para Radarı
              </span>
            </div>
          </div>

          {/* Orta Kısım: Canlı Fiyat Rozeti */}
          <div
            id="price-val"
            className={`font-mono text-[11px] sm:text-sm font-black px-1.5 sm:px-2.5 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors shrink-0 ${
              priceDirection === 'up' ? 'text-emerald-600 dark:text-emerald-400' :
              priceDirection === 'down' ? 'text-rose-600 dark:text-rose-400' : 'text-stone-700 dark:text-stone-300'
            }`}
          >
            {formatPrice(currentPrice)}
          </div>

          {/* Sağ Kısım: Form Kontrolleri (Input + Başlat/Durdur + Durum Noktası) */}
          <div className="flex items-center gap-1 shrink-0">
            <input
              id="coinInput"
              type="text"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleStart()}
              placeholder="BTC..."
              className="w-16 sm:w-24 px-1.5 py-1 text-[11px] sm:text-xs font-mono font-bold uppercase bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-rose-400 text-stone-900 dark:text-stone-100"
            />

            {!isRunning ? (
              <button
                id="startBtn"
                type="button"
                onClick={() => handleStart()}
                className="p-1 sm:px-2.5 sm:py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-black text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer shrink-0"
                title="Akışı Başlat"
              >
                <Play className="w-3.5 h-3.5 fill-white" />
                <span className="hidden sm:inline">BAŞLAT</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStop}
                className="p-1 sm:px-2.5 sm:py-1 rounded-lg bg-stone-800 hover:bg-stone-900 text-rose-300 font-black text-xs flex items-center gap-1 shadow-xs transition-all cursor-pointer shrink-0"
                title="Akışı Durdur"
              >
                <Square className="w-3.5 h-3.5 fill-rose-300" />
                <span className="hidden sm:inline">DURDUR</span>
              </button>
            )}

            {/* Kompakt Durum Noktası */}
            <div
              id="ws-status"
              title={connectionState === 'connected' ? `Bağlı: ${activeSymbol}` : connectionState === 'connecting' ? 'Bağlanıyor...' : 'Bağlantı Yok'}
              className={`p-1 rounded-lg border transition-colors flex items-center justify-center shrink-0 ${
                connectionState === 'connected'
                  ? 'bg-emerald-50 text-emerald-600 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800'
                  : connectionState === 'connecting'
                  ? 'bg-amber-50 text-amber-600 border-amber-300 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800'
                  : 'bg-stone-100 text-stone-400 border-stone-200 dark:bg-stone-800 dark:text-stone-500 dark:border-stone-700'
              }`}
            >
              <Radio className={`w-3.5 h-3.5 ${connectionState === 'connected' ? 'animate-pulse text-emerald-500' : ''}`} />
            </div>
          </div>
        </div>

        {/* Quick Coin Bar (Kompakt ve Hızlı Geçiş Barı) */}
        <div className="max-w-5xl mx-auto flex items-center gap-1 pt-1.5 pb-0.5 overflow-x-auto scrollbar-none">
          <span className="text-[10px] font-mono text-stone-400 shrink-0">Hızlı Pariteler:</span>
          {quickCoins.map((c) => (
            <div key={c} className="relative group shrink-0 flex items-center">
              <button
                type="button"
                onClick={() => handleStart(c)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer ${
                  activeSymbol === c && isRunning
                    ? 'bg-rose-600 text-white shadow-2xs font-black'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 hover:bg-rose-100 dark:hover:bg-stone-700'
                }`}
              >
                {c.replace('USDT', '')}
              </button>
              {quickCoins.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => handleRemoveQuickCoin(e, c)}
                  className="opacity-40 sm:opacity-0 sm:group-hover:opacity-100 hover:opacity-100 hover:text-rose-500 text-stone-400 text-[11px] font-black px-0.5 transition-opacity cursor-pointer"
                  title="Pariteyi kaldır"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {/* Yeni Parite Ekle Butonu */}
          {!showAddCoinModal ? (
            <button
              type="button"
              onClick={() => setShowAddCoinModal(true)}
              className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/50 flex items-center gap-0.5 shrink-0 transition-colors"
              title="Yeni hızlı parite ekle"
            >
              <Plus className="w-3 h-3" />
              <span>Ekle</span>
            </button>
          ) : (
            <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800 p-0.5 px-1.5 rounded-lg shrink-0">
              <input
                type="text"
                value={newCoinInput}
                onChange={(e) => setNewCoinInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddQuickCoin(newCoinInput)}
                placeholder="ETH / SOL..."
                autoFocus
                className="w-16 bg-transparent text-[10px] font-mono font-bold uppercase focus:outline-hidden text-stone-900 dark:text-stone-100"
              />
              <button
                type="button"
                onClick={() => handleAddQuickCoin(newCoinInput)}
                className="text-[10px] font-bold text-rose-600 hover:text-rose-700 px-1"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => setShowAddCoinModal(false)}
                className="text-[10px] font-bold text-stone-400 hover:text-stone-600"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </header>
      )}

      {/* ==================================================================== */}
      {/* MAIN CONTENT AREA BY ACTIVE TAB */}
      {/* ==================================================================== */}
      <main className={activeTab === 'chart' ? 'w-full h-full p-0 m-0' : 'max-w-5xl mx-auto px-2.5 sm:px-3 pt-3 pb-28 sm:pb-20'}>
        {/* TradingView Chart Component (Keep-Alive: DOM'da kalıcı, sekmeler arası geçişte sıfırlanmaz) */}
        <div className={activeTab === 'chart' ? 'w-full h-full p-0 m-0' : 'hidden'}>
          <TradingViewChart
            symbol={activeSymbol || 'BTCUSDT'}
            onBackToDashboard={() => setActiveTab('dashboard')}
            isDark={appSettings.theme === 'dark'}
            isActive={activeTab === 'chart'}
            onSelectSymbol={(sym) => handleStart(sym)}
            quickCoins={quickCoins}
          />
        </div>

        {activeTab === 'dashboard' && (
          <Dashboard
            divergence={divergence}
            topBuckets={sortedBuckets}
            recentTrades={recentTrades}
            activeTimeframe={appSettings.activeTimeframe}
            onTimeframeChange={(tf) => handleUpdateSettings({ activeTimeframe: tf })}
            maxTradesShown={appSettings.maxRecentTrades}
            activeSymbol={activeSymbol}
            onNavigateToWallets={() => setActiveTab('wallets')}
            isLoading={!isRunning || connectionState === 'connecting'}
          />
        )}

        {activeTab === 'wallets' && (
          <BucketList
            buckets={sortedBuckets}
            activeTimeframe={appSettings.activeTimeframe}
            onTimeframeChange={(tf) => handleUpdateSettings({ activeTimeframe: tf })}
            sortBy={sortOption}
            onSortChange={setSortOption}
            onOpenSettings={() => setActiveTab('settings')}
          />
        )}

        {activeTab === 'stats' && (
          <StatsView
            bucketManager={bucketManagerRef.current!}
            activeSymbol={activeSymbol}
          />
        )}

        {activeTab === 'logs' && (
          <LogsView
            logs={terminalLogs}
            onClearLogs={handleClearLogs}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            bucketManager={bucketManagerRef.current!}
            customBuckets={customBuckets}
            appSettings={appSettings}
            onUpdateSettings={handleUpdateSettings}
            onRefreshCustomBuckets={() => setCustomBuckets([...bucketManagerRef.current!.customBuckets])}
          />
        )}
      </main>

      {/* ==================================================================== */}
      {/* FIXED BOTTOM NAVIGATION TOOLBAR */}
      {/* ==================================================================== */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isRunning={isRunning}
        connectionState={connectionState}
        totalBuckets={sortedBuckets.length > 0 ? sortedBuckets.length : (customBuckets.length + 4)}
      />

    </div>
  );
}
