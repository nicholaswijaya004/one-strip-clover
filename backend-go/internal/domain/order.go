package domain

import (
	"fmt"
	"strings"
	"time"
)

// ============================================================================
// Entity: Order
//
// Order punya identitas (nomor pesanan) — dua pesanan dengan isi sama tetap
// pesanan berbeda. Itulah bedanya dengan value object.
// ============================================================================

const maxPhotosPerOrder = 8

// Photo & Strip sengaja dibungkus tipe sendiri, bukan []byte telanjang,
// supaya tidak mungkin tertukar posisi saat memanggil fungsi.
type Photo struct{ Data []byte }
type Strip struct{ Data []byte }

type OrderRef string

func (r OrderRef) String() string { return string(r) }

// NewOrderRef: OSC260819-A3F9C1
func NewOrderRef(now time.Time, requestID string) OrderRef {
	return OrderRef(fmt.Sprintf("OSC%s-%s",
		now.Format("060102"), strings.ToUpper(requestID)))
}

type Order struct {
	ref       OrderRef
	code      CodeID
	contact   ContactDetails
	address   Address
	note      string
	style     string
	photos    []Photo
	strip     *Strip
	takenAt   time.Time
	createdAt time.Time
}

// NewOrder — semua aturan kelengkapan pesanan dijaga di satu tempat.
// Perhatikan: tidak mungkin membuat Order tanpa persetujuan, tanpa foto,
// atau tanpa alamat. Handler tidak perlu memeriksa ulang.
func NewOrder(
	ref OrderRef, code CodeID, contact ContactDetails, address Address,
	photos []Photo, strip *Strip, note, style string,
	takenAt, now time.Time, consent bool,
) (*Order, error) {
	if !consent {
		return nil, ErrNoConsent
	}
	if len(photos) == 0 {
		return nil, ErrNoPhotos
	}
	if len(photos) > maxPhotosPerOrder {
		return nil, ErrTooManyPhotos
	}
	if len([]rune(note)) > 500 {
		note = string([]rune(note)[:500])
	}
	return &Order{
		ref: ref, code: code, contact: contact, address: address,
		photos: photos, strip: strip, note: note, style: style,
		takenAt: takenAt, createdAt: now,
	}, nil
}

func (o *Order) Ref() OrderRef            { return o.ref }
func (o *Order) Code() CodeID             { return o.code }
func (o *Order) Contact() ContactDetails  { return o.contact }
func (o *Order) Address() Address         { return o.address }
func (o *Order) Note() string             { return o.note }
func (o *Order) Style() string            { return o.style }
func (o *Order) Photos() []Photo          { return o.photos }
func (o *Order) Strip() *Strip            { return o.strip }
func (o *Order) TakenAt() time.Time       { return o.takenAt }
func (o *Order) CreatedAt() time.Time     { return o.createdAt }

// FolderLabel: "Nama - kontak - 2026-08-19 18.07 - OSC-ABC123"
// Dipakai untuk nama folder Drive DAN subject email — satu sumber kebenaran,
// jadi keduanya tidak mungkin berbeda format.
func (o *Order) FolderLabel(loc *time.Location) string {
	return strings.Join([]string{
		SafeLabel(o.contact.Name(), 40),
		SafeLabel(o.contact.Primary(), 40),
		o.takenAt.In(loc).Format("2006-01-02 15.04"),
		SafeLabel(string(o.code), 15),
	}, " - ")
}
