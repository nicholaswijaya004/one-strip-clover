package usecase

import (
	"context"
	"fmt"
	"time"

	"onestripclover/internal/domain"
)

// ============================================================================
// USE CASE: mengirim pesanan ke studio.
//
// Alurnya:
//   1. verifikasi token premium
//   2. kunci kode (cegah dua pesanan bersamaan)
//   3. bentuk objek Order (semua validasi terjadi di domain)
//   4. kirim lewat Notifier (email/Drive — use case tidak peduli yang mana)
//   5. baru setelah BERHASIL, potong jatah kode
//
// Urutan langkah 4 dan 5 disengaja: jatah tidak boleh terpotong kalau
// pengirimannya gagal. Pembeli tidak boleh rugi karena SMTP-mu bermasalah.
// ============================================================================

type SubmitOrderInput struct {
	Token     string
	Name      string
	Email     string
	Phone     string
	Address   string
	Note      string
	Style     string
	Consent   bool
	Photos    [][]byte
	Strip     []byte
	TakenAt   time.Time
	RequestID string
}

type SubmitOrderOutput struct {
	Ref        domain.OrderRef
	Channels   []string // channel yang berhasil, mis. ["email","drive"]
	OrdersLeft int
}

type SubmitOrder struct {
	repo     CodeRepository
	tokens   TokenService
	notifier Notifier // biasanya CompositeNotifier (email + drive)
	locks    OrderLock
	clock    Clock
	log      Logger
}

func NewSubmitOrder(
	repo CodeRepository, tokens TokenService, notifier Notifier,
	locks OrderLock, clock Clock, log Logger,
) *SubmitOrder {
	return &SubmitOrder{repo: repo, tokens: tokens, notifier: notifier,
		locks: locks, clock: clock, log: log}
}

func (uc *SubmitOrder) Execute(ctx context.Context, in SubmitOrderInput) (SubmitOrderOutput, error) {
	now := uc.clock.Now()

	// 1. Token premium — dicek di server, tidak bisa diakali dari browser
	codeID, err := uc.tokens.Verify(in.Token, now)
	if err != nil {
		return SubmitOrderOutput{}, err
	}

	// 2. Kunci per kode
	if !uc.locks.Acquire(string(codeID)) {
		return SubmitOrderOutput{}, domain.ErrAlreadyProcessing
	}
	defer uc.locks.Release(string(codeID))

	// Cek jatah lebih dulu supaya foto besar tidak diproses percuma
	code, err := uc.repo.FindByID(ctx, codeID)
	if err != nil {
		return SubmitOrderOutput{}, err
	}
	if code.IsSpent() {
		return SubmitOrderOutput{}, domain.ErrCodeSpent
	}

	// 3. Bentuk objek domain — semua validasi terjadi di konstruktor
	contact, err := domain.NewContactDetails(in.Name, in.Email, in.Phone)
	if err != nil {
		return SubmitOrderOutput{}, err
	}
	address, err := domain.NewAddress(in.Address)
	if err != nil {
		return SubmitOrderOutput{}, err
	}

	photos := make([]domain.Photo, 0, len(in.Photos))
	for _, p := range in.Photos {
		photos = append(photos, domain.Photo{Data: p})
	}
	var strip *domain.Strip
	if len(in.Strip) > 0 {
		strip = &domain.Strip{Data: in.Strip}
	}

	ref := domain.NewOrderRef(now, in.RequestID)
	order, err := domain.NewOrder(ref, codeID, contact, address, photos, strip,
		in.Note, in.Style, in.TakenAt, now, in.Consent)
	if err != nil {
		return SubmitOrderOutput{}, err
	}

	// 4. Kirim. Composite akan mencoba email & Drive bersamaan.
	if err := uc.notifier.Notify(ctx, order); err != nil {
		uc.log.Error("delivery.failed", map[string]any{"ref": ref, "err": err.Error()})
		return SubmitOrderOutput{}, fmt.Errorf("%w: %v", domain.ErrDeliveryFailed, err)
	}

	// 5. Baru sekarang jatah dipotong — setelah benar-benar terkirim
	var sisa int
	err = uc.repo.Transact(ctx, codeID, func(c *domain.AccessCode) error {
		if err := c.ConsumeOrder(string(ref), now); err != nil {
			return err
		}
		sisa = c.OrdersLeft()
		return nil
	})
	if err != nil {
		// Sudah terkirim tapi gagal dicatat: jangan gagalkan pembeli,
		// cukup catat keras supaya kamu bisa memperbaiki manual.
		uc.log.Error("order.consume_failed", map[string]any{
			"ref": ref, "code": codeID, "err": err.Error(),
		})
	}

	uc.log.Info("order.submitted", map[string]any{
		"ref": ref, "code": codeID, "ordersLeft": sisa,
	})
	return SubmitOrderOutput{Ref: ref, Channels: []string{uc.notifier.Name()}, OrdersLeft: sisa}, nil
}
