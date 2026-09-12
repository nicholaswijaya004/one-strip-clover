/**
 * ADAPTER: penyimpanan sesi di perangkat.
 *
 * Dibungkus karena dua alasan:
 *  1. localStorage MELEMPAR ERROR di mode privat Safari — kalau dipanggil
 *     langsung dari komponen, seluruh aplikasi bisa mati hanya karena itu.
 *  2. Saat pengujian, cukup pasang InMemoryStorage; tidak perlu jsdom.
 */

export interface SessionStorage {
  save(token: string, code: string): void;
  load(): { token: string; code: string } | null;
  clear(): void;
}

const KEY = "osc_premium";

export class BrowserStorage implements SessionStorage {
  save(token: string, code: string) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ token, code, at: Date.now() }));
    } catch {
      /* mode privat / kuota penuh — pengguna masih bisa mengetik ulang kode */
    }
  }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d?.token && d?.code ? { token: d.token, code: d.code } : null;
    } catch {
      return null;
    }
  }
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* diabaikan */
    }
  }
}

/** Dipakai di test — tanpa browser sama sekali */
export class InMemoryStorage implements SessionStorage {
  private data: { token: string; code: string } | null = null;
  save(token: string, code: string) {
    this.data = { token, code };
  }
  load() {
    return this.data;
  }
  clear() {
    this.data = null;
  }
}
