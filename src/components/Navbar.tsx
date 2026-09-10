import React, { memo } from 'react';
import {
  BarChart3,
  CandlestickChart,
  Layers,
  LucideIcon,
  Settings,
  Terminal,
  TrendingUp,
} from 'lucide-react';
import { ActiveTab } from '../types';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface NavbarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  isRunning: boolean;
  connectionState?: ConnectionStatus;
  totalBuckets: number;
}

interface NavTabItem {
  id: ActiveTab;
  label: string;
  icon: LucideIcon;
}

const TABS: readonly NavTabItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
  { id: 'chart', label: 'Grafik', icon: CandlestickChart },
  { id: 'wallets', label: 'Kovalar', icon: Layers },
  { id: 'stats', label: 'İstatistik', icon: BarChart3 },
  { id: 'logs', label: 'Terminal', icon: Terminal },
  { id: 'settings', label: 'Ayarlar', icon: Settings },
] as const;

export const Navbar: React.FC<NavbarProps> = memo(({
  activeTab,
  onTabChange,
  isRunning,
  connectionState = 'disconnected',
  totalBuckets,
}) => {
  const isDark = activeTab === 'chart';
  const badge = totalBuckets > 0 ? (totalBuckets > 99 ? '99+' : totalBuckets) : undefined;

  // Gerçek WebSocket ve motor durumuna göre renk & animasyon ayrımı
  const isConnected = isRunning && connectionState === 'connected';
  const isConnecting = isRunning && (connectionState === 'connecting' || connectionState === 'reconnecting');

  return (
    <nav
      aria-label="Ana Gezinme Menüsü"
      className={`fixed bottom-0 left-0 right-0 z-40 ${
        isDark
          ? 'bg-[#090a0f]/95 border-t border-stone-800/80'
          : 'bg-white/95 dark:bg-stone-900/95 border-t border-rose-200/80 dark:border-stone-800'
      } backdrop-blur-md shadow-[0_-4px_24px_rgba(0,0,0,0.12)] px-1 sm:px-2 pt-1.5 pb-2.5 sm:pb-1.5 transition-colors`}
      style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0.625rem))' }}
    >
      <div className="max-w-4xl mx-auto flex items-stretch justify-between">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-label={tab.label}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex flex-col items-center justify-center flex-1 min-h-[44px] py-1 px-0.5 min-w-0 rounded-xl
                transition-all duration-200 active:scale-95 cursor-pointer select-none ${
                isActive
                  ? 'text-rose-600 dark:text-rose-400 font-bold'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-rose-50/50 dark:hover:bg-stone-800/50 font-medium'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform duration-200 ${
                    isActive ? 'scale-110' : ''
                  }`}
                />

                {/* Dashboard Canlılık / WebSocket Göstergesi: 2 katmanlı (statik + ping) */}
                {tab.id === 'dashboard' && isRunning && (
                  <span className="absolute -top-0.5 -right-1 flex h-2 w-2">
                    {isConnected ? (
                      <>
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" title="Canlı Veri Akışı Bağlı" />
                      </>
                    ) : isConnecting ? (
                      <>
                        <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" title="Bağlantı Kuruluyor..." />
                      </>
                    ) : (
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" title="Çevrimdışı / Veri Yok" />
                    )}
                  </span>
                )}

                {/* Kovalar Rozeti: Sadece totalBuckets > 0 iken, 99+ korumalı ve py-0.5 */}
                {tab.id === 'wallets' && badge !== undefined && (
                  <span 
                    className="absolute -top-1.5 -right-2 text-[8px] sm:text-[9px] font-mono px-1 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 font-extrabold border border-rose-200 dark:border-rose-900 z-10 leading-none tabular-nums"
                    title={`${totalBuckets} Aktif Kova`}
                  >
                    {badge}
                  </span>
                )}
              </div>

              <span className="text-[10px] sm:text-[11px] tracking-tight mt-0.5 truncate max-w-full text-center leading-tight">
                {tab.label}
              </span>

              {isActive && (
                <span className="absolute -bottom-1 w-6 sm:w-8 h-0.5 sm:h-1 bg-rose-600 dark:bg-rose-500 rounded-full transition-all duration-200" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
});
