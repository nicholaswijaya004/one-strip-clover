package domain

import "errors"

// ============================================================================
// Sentinel error domain.
//
// Kenapa error didefinisikan di domain, bukan di HTTP handler:
// domain tahu APA yang salah ("kode sudah hangus"), sedangkan HTTP hanya
// menerjemahkannya jadi angka status (409). Kalau nanti ada antarmuka lain
// (gRPC, CLI, job terjadwal), aturan errornya tidak perlu ditulis ulang.
//
// Pemanggil memeriksa dengan errors.Is(err, domain.ErrCodeSpent) — bukan
// membandingkan string pesan, yang gampang rusak saat kalimatnya diubah.
// ============================================================================

var (
	// Kode akses
	ErrCodeNotFound      = errors.New("kode tidak ditemukan")
	ErrCodeSpent         = errors.New("kode sudah dipakai memesan")
	ErrCodeExpired       = errors.New("kode sudah lewat batas waktu")
	ErrCodeAlreadyIssued = errors.New("kode sudah pernah dibagikan")
	ErrCodeNotRedeemed   = errors.New("kode belum ditukar")
	ErrInvalidMaxOrders  = errors.New("batas pesanan minimal 1")
	ErrOutOfStock        = errors.New("stok kode habis")

	// Value object
	ErrEmptyName       = errors.New("nama wajib diisi")
	ErrEmptyEmail      = errors.New("email kosong")
	ErrInvalidEmail    = errors.New("format email tidak valid")
	ErrEmptyPhone      = errors.New("nomor kosong")
	ErrInvalidPhone    = errors.New("format nomor tidak valid")
	ErrNoContact       = errors.New("isi email atau nomor WhatsApp")
	ErrAddressTooShort = errors.New("alamat terlalu pendek")
	ErrTooLong         = errors.New("input terlalu panjang")

	// Pesanan
	ErrNoPhotos      = errors.New("tidak ada foto")
	ErrTooManyPhotos = errors.New("foto terlalu banyak")
	ErrNoConsent     = errors.New("persetujuan belum dicentang")
	ErrDeliveryFailed = errors.New("pengiriman ke studio gagal")
	ErrAlreadyProcessing = errors.New("pesanan untuk kode ini sedang diproses")
)
