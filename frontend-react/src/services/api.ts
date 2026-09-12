/**
 * ADAPTER + FACADE
 *
 * Adapter : satu-satunya tempat yang tahu tentang `fetch`, URL, dan bentuk
 *           JSON server. Kalau backend pindah dari Node ke Go dan bentuk
 *           responsnya berubah, HANYA file ini yang diedit.
 * Facade  : komponen memanggil `api.redeem(code)`, bukan menyusun sendiri
 *           header, JSON.stringify, dan penanganan status HTTP.
 *
 * Pelajaran dari versi vanilla: `fetch("/api/redeem", {...})` ditulis langsung
 * di dalam handler tombol. Akibatnya penanganan error tersebar dan tidak
 * konsisten, serta mustahil diuji tanpa server hidup.
 */

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RedeemResult {
  token: string;
  reentry: boolean;
  ordersLeft: number;
}

export interface SubmitOrderPayload {
  token: string;
  name: string;
  email: string;
  wa: string;
  address: string;
  note: string;
  style: string;
  consent: boolean;
  photos: string[];
  strip: string | null;
  takenAt: string;
}

export interface ShopConfig {
  price: string;
  shops: { tiktok: string; tokopedia: string; shopee: string; whatsapp: string };
  hasShop: boolean;
}

/** Interface dulu, implementasi belakangan — supaya komponen bisa diuji
 *  dengan FakeApi tanpa menyentuh jaringan. */
export interface Api {
  redeem(code: string): Promise<RedeemResult>;
  verifySession(token: string): Promise<RedeemResult | null>;
  submitOrder(
    p: SubmitOrderPayload,
    onProgress?: (pct: number) => void,
  ): Promise<{ ref: string }>;
  config(): Promise<ShopConfig>;
}

export class HttpApi implements Api {
  constructor(private readonly baseUrl = "") {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as any)?.ok === false) {
      throw new ApiError(
        (data as any)?.error ?? "UNKNOWN",
        (data as any)?.message ?? "Terjadi kesalahan",
        res.status,
        data,
      );
    }
    return data as T;
  }

  async redeem(code: string): Promise<RedeemResult> {
    const d = await this.post<any>("/api/redeem", { code });
    return { token: d.token, reentry: !!d.reentry, ordersLeft: d.ordersLeft ?? 1 };
  }

  async verifySession(token: string): Promise<RedeemResult | null> {
    try {
      const d = await this.post<any>("/api/session", { token });
      return d.ok ? { token, reentry: true, ordersLeft: d.ordersLeft ?? 1 } : null;
    } catch {
      return null;
    }
  }

  /**
   * XHR dipakai (bukan fetch) karena HANYA XHR yang bisa melaporkan progres
   * unggahan. Payload 2-4 MB di jaringan HP bisa 30 detik — tanpa progres,
   * pengguna mengira aplikasi hang lalu menekan kirim dua kali.
   */
  submitOrder(p: SubmitOrderPayload, onProgress?: (pct: number) => void) {
    return new Promise<{ ref: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", this.baseUrl + "/api/orders");
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.timeout = 180_000;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress)
          onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        let d: any = {};
        try {
          d = JSON.parse(xhr.responseText);
        } catch {
          /* biarkan kosong */
        }
        if (xhr.status >= 200 && xhr.status < 300 && d.ok)
          resolve({ ref: d.ref });
        else
          reject(new ApiError(d.error ?? "UNKNOWN", d.message ?? "Gagal mengirim", xhr.status, d));
      };
      xhr.onerror = () => reject(new ApiError("NETWORK", "Koneksi terputus", 0));
      xhr.ontimeout = () => reject(new ApiError("TIMEOUT", "Jaringan terlalu lambat", 0));
      xhr.send(JSON.stringify(p));
    });
  }

  async config(): Promise<ShopConfig> {
    const res = await fetch(this.baseUrl + "/api/config");
    return res.json();
  }
}
