package usecase

import (
	"context"
	"time"

	"onestripclover/internal/domain"
)

// ============================================================================
// PORTS — semua interface yang dibutuhkan use case dikumpulkan di sini.
//
// Aturan Hexagonal Architecture: interface DIDEFINISIKAN oleh yang MEMAKAI
// (use case), bukan oleh yang mengimplementasikan (adapter). Jadi adapter
// yang menyesuaikan diri ke kebutuhan bisnis, bukan sebaliknya.
//
// Praktisnya: use case tidak tahu apakah data disimpan di file JSON,
// PostgreSQL, atau Redis. Mengganti penyimpanan = tulis adapter baru,
// use case tidak berubah sebaris pun.
// ============================================================================

// ------------------------------------------------- Repository pattern

type CodeRepository interface {
	FindByID(ctx context.Context, id domain.CodeID) (*domain.AccessCode, error)
	Save(ctx context.Context, code *domain.AccessCode) error
	SaveMany(ctx context.Context, codes []*domain.AccessCode) error

	// Transact menjalankan fn secara EKSKLUSIF untuk satu kode:
	// baca terbaru → ubah → simpan, tanpa ada yang menyelinap di tengah.
	//
	// Method ini ada karena bug nyata yang ditemukan saat audit versi Node:
	// dua permintaan bersamaan sama-sama membaca "belum dipakai", sama-sama
	// lolos, dan satu penukaran hilang tertimpa. Penguncian adalah tanggung
	// jawab lapisan penyimpanan — use case tidak boleh perlu tahu caranya.
	Transact(ctx context.Context, id domain.CodeID, fn func(*domain.AccessCode) error) error

	// TakeNextAvailable mengambil satu kode stok admin dan menandainya
	// terbagikan, dalam satu operasi atomik.
	TakeNextAvailable(ctx context.Context, target string) (*domain.AccessCode, error)

	Stats(ctx context.Context) (CodeStats, error)
}

type CodeStats struct {
	Total        int `json:"total"`
	AdminStock   int `json:"adminStock"`
	ChatbotStock int `json:"chatbotStock"`
	Redeemed     int `json:"redeemed"`
	Spent        int `json:"spent"`
}

// ---------------------------------------------------- Strategy pattern

// Notifier — satu antarmuka, banyak cara mengirim pesanan ke studio.
// EmailNotifier dan DriveNotifier cara kerjanya beda total, tapi use case
// memperlakukan keduanya sama.
type Notifier interface {
	Notify(ctx context.Context, order *domain.Order) error
	Name() string
}

// --------------------------------------------------------- Token & waktu

type TokenService interface {
	Issue(code domain.CodeID, now time.Time) (string, error)
	Verify(token string, now time.Time) (domain.CodeID, error)
}

// Clock disuntikkan supaya waktu bisa dikendalikan saat pengujian.
// Tanpa ini, menguji "kode kedaluwarsa setelah 3 jam" berarti menunggu 3 jam.
type Clock interface {
	Now() time.Time
}

type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

// FixedClock dipakai di test.
type FixedClock struct{ T time.Time }

func (c FixedClock) Now() time.Time { return c.T }

// ---------------------------------------------------------------- Logger

// Logger sengaja diabstraksi supaya domain/use case tidak terikat ke
// pustaka log tertentu.
type Logger interface {
	Info(event string, fields map[string]any)
	Warn(event string, fields map[string]any)
	Error(event string, fields map[string]any)
}

// -------------------------------------------------------------- Locking

// OrderLock mencegah dua pesanan berjalan bersamaan untuk kode yang sama.
type OrderLock interface {
	Acquire(key string) bool
	Release(key string)
}
