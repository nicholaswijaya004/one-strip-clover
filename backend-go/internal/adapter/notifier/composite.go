package notifier

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"onestripclover/internal/domain"
	"onestripclover/internal/usecase"
)

// ============================================================================
// COMPOSITE PATTERN
//
// Composite adalah objek yang MENGIMPLEMENTASIKAN antarmuka yang sama dengan
// anak-anaknya. Use case cukup memanggil satu Notifier, tanpa tahu di dalamnya
// ada 1, 2, atau 0 pengirim.
//
// Perilaku penting (pelajaran dari versi Node): satu channel gagal TIDAK boleh
// membatalkan yang lain. Kalau Drive mati tapi email terkirim, pesanan tetap
// sampai ke studio → dianggap BERHASIL. Baru kalau SEMUA gagal, pesanan gagal.
// ============================================================================

type Composite struct {
	children []usecase.Notifier
}

func NewComposite(children ...usecase.Notifier) *Composite {
	return &Composite{children: children}
}

func (c *Composite) Name() string {
	names := make([]string, 0, len(c.children))
	for _, ch := range c.children {
		names = append(names, ch.Name())
	}
	return strings.Join(names, "+")
}

func (c *Composite) Notify(ctx context.Context, order *domain.Order) error {
	if len(c.children) == 0 {
		return fmt.Errorf("tidak ada channel pengiriman yang dikonfigurasi")
	}

	type hasil struct {
		name string
		err  error
	}

	var wg sync.WaitGroup
	out := make([]hasil, len(c.children))

	// PARALEL. Di versi Node ini dulu berurutan: email selesai dulu, baru
	// Drive — total waktu = jumlah keduanya. Sekarang = yang paling lama saja.
	for i, ch := range c.children {
		wg.Add(1)
		go func(i int, ch usecase.Notifier) {
			defer wg.Done()
			out[i] = hasil{name: ch.Name(), err: ch.Notify(ctx, order)}
		}(i, ch)
	}
	wg.Wait()

	var berhasil int
	var pesan []string
	for _, h := range out {
		if h.err == nil {
			berhasil++
		} else {
			pesan = append(pesan, fmt.Sprintf("%s: %v", h.name, h.err))
		}
	}

	if berhasil == 0 {
		return fmt.Errorf("semua channel gagal — %s", strings.Join(pesan, " | "))
	}
	return nil // minimal satu berhasil = pesanan sampai ke studio
}
