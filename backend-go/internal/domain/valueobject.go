package domain

import (
	"regexp"
	"strings"
)

// ============================================================================
// VALUE OBJECT
//
// Ciri value object:
//   1. Tidak punya identitas — dibandingkan dari ISINYA
//   2. Immutable — tidak ada setter; kalau perlu berubah, buat objek baru
//   3. SELALU valid — validasi terjadi di konstruktor, bukan di pemanggil
//
// Manfaat nyata: kalau sebuah fungsi menerima parameter bertipe Email,
// fungsi itu TIDAK PERLU memvalidasi lagi. Mustahil ada Email tidak valid.
// Bandingkan dengan Node yang memakai `string` di mana-mana lalu memvalidasi
// ulang di frontend, di server, dan di lib/format.js.
// ============================================================================

var (
	emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	phoneRe = regexp.MustCompile(`^[0-9+()\-\s]{8,20}$`)
	// Karakter yang merusak nama file/folder dan header email
	unsafeRe = regexp.MustCompile(`[\\/:*?"<>|\r\n\t]`)
)

// ---------------------------------------------------------------- Email

type Email struct {
	value string
}

// NewEmail adalah satu-satunya jalan membuat Email — inilah kuncinya.
func NewEmail(raw string) (Email, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return Email{}, ErrEmptyEmail
	}
	if len(v) > 120 {
		return Email{}, ErrTooLong
	}
	if !emailRe.MatchString(v) {
		return Email{}, ErrInvalidEmail
	}
	return Email{value: strings.ToLower(v)}, nil
}

func (e Email) String() string { return e.value }
func (e Email) IsZero() bool   { return e.value == "" }

// ---------------------------------------------------------- PhoneNumber

type PhoneNumber struct {
	value string
}

func NewPhoneNumber(raw string) (PhoneNumber, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return PhoneNumber{}, ErrEmptyPhone
	}
	if !phoneRe.MatchString(v) {
		return PhoneNumber{}, ErrInvalidPhone
	}
	return PhoneNumber{value: v}, nil
}

func (p PhoneNumber) String() string { return p.value }
func (p PhoneNumber) IsZero() bool   { return p.value == "" }

// -------------------------------------------------------------- Address

type Address struct {
	value string
}

// Alamat kirim harus cukup lengkap untuk dipakai kurir.
func NewAddress(raw string) (Address, error) {
	v := strings.TrimSpace(raw)
	if len([]rune(v)) < 12 {
		return Address{}, ErrAddressTooShort
	}
	if len([]rune(v)) > 400 {
		return Address{}, ErrTooLong
	}
	return Address{value: v}, nil
}

func (a Address) String() string { return a.value }

// OneLine dipakai untuk nama folder & subject email.
func (a Address) OneLine() string {
	return strings.Join(strings.Fields(a.value), " ")
}

// ------------------------------------------------------- ContactDetails

// ContactDetails membungkus aturan "email ATAU WhatsApp, minimal satu".
// Aturannya hidup di sini, bukan tersebar di handler.
type ContactDetails struct {
	name  string
	email Email
	phone PhoneNumber
}

func NewContactDetails(name, email, phone string) (ContactDetails, error) {
	n := strings.TrimSpace(name)
	if n == "" {
		return ContactDetails{}, ErrEmptyName
	}
	if len([]rune(n)) > 80 {
		return ContactDetails{}, ErrTooLong
	}

	var c ContactDetails
	c.name = n

	if strings.TrimSpace(email) != "" {
		e, err := NewEmail(email)
		if err != nil {
			return ContactDetails{}, err
		}
		c.email = e
	}
	if strings.TrimSpace(phone) != "" {
		p, err := NewPhoneNumber(phone)
		if err != nil {
			return ContactDetails{}, err
		}
		c.phone = p
	}

	if c.email.IsZero() && c.phone.IsZero() {
		return ContactDetails{}, ErrNoContact
	}
	return c, nil
}

func (c ContactDetails) Name() string       { return c.name }
func (c ContactDetails) Email() Email       { return c.email }
func (c ContactDetails) Phone() PhoneNumber { return c.phone }

// Primary mengembalikan kontak utama: email diutamakan, jatuh ke WhatsApp.
func (c ContactDetails) Primary() string {
	if !c.email.IsZero() {
		return c.email.String()
	}
	return c.phone.String()
}

// ------------------------------------------------------------ SafeLabel

// SafeLabel membersihkan teks agar aman jadi nama folder / subject email.
// Ini menutup dua celah sekaligus: path traversal dan email header injection.
func SafeLabel(s string, max int) string {
	out := unsafeRe.ReplaceAllString(s, " ")
	out = strings.Join(strings.Fields(out), " ")
	if max > 0 && len([]rune(out)) > max {
		out = string([]rune(out)[:max])
	}
	return strings.TrimSpace(out)
}
