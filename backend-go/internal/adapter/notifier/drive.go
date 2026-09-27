package notifier

import (
	"context"
	"errors"

	"onestripclover/internal/domain"
)

// ============================================================================
// Drive — BELUM diimplementasikan di versi Go (proyek belajar).
//
// Sistem produksi (Node) sudah mengunggah ke Drive lewat googleapis. Di sini
// sengaja dibiarkan jujur: mengembalikan error yang jelas, bukan pura-pura
// berhasil. Karena Composite hanya butuh SATU channel berhasil, email tetap
// mengantar pesanan walau Drive belum ada.
//
// Latihan: implementasikan dengan google.golang.org/api/drive/v3 — cukup
// file ini yang berubah; use case dan composite tidak tersentuh.
// ============================================================================

var ErrDriveNotImplemented = errors.New("drive belum diimplementasikan di versi Go")

type Drive struct{ folderID string }

func NewDrive(folderID string) *Drive { return &Drive{folderID: folderID} }

func (d *Drive) Name() string { return "drive" }

func (d *Drive) Notify(ctx context.Context, o *domain.Order) error {
	return ErrDriveNotImplemented
}
