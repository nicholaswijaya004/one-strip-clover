package domain_test

import (
	"strings"
	"testing"

	"onestripclover/internal/domain"
)

func TestEmailTidakValidDitolakDiKonstruktor(t *testing.T) {
	for _, jelek := range []string{"", "bukan-email", "a@b", "@b.com", "a b@c.com"} {
		if _, err := domain.NewEmail(jelek); err == nil {
			t.Fatalf("email %q seharusnya ditolak", jelek)
		}
	}
	if _, err := domain.NewEmail("Daniel@Gmail.com "); err != nil {
		t.Fatalf("email valid ditolak: %v", err)
	}
}

func TestKontakButuhMinimalSatuSaluran(t *testing.T) {
	if _, err := domain.NewContactDetails("Daniel", "", ""); err != domain.ErrNoContact {
		t.Fatalf("harus ErrNoContact, dapat %v", err)
	}
	if _, err := domain.NewContactDetails("", "a@b.com", ""); err != domain.ErrEmptyName {
		t.Fatalf("nama kosong harus ditolak, dapat %v", err)
	}
	if _, err := domain.NewContactDetails("Daniel", "", "081234567890"); err != nil {
		t.Fatalf("WhatsApp saja seharusnya cukup: %v", err)
	}
}

func TestKontakUtamaMengutamakanEmail(t *testing.T) {
	c, err := domain.NewContactDetails("Daniel", "a@b.com", "081234567890")
	if err != nil {
		t.Fatal(err)
	}
	if c.Primary() != "a@b.com" {
		t.Fatalf("harus email, dapat %q", c.Primary())
	}
}

func TestSafeLabelMenutupCelahInjeksi(t *testing.T) {
	// email header injection
	if out := domain.SafeLabel("Budi\r\nBcc: korban@example.com", 100); strings.ContainsAny(out, "\r\n") {
		t.Fatalf("CR/LF harus dibuang: %q", out)
	}
	// path traversal
	if out := domain.SafeLabel("../../etc/passwd", 100); strings.Contains(out, "/") {
		t.Fatalf("garis miring harus dibuang: %q", out)
	}
}

func TestAlamatHarusCukupLengkap(t *testing.T) {
	if _, err := domain.NewAddress("Jl. Mawar"); err == nil {
		t.Fatal("alamat terlalu pendek harus ditolak")
	}
	if _, err := domain.NewAddress("Jl. Merdeka No. 12, Sukabumi, Jawa Barat 43351"); err != nil {
		t.Fatalf("alamat lengkap ditolak: %v", err)
	}
}
