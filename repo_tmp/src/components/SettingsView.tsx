import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Moon,
  Plus,
  RotateCcw,
  Sliders,
  Sun,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { soundEngine } from '../audio';
import { BucketManager } from '../engine';
import { AppSettings, CustomBucket } from '../types';

interface SettingsViewProps {
  bucketManager: BucketManager;
  customBuckets: CustomBucket[];
  appSettings: AppSettings;
  onUpdateSettings: (settings: Partial<AppSettings>) => void;
  onRefreshCustomBuckets: () => void;
}

// Emoji-safe kırpma: maxLength karakter değil "grapheme" sayar (surrogate pair bozulmasını önler)
const clampIcon = (raw: string, maxChars = 2): string => {
  const chars = Array.from(raw.trim());
  return chars.length ? chars.slice(0, maxChars).join('') : '💎';
};

const clipboardCopy = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('clipboard api yok');
  } catch {
    // iframe/sandbox fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
};

// ------------------------------------------------------------------------
// 🧩 KOVA KARTI (mobil-öncelikli, klavye focus kaybı yok, Escape ile iptal)
// ------------------------------------------------------------------------
interface EditableBucketRowProps {
  bucket: CustomBucket;
  isDeleting: boolean;
  isOverlap: boolean;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onToggleActive: () => void;
  onToggleSmart: () => void;
  onSaveUpdate: (updates: Partial<CustomBucket>) => void;
}

const EditableBucketRow: React.FC<EditableBucketRowProps> = ({
  bucket,
  isDeleting,
  isOverlap,
  onStartDelete,
  onCancelDelete,
  onConfirmDelete,
  onToggleActive,
  onToggleSmart,
  onSaveUpdate,
}) => {
  const [localName, setLocalName] = useState(bucket.name);
  const [localMin, setLocalMin] = useState(bucket.minValue.toString());
  const [localMax, setLocalMax] = useState(bucket.maxValue.toString());
  const [localIcon, setLocalIcon] = useState(bucket.icon);
  const [localColor, setLocalColor] = useState(bucket.color);

  useEffect(() => {
    setLocalName(bucket.name);
    setLocalMin(bucket.minValue.toString());
    setLocalMax(bucket.maxValue.toString());
    setLocalIcon(bucket.icon);
    setLocalColor(bucket.color);
  }, [bucket.name, bucket.minValue, bucket.maxValue, bucket.icon, bucket.color]);

  const commitName = () => {
    const trimmed = localName.trim();
    if (!trimmed) { setLocalName(bucket.name); return; }
    if (trimmed !== bucket.name) onSaveUpdate({ name: trimmed });
  };

  const commitMin = () => {
    const val = parseFloat(localMin);
    const maxRef = parseFloat(localMax); // stale prop yerine ekrandaki güncel max ile kıyasla
    if (isNaN(val) || val < 0 || val >= maxRef) { setLocalMin(bucket.minValue.toString()); return; }
    if (val !== bucket.minValue) onSaveUpdate({ minValue: Math.round(val) });
  };

  const commitMax = () => {
    const val = parseFloat(localMax);
    const minRef = parseFloat(localMin);
    if (isNaN(val) || val <= minRef) { setLocalMax(bucket.maxValue.toString()); return; }
    if (val !== bucket.maxValue) onSaveUpdate({ maxValue: Math.round(val) });
  };

  const commitIcon = () => {
    const clamped = clampIcon(localIcon);
    setLocalIcon(clamped);
    if (clamped !== bucket.icon) onSaveUpdate({ icon: clamped });
  };

  const onEscape = (e: React.KeyboardEvent<HTMLInputElement>, reset: () => void) => {
    if (e.key === 'Escape') { reset(); e.currentTarget.blur(); }
    if (e.key === 'Enter') e.currentTarget.blur();
  };

  return (
    <div
      className={`rounded-2xl border p-3.5 space-y-3 transition-colors ${
        isOverlap
          ? 'border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/20'
          : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900'
      }`}
    >
      {/* Üst satır: ikon + isim + durum rozeti */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={localIcon}
          aria-label="Kova ikonu"
          onChange={(e) => setLocalIcon(e.target.value)}
          onBlur={commitIcon}
          onKeyDown={(e) => onEscape(e, () => setLocalIcon(bucket.icon))}
          className="w-11 h-11 shrink-0 grid place-items-center text-lg text-center bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl focus:border-rose-500 focus:outline-hidden"
        />
        <input
          type="text"
          value={localName}
          aria-label="Kova adı"
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => onEscape(e, () => setLocalName(bucket.name))}
          className="min-w-0 flex-1 bg-transparent border-b border-dashed border-stone-300 dark:border-stone-700 px-1 py-1.5 text-sm font-bold text-stone-900 dark:text-stone-100 focus:border-rose-500 focus:outline-hidden"
        />
        {isOverlap && (
          <span title="Aralık çakışması algılandı" className="shrink-0 text-amber-500">
            <AlertTriangle className="w-4 h-4" />
          </span>
        )}
        <button
          type="button"
          onClick={onToggleActive}
          aria-label={bucket.isActive ? 'Kovayı gizle' : 'Kovayı aktifleştir'}
          className="shrink-0 p-1.5 -m-1.5 rounded-lg text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 cursor-pointer"
        >
          {bucket.isActive ? <Eye className="w-4 h-4 text-emerald-500" /> : <EyeOff className="w-4 h-4 text-stone-400" />}
        </button>
      </div>

      {/* Aralık girişleri */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-stone-500 font-mono block mb-1">Min USDT</label>
          <input
            type="number"
            inputMode="decimal"
            value={localMin}
            onChange={(e) => setLocalMin(e.target.value)}
            onBlur={commitMin}
            onKeyDown={(e) => onEscape(e, () => setLocalMin(bucket.minValue.toString()))}
            className="w-full px-2.5 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-xs font-mono focus:border-rose-500 focus:outline-hidden"
          />
        </div>
        <div>
          <label className="text-[10px] text-stone-500 font-mono block mb-1">Max USDT</label>
          <input
            type="number"
            inputMode="decimal"
            value={localMax}
            onChange={(e) => setLocalMax(e.target.value)}
            onBlur={commitMax}
            onKeyDown={(e) => onEscape(e, () => setLocalMax(bucket.maxValue.toString()))}
            className="w-full px-2.5 py-2 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg text-xs font-mono focus:border-rose-500 focus:outline-hidden"
          />
        </div>
      </div>

      {/* Alt satır: renk, tür, sil */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={localColor}
            aria-label="Kova rengi"
            onChange={(e) => { setLocalColor(e.target.value); onSaveUpdate({ color: e.target.value }); }}
            className="w-8 h-8 p-0 rounded-lg border-0 cursor-pointer"
          />
          <button
            type="button"
            onClick={onToggleSmart}
            className={`h-8 px-2.5 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
              bucket.isSmartMoney
                ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-500 border-stone-200 dark:border-stone-700'
            }`}
          >
            {bucket.isSmartMoney ? 'Smart' : 'Retail'}
          </button>
        </div>

        {isDeleting ? (
          <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/80 p-1 rounded-xl border border-rose-200 dark:border-rose-800">
            <span className="text-[10px] font-bold text-rose-700 dark:text-rose-300 px-1">Silinsin mi?</span>
            <button type="button" onClick={onConfirmDelete} className="h-7 px-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold cursor-pointer">Evet</button>
            <button type="button" onClick={onCancelDelete} className="h-7 px-2 bg-stone-200 dark:bg-stone-700 hover:bg-stone-300 text-stone-700 dark:text-stone-300 rounded-lg text-[10px] font-bold cursor-pointer">Vazgeç</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onStartDelete}
            aria-label="Kovayı sil"
            className="h-9 w-9 grid place-items-center rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------
// ⚙️ ANA SETTINGS VIEW
// ------------------------------------------------------------------------
export const SettingsView: React.FC<SettingsViewProps> = ({
  bucketManager,
  customBuckets,
  appSettings,
  onUpdateSettings,
  onRefreshCustomBuckets,
}) => {
  const [newName, setNewName] = useState('');
  const [newMin, setNewMin] = useState('1000');
  const [newMax, setNewMax] = useState('5000');
  const [newIcon, setNewIcon] = useState('💎');
  const [newColor, setNewColor] = useState('#EC4899');
  const [newIsSmart, setNewIsSmart] = useState(false);
  const [formError, setFormError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const [deletingBucketId, setDeletingBucketId] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [jsonImportText, setJsonImportText] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);

  const [toast, setToast] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    const id = Date.now();
    setToast({ id, message, type });
    toastTimer.current = setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3000);
  }, []);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Çakışan kova id seti — her satırda O(n) yeniden hesaplamak yerine tek geçişte
  const overlapIds = useMemo(() => {
    const ids = new Set<string>();
    const active = customBuckets.filter((b) => b.isActive);
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i], b = active[j];
        if (a.minValue < b.maxValue && a.maxValue > b.minValue) { ids.add(a.id); ids.add(b.id); }
      }
    }
    return ids;
  }, [customBuckets]);

  const handleCreateBucket = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const trimmedName = newName.trim();
    const minVal = parseFloat(newMin);
    const maxVal = parseFloat(newMax);

    if (!trimmedName) { setFormError('Kova adı boş bırakılamaz.'); return; }
    if (isNaN(minVal) || isNaN(maxVal) || minVal < 0 || maxVal <= minVal) {
      setFormError('Geçerli bir tutar aralığı girin (Min < Max).');
      return;
    }
    const isDuplicate = customBuckets.some((b) => b.name.trim().toLowerCase() === trimmedName.toLowerCase());
    if (isDuplicate) { setFormError('Bu isimde bir kova zaten var.'); return; }

    const result = bucketManager.createManualBucket({
      name: trimmedName,
      minValue: minVal,
      maxValue: maxVal,
      icon: clampIcon(newIcon),
      color: newColor,
      isActive: true,
      isSmartMoney: newIsSmart,
    });

    if (result.success) {
      setNewName('');
      const nextMin = maxVal > 0 ? maxVal : 1000;
      setNewMin(nextMin.toString());
      setNewMax((nextMin * 2).toString());
      onRefreshCustomBuckets();
      soundEngine.playSignalChime('alert');
      showToast(`"${trimmedName}" kovası eklendi`);
    } else {
      setFormError(result.message || `Maksimum ${bucketManager.maxCustomBuckets} kova sınırına ulaşıldı.`);
    }
  };

  const handleAutoExpand = () => {
    const result = bucketManager.expandTo100Buckets();
    if (result.success) {
      onRefreshCustomBuckets();
      soundEngine.playSignalChime('bull');
      showToast('Kovalar 100 dilimlik algoritmaya genişletildi');
    } else {
      showToast(result.message, 'error');
    }
  };

  const executeReset = () => {
    bucketManager.resetCustomBuckets();
    onRefreshCustomBuckets();
    setShowResetModal(false);
    showToast('Tüm özel kovalar varsayılana sıfırlandı', 'info');
  };

  const executeDeleteBucket = (id: string, name: string) => {
    bucketManager.removeCustomBucket(id);
    onRefreshCustomBuckets();
    setDeletingBucketId(null);
    showToast(`"${name}" kovası silindi`, 'info');
  };

  const handleExportJson = async () => {
    const data = bucketManager.exportCustomBuckets();
    const ok = await clipboardCopy(data);
    if (ok) {
      setCopySuccess(true);
      showToast('Kova JSON konfigürasyonu panoya kopyalandı');
      setTimeout(() => setCopySuccess(false), 2000);
    } else {
      showToast('Kopyalama başarısız — panoya erişim engellendi', 'error');
    }
  };

  const handleImportJson = () => {
    if (!jsonImportText.trim()) return;
    try {
      const result = bucketManager.importCustomBuckets(jsonImportText);
      if (result.success) {
        setJsonImportText('');
        onRefreshCustomBuckets();
        showToast('Kovalar başarıyla içe aktarıldı');
      } else {
        showToast(result.message || 'Geçersiz JSON formatı', 'error');
      }
    } catch {
      showToast('İçe aktarma sırasında hata oluştu', 'error');
    }
  };

  return (
    <div className="space-y-5 relative pb-6">
      {/* TOAST — üstte, safe-area uyumlu, tek örnek */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-3 left-3 right-3 z-50 flex justify-center pointer-events-none"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div
            className={`pointer-events-auto max-w-sm w-full px-4 py-2.5 rounded-xl shadow-lg border flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-2 ${
              toast.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-500'
                : toast.type === 'error'
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-stone-900 text-white border-stone-800 dark:bg-stone-100 dark:text-stone-900'
            }`}
          >
            <span className="flex-1">{toast.message}</span>
            <button type="button" aria-label="Kapat" onClick={() => setToast(null)} className="shrink-0 hover:opacity-80">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* SIFIRLAMA ONAY MODALI */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-4">
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-sm font-black text-stone-900 dark:text-stone-100">Kovaları Sıfırla?</h3>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              Tüm özel kovalar varsayılan logaritmik yapıya dönecek. Yaptığınız değişiklikler silinecek.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowResetModal(false)} className="h-10 px-3.5 rounded-xl text-xs font-bold text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">Vazgeç</button>
              <button type="button" onClick={executeReset} className="h-10 px-4 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs cursor-pointer">Evet, Sıfırla</button>
            </div>
          </div>
        </div>
      )}

      {/* 1. SİSTEM & ARAYÜZ */}
      <section className="bg-white/95 dark:bg-stone-900 p-4 sm:p-5 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-rose-500" />
          <h2 className="text-base font-black text-stone-900 dark:text-stone-100">Sistem & Performans Yapılandırması</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
          <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-stone-800 dark:text-stone-200">Ring Buffer Boyutu</span>
              <span className="text-xs font-mono font-black text-rose-600 dark:text-rose-400">{appSettings.bufferSize.toLocaleString()}</span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[500, 1000, 2000, 5000, 10000].map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    bucketManager.setBufferSize(size);
                    onUpdateSettings({ bufferSize: size });
                    showToast(`Ring Buffer ${size.toLocaleString()} boyuta ayarlandı`);
                  }}
                  className={`h-9 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    appSettings.bufferSize === size
                      ? 'bg-rose-600 text-white shadow-2xs'
                      : 'bg-white dark:bg-stone-700 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-600 hover:bg-rose-50'
                  }`}
                >
                  {size >= 1000 ? `${size / 1000}k` : size}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-stone-500 dark:text-stone-400">P70/P90/P98 hesaplamalarında kullanılan dinamik kayan pencere</p>
          </div>

          <div className="p-3.5 rounded-xl bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 space-y-2">
            <span className="text-xs font-bold text-stone-800 dark:text-stone-200 block">Görsel & Ses Tercihleri</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings({ theme: appSettings.theme === 'dark' ? 'light' : 'dark' })}
                className="h-10 rounded-lg text-xs font-bold border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 flex items-center justify-center gap-1.5 transition-colors hover:bg-rose-50 dark:hover:bg-stone-600 cursor-pointer"
              >
                {appSettings.theme === 'dark' ? <Moon className="w-3.5 h-3.5 text-indigo-400" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
                <span>{appSettings.theme === 'dark' ? 'Karanlık' : 'Aydınlık'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextSound = !appSettings.soundEnabled;
                  onUpdateSettings({ soundEnabled: nextSound });
                  soundEngine.setMuted(!nextSound);
                  if (nextSound) soundEngine.playSignalChime('bull');
                }}
                className="h-10 rounded-lg text-xs font-bold border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 flex items-center justify-center gap-1.5 transition-colors hover:bg-rose-50 dark:hover:bg-stone-600 cursor-pointer"
              >
                {appSettings.soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-emerald-500" /> : <VolumeX className="w-3.5 h-3.5 text-stone-400" />}
                <span>{appSettings.soundEnabled ? 'Açık' : 'Kapalı'}</span>
              </button>
            </div>
            <p className="text-[10px] text-stone-500 dark:text-stone-400">Boğa Emilimi / Dağıtım tespitinde anlık bildirim tonu</p>
          </div>
        </div>
      </section>

      {/* 2. KOVA YÖNETİMİ */}
      <section className="bg-white/95 dark:bg-stone-900 p-4 sm:p-5 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-rose-500" />
            <h2 className="text-base font-black text-stone-900 dark:text-stone-100">Özel Kovalar ({customBuckets.length}/100)</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowResetModal(true)}
            aria-label="Kovaları sıfırla"
            className="h-9 w-9 grid place-items-center rounded-lg bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 text-stone-500 border border-stone-200 dark:border-stone-700 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleAutoExpand}
            className="h-11 rounded-xl bg-amber-50 dark:bg-amber-950/70 hover:bg-amber-100 text-amber-900 dark:text-amber-200 text-xs font-bold border border-amber-300 dark:border-amber-700 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>100'e Genişlet</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{showAddForm ? 'Formu Kapat' : 'Yeni Kova'}</span>
          </button>
        </div>

        {/* Yeni Kova Formu (mobilde açılır/kapanır) */}
        {showAddForm && (
          <form onSubmit={handleCreateBucket} className="p-3.5 rounded-xl bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 space-y-3">
            <div>
              <label className="text-[10px] text-stone-500 font-mono block mb-1">Kova Adı</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Örn: Balina Avcısı"
                className="w-full h-10 px-2.5 bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-lg text-xs text-stone-900 dark:text-stone-100 focus:border-rose-500 focus:outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-stone-500 font-mono block mb-1">Min USDT</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={newMin}
                  onChange={(e) => setNewMin(e.target.value)}
                  className="w-full h-10 px-2.5 bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-lg text-xs font-mono text-stone-900 dark:text-stone-100 focus:border-rose-500 focus:outline-hidden"
                />
              </div>
              <div>
                <label className="text-[10px] text-stone-500 font-mono block mb-1">Maks USDT</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={newMax}
                  onChange={(e) => setNewMax(e.target.value)}
                  className="w-full h-10 px-2.5 bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-lg text-xs font-mono text-stone-900 dark:text-stone-100 focus:border-rose-500 focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-stone-500 font-mono">İkon</span>
                <input
                  type="text"
                  value={newIcon}
                  onChange={(e) => setNewIcon(e.target.value)}
                  onBlur={() => setNewIcon(clampIcon(newIcon))}
                  className="w-12 h-9 text-center bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-lg focus:border-rose-500 focus:outline-hidden"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-stone-500 font-mono">Renk</span>
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-9 h-9 p-0 rounded-lg border border-stone-300 dark:border-stone-600 cursor-pointer"
                />
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer text-stone-700 dark:text-stone-300 ml-auto">
                <input type="checkbox" checked={newIsSmart} onChange={(e) => setNewIsSmart(e.target.checked)} className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer" />
                <span className="text-[10px] font-semibold">Smart Money</span>
              </label>
            </div>

            {formError && <p className="text-xs text-rose-600 dark:text-rose-400 font-bold">{formError}</p>}

            <button type="submit" className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer shadow-xs">
              Kovayı Ekle
            </button>
          </form>
        )}

        {/* Kova Listesi — kart tabanlı, tüm ekran boyutlarında okunur */}
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-0.5">
          {customBuckets.length === 0 ? (
            <p className="text-xs text-stone-500 text-center py-6">Henüz özel kova yok. "Yeni Kova" ile ekleyin.</p>
          ) : (
            customBuckets.map((b) => (
              <EditableBucketRow
                key={b.id}
                bucket={b}
                isDeleting={deletingBucketId === b.id}
                isOverlap={overlapIds.has(b.id)}
                onStartDelete={() => setDeletingBucketId(b.id)}
                onCancelDelete={() => setDeletingBucketId(null)}
                onConfirmDelete={() => executeDeleteBucket(b.id, b.name)}
                onToggleActive={() => { bucketManager.toggleBucketActive(b.id); onRefreshCustomBuckets(); }}
                onToggleSmart={() => { bucketManager.updateCustomBucket(b.id, { isSmartMoney: !b.isSmartMoney }); onRefreshCustomBuckets(); }}
                onSaveUpdate={(updates) => {
                  bucketManager.updateCustomBucket(b.id, updates);
                  onRefreshCustomBuckets();
                  showToast(`"${b.name}" güncellendi`);
                }}
              />
            ))
          )}
        </div>
      </section>

      {/* 3. YEDEKLEME */}
      <section className="bg-white/95 dark:bg-stone-900 p-4 sm:p-5 rounded-2xl border border-pink-200/80 dark:border-stone-800 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <Download className="w-5 h-5 text-rose-500" />
          <h2 className="text-base font-black text-stone-900 dark:text-stone-100">Kova Yapılandırma Yedekleme</h2>
        </div>

        <div className="grid grid-cols-1 gap-3 pt-1">
          <div className="space-y-2 p-3 bg-stone-50 dark:bg-stone-800/80 rounded-xl border border-stone-200 dark:border-stone-700">
            <span className="text-xs font-bold text-stone-800 dark:text-stone-200 block">Dışa Aktar</span>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">{customBuckets.length} özel kovayı JSON olarak panoya kopyala</p>
            <button
              type="button"
              onClick={handleExportJson}
              className="w-full h-11 rounded-lg bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer hover:opacity-90"
            >
              {copySuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copySuccess ? 'Kopyalandı' : 'JSON Kopyala'}</span>
            </button>
          </div>

          <div className="space-y-2 p-3 bg-stone-50 dark:bg-stone-800/80 rounded-xl border border-stone-200 dark:border-stone-700">
            <span className="text-xs font-bold text-stone-800 dark:text-stone-200 block">İçe Aktar</span>
            <textarea
              rows={3}
              placeholder="Yapıştırılacak JSON verisi..."
              value={jsonImportText}
              onChange={(e) => setJsonImportText(e.target.value)}
              className="w-full p-2.5 text-xs font-mono bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600 rounded-lg text-stone-900 dark:text-stone-100 focus:border-rose-500 focus:outline-hidden resize-none"
            />
            <button
              type="button"
              onClick={handleImportJson}
              disabled={!jsonImportText.trim()}
              className="w-full h-11 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>İçe Aktar ve Uygula</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
