package httpx

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"onestripclover/internal/domain"
	"onestripclover/internal/usecase"
)

// ============================================================================
// ADAPTER: menerjemahkan HTTP ↔ use case.
//
// Handler HANYA melakukan tiga hal:
//   1. membaca request → jadi input use case
//   2. memanggil use case
//   3. menerjemahkan hasil/error domain → status HTTP
//
// Tidak ada aturan bisnis di sini. Kalau kamu menemukan `if ... >= maxOrders`
// di file ini, berarti aturan sudah bocor keluar dari domain.
// ============================================================================

type Handler struct {
	redeem *usecase.RedeemCode
	submit *usecase.SubmitOrder
	log    usecase.Logger
}

func NewHandler(r *usecase.RedeemCode, s *usecase.SubmitOrder, log usecase.Logger) *Handler {
	return &Handler{redeem: r, submit: s, log: log}
}

// ------------------------------------------------------------ /api/redeem

type redeemRequest struct {
	Code string `json:"code"`
}

func (h *Handler) Redeem(w http.ResponseWriter, r *http.Request) {
	var req redeemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("BAD_REQUEST", "format tidak dikenali"))
		return
	}

	out, err := h.redeem.Execute(r.Context(), usecase.RedeemCodeInput{RawCode: req.Code})
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "token": out.Token, "reentry": out.Reentry,
		"ordersLeft": out.OrdersLeft, "hours": int(out.ExpiresIn.Hours()),
	})
}

// --------------------------------------------------- /api/orders (kirim studio)

type submitRequest struct {
	Token   string   `json:"token"`
	Name    string   `json:"name"`
	Email   string   `json:"email"`
	Phone   string   `json:"wa"`
	Address string   `json:"address"`
	Note    string   `json:"note"`
	Style   string   `json:"style"`
	Consent bool     `json:"consent"`
	Photos  []string `json:"photos"` // data URL base64
	Strip   string   `json:"strip"`
	TakenAt string   `json:"takenAt"`
}

func (h *Handler) SubmitOrder(w http.ResponseWriter, r *http.Request) {
	var req submitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody("BAD_REQUEST", "format tidak dikenali"))
		return
	}

	photos := make([][]byte, 0, len(req.Photos))
	for _, p := range req.Photos {
		b, err := decodeDataURL(p)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, errorBody("BAD_PHOTO", "foto tidak terbaca"))
			return
		}
		photos = append(photos, b)
	}
	strip, _ := decodeDataURL(req.Strip)

	takenAt, err := time.Parse(time.RFC3339, req.TakenAt)
	if err != nil {
		takenAt = time.Now()
	}

	out, err := h.submit.Execute(r.Context(), usecase.SubmitOrderInput{
		Token: req.Token, Name: req.Name, Email: req.Email, Phone: req.Phone,
		Address: req.Address, Note: req.Note, Style: req.Style,
		Consent: req.Consent, Photos: photos, Strip: strip,
		TakenAt: takenAt, RequestID: requestIDFrom(r),
	})
	if err != nil {
		writeDomainError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true, "ref": out.Ref.String(), "ordersLeft": out.OrdersLeft,
	})
}

// ------------------------------------------------------ penerjemah error

// Satu tempat menerjemahkan error domain → status HTTP.
// Kalau ada antarmuka lain (gRPC/CLI), cukup tulis penerjemah lain;
// domain dan use case tidak berubah.
func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrCodeNotFound):
		writeJSON(w, http.StatusNotFound, errorBody("INVALID", "kode tidak ditemukan"))
	case errors.Is(err, domain.ErrCodeSpent):
		writeJSON(w, http.StatusConflict, errorBody("SPENT", "kode sudah dipakai memesan"))
	case errors.Is(err, domain.ErrCodeExpired):
		writeJSON(w, http.StatusConflict, errorBody("USED", "kode sudah lewat batas waktu"))
	case errors.Is(err, domain.ErrAlreadyProcessing):
		writeJSON(w, http.StatusConflict, errorBody("ALREADY_PROCESSING", "pesanan sedang diproses"))
	case errors.Is(err, domain.ErrNoConsent):
		writeJSON(w, http.StatusBadRequest, errorBody("CONSENT_REQUIRED", "persetujuan belum dicentang"))
	case errors.Is(err, domain.ErrEmptyName):
		writeJSON(w, http.StatusBadRequest, errorBody("NAME_REQUIRED", "nama wajib diisi"))
	case errors.Is(err, domain.ErrNoContact):
		writeJSON(w, http.StatusBadRequest, errorBody("CONTACT_REQUIRED", "isi email atau WhatsApp"))
	case errors.Is(err, domain.ErrAddressTooShort):
		writeJSON(w, http.StatusBadRequest, errorBody("ADDRESS_REQUIRED", "alamat wajib diisi"))
	case errors.Is(err, domain.ErrDeliveryFailed):
		writeJSON(w, http.StatusBadGateway, errorBody("DELIVERY_FAILED", "gagal mengirim ke studio"))
	default:
		// Pesan error internal TIDAK dibocorkan ke pengunjung
		writeJSON(w, http.StatusInternalServerError, errorBody("SERVER_ERROR", "terjadi kesalahan"))
	}
}

// ------------------------------------------------------------------ util

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func errorBody(code, msg string) map[string]any {
	return map[string]any{"ok": false, "error": code, "message": msg}
}

func decodeDataURL(s string) ([]byte, error) {
	if s == "" {
		return nil, nil
	}
	for i := 0; i < len(s); i++ {
		if s[i] == ',' {
			return base64.StdEncoding.DecodeString(s[i+1:])
		}
	}
	return base64.StdEncoding.DecodeString(s)
}

func requestIDFrom(r *http.Request) string {
	if v := r.Header.Get("X-Request-Id"); v != "" {
		return v
	}
	return time.Now().Format("150405.000")
}
