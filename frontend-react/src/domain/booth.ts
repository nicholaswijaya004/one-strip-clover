/**
 * STATE MACHINE sesi foto — dipakai lewat useReducer.
 *
 * Kenapa reducer, bukan banyak useState:
 * dengan useState terpisah (isBusy, photos, countdown, cancelled) bisa muncul
 * kombinasi mustahil, mis. isBusy=false tapi hitungan mundur masih jalan.
 * State machine membuat kondisi mustahil itu TIDAK BISA diwakili.
 */

export type BoothState =
  | { phase: "idle"; photos: string[] }
  | { phase: "preparing" }
  | { phase: "counting"; shot: number; count: number; photos: string[] }
  | { phase: "done"; photos: string[]; takenAt: string };

export type BoothEvent =
  | { type: "START" }
  | { type: "TICK"; count: number }
  | { type: "CAPTURED"; photo: string }
  | { type: "UPLOADED"; photos: string[] }
  | { type: "CANCEL" }
  | { type: "RESET" };

export const TOTAL_SHOTS = 4;

export const initialBooth: BoothState = { phase: "idle", photos: [] };

export function boothReducer(state: BoothState, ev: BoothEvent): BoothState {
  switch (ev.type) {
    case "START":
      return { phase: "preparing" };

    case "TICK":
      if (state.phase === "preparing")
        return { phase: "counting", shot: 1, count: ev.count, photos: [] };
      if (state.phase === "counting") return { ...state, count: ev.count };
      return state;

    case "CAPTURED": {
      if (state.phase !== "counting") return state;
      const photos = [...state.photos, ev.photo];
      if (photos.length >= TOTAL_SHOTS)
        return { phase: "done", photos, takenAt: new Date().toISOString() };
      return { phase: "counting", shot: photos.length + 1, count: 3, photos };
    }

    case "UPLOADED":
      return {
        phase: "done",
        photos: ev.photos.slice(0, TOTAL_SHOTS),
        takenAt: new Date().toISOString(),
      };

    // Jalan keluar — pengguna harus selalu bisa membatalkan
    case "CANCEL":
    case "RESET":
      return initialBooth;

    default:
      return state;
  }
}

export const boothBusy = (s: BoothState): boolean =>
  s.phase === "preparing" || s.phase === "counting";
