package token

import (
	"strings"
	"testing"
	"time"
)

const rahasia = "rahasia-uji-yang-panjangnya-lebih-dari-32-karakter"

func TestHMAC_TerbitLaluSah(t *testing.T) {
	s, err := NewHMACService(rahasia, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	tok, _ := s.Issue("OSC-ABCDEFGH", now)
	code, err := s.Verify(tok, now.Add(30*time.Minute))
	if err != nil || code != "OSC-ABCDEFGH" {
		t.Fatalf("token sah ditolak: %v %v", code, err)
	}
}

func TestHMAC_Kedaluwarsa(t *testing.T) {
	s, _ := NewHMACService(rahasia, time.Hour)
	now := time.Now()
	tok, _ := s.Issue("OSC-ABCDEFGH", now)
	if _, err := s.Verify(tok, now.Add(2*time.Hour)); err == nil {
		t.Fatal("token kedaluwarsa diterima")
	}
}

func TestHMAC_TandaTanganDiubahDitolak(t *testing.T) {
	s, _ := NewHMACService(rahasia, time.Hour)
	lain, _ := NewHMACService(strings.Repeat("z", 40), time.Hour)
	now := time.Now()
	tok, _ := lain.Issue("OSC-ABCDEFGH", now)
	for _, palsu := range []string{tok, "", "a.b", "abc", tok + "x"} {
		if _, err := s.Verify(palsu, now); err == nil {
			t.Fatalf("token palsu diterima: %q", palsu)
		}
	}
}

func TestHMAC_RahasiaPendekDitolak(t *testing.T) {
	if _, err := NewHMACService("pendek", time.Hour); err == nil {
		t.Fatal("rahasia pendek harus ditolak")
	}
}
