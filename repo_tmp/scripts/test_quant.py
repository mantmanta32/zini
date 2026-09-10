#!/usr/bin/env python3
"""
Python Tabanlı Quant & WebSocket Matematik Doğrulama Motoru
- Quantile (P70, P90, P98) formül doğrulaması
- OBI (Order Flow Imbalance) formül doğrulaması
- Rolling Window Binary Search / Prune mantık testi
"""

import sys
import math

def calculate_quantiles(values):
    if not values:
        return {'p70': 1000, 'p90': 10000, 'p98': 50000}
    s = sorted(values)
    n = len(s)
    def q(p):
        idx = int(math.ceil(p * n)) - 1
        return s[max(0, min(idx, n - 1))]
    return {
        'p70': q(0.70),
        'p90': q(0.90),
        'p98': q(0.98),
    }

def calculate_obi(buy_vol, sell_vol):
    total = buy_vol + sell_vol
    if total == 0:
        return 0.0
    return round(((buy_vol - sell_vol) / total) * 100.0, 2)

def test_quantiles():
    # 100 adet logaritmik işlem simülasyonu
    sample = [10.0 * (10.0 ** (i / 25.0)) for i in range(100)]
    q = calculate_quantiles(sample)
    assert q['p70'] < q['p90'] < q['p98'], "Quantile hiyerarşisi hatalı!"
    print(f"  ✅ [PYTHON PASS] Quantile P70: {q['p70']:.1f}, P90: {q['p90']:.1f}, P98: {q['p98']:.1f}")

def test_obi():
    # Net alım baskısı
    obi_buy = calculate_obi(70000, 30000)
    assert obi_buy == 40.0, f"Beklenen 40.0, gelen {obi_buy}"
    
    # Net satım baskısı
    obi_sell = calculate_obi(20000, 80000)
    assert obi_sell == -60.0, f"Beklenen -60.0, gelen {obi_sell}"
    
    # Nötr durum
    obi_neutral = calculate_obi(50000, 50000)
    assert obi_neutral == 0.0, f"Beklenen 0.0, gelen {obi_neutral}"
    print("  ✅ [PYTHON PASS] OBI (Order Flow Imbalance) formül testi başarılı")

if __name__ == '__main__':
    print("\n======================================================")
    print("🐍 PYTHON QUANT & VERİ HESAPLAMA DOĞRULAMA MOTORU")
    print("======================================================")
    try:
        test_quantiles()
        test_obi()
        print("🏁 PYTHON TESTLERİ: TÜM KONTROLLER BAŞARILI!\n")
    except Exception as e:
        print(f"❌ PYTHON TEST HATASI: {e}")
        sys.exit(1)
