// ------------------------------------------------------------------------
// 🔬 ZIN ENGINE & BUCKET INTEGRATION TEST SUITE (Node.js Test Runner)
// ------------------------------------------------------------------------

// Setup global mock for localStorage if in Node
if (typeof globalThis.localStorage === 'undefined') {
  let store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = String(v); },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    length: 0,
  } as any;
}

import { BucketManager, RingBuffer } from '../src/engine';
import { CustomBucket } from '../src/types';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name} ->`, err.message);
    failed++;
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) throw new Error(`Expected ${expected}, but got ${actual}`);
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (!(actual > expected)) throw new Error(`Expected ${actual} > ${expected}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${actual}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${actual}`);
    },
  };
}

console.log('\n======================================================');
console.log('🚀 ZIN ENGINE INTEGRATION & VERIFICATION TESTS');
console.log('======================================================\n');

// 1. RING BUFFER SUITE
console.log('📦 SUITE 1: RingBuffer FIFO & Eviction');
it('RingBuffer writes values and respects order', () => {
  const rb = new RingBuffer(3);
  rb.push(10);
  rb.push(20);
  expect(rb.getValues()).toEqual([10, 20]);
  rb.push(30);
  expect(rb.getValues()).toEqual([10, 20, 30]);
  rb.push(40); // 10 evict
  expect(rb.getValues()).toEqual([20, 30, 40]);
});

it('RingBuffer resize keeps most recent values', () => {
  const rb = new RingBuffer(5);
  [1, 2, 3, 4, 5].forEach((n) => rb.push(n));
  rb.resize(2);
  expect(rb.getValues()).toEqual([4, 5]);
});

// 2. BUCKET MANAGER CRUD SUITE
console.log('\n🗂️ SUITE 2: BucketManager CRUD & Persistence');
it('Initializes with default custom buckets and stats', () => {
  localStorage.clear();
  const bm = new BucketManager();
  expect(bm.customBuckets.length).toBeGreaterThan(0);
  const firstId = bm.customBuckets[0].id;
  expect(bm.stats[firstId]).toBeTruthy();
});

it('Adds a manual custom bucket', () => {
  const bm = new BucketManager();
  const countBefore = bm.customBuckets.length;
  const ok = bm.createManualBucket({
    name: 'Balina Kapanı',
    minValue: 10000,
    maxValue: 50000,
    icon: '🐋',
    color: '#3B82F6',
    isActive: true,
    isSmartMoney: true,
  });
  expect(ok).toBe(true);
  expect(bm.customBuckets.length).toBe(countBefore + 1);
  const found = bm.customBuckets.find((b) => b.name === 'Balina Kapanı');
  expect(found).toBeTruthy();
  expect(bm.stats[found!.id]).toBeTruthy();
});

it('Updates custom bucket properties correctly', () => {
  const bm = new BucketManager();
  const b = bm.customBuckets[0];
  bm.updateCustomBucket(b.id, { name: 'Güncel Kova', minValue: 777 });
  const updated = bm.customBuckets.find((item) => item.id === b.id);
  expect(updated?.name).toBe('Güncel Kova');
  expect(updated?.minValue).toBe(777);
});

it('Deletes custom bucket and purges stats without residue', () => {
  const bm = new BucketManager();
  const target = bm.customBuckets[bm.customBuckets.length - 1];
  const targetId = target.id;
  const countBefore = bm.customBuckets.length;

  bm.removeCustomBucket(targetId);
  expect(bm.customBuckets.length).toBe(countBefore - 1);
  expect(bm.customBuckets.some((b) => b.id === targetId)).toBe(false);
  expect(bm.stats[targetId]).toBeFalsy();
});

it('Expands to 100 buckets dynamically', () => {
  const bm = new BucketManager();
  const initialCount = bm.customBuckets.length;
  const success = bm.addCustomBucket();
  expect(success).toBe(true);
  expect(bm.customBuckets.length).toBeGreaterThan(initialCount);
});

it('Imports and exports buckets via JSON', () => {
  const bm = new BucketManager();
  const exported = bm.exportCustomBuckets();
  expect(exported.length).toBeGreaterThan(10);

  const testPayload: CustomBucket[] = [
    {
      id: 'custom_import_1',
      name: 'Import Test',
      minValue: 100,
      maxValue: 1000,
      color: '#FF0000',
      icon: '🔥',
      isActive: true,
      tradeCount: 0,
      volume: 0,
      isSmartMoney: false,
    },
  ];

  const ok = bm.importCustomBuckets(JSON.stringify(testPayload));
  expect(ok).toBe(true);
  expect(bm.customBuckets.length).toBe(1);
  expect(bm.customBuckets[0].name).toBe('Import Test');
});

// 3. TRADE PROCESSING & MATH ENGINE SUITE
console.log('\n⚡ SUITE 3: Trade Processing & Divergence Engine');
it('Correctly processes buy & sell trades and calculates delta', () => {
  const bm = new BucketManager();
  bm.resetCustomBuckets(); // Clean slate

  const now = Date.now();
  // 500 USDT Buyer Maker = False -> Market Buy
  const t1 = bm.processTrade(500, 1, false, now - 5000);
  expect(t1.notionalValue).toBe(500);

  // 1000 USDT Buyer Maker = True -> Market Sell
  const t2 = bm.processTrade(1000, 1, true, now - 2000);
  expect(t2.notionalValue).toBe(1000);

  // Verify rolling stats for 1m
  const div = bm.getSmartMoneyDivergence('1m', now);
  expect(typeof div.retailDelta).toBe('number');
  expect(typeof div.smartDelta).toBe('number');
  expect(typeof div.overallObi).toBe('number');
});

console.log('\n======================================================');
console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
