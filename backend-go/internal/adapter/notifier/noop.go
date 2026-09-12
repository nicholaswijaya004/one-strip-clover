package notifier

import (
	"context"

	"onestripclover/internal/domain"
)

// ============================================================================
// NULL OBJECT PATTERN
//
// Masalahnya: Google Drive itu opsional. Tanpa pattern ini, kode akan penuh
// pemeriksaan `if driveNotifier != nil { ... }` di setiap tempat pemakaian.
// Gampang terlupa satu → nil panic di produksi.
//
// Null Object mengganti "ketiadaan" dengan objek sah yang tidak melakukan
// apa-apa. Pemanggil tidak perlu tahu bedanya, dan tidak ada percabangan.
// ============================================================================

type Noop struct{ label string }

func NewNoop(label string) *Noop { return &Noop{label: label} }

func (n *Noop) Name() string { return n.label + "(nonaktif)" }

func (n *Noop) Notify(ctx context.Context, order *domain.Order) error {
	return nil // sengaja tidak melakukan apa pun
}
