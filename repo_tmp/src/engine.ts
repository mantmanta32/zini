import { 
  AllBucketTypes, 
  BucketKey, 
  BucketOperationFailReason,
  BucketOperationResult,
  BucketStats, 
  BucketThresholds, 
  CustomBucket, 
  EngineStatsState, 
  RecentTrade, 
  SmartMoneyDivergence, 
  SortOption, 
  TimedTradeItem,
  TimeframeOption
} from './types';

// ========================================================================
// 🧠 ZIN PROJESİ - QUANT MOTORU & RECONNECT STREAM KERNEL (FAZA 3.5)
// ========================================================================

// 1. RING BUFFER - Dinamik Boyutlandırma (20.000'e kadar) ve Bellek Koruması
export class RingBuffer {
  maxSize: number;
  buffer: Float64Array;
  head: number;
  count: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = Math.max(1, Math.min(maxSize, 20000));
    this.buffer = new Float64Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }

  push(value: number): void {
    this.buffer[this.head] = value;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }

  getValues(): number[] {
    if (this.count < this.maxSize) {
      return Array.from(this.buffer.subarray(0, this.count));
    }
    const result = new Float64Array(this.maxSize);
    const tailCount = this.maxSize - this.head;
    result.set(this.buffer.subarray(this.head), 0);
    result.set(this.buffer.subarray(0, this.head), tailCount);
    return Array.from(result);
  }

  // Dinamik Boyut Ayarı (1 - 20000 Arası)
  resize(newSize: number): void {
    const validSize = Math.max(1, Math.min(newSize, 20000));
    if (validSize === this.maxSize) return;

    const currentValues = this.getValues();
    this.maxSize = validSize;
    this.buffer = new Float64Array(validSize);
    this.head = 0;
    this.count = 0;

    // En son değerleri yeni buffera aktar
    const startIdx = Math.max(0, currentValues.length - validSize);
    for (let i = startIdx; i < currentValues.length; i++) {
      this.push(currentValues[i]);
    }
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
    this.buffer.fill(0);
  }
}

// 2. BUCKET MANAGER - Dinamik Eşikler, 100 Kova & Multi-Timeframe Divergence
export class BucketManager {
  mode: 'dynamic' | 'static';
  ringBuffer: RingBuffer;
  staticThresholds: BucketThresholds;
  dynamicThresholds: BucketThresholds;
  stats: EngineStatsState;
  lastBootstrapVolume: number = 0;
  lastMultiplier: number = 1.0;

  // 100 Custom Bucket Mimarisi
  customBuckets: CustomBucket[] = [];
  readonly maxCustomBuckets: number = 100;

  // Kayan Pencere (Maksimum 15 dakika = 900,000ms saklar)
  rollingTrades: TimedTradeItem[] = [];
  lastPruneTime: number = 0;
  private readonly maxRollingTrades = 20000;

  // Binance Klines Snapshot Geçmişi (1m, 5m, 15m Kesin Piyasa Deltası)
  klineHistory: Array<{
    openTime: number;
    closeTime: number;
    quoteVol: number;
    takerBuyQuoteVol: number;
    tradeCount: number;
  }> = [];
  hasKlineBootstrap: boolean = false;

  // Debounce mekanizması (recalculatePercentiles)
  private lastPercentileCalcTime: number = 0;
  private readonly percentileDebounceMs: number = 250;

  // Constants (Magic Numbers Temizliği)
  private readonly TIMEFRAME_MULTIPLIERS: Record<TimeframeOption, number> = {
    '1m': 1.0,
    '5m': 2.0,
    '15m': 3.5,
  };
  private readonly RETAIL_THRESHOLD_BASE = 500;
  private readonly SMART_THRESHOLD_BASE = 1000;
  private readonly MOMENTUM_THRESHOLD_BASE = 2000;

  onThresholdUpdate?: (thresholds: BucketThresholds, mode: string) => void;
  onCustomBucketsUpdate?: (buckets: CustomBucket[]) => void;

  constructor(initialBufferSize: number = 1000) {
    this.mode = 'dynamic';
    this.ringBuffer = new RingBuffer(initialBufferSize);

    this.staticThresholds = {
      shrimpMax: 1000,
      crabMax: 10000,
      whaleMax: 100000,
    };
    this.dynamicThresholds = { ...this.staticThresholds };

    this.stats = this.initializeStats();
    this.loadFromStorage();
  }

  private initializeStats(): EngineStatsState {
    return {
      shrimp: { id: 'shrimp', name: 'Karides', icon: '🦐', buyVol: 0, sellVol: 0, count: 0 },
      crab: { id: 'crab', name: 'Yengeç', icon: '🦀', buyVol: 0, sellVol: 0, count: 0 },
      whale: { id: 'whale', name: 'Balina', icon: '🐋', buyVol: 0, sellVol: 0, count: 0 },
      leviathan: { id: 'leviathan', name: 'Leviathan', icon: '🦑', buyVol: 0, sellVol: 0, count: 0 },
    };
  }

  resetForNewSymbol(): void {
    this.ringBuffer.clear();
    this.rollingTrades = [];
    this.klineHistory = [];
    this.hasKlineBootstrap = false;
    this.stats = this.initializeStats();
    this.dynamicThresholds = { ...this.staticThresholds };
    this.lastMultiplier = 1;
    for (const b of this.customBuckets) {
      b.volume = 0;
      b.tradeCount = 0;
    }
    this.ensureStatsKeys();
    if (this.onThresholdUpdate) {
      this.onThresholdUpdate(this.dynamicThresholds, this.mode);
    }
  }

  loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('kara_para_custom_100_buckets');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Eski otomatik oluşturulan sahte "custom_init_", "custom_exp_" ve "B1, B2..." log artıklarını temizle
          const cleaned = parsed.filter((b: CustomBucket) => 
            !b.id.startsWith('custom_init_') && 
            !b.id.startsWith('custom_exp_') &&
            !b.name.startsWith('B')
          );
          if (cleaned.length > 0) {
            this.customBuckets = cleaned;
            this.ensureStatsKeys();
            return;
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ LocalStorage okunamadı:', e);
    }
    this.initializeDefaultCustomBuckets();
  }

  saveToStorage(): void {
    try {
      localStorage.setItem('kara_para_custom_100_buckets', JSON.stringify(this.customBuckets));
    } catch (e) {
      console.error('❌ LocalStorage yazılamadı:', e);
    }
    if (this.onCustomBucketsUpdate) {
      this.onCustomBucketsUpdate([...this.customBuckets]);
    }
  }

  reset(): void {
    this.rollingTrades = [];
    this.stats = {
      shrimp: { id: 'shrimp', name: 'Karides', icon: '🦐', buyVol: 0, sellVol: 0, count: 0 },
      crab: { id: 'crab', name: 'Yengeç', icon: '🦀', buyVol: 0, sellVol: 0, count: 0 },
      whale: { id: 'whale', name: 'Balina', icon: '🐋', buyVol: 0, sellVol: 0, count: 0 },
      leviathan: { id: 'leviathan', name: 'Leviathan', icon: '🦑', buyVol: 0, sellVol: 0, count: 0 },
    };
    this.ensureStatsKeys();
    this.klineHistory = [];
    this.hasKlineBootstrap = false;
  }

  private ensureStatsKeys(): void {
    for (const b of this.customBuckets) {
      if (!this.stats[b.id]) {
        this.stats[b.id] = { id: b.id, name: b.name, icon: b.icon, buyVol: 0, sellVol: 0, count: 0 };
      }
    }
  }

  getBucketColor(index: number): string {
    const colors = [
      '#EF4444', '#F97316', '#F59E0B', '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#F43F5E',
      '#DC2626', '#EA580C', '#D97706', '#059669', '#0891B2', '#2563EB', '#4F46E5', '#7C3AED', '#DB2777', '#E11D48',
      '#B91C1C', '#C2410C', '#B45309', '#047857', '#0E7490', '#1D4ED8', '#4338CA', '#6D28D9', '#BE185D', '#BE123C',
      '#F87171', '#FB923C', '#FBBF24', '#34D399', '#22D3EE', '#60A5FA', '#818CF8', '#A78BFA', '#F472B6', '#FB7185',
      '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
    ];
    return colors[index % colors.length];
  }

  getBucketIcon(index: number): string {
    const icons = [
      '🦐', '🦀', '🐋', '🦑', '🐟', '🐠', '🐡', '🦈', '🐙', '🦞',
      '🎯', '⭐', '✨', '💎', '🔥', '⚡', '🌪️', '💥', '🌟', '🚀',
      '💰', '🪙', '💵', '💴', '💶', '💷', '💸', '💳', '💲', '💱',
      '📈', '📉', '📊', '🛡️', '⚔️', '👑', '🏆', '🥇', '🦁', '🐯',
      '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚪', '⚫', '🟥',
    ];
    return icons[index % icons.length];
  }

  private initializeDefaultCustomBuckets(): void {
    // Varsayılan temiz durum: Kullanıcı kendi özel kovalarını Ayarlar'dan ekleyene kadar
    // 4 ana kova (Karides, Yengeç, Balina, Leviathan) çakışmasız, saf ve kusursuz çalışır.
    this.customBuckets = [];
    this.saveToStorage();
  }

  private generateSampleValues(count: number): number[] {
    return Array.from({ length: count }, (_, i) => 10 * Math.pow(10, (i / count) * 4));
  }

  generateLogarithmicBuckets(values: number[], count: number): { min: number; max: number }[] {
    if (values.length === 0) {
      return this.generateSampleValues(count).map((_, i) => ({
        min: Math.max(1, Math.round(10 * Math.pow(10, (i / count) * 4))),
        max: Math.max(2, Math.round(10 * Math.pow(10, ((i + 1) / count) * 4))),
      }));
    }

    const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
    if (sorted.length === 0) {
      return this.generateSampleValues(count).map((_, i) => ({
        min: 10 * (i + 1),
        max: 100 * (i + 1),
      }));
    }

    const minVal = sorted[0] > 0.1 ? sorted[0] : 0.1;
    const maxVal = Math.max(minVal + 10, sorted[sorted.length - 1]);

    const logMin = Math.log(minVal);
    const logMax = Math.log(maxVal);
    const logRange = logMax - logMin;

    const buckets: { min: number; max: number }[] = [];
    for (let i = 0; i < count; i++) {
      const startLog = logMin + (i / count) * logRange;
      const endLog = logMin + ((i + 1) / count) * logRange;

      buckets.push({
        min: Math.max(1, Math.round(Math.exp(startLog))),
        max: Math.max(2, Math.round(Math.exp(endLog))),
      });
    }

    return buckets;
  }

  // Ring Buffer Boyutunu Atomik Güncelle
  setBufferSize(newSize: number): number {
    const validSize = Math.max(100, Math.min(20000, Math.round(newSize)));
    this.ringBuffer.resize(validSize);
    return validSize;
  }

  // Otomatik 100 Kovaya Genişletme (Açık ve Anlamlı İsimlendirme)
  expandTo100Buckets(): BucketOperationResult {
    if (this.customBuckets.length >= this.maxCustomBuckets) {
      return {
        success: false,
        reason: 'LIMIT',
        message: `Zaten maksimum ${this.maxCustomBuckets} kova sınırına ulaşıldı.`,
      };
    }

    const rawValues = this.ringBuffer.getValues().filter((v) => v > 0);
    const values = rawValues.length >= 10 ? rawValues : this.generateSampleValues(500);

    let targetCount = Math.min(Math.max(this.customBuckets.length * 2, 20), this.maxCustomBuckets);
    if (targetCount === this.customBuckets.length) {
      targetCount = Math.min(this.customBuckets.length + 10, this.maxCustomBuckets);
    }

    const newLogRanges = this.generateLogarithmicBuckets(values, targetCount);

    this.customBuckets = newLogRanges.map((range, i) => {
      const existing = this.customBuckets[i];
      const id = existing ? existing.id : `custom_exp_${Date.now()}_${i}`;
      return {
        id,
        name: existing?.name || `B${i + 1} (${range.min < 1000 ? '$' + range.min : '$' + Math.round(range.min / 1000) + 'k'}+)`,
        minValue: range.min,
        maxValue: range.max,
        color: existing?.color || this.getBucketColor(i),
        icon: existing?.icon || this.getBucketIcon(i),
        isActive: existing?.isActive ?? true,
        tradeCount: existing?.tradeCount || 0,
        volume: existing?.volume || 0,
        isSmartMoney: existing?.isSmartMoney !== undefined ? existing.isSmartMoney : (i >= Math.floor(targetCount * 0.6)),
      };
    });

    this.ensureStatsKeys();
    this.saveToStorage();
    return { success: true, count: this.customBuckets.length };
  }

  // Geriye dönük uyumluluk için alias
  addCustomBucket(): boolean {
    const res = this.expandTo100Buckets();
    return res.success;
  }

  // Manuel Özel Bucket Ekleme - Kapsamlı Domain Doğrulaması
  createManualBucket(bucket: Omit<CustomBucket, 'id' | 'tradeCount' | 'volume'>): BucketOperationResult {
    if (this.customBuckets.length >= this.maxCustomBuckets) {
      return {
        success: false,
        reason: 'LIMIT',
        message: `Maksimum ${this.maxCustomBuckets} kova sınırına ulaşıldı.`,
      };
    }

    const name = bucket.name ? bucket.name.trim() : '';
    if (!name) {
      return {
        success: false,
        reason: 'EMPTY_NAME',
        message: 'Kova adı boş bırakılamaz.',
      };
    }

    const min = Number(bucket.minValue);
    const max = Number(bucket.maxValue);

    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= min) {
      return {
        success: false,
        reason: 'INVALID_RANGE',
        message: 'Geçersiz aralık: Minimum tutar 0 veya daha büyük, maksimumdan küçük olmalıdır.',
      };
    }

    // Aktif özel kovalarla çakışma (overlap) denetimi
    const hasOverlap = this.customBuckets.some(
      (b) => b.isActive && min < b.maxValue && max > b.minValue
    );

    if (hasOverlap) {
      return {
        success: false,
        reason: 'OVERLAP',
        message: 'Bu tutar aralığı mevcut aktif bir özel kova ile çakışıyor.',
      };
    }

    const newBucket: CustomBucket = {
      name,
      minValue: Math.round(min),
      maxValue: Math.round(max),
      color: bucket.color || '#EC4899',
      icon: (bucket.icon ? bucket.icon.trim() : '') || '💎',
      isActive: bucket.isActive ?? true,
      isSmartMoney: !!bucket.isSmartMoney,
      id: `custom_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      tradeCount: 0,
      volume: 0,
    };

    this.customBuckets.push(newBucket);
    this.ensureStatsKeys();
    this.saveToStorage();
    return { success: true, bucket: newBucket };
  }

  removeCustomBucket(id: string): { success: boolean; removedName?: string } {
    const target = this.customBuckets.find((b) => b.id === id);
    if (!target) return { success: false };
    const name = target.name;
    this.customBuckets = this.customBuckets.filter((b) => b.id !== id);
    delete this.stats[id];
    this.saveToStorage();
    return { success: true, removedName: name };
  }

  updateCustomBucket(id: string, updates: Partial<CustomBucket>): BucketOperationResult {
    const targetIndex = this.customBuckets.findIndex((b) => b.id === id);
    if (targetIndex === -1) {
      return { success: false, reason: 'DUPLICATE_ID', message: 'Kova bulunamadı.' };
    }

    const current = this.customBuckets[targetIndex];
    const candidate: CustomBucket = { ...current, ...updates };

    if (candidate.minValue >= candidate.maxValue) {
      return {
        success: false,
        reason: 'INVALID_RANGE',
        message: 'Minimum tutar maksimum tutardan küçük olmalıdır.',
      };
    }

    this.customBuckets[targetIndex] = candidate;
    this.saveToStorage();
    return { success: true, bucket: candidate };
  }

  toggleBucketActive(id: string): void {
    this.customBuckets = this.customBuckets.map((b) => (b.id === id ? { ...b, isActive: !b.isActive } : b));
    this.saveToStorage();
  }

  resetCustomBuckets(): void {
    this.customBuckets = [];
    this.initializeDefaultCustomBuckets();
  }

  exportCustomBuckets(): string {
    return JSON.stringify(this.customBuckets, null, 2);
  }

  // JSON İçe Aktarma - Sıkı Şema ve Tip Doğrulaması (Schema Validation)
  importCustomBuckets(jsonStr: string): BucketOperationResult {
    try {
      if (!jsonStr || !jsonStr.trim()) {
        return { success: false, reason: 'INVALID_SCHEMA', message: 'JSON verisi boş.' };
      }

      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return {
          success: false,
          reason: 'INVALID_SCHEMA',
          message: 'JSON verisi kova listesi (dizi) içermelidir.',
        };
      }

      const validatedList: CustomBucket[] = [];
      const seenIds = new Set<string>();

      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (typeof item !== 'object' || item === null) {
          return {
            success: false,
            reason: 'INVALID_SCHEMA',
            message: `#${i + 1} eleman geçerli bir kova nesnesi değil.`,
          };
        }

        const name = typeof item.name === 'string' ? item.name.trim() : '';
        const min = Number(item.minValue);
        const max = Number(item.maxValue);

        if (!name) {
          return {
            success: false,
            reason: 'EMPTY_NAME',
            message: `#${i + 1} kovasının adı boş.`,
          };
        }

        if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max <= min) {
          return {
            success: false,
            reason: 'INVALID_RANGE',
            message: `"${name}" kovasında geçersiz tutar aralığı (${min} - ${max}).`,
          };
        }

        const rawId = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `custom_${Date.now()}_${i}`;
        const finalId = seenIds.has(rawId) ? `${rawId}_${i}` : rawId;
        seenIds.add(finalId);

        validatedList.push({
          id: finalId,
          name,
          minValue: Math.round(min),
          maxValue: Math.round(max),
          color: typeof item.color === 'string' && item.color.startsWith('#') ? item.color : this.getBucketColor(i),
          icon: typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : this.getBucketIcon(i),
          isActive: item.isActive !== undefined ? !!item.isActive : true,
          tradeCount: typeof item.tradeCount === 'number' ? item.tradeCount : 0,
          volume: typeof item.volume === 'number' ? item.volume : 0,
          isSmartMoney: !!item.isSmartMoney,
        });

        if (validatedList.length >= this.maxCustomBuckets) break;
      }

      this.customBuckets = validatedList;
      this.ensureStatsKeys();
      this.saveToStorage();
      return { success: true, count: validatedList.length };
    } catch (e: any) {
      return {
        success: false,
        reason: 'INVALID_SCHEMA',
        message: `JSON ayrıştırma hatası: ${e?.message || 'Sözdizimi bozuk'}`,
      };
    }
  }

  setMode(newMode: 'dynamic' | 'static'): void {
    this.mode = newMode;
    if (this.onThresholdUpdate) {
      this.onThresholdUpdate(
        this.mode === 'dynamic' ? this.dynamicThresholds : this.staticThresholds,
        this.mode
      );
    }
  }

  applyBootstrap(dailyQuoteVolume: number): void {
    this.lastBootstrapVolume = dailyQuoteVolume;
    if (this.mode !== 'dynamic') return;

    let multiplier = 1.0;
    if (dailyQuoteVolume > 1_000_000_000) multiplier = 5.0;
    else if (dailyQuoteVolume > 100_000_000) multiplier = 1.0;
    else multiplier = 0.2;

    this.lastMultiplier = multiplier;

    this.dynamicThresholds.shrimpMax = Math.round(1000 * multiplier);
    this.dynamicThresholds.crabMax = Math.round(10000 * multiplier);
    this.dynamicThresholds.whaleMax = Math.round(100000 * multiplier);

    if (this.onThresholdUpdate) {
      this.onThresholdUpdate(this.dynamicThresholds, this.mode);
    }
  }

  // Debounce korumalı persentil hesaplama (250ms)
  recalculatePercentiles(now: number): void {
    if (this.mode !== 'dynamic') return;
    if (now - this.lastPercentileCalcTime < this.percentileDebounceMs) return;
    this.lastPercentileCalcTime = now;

    const values = this.ringBuffer.getValues();
    if (values.length < 50) return;

    values.sort((a, b) => a - b);
    const len = values.length;

    const p70 = Math.max(1, Math.round(values[Math.floor(len * 0.7)]));
    const p90 = Math.max(p70 + 1, Math.round(values[Math.floor(len * 0.9)]));
    const p98 = Math.max(p90 + 1, Math.round(values[Math.floor(len * 0.98)]));

    this.dynamicThresholds.shrimpMax = p70;
    this.dynamicThresholds.crabMax = p90;
    this.dynamicThresholds.whaleMax = p98;

    if (this.onThresholdUpdate) {
      this.onThresholdUpdate(this.dynamicThresholds, this.mode);
    }
  }

  private updateCustomBucketsWithLiveBuffer(): void {
    const values = this.ringBuffer.getValues().filter((v) => v > 0);
    if (values.length < 50 || this.customBuckets.length === 0) return;

    const logRanges = this.generateLogarithmicBuckets(values, this.customBuckets.length);
    for (let i = 0; i < this.customBuckets.length; i++) {
      this.customBuckets[i].minValue = logRanges[i].min;
      this.customBuckets[i].maxValue = logRanges[i].max;
    }
  }

  // Custom Bucket Eşleme - Kullanıcı Sıralamasına Göre Güvenli Bulma
  classifyCustomBucket(notionalValue: number): CustomBucket | null {
    if (this.customBuckets.length === 0) return null;

    // Aktif custom bucket'ler arasında eşleşeni bul
    for (const b of this.customBuckets) {
      if (b.isActive && notionalValue >= b.minValue && notionalValue < b.maxValue) {
        return b;
      }
    }

    return null;
  }

  // ÇEKİRDEK İŞLEM İŞLEYİCİSİ - tradeTime ZORUNLU
  processTrade(
    price: number,
    quantity: number,
    isBuyerMaker: boolean,
    tradeTime: number
  ): {
    bucket: AllBucketTypes;
    bucketName: string;
    bucketIcon: string;
    notionalValue: number;
    customBucketId?: string;
  } {
    const notionalValue = price * quantity;

    // 1. Ring Buffer'a push et ve debounce ile persentilleri güncelle
    if (this.mode === 'dynamic') {
      this.ringBuffer.push(notionalValue);
      if (this.ringBuffer.count % 50 === 0) {
        this.recalculatePercentiles(tradeTime);
        this.updateCustomBucketsWithLiveBuffer();
      }
    }

    // 2. Varsayılan kova sınıflandırması
    const thresholds = this.mode === 'dynamic' ? this.dynamicThresholds : this.staticThresholds;
    let defaultBucket: BucketKey = 'shrimp';
    if (notionalValue > thresholds.whaleMax) defaultBucket = 'leviathan';
    else if (notionalValue > thresholds.crabMax) defaultBucket = 'whale';
    else if (notionalValue > thresholds.shrimpMax) defaultBucket = 'crab';

    // Varsayılan kova istatistik güncelle
    if (!this.stats[defaultBucket]) {
      this.stats[defaultBucket] = { id: defaultBucket, name: defaultBucket, icon: '🦐', buyVol: 0, sellVol: 0, count: 0 };
    }
    if (isBuyerMaker) {
      this.stats[defaultBucket].sellVol += notionalValue;
    } else {
      this.stats[defaultBucket].buyVol += notionalValue;
    }
    this.stats[defaultBucket].count += 1;

    // 3. Custom Bucket Sınıflandırması
    const matchedCustom = this.classifyCustomBucket(notionalValue);
    if (matchedCustom) {
      matchedCustom.volume += notionalValue;
      matchedCustom.tradeCount += 1;

      if (!this.stats[matchedCustom.id]) {
        this.stats[matchedCustom.id] = { id: matchedCustom.id, name: matchedCustom.name, icon: matchedCustom.icon, buyVol: 0, sellVol: 0, count: 0 };
      }
      if (isBuyerMaker) {
        this.stats[matchedCustom.id].sellVol += notionalValue;
      } else {
        this.stats[matchedCustom.id].buyVol += notionalValue;
      }
      this.stats[matchedCustom.id].count += 1;
    }

    // 4. Kayan Pencereye ekle (Hem varsayılan ana kova hem de özel kova kimliğiyle)
    this.rollingTrades.push({
      time: tradeTime,
      notional: notionalValue,
      isBuyerMaker,
      bucket: defaultBucket,
      customBucketId: matchedCustom ? matchedCustom.id : undefined,
    });

    // 5. Binary Search ile O(log N) Prune ve Max Sınır Kontrolü
    if (tradeTime - this.lastPruneTime > 1000) {
      this.pruneRollingTrades(tradeTime);
      this.lastPruneTime = tradeTime;
    }

    const defaultNames: Record<BucketKey, { name: string; icon: string }> = {
      shrimp: { name: 'Karides', icon: '🦐' },
      crab: { name: 'Yengeç', icon: '🦀' },
      whale: { name: 'Balina', icon: '🐋' },
      leviathan: { name: 'Leviathan', icon: '🦑' },
    };

    return {
      bucket: matchedCustom ? matchedCustom.id : defaultBucket,
      bucketName: matchedCustom ? matchedCustom.name : defaultNames[defaultBucket].name,
      bucketIcon: matchedCustom ? matchedCustom.icon : defaultNames[defaultBucket].icon,
      notionalValue,
      customBucketId: matchedCustom?.id,
    };
  }

  // BINARY SEARCH İLE O(log N) BUDAMA + Max Boyut Sınırı (Sorun #14 Çözümü)
  pruneRollingTrades(currentTime: number): void {
    // En uzun timeframe olan 15 dakikadan (900,000ms) eski kayıtları temizle
    const cutoff = currentTime - 900_000;
    const len = this.rollingTrades.length;
    if (len === 0) return;

    if (this.rollingTrades[0].time < cutoff) {
      let low = 0;
      let high = len - 1;
      let pruneIndex = 0;

      while (low <= high) {
        const mid = (low + high) >> 1;
        if (this.rollingTrades[mid].time < cutoff) {
          pruneIndex = mid + 1;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (pruneIndex > 0) {
        this.rollingTrades.splice(0, pruneIndex);
      }
    }

    // Ekstra Güvenlik: maxRollingTrades sınırını aşarsa eski kayıtları buda
    if (this.rollingTrades.length > this.maxRollingTrades) {
      this.rollingTrades = this.rollingTrades.slice(-this.maxRollingTrades);
    }
  }

  // Binance Futures REST API: Multi-Segment AggTrades + 15m Klines Bootstrapping (Kesin Multi-Timeframe)
  async bootstrapFromRest(symbol: string): Promise<number> {
    try {
      const cleanSym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const now = Date.now();
      const cutoff15m = now - 900_000;

      // 1. Son 15 adet 1m kline mumunu çek (Piyasanın resmi 1m, 5m, 15m taker buy/sell hacim ve deltasını getirir)
      const klinePromise = fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=1m&limit=15`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);

      // 2. 15 dakikalık ufku doldurmak için 3 paralel zaman diliminden aggTrades çek
      const aggEarlyPromise = fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${cleanSym}&startTime=${now - 900_000}&limit=1000`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
      const aggMidPromise = fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${cleanSym}&startTime=${now - 450_000}&limit=1000`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);
      const aggLatestPromise = fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${cleanSym}&limit=1000`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);

      const [klinesRaw, aggEarly, aggMid, aggLatest] = await Promise.all([
        klinePromise,
        aggEarlyPromise,
        aggMidPromise,
        aggLatestPromise,
      ]);

      // Kline verisini parse et ve kaydet
      if (Array.isArray(klinesRaw) && klinesRaw.length > 0) {
        this.klineHistory = klinesRaw.map((k: any) => {
          const openTime = Number(k[0]);
          const closeTime = Number(k[6]);
          const quoteVol = parseFloat(k[7]) || 0;
          const takerBuyQuoteVol = parseFloat(k[10]) || 0;
          const tradeCount = Number(k[8]) || 0;
          return { openTime, closeTime, quoteVol, takerBuyQuoteVol, tradeCount };
        });
        this.hasKlineBootstrap = true;
      }

      // Tüm aggTrade'leri birleştir ve tekilleştir
      const tradeMap = new Map<number, any>();
      const addTrades = (arr: any) => {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
          const id = Number(item.a);
          if (id && !tradeMap.has(id)) {
            tradeMap.set(id, item);
          }
        }
      };

      addTrades(aggEarly);
      addTrades(aggMid);
      addTrades(aggLatest);

      const allTrades = Array.from(tradeMap.values());
      allTrades.sort((a, b) => Number(a.T) - Number(b.T));

      let imported = 0;
      for (const item of allTrades) {
        const price = parseFloat(item.p);
        const qty = parseFloat(item.q);
        const isBuyerMaker = Boolean(item.m);
        const time = Number(item.T);

        if (isNaN(price) || isNaN(qty) || time < cutoff15m) continue;

        this.processTrade(price, qty, isBuyerMaker, time);
        imported++;
      }

      return imported;
    } catch (err) {
      console.warn('⚠️ REST bootstrap atlandı (Canlı WebSocket verisi akıyor):', err);
      return 0;
    }
  }

  // Multi-Timeframe Kayan İstatistik Motoru (1m, 5m, 15m)
  getBucketRollingStats(
    bucketKey: AllBucketTypes,
    tf: TimeframeOption = '1m',
    currentTime: number = Date.now()
  ): {
    rollingBuyVol: number;
    rollingSellVol: number;
    rollingDelta: number;
    rollingCount: number;
    directionalBias: number;
    aggressionScore: number;
  } {
    const windowMs = tf === '15m' ? 900_000 : tf === '5m' ? 300_000 : 60_000;
    const cutoff = currentTime - windowMs;

    let buyVol = 0;
    let sellVol = 0;
    let count = 0;

    for (let i = this.rollingTrades.length - 1; i >= 0; i--) {
      const t = this.rollingTrades[i];
      if (t.time < cutoff) break;

      if (t.bucket === bucketKey || t.customBucketId === bucketKey) {
        count++;
        if (t.isBuyerMaker) sellVol += t.notional;
        else buyVol += t.notional;
      }
    }

    // Kuant Sentez Koruması: Eğer trade buffer bu pencereyi (özellikle 5m ve 15m) tam doldurmadıysa
    // ve elimizde Binance'in resmi 1m kline mumları varsa, pencerenin gerçek hacim ve deltasıyla sentezle
    const oldestInRolling = this.rollingTrades.length > 0 ? this.rollingTrades[0].time : currentTime;
    const actualSpanMs = currentTime - oldestInRolling;

    if (this.hasKlineBootstrap && this.klineHistory.length > 0 && actualSpanMs < windowMs * 0.7) {
      // Bu timeframe için kline mumlarını topla
      const numCandles = tf === '15m' ? 15 : tf === '5m' ? 5 : 1;
      const relevantKlines = this.klineHistory.slice(-numCandles);
      let klineTotalQuote = 0;
      let klineTakerBuy = 0;
      let klineCount = 0;

      for (const k of relevantKlines) {
        klineTotalQuote += k.quoteVol;
        klineTakerBuy += k.takerBuyQuoteVol;
        klineCount += k.tradeCount;
      }
      const klineTakerSell = Math.max(0, klineTotalQuote - klineTakerBuy);

      // Kovanın genel hacim payını hesapla
      const defaultWeights: Record<string, number> = {
        shrimp: 0.08,
        crab: 0.22,
        whale: 0.42,
        leviathan: 0.28,
      };
      const weight = defaultWeights[bucketKey] || 0.05;

      // Kovanın mikro bias'ını belirle (alım/satım dengesi)
      const microTotal = buyVol + sellVol;
      const biasRatio = microTotal > 0 ? buyVol / microTotal : 0.5;

      const synthTotalVol = klineTotalQuote * weight;
      const synthBuy = synthTotalVol * biasRatio;
      const synthSell = synthTotalVol * (1 - biasRatio);
      const synthCount = Math.max(count, Math.round(klineCount * weight));

      const finalBuy = Math.round(synthBuy);
      const finalSell = Math.round(synthSell);
      const finalTotal = finalBuy + finalSell;
      const directionalBias = finalTotal === 0 ? 50 : Math.round((finalBuy / finalTotal) * 100);

      return {
        rollingBuyVol: finalBuy,
        rollingSellVol: finalSell,
        rollingDelta: finalBuy - finalSell,
        rollingCount: synthCount,
        directionalBias,
        aggressionScore: directionalBias,
      };
    }

    const total = buyVol + sellVol;
    const directionalBias = total === 0 ? 50 : Math.round((buyVol / total) * 100);

    return {
      rollingBuyVol: Math.round(buyVol),
      rollingSellVol: Math.round(sellVol),
      rollingDelta: Math.round(buyVol - sellVol),
      rollingCount: count,
      directionalBias,
      aggressionScore: directionalBias,
    };
  }

  // Timeframe Tarihçesi Hazır mı?
  hasHistory(tf: TimeframeOption): boolean {
    if (this.hasKlineBootstrap && this.klineHistory.length >= (tf === '15m' ? 8 : tf === '5m' ? 3 : 1)) {
      return true;
    }
    const windowMs = tf === '15m' ? 900_000 : tf === '5m' ? 300_000 : 60_000;
    if (this.rollingTrades.length === 0) return false;
    const span = Date.now() - this.rollingTrades[0].time;
    return span >= windowMs * 0.7;
  }

  // Akıllı Sıralama ile Tüm Kovaları Getir
  getAllBucketsSorted(
    sortBy: SortOption = 'activity',
    tf: TimeframeOption = '1m',
    currentTime: number = Date.now()
  ): BucketStats[] {
    const list: BucketStats[] = [];

    const defaults: Array<{ key: BucketKey; name: string; icon: string; min: number; max: number; smart: boolean }> = [
      { key: 'shrimp', name: 'Karides', icon: '🦐', min: 0, max: this.dynamicThresholds.shrimpMax, smart: false },
      { key: 'crab', name: 'Yengeç', icon: '🦀', min: this.dynamicThresholds.shrimpMax, max: this.dynamicThresholds.crabMax, smart: false },
      { key: 'whale', name: 'Balina', icon: '🐋', min: this.dynamicThresholds.crabMax, max: this.dynamicThresholds.whaleMax, smart: true },
      { key: 'leviathan', name: 'Leviathan', icon: '🦑', min: this.dynamicThresholds.whaleMax, max: 999_999_999, smart: true },
    ];

    for (const d of defaults) {
      const s = this.stats[d.key] || { buyVol: 0, sellVol: 0, count: 0 };
      const r = this.getBucketRollingStats(d.key, tf, currentTime);
      list.push({
        id: d.key,
        name: d.name,
        icon: d.icon,
        buyVol: s.buyVol,
        sellVol: s.sellVol,
        count: s.count,
        rollingBuyVol: r.rollingBuyVol,
        rollingSellVol: r.rollingSellVol,
        rollingDelta: r.rollingDelta,
        rollingCount: r.rollingCount,
        directionalBias: r.directionalBias,
        aggressionScore: r.aggressionScore,
        minValue: d.min,
        maxValue: d.max,
        color: '#F43F5E',
        isSmartMoney: d.smart,
      });
    }

    for (const b of this.customBuckets) {
      if (!b.isActive) continue;
      const s = this.stats[b.id] || { buyVol: 0, sellVol: 0, count: 0 };
      const r = this.getBucketRollingStats(b.id, tf, currentTime);
      list.push({
        id: b.id,
        name: b.name,
        icon: b.icon,
        buyVol: s.buyVol,
        sellVol: s.sellVol,
        count: s.count,
        rollingBuyVol: r.rollingBuyVol,
        rollingSellVol: r.rollingSellVol,
        rollingDelta: r.rollingDelta,
        rollingCount: r.rollingCount,
        directionalBias: r.directionalBias,
        aggressionScore: r.aggressionScore,
        minValue: b.minValue,
        maxValue: b.maxValue,
        color: b.color,
        isSmartMoney: b.isSmartMoney,
      });
    }

    switch (sortBy) {
      case 'activity':
        list.sort((a, b) => (b.rollingCount ?? 0) - (a.rollingCount ?? 0) || b.count - a.count);
        break;
      case 'delta_desc':
        list.sort((a, b) => (b.rollingDelta ?? 0) - (a.rollingDelta ?? 0));
        break;
      case 'delta_asc':
        list.sort((a, b) => (a.rollingDelta ?? 0) - (b.rollingDelta ?? 0));
        break;
      case 'volume':
        list.sort((a, b) => ((b.rollingBuyVol ?? 0) + (b.rollingSellVol ?? 0)) - ((a.rollingBuyVol ?? 0) + (a.rollingSellVol ?? 0)));
        break;
      case 'hierarchy':
      default:
        list.sort((a, b) => (a.minValue ?? 0) - (b.minValue ?? 0));
        break;
    }

    return list;
  }

  // Multi-Timeframe Smart Money Uyumsuzluk Radarı (Sorun #1 ve #17 Çözümü)
  getSmartMoneyDivergence(
    tf: TimeframeOption = '1m',
    currentTime: number = Date.now()
  ): SmartMoneyDivergence {
    const shrimpStats = this.getBucketRollingStats('shrimp', tf, currentTime);
    const whaleStats = this.getBucketRollingStats('whale', tf, currentTime);
    const leviathanStats = this.getBucketRollingStats('leviathan', tf, currentTime);

    let retailDelta = shrimpStats.rollingDelta;
    let smartDelta = whaleStats.rollingDelta + leviathanStats.rollingDelta;
    let retailBuyVol = shrimpStats.rollingBuyVol;
    let retailSellVol = shrimpStats.rollingSellVol;
    let smartBuyVol = whaleStats.rollingBuyVol + leviathanStats.rollingBuyVol;
    let smartSellVol = whaleStats.rollingSellVol + leviathanStats.rollingSellVol;

    // Doğru Sınıflandırma: isSmartMoney=true ise smartDelta, değilse retailDelta
    for (const b of this.customBuckets) {
      if (!b.isActive) continue;
      const stats = this.getBucketRollingStats(b.id, tf, currentTime);
      if (b.isSmartMoney) {
        smartDelta += stats.rollingDelta;
        smartBuyVol += stats.rollingBuyVol;
        smartSellVol += stats.rollingSellVol;
      } else {
        retailDelta += stats.rollingDelta;
        retailBuyVol += stats.rollingBuyVol;
        retailSellVol += stats.rollingSellVol;
      }
    }

    const totalBuy = retailBuyVol + smartBuyVol;
    const totalSell = retailSellVol + smartSellVol;
    const overallTotal = totalBuy + totalSell;
    const overallObi = overallTotal > 0 ? Math.round(((totalBuy - totalSell) / overallTotal) * 100) : 0;

    const smartTotal = smartBuyVol + smartSellVol;
    const smartObi = smartTotal > 0 ? Math.round(((smartBuyVol - smartSellVol) / smartTotal) * 100) : 0;

    const retailTotal = retailBuyVol + retailSellVol;
    const retailObi = retailTotal > 0 ? Math.round(((retailBuyVol - retailSellVol) / retailTotal) * 100) : 0;

    // Timeframe katsayısı (5m ve 15m'de eşikler ölçeklenir)
    const tfMultiplier = this.TIMEFRAME_MULTIPLIERS[tf] || 1.0;
    const retailThresh = this.RETAIL_THRESHOLD_BASE * tfMultiplier;
    const smartThresh = this.SMART_THRESHOLD_BASE * tfMultiplier;
    const momentumThresh = this.MOMENTUM_THRESHOLD_BASE * tfMultiplier;

    if (retailDelta < -retailThresh && smartDelta > smartThresh) {
      const conf = Math.min(99, Math.round(68 + (Math.abs(smartDelta) / (10_000 * tfMultiplier)) * 20));
      return {
        timeframe: tf,
        retailDelta,
        smartDelta,
        overallObi,
        smartObi,
        retailObi,
        signal: 'ACCUMULATION',
        signalTitle: '🟢 BOĞA EMİLİMİ',
        signalDesc: 'Karidesler panikle satıyor, Balina ve Leviathan tüm satışı marketten emiyor! Yukarı patlama ihtimali yüksek.',
        confidence: conf,
        timestamp: currentTime,
      };
    }

    if (retailDelta > retailThresh && smartDelta < -smartThresh) {
      const conf = Math.min(99, Math.round(68 + (Math.abs(smartDelta) / (10_000 * tfMultiplier)) * 20));
      return {
        timeframe: tf,
        retailDelta,
        smartDelta,
        overallObi,
        smartObi,
        retailObi,
        signal: 'DISTRIBUTION',
        signalTitle: '🔴 DAĞITIM & TUZAK',
        signalDesc: 'Karidesler FOMO ile alıyor, Akıllı Para tepeden boşaltıyor! Tuzak kapısı kapanmak üzere.',
        confidence: conf,
        timestamp: currentTime,
      };
    }

    if (smartDelta > momentumThresh && retailDelta > 0) {
      return {
        timeframe: tf,
        retailDelta,
        smartDelta,
        overallObi,
        smartObi,
        retailObi,
        signal: 'BULL_MOMENTUM',
        signalTitle: '⚡ GÜÇLÜ BOĞA AKIŞI',
        signalDesc: 'Hem Akıllı Para hem piyasa tek yöne agresif alım pompalıyor. Trend yukarı yönlü ezici.',
        confidence: 85,
        timestamp: currentTime,
      };
    }

    if (smartDelta < -momentumThresh && retailDelta < 0) {
      return {
        timeframe: tf,
        retailDelta,
        smartDelta,
        overallObi,
        smartObi,
        retailObi,
        signal: 'BEAR_MOMENTUM',
        signalTitle: '⚡ GÜÇLÜ AYI BASKISI',
        signalDesc: 'Tahtada acımasız blok satışlar akıyor. Likidite alt kademelere süpürülüyor.',
        confidence: 85,
        timestamp: currentTime,
      };
    }

    return {
      timeframe: tf,
      retailDelta,
      smartDelta,
      overallObi,
      smartObi,
      retailObi,
      signal: 'NEUTRAL',
      signalTitle: '⚖️ DENGELİ / NÖTR',
      signalDesc: 'Akıllı para ve retail arasında net bir yön uyuşmazlığı yok, kademeler test ediliyor.',
      confidence: 50,
      timestamp: currentTime,
    };
  }
}

// 3. WEBSOCKET YÖNETİCİSİ - Çift Hat: @trade + depth20 [public], kline/markPrice/forceOrder [market]
export class WSManager {
  bucketManager: BucketManager;
  publicWs: WebSocket | null = null;
  marketWs: WebSocket | null = null;
  currentSymbol: string = '';
  isExplicitDisconnect: boolean = false;

  // Reconnect parametreleri
  reconnectAttempts: number = 0;
  maxReconnectDelayMs: number = 15_000;
  reconnectTimeoutId: any = null;
  autoReconnectEnabled: boolean = true;

  // Heartbeat / Sessizlik Takibi
  private lastMessageTime: number = 0;
  private heartbeatIntervalId: any = null;

  onTrade?: (trade: RecentTrade) => void;
  onKline?: (candle: { time: number; open: number; high: number; low: number; close: number; volume: number; isClosed: boolean }) => void;
  onForceOrder?: (order: { symbol: string; side: string; price: number; qty: number; time: number }) => void;
  onStatusChange?: (status: 'disconnected' | 'connecting' | 'connected' | 'error', message: string) => void;
  onLog?: (msg: string, type: 'info' | 'warn' | 'success' | 'error') => void;

  get ws(): WebSocket | null {
    return this.publicWs;
  }

  constructor(bucketManager: BucketManager) {
    this.bucketManager = bucketManager;
    this.currentSymbol = '';
  }

  connect(symbol: string): void {
    const nextSymbol = symbol.toLowerCase().trim();
    if (this.currentSymbol && this.currentSymbol !== nextSymbol) {
      this.bucketManager.resetForNewSymbol();
    }

    this.isExplicitDisconnect = false;
    this.currentSymbol = nextSymbol;

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.onStatusChange) {
      this.onStatusChange('connecting', `Bağlanıyor: ${symbol.toUpperCase()}...`);
    }
    this.log(`🚀 BAŞLATILIYOR: ${symbol.toUpperCase()} stream ve bootstrap`, 'info');

    this.fetchBootstrapVolume();
    this.fetchRecentTrades();
    this.startSocket();
    this.startHeartbeatCheck();
  }

  fetchRecentTrades(): void {
    const sym = this.currentSymbol.toUpperCase();
    fetch(`https://fapi.binance.com/fapi/v1/trades?symbol=${sym}&limit=35`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((trades: any[]) => {
        if (!Array.isArray(trades) || trades.length === 0) return;
        this.log(`⚡ REST BOOTSTRAP: ${trades.length} gerçek işlem anında hafızaya aktarıldı.`, 'info');
        for (const t of trades) {
          const price = parseFloat(t.price);
          const qty = parseFloat(t.qty);
          const isBuyerMaker = Boolean(t.isBuyerMaker);
          const tradeTime = t.time || Date.now();
          const tradeId = t.id || Date.now();

          const { bucket, bucketName, bucketIcon, notionalValue } = this.bucketManager.processTrade(
            price,
            qty,
            isBuyerMaker,
            tradeTime
          );

          if (this.onTrade) {
            this.onTrade({
              id: tradeId,
              price,
              qty,
              notional: notionalValue,
              isBuyerMaker,
              time: tradeTime,
              bucket,
              bucketName,
              bucketIcon,
            });
          }
        }
      })
      .catch((err) => {
        this.log(`⚠️ REST bootstrap uyarısı: ${err.message}`, 'warn');
      });
  }

  private startSocket(): void {
    if (!this.currentSymbol) return;

    if (this.publicWs) {
      try {
        this.publicWs.onclose = null;
        this.publicWs.onerror = null;
        this.publicWs.close();
      } catch {}
      this.publicWs = null;
    }
    if (this.marketWs) {
      try {
        this.marketWs.onclose = null;
        this.marketWs.onerror = null;
        this.marketWs.close();
      } catch {}
      this.marketWs = null;
    }

    const sym = this.currentSymbol;

    // 1. PUBLIC BAĞLANTI: @trade + depth20 (Public hat - canlı testte kesintisiz veri bastı)
    const publicStreamUrl = `wss://fstream.binance.com/stream?streams=${sym}@trade/${sym}@depth20@100ms`;
    try {
      this.publicWs = new WebSocket(publicStreamUrl);
    } catch (e: any) {
      this.log(`❌ Public WS Başlatma Hatası: ${e.message}`, 'error');
      this.handleReconnect();
      return;
    }

    this.publicWs.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastMessageTime = Date.now();
      this.log(`✅ PUBLIC WS BAĞLANDI: ${sym.toUpperCase()} (@trade + depth20) canlı!`, 'success');

      if (this.onStatusChange) {
        this.onStatusChange('connected', `Bağlı (${sym.toUpperCase()})`);
      }
    };

    this.publicWs.onmessage = (event: MessageEvent) => {
      this.lastMessageTime = Date.now();
      try {
        const raw = JSON.parse(event.data);
        const data = raw.data || raw;

        const isTrade = data.e === 'trade' || (typeof raw.stream === 'string' && raw.stream.endsWith('@trade'));
        if (isTrade && data.p && data.q) {
          const price = parseFloat(data.p);
          const qty = parseFloat(data.q);
          if (isNaN(price) || price <= 0 || isNaN(qty) || qty <= 0) return;
          const isBuyerMaker = Boolean(data.m);
          const tradeTime = data.T || Date.now();
          const tradeId = data.t || Date.now();

          const { bucket, bucketName, bucketIcon, notionalValue } = this.bucketManager.processTrade(
            price,
            qty,
            isBuyerMaker,
            tradeTime
          );

          if (this.onTrade) {
            this.onTrade({
              id: tradeId,
              price,
              qty,
              notional: notionalValue,
              isBuyerMaker,
              time: tradeTime,
              bucket,
              bucketName,
              bucketIcon,
            });
          }
        }
      } catch (err: any) {
        console.error('Public WS ayrıştırma hatası:', err);
      }
    };

    this.publicWs.onerror = () => {
      this.log(`❌ PUBLIC WS HATA: ${sym.toUpperCase()} akışında sorun!`, 'error');
      if (this.onStatusChange) {
        this.onStatusChange('error', 'Public Bağlantı Hatası!');
      }
    };

    this.publicWs.onclose = () => {
      if (!this.isExplicitDisconnect) {
        this.log(`⚠️ PUBLIC WS KOPTU: Yeniden bağlanılıyor...`, 'warn');
        this.handleReconnect();
      } else {
        this.log(`ℹ️ PUBLIC WS KAPANDI: ${sym.toUpperCase()}`, 'info');
      }
    };

    // 2. MARKET BAĞLANTI: kline_1m + markPrice + forceOrder (Market hat)
    const marketStreamUrl = `wss://fstream.binance.com/stream?streams=${sym}@kline_1m/${sym}@markPrice@1s/${sym}@forceOrder`;
    try {
      this.marketWs = new WebSocket(marketStreamUrl);
      this.marketWs.onopen = () => {
        this.log(`✅ MARKET WS BAĞLANDI: ${sym.toUpperCase()} (kline + markPrice + forceOrder)`, 'success');
      };
      this.marketWs.onmessage = (event: MessageEvent) => {
        try {
          const raw = JSON.parse(event.data);
          const data = raw.data || raw;

          if (data.e === 'kline' && data.k && this.onKline) {
            const k = data.k;
            this.onKline({
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
              isClosed: Boolean(k.x),
            });
          } else if (data.e === 'forceOrder' && data.o) {
            const o = data.o;
            const notional = Math.round(parseFloat(o.p) * parseFloat(o.q));
            this.log(`⚡ LİKİDASYON: ${o.S === 'BUY' ? '🟢 SHORT' : '🔴 LONG'} $${notional.toLocaleString()} @ $${parseFloat(o.p).toFixed(2)}`, 'warn');
            if (this.onForceOrder) {
              this.onForceOrder({
                symbol: o.s,
                side: o.S,
                price: parseFloat(o.p),
                qty: parseFloat(o.q),
                time: o.T || Date.now(),
              });
            }
          }
        } catch {}
      };
      this.marketWs.onerror = () => {};
      this.marketWs.onclose = () => {};
    } catch {}
  }

  // Exponential Backoff ile Otomatik Yeniden Bağlanma
  private handleReconnect(): void {
    if (this.isExplicitDisconnect || !this.autoReconnectEnabled || !this.currentSymbol) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelayMs);
    this.log(`🔄 Yeniden bağlantı deneniyor (${this.reconnectAttempts}. deneme, ${delay / 1000}s sonra)...`, 'warn');

    if (this.onStatusChange) {
      this.onStatusChange('connecting', `Yeniden bağlanılıyor (${this.reconnectAttempts})...`);
    }

    this.reconnectTimeoutId = setTimeout(() => {
      if (!this.isExplicitDisconnect) {
        this.startSocket();
      }
    }, delay);
  }

  // Heartbeat kontrolü - 12 saniye sessizlik olursa soket tıkalı demektir
  private startHeartbeatCheck(): void {
    if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
    this.heartbeatIntervalId = setInterval(() => {
      if (this.isExplicitDisconnect || !this.publicWs || this.publicWs.readyState !== WebSocket.OPEN) return;
      const silenceDuration = Date.now() - this.lastMessageTime;
      if (silenceDuration > 12_000) {
        this.log(`⏱️ Heartbeat Uyarısı: 12sn veri gelmedi, soket yenileniyor.`, 'warn');
        this.startSocket();
      }
    }, 4000);
  }

  fetchBootstrapVolume(): void {
    const sym = this.currentSymbol.toUpperCase();
    fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const quoteVol = parseFloat(data.quoteVolume || '0');
        this.bucketManager.applyBootstrap(quoteVol);
        this.log(
          `📊 BOOTSTRAP: ${sym} 24s Hacim $${(quoteVol / 1_000_000).toFixed(1)}M | Çarpan: ${this.bucketManager.lastMultiplier}x`,
          'info'
        );
      })
      .catch((err) => {
        this.log(`⚠️ Bootstrap uyarısı: 24s hacim alınamadı (${err.message}), varsayılan eşiklerle devam ediliyor.`, 'warn');
      });
  }

  disconnect(): void {
    this.isExplicitDisconnect = true;
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
    if (this.publicWs) {
      try {
        this.publicWs.close();
      } catch {}
      this.publicWs = null;
    }
    if (this.marketWs) {
      try {
        this.marketWs.close();
      } catch {}
      this.marketWs = null;
    }
    if (this.onStatusChange) {
      this.onStatusChange('disconnected', 'Bağlantı Kesildi');
    }
  }

  private log(msg: string, type: 'info' | 'warn' | 'success' | 'error'): void {
    if (this.onLog) {
      this.onLog(msg, type);
    }
  }
}
