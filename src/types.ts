export type BucketKey = 'shrimp' | 'crab' | 'whale' | 'leviathan';

export type BucketRef = 
  | { kind: 'preset'; key: BucketKey }
  | { kind: 'custom'; id: string };

export type TimeframeOption = '1m' | '5m' | '15m';
export type ActiveTab = 'dashboard' | 'chart' | 'wallets' | 'stats' | 'logs' | 'settings';
export type SortOption = 'activity' | 'delta_desc' | 'delta_asc' | 'volume' | 'hierarchy';
export type ThemeMode = 'dark' | 'light';

export interface CustomBucket {
  id: string;
  name: string;
  minValue: number;
  maxValue: number;
  color: string;
  icon: string;
  isActive: boolean;
  tradeCount: number;
  volume: number;
  isSmartMoney?: boolean;
}

export type BucketOperationFailReason = 
  | 'LIMIT' 
  | 'OVERLAP' 
  | 'INVALID_RANGE' 
  | 'INVALID_SCHEMA' 
  | 'EMPTY_NAME'
  | 'DUPLICATE_ID';

export type BucketOperationResult = 
  | { success: true; bucket?: CustomBucket; count?: number }
  | { success: false; reason: BucketOperationFailReason; message: string };

export interface BucketThresholds {
  shrimpMax: number;
  crabMax: number;
  whaleMax: number;
}

export interface BucketStats {
  id: string;
  name: string;
  icon: string;
  buyVol: number;
  sellVol: number;
  count: number;
  rollingBuyVol?: number;
  rollingSellVol?: number;
  rollingCount?: number;
  rollingDelta?: number;
  directionalBias?: number;
  aggressionScore?: number;
  minValue?: number;
  maxValue?: number;
  color?: string;
  isSmartMoney?: boolean;
}

export interface EngineStatsState {
  preset: {
    shrimp: BucketStats;
    crab: BucketStats;
    whale: BucketStats;
    leviathan: BucketStats;
  };
  custom: Record<string, BucketStats>;
}

export interface TimedTradeItem {
  time: number;
  notional: number;
  isBuyerMaker: boolean;
  bucket: BucketRef;
}

export interface RecentTrade {
  id: number;
  price: number;
  qty: number;
  notional: number;
  isBuyerMaker: boolean;
  time: number;
  bucket: BucketRef;
  bucketName: string;
  bucketIcon: string;
}

export interface SmartMoneyDivergence {
  timeframe: TimeframeOption;
  retailDelta: number;
  smartDelta: number;
  overallObi?: number;
  smartObi?: number;
  retailObi?: number;
  signal: 'ACCUMULATION' | 'DISTRIBUTION' | 'BULL_MOMENTUM' | 'BEAR_MOMENTUM' | 'NEUTRAL';
  signalTitle: string;
  signalDesc: string;
  confidence: number;
  timestamp: number;
}

export interface AppSettings {
  theme: ThemeMode;
  soundEnabled: boolean;
  activeTimeframe: TimeframeOption;
  bufferSize: number;
  maxRecentTrades: number;
  autoReconnect: boolean;
}

export interface TerminalLog {
  id: number;
  text: string;
  type: 'info' | 'warn' | 'success' | 'error';
  time: string;
  timestamp: number;
}
