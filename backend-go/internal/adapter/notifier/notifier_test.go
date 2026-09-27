package notifier

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"onestripclover/internal/domain"
	"onestripclover/internal/usecase"
)

type senderPalsu struct {
	to  []string
	msg []byte
	err error
}

func (s *senderPalsu) Send(_ context.Context, _ SMTPConfig, to []string, msg []byte) error {
	s.to, s.msg = to, msg
	return s.err
}

type gagal struct{}

func (gagal) Name() string                                { return "gagal" }
func (gagal) Notify(context.Context, *domain.Order) error { return errors.New("mati") }

func pesanan(t *testing.T, nama string) *domain.Order {
	t.Helper()
	now := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	c, err := domain.NewContactDetails(nama, "pembeli@contoh.id", "")
	if err != nil {
		t.Fatal(err)
	}
	a, err := domain.NewAddress("Jl. Pengujian No. 1, Jakarta Selatan")
	if err != nil {
		t.Fatal(err)
	}
	o, err := domain.NewOrder(domain.NewOrderRef(now, "abc123"), "OSC-ABCDEFGH", c, a,
		[]domain.Photo{{Data: []byte{0xff, 0xd8, 0xff}}}, nil, "catatan", "gaya", now, now, true)
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func TestEmail_KirimKeStudioDenganReplyToPembeli(t *testing.T) {
	s := &senderPalsu{}
	e := NewEmail(SMTPConfig{From: "studio@contoh.id", StudioEmail: "studio@contoh.id"}, s)
	if err := e.Notify(context.Background(), pesanan(t, "Budi")); err != nil {
		t.Fatal(err)
	}
	m := string(s.msg)
	if s.to[0] != "studio@contoh.id" {
		t.Fatalf("tujuan salah: %v", s.to)
	}
	for _, harus := range []string{"From: studio@contoh.id", "Reply-To: pembeli@contoh.id", "foto-asli-"} {
		if !strings.Contains(m, harus) {
			t.Errorf("pesan tidak memuat %q", harus)
		}
	}
}

func TestEmail_SubjectKebalHeaderInjection(t *testing.T) {
	s := &senderPalsu{}
	e := NewEmail(SMTPConfig{StudioEmail: "studio@contoh.id"}, s)
	_ = e.Notify(context.Background(), pesanan(t, "Budi\r\nBcc: korban@contoh.id"))
	head := strings.SplitN(string(s.msg), "\r\n\r\n", 2)[0]
	if strings.Contains(head, "\r\nBcc:") {
		t.Fatal("header Bcc berhasil disisipkan")
	}
}

func TestComposite_SatuBerhasilCukup(t *testing.T) {
	ok := NewEmail(SMTPConfig{StudioEmail: "s@contoh.id"}, &senderPalsu{})
	c := NewComposite([]usecase.Notifier{gagal{}, ok, NewDrive("x")}...)
	if err := c.Notify(context.Background(), pesanan(t, "Budi")); err != nil {
		t.Fatalf("satu channel berhasil harus dianggap sukses: %v", err)
	}
	semuaGagal := NewComposite(gagal{}, NewDrive("x"))
	if err := semuaGagal.Notify(context.Background(), pesanan(t, "Budi")); err == nil {
		t.Fatal("semua gagal harus error")
	}
}
