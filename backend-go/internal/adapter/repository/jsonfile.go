package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"onestripclover/internal/domain"
	"onestripclover/internal/usecase"
)

// ============================================================================
// ADAPTER: implementasi CodeRepository memakai file JSON.
//
// Ini satu-satunya file yang tahu tentang disk, JSON, dan penguncian.
// Domain dan use case tidak tahu apa-apa soal ini — makanya menggantinya
// dengan PostgresCodeRepo nanti tidak mengubah logika bisnis sama sekali.
//
// Dua pelajaran dari audit versi Node diterapkan di sini:
//   1. Semua perubahan lewat satu mutex → tidak ada balapan baca-ubah-tulis
//   2. Penulisan atomik (tmp → fsync → rename) → file tidak bisa rusak
//      separuh kalau proses mati di tengah jalan
// ============================================================================

type JSONFile struct {
	path string
	mu   sync.Mutex // melindungi seluruh siklus baca-ubah-tulis
}

func NewJSONFile(path string) *JSONFile {
	return &JSONFile{path: path}
}

// record = bentuk data di disk. Sengaja dipisah dari domain.AccessCode
// supaya perubahan struktur file tidak memaksa domain ikut berubah.
type record struct {
	State      string     `json:"state"`
	CreatedAt  time.Time  `json:"createdAt"`
	IssuedAt   *time.Time `json:"issuedAt,omitempty"`
	RedeemedAt *time.Time `json:"redeemedAt,omitempty"`
	OrdersUsed int        `json:"ordersUsed"`
	MaxOrders  int        `json:"maxOrders"`
	LastRef    string     `json:"lastRef,omitempty"`
	IssuedTo   string     `json:"issuedTo,omitempty"`
}

func toRecord(c *domain.AccessCode) record {
	return record{
		State: string(c.State()), CreatedAt: c.CreatedAt(),
		IssuedAt: c.IssuedAt(), RedeemedAt: c.RedeemedAt(),
		OrdersUsed: c.OrdersUsed(), MaxOrders: c.MaxOrders(),
		LastRef: c.LastRef(), IssuedTo: c.IssuedTo(),
	}
}

func fromRecord(id domain.CodeID, r record) *domain.AccessCode {
	return domain.RestoreAccessCode(
		id, domain.CodeState(r.State), r.CreatedAt,
		r.IssuedAt, r.RedeemedAt, r.OrdersUsed, r.MaxOrders, r.LastRef, r.IssuedTo,
	)
}

// -------------------------------------------------------- baca/tulis disk

func (r *JSONFile) readAll() (map[string]record, error) {
	b, err := os.ReadFile(r.path)
	if os.IsNotExist(err) {
		return map[string]record{}, nil
	}
	if err != nil {
		return nil, err
	}
	if len(b) == 0 {
		return map[string]record{}, nil
	}
	var out map[string]record
	if err := json.Unmarshal(b, &out); err != nil {
		// File utama rusak → coba cadangan sebelum menyerah
		if bak, e2 := os.ReadFile(r.path + ".bak"); e2 == nil {
			if json.Unmarshal(bak, &out) == nil {
				return out, nil
			}
		}
		return nil, fmt.Errorf("codes.json rusak: %w", err)
	}
	return out, nil
}

// writeAll menulis secara ATOMIK. Tanpa ini, mati listrik di tengah
// penulisan = seluruh kode yang pernah dijual hilang.
func (r *JSONFile) writeAll(data map[string]record) error {
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return err
	}
	if b, err := os.ReadFile(r.path); err == nil {
		_ = os.WriteFile(r.path+".bak", b, 0o600) // cadangan versi sebelumnya
	}

	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil { // pastikan sampai disk sebelum rename
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, r.path) // atomik
}

// ------------------------------------------------------------- Repository

func (r *JSONFile) FindByID(ctx context.Context, id domain.CodeID) (*domain.AccessCode, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.readAll()
	if err != nil {
		return nil, err
	}
	rec, ok := all[string(id)]
	if !ok {
		return nil, domain.ErrCodeNotFound
	}
	return fromRecord(id, rec), nil
}

func (r *JSONFile) Save(ctx context.Context, c *domain.AccessCode) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.readAll()
	if err != nil {
		return err
	}
	all[string(c.ID())] = toRecord(c)
	return r.writeAll(all)
}

func (r *JSONFile) SaveMany(ctx context.Context, codes []*domain.AccessCode) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.readAll()
	if err != nil {
		return err
	}
	for _, c := range codes {
		all[string(c.ID())] = toRecord(c)
	}
	return r.writeAll(all)
}

// Transact: baca → ubah → simpan dalam satu kunci. Inilah yang menutup
// celah "dua penukaran bersamaan, satu hilang" di versi Node.
func (r *JSONFile) Transact(
	ctx context.Context, id domain.CodeID, fn func(*domain.AccessCode) error,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.readAll()
	if err != nil {
		return err
	}
	rec, ok := all[string(id)]
	if !ok {
		return domain.ErrCodeNotFound
	}

	code := fromRecord(id, rec)
	if err := fn(code); err != nil {
		return err // perubahan TIDAK disimpan kalau aturan domain menolak
	}
	all[string(id)] = toRecord(code)
	return r.writeAll(all)
}

func (r *JSONFile) TakeNextAvailable(ctx context.Context, target string) (*domain.AccessCode, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.readAll()
	if err != nil {
		return nil, err
	}
	for id, rec := range all {
		c := fromRecord(domain.CodeID(id), rec)
		if !c.IsAvailableForAdmin() {
			continue
		}
		if err := c.IssueTo(target, time.Now()); err != nil {
			continue
		}
		all[id] = toRecord(c)
		if err := r.writeAll(all); err != nil {
			return nil, err
		}
		return c, nil
	}
	return nil, domain.ErrOutOfStock
}

func (r *JSONFile) Stats(ctx context.Context) (usecase.CodeStats, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	all, err := r.readAll()
	if err != nil {
		return usecase.CodeStats{}, err
	}
	var s usecase.CodeStats
	for id, rec := range all {
		c := fromRecord(domain.CodeID(id), rec)
		s.Total++
		switch {
		case c.IsSpent():
			s.Spent++
		case c.State() == domain.StateFresh:
			s.AdminStock++
		case c.State() == domain.StateIssued:
			s.ChatbotStock++
		case c.State() == domain.StateRedeemed:
			s.Redeemed++
		}
	}
	return s, nil
}
