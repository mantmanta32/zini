import { BucketManager } from './engine';
import { BucketStats, SmartMoneyDivergence, TimeframeOption } from './types';

export interface DataQuality {
  percent: number;
  isReady: boolean;
  text: string;
  status: 'BOOTSTRAPPING' | 'READY' | 'WARMING' | 'NO_DATA';
}

export interface BucketMatrixRow {
  id: string;
  name: string;
  icon: string;
  minValue: number;
  maxValue: number;
  isSmartMoney: boolean;
  color?: string;
  b1?: BucketStats;
  b5?: BucketStats;
  b15?: BucketStats;
}

export interface ParticipantFlowStats {
  buyVol: number;
  sellVol: number;
  volume: number;
  delta: number;
  obi: number;
}

export interface StatsSnapshot {
  symbol: string;
  timestamp: number;
  timeframes: {
    '1m': SmartMoneyDivergence;
    '5m': SmartMoneyDivergence;
    '15m': SmartMoneyDivergence;
  };
  dataQuality: {
    '1m': DataQuality;
    '5m': DataQuality;
    '15m': DataQuality;
  };
  flow5m: {
    smart: ParticipantFlowStats;
    retail: ParticipantFlowStats;
    overall: ParticipantFlowStats;
    hasVolume: boolean;
    smartRatio: number;
    retailRatio: number;
  };
  bucketMatrix: BucketMatrixRow[];
  allBucketCount: number;
}

export function computeDataQuality(bucketManager: BucketManager, tf: TimeframeOption, now: number): DataQuality {
  if (bucketManager.hasHistory(tf)) {
    return { percent: 100, isReady: true, text: 'Canlı', status: 'READY' };
  }

  const oldestTradeTime = bucketManager.rollingTrades.length > 0 
    ? bucketManager.rollingTrades[0].time 
    : now;
  const availableHistoryMs = Math.max(0, now - oldestTradeTime);
  const targetMs = tf === '15m' ? 900_000 : tf === '5m' ? 300_000 : 60_000;

  if (availableHistoryMs === 0) {
    return { percent: 0, isReady: false, text: 'Veri Bekleniyor', status: 'NO_DATA' };
  }

  const ratio = Math.min(1, availableHistoryMs / targetMs);
  const percent = Math.round(ratio * 100);
  const isReady = percent >= 95;

  return {
    percent,
    isReady,
    text: isReady ? 'Canlı' : `Isınıyor %${percent}`,
    status: isReady ? 'READY' : 'WARMING',
  };
}

export function generateStatsSnapshot(
  bucketManager: BucketManager,
  activeSymbol: string,
  snapshotTime?: number
): StatsSnapshot {
  const now = snapshotTime ?? (bucketManager.rollingTrades.length > 0
    ? bucketManager.rollingTrades[bucketManager.rollingTrades.length - 1].time
    : Date.now());

  // 1. Üç timeframe için veriyi tek seferde çek O(N)
  const buckets1m = bucketManager.getAllBucketsSorted('hierarchy', '1m', now);
  const buckets5m = bucketManager.getAllBucketsSorted('hierarchy', '5m', now);
  const buckets15m = bucketManager.getAllBucketsSorted('hierarchy', '15m', now);

  // 2. O(1) erişim için Map indeksleme
  const map1m = new Map<string, BucketStats>(buckets1m.map((b) => [b.id, b]));
  const map5m = new Map<string, BucketStats>(buckets5m.map((b) => [b.id, b]));
  const map15m = new Map<string, BucketStats>(buckets15m.map((b) => [b.id, b]));

  // 3. Timeframe Union (1m + 5m + 15m birleşimi)
  const unionMap = new Map<string, BucketStats>();
  for (const b of buckets1m) unionMap.set(b.id, b);
  for (const b of buckets5m) if (!unionMap.has(b.id)) unionMap.set(b.id, b);
  for (const b of buckets15m) if (!unionMap.has(b.id)) unionMap.set(b.id, b);

  const unionList = Array.from(unionMap.values()).sort((a, b) => (a.minValue ?? 0) - (b.minValue ?? 0));

  const bucketMatrix: BucketMatrixRow[] = unionList.map((base) => ({
    id: base.id,
    name: base.name,
    icon: base.icon,
    minValue: base.minValue ?? 0,
    maxValue: base.maxValue ?? 0,
    isSmartMoney: !!base.isSmartMoney,
    color: base.color,
    b1: map1m.get(base.id),
    b5: map5m.get(base.id),
    b15: map15m.get(base.id),
  }));

  // 4. Timeframe bazlı diverjans ve veri kalitesi
  const timeframes: Record<TimeframeOption, SmartMoneyDivergence> = {
    '1m': bucketManager.getSmartMoneyDivergence('1m', now),
    '5m': bucketManager.getSmartMoneyDivergence('5m', now),
    '15m': bucketManager.getSmartMoneyDivergence('15m', now),
  };

  const dataQuality: Record<TimeframeOption, DataQuality> = {
    '1m': computeDataQuality(bucketManager, '1m', now),
    '5m': computeDataQuality(bucketManager, '5m', now),
    '15m': computeDataQuality(bucketManager, '15m', now),
  };

  // 5. Flow İstatistikleri (5m referans penceresi)
  let smartBuy = 0;
  let smartSell = 0;
  let retailBuy = 0;
  let retailSell = 0;

  for (const b of buckets5m) {
    const buy = b.rollingBuyVol ?? 0;
    const sell = b.rollingSellVol ?? 0;
    if (b.isSmartMoney) {
      smartBuy += buy;
      smartSell += sell;
    } else {
      retailBuy += buy;
      retailSell += sell;
    }
  }

  const smartVol = smartBuy + smartSell;
  const smartDelta = smartBuy - smartSell;
  const smartObi = smartVol > 0 ? Math.round((smartDelta / smartVol) * 100) : 0;

  const retailVol = retailBuy + retailSell;
  const retailDelta = retailBuy - retailSell;
  const retailObi = retailVol > 0 ? Math.round((retailDelta / retailVol) * 100) : 0;

  const totalVol = smartVol + retailVol;
  const totalDelta = smartDelta + retailDelta;
  const overallObi = totalVol > 0 ? Math.round((totalDelta / totalVol) * 100) : 0;

  const hasVolume = totalVol > 0;
  const smartRatio = hasVolume ? Math.round((smartVol / totalVol) * 100) : 0;
  const retailRatio = hasVolume ? 100 - smartRatio : 0;

  return {
    symbol: activeSymbol || 'BTCUSDT',
    timestamp: now,
    timeframes,
    dataQuality,
    flow5m: {
      smart: { buyVol: smartBuy, sellVol: smartSell, volume: smartVol, delta: smartDelta, obi: smartObi },
      retail: { buyVol: retailBuy, sellVol: retailSell, volume: retailVol, delta: retailDelta, obi: retailObi },
      overall: { buyVol: smartBuy + retailBuy, sellVol: smartSell + retailSell, volume: totalVol, delta: totalDelta, obi: overallObi },
      hasVolume,
      smartRatio,
      retailRatio,
    },
    bucketMatrix,
    allBucketCount: bucketMatrix.length,
  };
}
