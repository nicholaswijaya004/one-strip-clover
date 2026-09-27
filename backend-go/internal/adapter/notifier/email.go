package notifier

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"onestripclover/internal/domain"
)

// ============================================================================
// STRATEGY: kirim pesanan lewat email.
//
// Pengiriman SMTP-nya sendiri disembunyikan di balik interface Sender, supaya
// Email bisa diuji tanpa server SMTP sungguhan (cukup Sender palsu yang
// menyimpan pesannya di memori).
// ============================================================================

// SMTPConfig — semua yang dibutuhkan untuk mengirim email ke studio.
type SMTPConfig struct {
	Host, Username, Password string
	Port                     int
	From, StudioEmail        string
	AttachRaw                bool
	Location                 *time.Location
}

// Sender mengirim satu pesan MIME yang sudah jadi.
type Sender interface {
	Send(ctx context.Context, cfg SMTPConfig, to []string, msg []byte) error
}

type Email struct {
	cfg    SMTPConfig
	sender Sender
}

func NewEmail(cfg SMTPConfig, sender Sender) *Email {
	if cfg.Location == nil {
		cfg.Location = time.UTC
	}
	return &Email{cfg: cfg, sender: sender}
}

func (e *Email) Name() string { return "email" }

func (e *Email) Notify(ctx context.Context, o *domain.Order) error {
	if e.cfg.StudioEmail == "" {
		return fmt.Errorf("STUDIO_EMAIL belum diisi")
	}
	msg, err := e.Build(o)
	if err != nil {
		return err
	}
	return e.sender.Send(ctx, e.cfg, []string{e.cfg.StudioEmail}, msg)
}

// Build menyusun pesan MIME multipart (teks + lampiran). Dipisah dari Notify
// supaya isinya bisa diperiksa di tes.
func (e *Email) Build(o *domain.Order) ([]byte, error) {
	boundary, err := randomBoundary()
	if err != nil {
		return nil, err
	}
	from := e.cfg.From
	if from == "" {
		from = e.cfg.Username
	}

	var b bytes.Buffer
	// SafeLabel membuang CR/LF → subject aman dari header injection
	subject := domain.SafeLabel(fmt.Sprintf("[%s] %s", o.Ref(), o.FolderLabel(e.cfg.Location)), 180)
	hdr := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	hdr("From", from)
	hdr("To", e.cfg.StudioEmail)
	if em := o.Contact().Email(); !em.IsZero() {
		hdr("Reply-To", em.String()) // Email sudah tervalidasi di domain
	}
	hdr("Subject", mime.QEncoding.Encode("utf-8", subject))
	hdr("MIME-Version", "1.0")
	hdr("Content-Type", `multipart/mixed; boundary="`+boundary+`"`)
	b.WriteString("\r\n")

	part := func(contentType, disposition string, body []byte, b64 bool) {
		fmt.Fprintf(&b, "--%s\r\nContent-Type: %s\r\n", boundary, contentType)
		if disposition != "" {
			fmt.Fprintf(&b, "Content-Disposition: %s\r\n", disposition)
		}
		if b64 {
			b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
			writeBase64Lines(&b, body)
		} else {
			b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
			b.Write(body)
		}
		b.WriteString("\r\n")
	}

	part("text/plain; charset=utf-8", "", []byte(e.body(o)), false)

	stamp := o.CreatedAt().UTC().Format("20060102-150405")
	if s := o.Strip(); s != nil && len(s.Data) > 0 {
		part("image/jpeg", `attachment; filename="STRIP-`+stamp+`.jpg"`, s.Data, true)
	}
	if e.cfg.AttachRaw || o.Strip() == nil {
		for i, p := range o.Photos() {
			name := fmt.Sprintf("foto-asli-%s-%d.jpg", stamp, i+1)
			part("image/jpeg", `attachment; filename="`+name+`"`, p.Data, true)
		}
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes(), nil
}

func (e *Email) body(o *domain.Order) string {
	c := o.Contact()
	return strings.Join([]string{
		"PESANAN STRIP MANUAL — ONE STRIP CLOVER",
		"No. Pesanan: " + o.Ref().String(),
		"",
		">>> ALAMAT PENGIRIMAN:",
		o.Address().String(),
		"",
		"Nama    : " + c.Name(),
		"Email   : " + c.Email().String(),
		"WhatsApp: " + c.Phone().String(),
		"Kode    : " + o.Code().String(),
		"Catatan : " + o.Note(),
		"Gaya    : " + o.Style(),
		"Foto diambil: " + o.TakenAt().In(e.cfg.Location).Format("2006-01-02 15.04"),
	}, "\r\n")
}

func writeBase64Lines(b *bytes.Buffer, data []byte) {
	enc := base64.StdEncoding.EncodeToString(data)
	for len(enc) > 76 { // RFC 2045: baris maksimal 76 karakter
		b.WriteString(enc[:76])
		b.WriteString("\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc)
}

func randomBoundary() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "osc-" + hex.EncodeToString(buf), nil
}

// ---------------------------------------------------------- SMTP sungguhan

type smtpSender struct{ timeout time.Duration }

// NewSMTPSender — pengirim net/smtp dengan batas waktu (tanpa ini koneksi
// SMTP yang macet menggantung selamanya dan menahan kunci pesanan).
func NewSMTPSender() Sender { return &smtpSender{timeout: 45 * time.Second} }

func (s *smtpSender) Send(ctx context.Context, cfg SMTPConfig, to []string, msg []byte) error {
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	d := net.Dialer{Timeout: 15 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	_ = conn.SetDeadline(time.Now().Add(s.timeout))

	c, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close()

	// STARTTLS wajib kalau ada auth — jangan kirim password polos
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(tlsConfig(cfg.Host)); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	} else if cfg.Username != "" {
		return fmt.Errorf("server SMTP tidak mendukung STARTTLS — menolak mengirim password tanpa enkripsi")
	}
	if cfg.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	from := cfg.From
	if from == "" {
		from = cfg.Username
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, r := range to {
		if err := c.Rcpt(r); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
