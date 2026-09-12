/**
 * DOMAIN LAYER (frontend)
 *
 * Aturan murni — tidak menyentuh DOM, fetch, atau localStorage.
 * Karena itu bisa diuji tanpa browser, sama seperti domain di Go.
 *
 * Pelajaran dari versi vanilla: dulu `S.premium = true` tersebar di beberapa
 * tempat, dan tiap tempat harus ingat memanggil renderFrameStrip() +
 * renderStudioBtn() + menampilkan badge. Satu terlupa = tampilan tidak sinkron
 * (persis bug kotak "beli kode" yang tidak muncul). Di sini status adalah
 * SATU nilai; tampilan tinggal mengikutinya.
 */

export type SessionState =
  | { kind: "anonymous" }
  | { kind: "premium"; code: string; token: string; ordersLeft: number };

export const anonymous = (): SessionState => ({ kind: "anonymous" });

export const isPremium = (s: SessionState): boolean => s.kind === "premium";

/** Unduhan bersih (tanpa watermark) hanya untuk sesi premium */
export const canDownloadClean = isPremium;

/** "Kirim ke Studio" butuh premium DAN masih ada jatah pesanan */
export const canSubmitOrder = (s: SessionState): boolean =>
  s.kind === "premium" && s.ordersLeft > 0;

// --------------------------------------------------------------- Bingkai

export type FrameId = "clover" | "linen" | "blush" | "mint" | "plum";

export interface Frame {
  id: FrameId;
  name: string;
  premium: boolean;
}

export const FRAMES: readonly Frame[] = [
  { id: "clover", name: "Clover", premium: false },
  { id: "linen", name: "Linen", premium: false },
  { id: "blush", name: "Blush", premium: true },
  { id: "mint", name: "Mint", premium: true },
  { id: "plum", name: "Plum", premium: true },
] as const;

export const isFrameLocked = (f: Frame, s: SessionState): boolean =>
  f.premium && !isPremium(s);
