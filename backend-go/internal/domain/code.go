package domain

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// ============================================================================
// AGGREGATE ROOT: AccessCode
//
// Ini contoh paling penting di proyek ini. Perhatikan:
//
//   • SEMUA field huruf kecil (privat). Tidak ada yang bisa mengubahnya
//     dari luar package — enkapsulasi sungguhan, bukan getter/setter.
//   • Aturan bisnis ("kode hangus setelah 1 pesanan") hidup DI DALAM objek.
//     Handler baru yang lupa mengecek? Tidak mungkin — satu-satunya jalan
//     menambah pemakaian adalah ConsumeOrder(), dan dia memeriksa sendiri.
//   • Bandingkan versi Node: `if ((entry.submissions||0) >= MAX)` ditulis
//     manual di server.js. Itu invariant yang dititipkan ke pemanggil —
//     rapuh, dan persis jenis celah yang kita temukan saat audit.
// ============================================================================

// CodeState — State pattern. Transisi sah:
//
//	Fresh ──IssueToChatbot()──▶ Issued ──Redeem()──▶ Redeemed ──ConsumeOrder()──▶ Spent
//	  └────────────────Redeem()────────────────────────▶
type CodeState string

const (
	StateFresh    CodeState = "fresh"    // baru dibuat, belum dibagikan
	StateIssued   CodeState = "issued"   // sudah masuk pool chatbot / diberikan admin
	StateRedeemed CodeState = "redeemed" // sudah ditukar pembeli, belum memesan
	StateSpent    CodeState = "spent"    // sudah dipakai memesan → mati permanen
)

const (
	codeAlphabet   = "ABCDEFGHJKMNPQRSTUVWXYZ23456789" // tanpa 0/O/1/I/L
	codeBodyLength = 6
)

type CodeID string

func (c CodeID) String() string { return string(c) }

// AccessCode adalah aggregate root.
type AccessCode struct {
	id         CodeID
	state      CodeState
	createdAt  time.Time
	issuedAt   *time.Time
	redeemedAt *time.Time
	ordersUsed int
	maxOrders  int
	lastRef    string
	issuedTo   string // "(batch chatbot)" atau nama pembeli
}

// ---------------------------------------------------------------- Factory

// NewAccessCode — Factory Method. Menjamin kode selalu lahir dalam
// keadaan sah: ID berformat benar, state awal Fresh, maxOrders masuk akal.
func NewAccessCode(prefix string, maxOrders int, now time.Time) (*AccessCode, error) {
	if maxOrders < 1 {
		return nil, ErrInvalidMaxOrders
	}
	body, err := randomCodeBody()
	if err != nil {
		return nil, err
	}
	if prefix == "" {
		prefix = "OSC"
	}
	return &AccessCode{
		id:        CodeID(fmt.Sprintf("%s-%s", strings.ToUpper(prefix), body)),
		state:     StateFresh,
		createdAt: now,
		maxOrders: maxOrders,
	}, nil
}

// RestoreAccessCode dipakai HANYA oleh repository saat memuat dari penyimpanan.
// Dipisah dari NewAccessCode supaya data lama tidak melewati aturan pembuatan.
func RestoreAccessCode(
	id CodeID, state CodeState, createdAt time.Time,
	issuedAt, redeemedAt *time.Time,
	ordersUsed, maxOrders int, lastRef, issuedTo string,
) *AccessCode {
	if maxOrders < 1 {
		maxOrders = 1
	}
	return &AccessCode{
		id: id, state: state, createdAt: createdAt,
		issuedAt: issuedAt, redeemedAt: redeemedAt,
		ordersUsed: ordersUsed, maxOrders: maxOrders,
		lastRef: lastRef, issuedTo: issuedTo,
	}
}

func randomCodeBody() (string, error) {
	var sb strings.Builder
	max := big.NewInt(int64(len(codeAlphabet)))
	for i := 0; i < codeBodyLength; i++ {
		n, err := rand.Int(rand.Reader, max) // crypto/rand, bukan math/rand
		if err != nil {
			return "", err
		}
		sb.WriteByte(codeAlphabet[n.Int64()])
	}
	return sb.String(), nil
}

// -------------------------------------------------------------- Perilaku

// IssueTo menandai kode sudah dibagikan (ke pool chatbot atau pembeli tertentu).
func (c *AccessCode) IssueTo(target string, now time.Time) error {
	if c.state != StateFresh {
		return ErrCodeAlreadyIssued
	}
	c.state = StateIssued
	c.issuedAt = &now
	c.issuedTo = target
	return nil
}

// Redeem menukar kode menjadi sesi premium.
//
// Dua hal yang membuat method ini "pintar":
//   - kode yang SUDAH dipakai memesan langsung ditolak (walau baru 1 detik)
//   - kode yang sudah ditukar tapi BELUM memesan tetap boleh masuk lagi
//     selama masih dalam batas waktu — ini melindungi pembeli yang
//     halamannya ter-refresh saat mengisi alamat.
func (c *AccessCode) Redeem(now time.Time, window time.Duration) (RedeemOutcome, error) {
	if c.IsSpent() {
		return RedeemOutcome{}, ErrCodeSpent
	}

	if c.state == StateRedeemed && c.redeemedAt != nil {
		if now.Sub(*c.redeemedAt) > window {
			return RedeemOutcome{}, ErrCodeExpired
		}
		// masuk lagi — bukan akses baru, jatah pesanan tidak bertambah
		return RedeemOutcome{Code: c.id, Reentry: true, OrdersLeft: c.OrdersLeft()}, nil
	}

	c.state = StateRedeemed
	c.redeemedAt = &now
	return RedeemOutcome{Code: c.id, Reentry: false, OrdersLeft: c.OrdersLeft()}, nil
}

// ConsumeOrder memakai satu jatah pesanan. INI penjaga invariant utamanya.
func (c *AccessCode) ConsumeOrder(ref string, now time.Time) error {
	if c.state != StateRedeemed && c.state != StateSpent {
		return ErrCodeNotRedeemed
	}
	if c.ordersUsed >= c.maxOrders {
		return ErrCodeSpent
	}
	c.ordersUsed++
	c.lastRef = ref
	if c.ordersUsed >= c.maxOrders {
		c.state = StateSpent
	}
	return nil
}

// ------------------------------------------------------------- Pembacaan

func (c *AccessCode) ID() CodeID         { return c.id }
func (c *AccessCode) State() CodeState   { return c.state }
func (c *AccessCode) MaxOrders() int     { return c.maxOrders }
func (c *AccessCode) OrdersUsed() int    { return c.ordersUsed }
func (c *AccessCode) LastRef() string    { return c.lastRef }
func (c *AccessCode) IssuedTo() string   { return c.issuedTo }
func (c *AccessCode) CreatedAt() time.Time { return c.createdAt }
func (c *AccessCode) IssuedAt() *time.Time   { return c.issuedAt }
func (c *AccessCode) RedeemedAt() *time.Time { return c.redeemedAt }

func (c *AccessCode) IsSpent() bool  { return c.ordersUsed >= c.maxOrders }
func (c *AccessCode) OrdersLeft() int {
	left := c.maxOrders - c.ordersUsed
	if left < 0 {
		return 0
	}
	return left
}

// IsAvailableForAdmin: kode yang masih boleh dibagikan lewat tombol /admin.
// Kode milik pool chatbot TIDAK termasuk — inilah aturan yang di versi Node
// harus diingat manual oleh pemanggil.
func (c *AccessCode) IsAvailableForAdmin() bool { return c.state == StateFresh }

// RedeemOutcome — hasil penukaran, dikembalikan ke use case.
type RedeemOutcome struct {
	Code       CodeID
	Reentry    bool
	OrdersLeft int
}
