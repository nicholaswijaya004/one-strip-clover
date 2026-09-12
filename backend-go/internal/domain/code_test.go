package domain_test

import (
	"errors"
	"testing"
	"time"

	"onestripclover/internal/domain"
)

// ============================================================================
// Perhatikan: tes ini TIDAK butuh file, server, atau mock apa pun.
// Itulah hasil langsung dari memisahkan aturan bisnis ke domain murni.
//
// Bandingkan dengan versi Node: menguji aturan yang sama butuh menyiapkan
// data/codes.json terlebih dulu, lalu mengembalikannya setelah tes selesai.
// ============================================================================

func mustCode(t *testing.T, maxOrders int) *domain.AccessCode {
	t.Helper()
	c, err := domain.NewAccessCode("OSC", maxOrders, time.Now())
	if err != nil {
		t.Fatalf("membuat kode: %v", err)
	}
	return c
}

func TestKodeBaruFormatnyaBenar(t *testing.T) {
	c := mustCode(t, 1)
	id := c.ID().String()
	if len(id) != 10 || id[:4] != "OSC-" {
		t.Fatalf("format kode salah: %q", id)
	}
	if c.State() != domain.StateFresh {
		t.Fatalf("kode baru harus Fresh, dapat %v", c.State())
	}
}

func TestKodeHangusSetelahSatuPesanan(t *testing.T) {
	now := time.Now()
	c := mustCode(t, 1)
	if _, err := c.Redeem(now, time.Hour); err != nil {
		t.Fatalf("penukaran pertama gagal: %v", err)
	}
	if err := c.ConsumeOrder("OSC260819-A1", now); err != nil {
		t.Fatalf("pesanan pertama gagal: %v", err)
	}

	// inti aturannya: pesanan kedua harus ditolak
	if err := c.ConsumeOrder("OSC260819-A2", now); !errors.Is(err, domain.ErrCodeSpent) {
		t.Fatalf("pesanan kedua harus ditolak, dapat %v", err)
	}
	if c.State() != domain.StateSpent {
		t.Fatalf("state harus Spent, dapat %v", c.State())
	}
}

func TestKodeYangSudahMemesanTidakBisaDitukarLagi(t *testing.T) {
	now := time.Now()
	c := mustCode(t, 1)
	_, _ = c.Redeem(now, 3*time.Hour)
	_ = c.ConsumeOrder("OSC260819-A1", now)

	// walau baru 1 detik, kode sudah mati
	_, err := c.Redeem(now.Add(time.Second), 3*time.Hour)
	if !errors.Is(err, domain.ErrCodeSpent) {
		t.Fatalf("harus ErrCodeSpent, dapat %v", err)
	}
}

func TestPembeliBolehMasukLagiSelamaBelumMemesan(t *testing.T) {
	// skenario nyata: halaman ter-refresh saat mengisi alamat
	now := time.Now()
	c := mustCode(t, 1)
	if _, err := c.Redeem(now, 3*time.Hour); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 5; i++ {
		out, err := c.Redeem(now.Add(time.Duration(i)*10*time.Minute), 3*time.Hour)
		if err != nil {
			t.Fatalf("percobaan ke-%d ditolak: %v", i, err)
		}
		if !out.Reentry {
			t.Fatalf("percobaan ke-%d harus ditandai reentry", i)
		}
	}
}

func TestKodeKedaluwarsaKalauLewatBatasWaktuTanpaMemesan(t *testing.T) {
	now := time.Now()
	c := mustCode(t, 1)
	_, _ = c.Redeem(now, 3*time.Hour)

	_, err := c.Redeem(now.Add(4*time.Hour), 3*time.Hour)
	if !errors.Is(err, domain.ErrCodeExpired) {
		t.Fatalf("harus ErrCodeExpired, dapat %v", err)
	}
}

func TestKodeChatbotTidakBolehDiambilTombolAdmin(t *testing.T) {
	c := mustCode(t, 1)
	if !c.IsAvailableForAdmin() {
		t.Fatal("kode Fresh harus tersedia untuk admin")
	}
	if err := c.IssueTo("(batch chatbot)", time.Now()); err != nil {
		t.Fatal(err)
	}
	if c.IsAvailableForAdmin() {
		t.Fatal("kode yang sudah masuk pool chatbot TIDAK boleh dibagikan lagi lewat admin")
	}
}

func TestKodeTidakMemakaiKarakterRancu(t *testing.T) {
	// 0/O dan 1/I/L gampang salah ketik oleh pembeli
	for i := 0; i < 300; i++ {
		id := mustCode(t, 1).ID().String()
		for _, ch := range id[4:] {
			if ch == '0' || ch == 'O' || ch == '1' || ch == 'I' || ch == 'L' {
				t.Fatalf("kode mengandung karakter rancu: %s", id)
			}
		}
	}
}

func TestBatasPesananBisaLebihDariSatu(t *testing.T) {
	now := time.Now()
	c := mustCode(t, 2) // mis. paket berisi 2 strip
	_, _ = c.Redeem(now, time.Hour)

	if err := c.ConsumeOrder("A", now); err != nil {
		t.Fatal(err)
	}
	if c.IsSpent() {
		t.Fatal("belum boleh hangus, jatah masih 1")
	}
	if err := c.ConsumeOrder("B", now); err != nil {
		t.Fatal(err)
	}
	if !c.IsSpent() {
		t.Fatal("harus hangus setelah jatah habis")
	}
}
