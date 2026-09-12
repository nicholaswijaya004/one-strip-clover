package usecase

import (
	"context"
	"errors"
	"strings"
	"time"

	"onestripclover/internal/domain"
)

// ============================================================================
// USE CASE: menukar kode akses.
//
// Perhatikan apa yang TIDAK ada di sini:
//   • tidak ada HTTP (tidak tahu status 409 itu apa)
//   • tidak ada fs/JSON (tidak tahu data disimpan di mana)
//   • tidak ada time.Now() langsung (pakai Clock supaya bisa diuji)
//
// Use case hanya mengurus ALUR. Aturannya sendiri ada di domain.AccessCode.
// ============================================================================

type RedeemCodeInput struct {
	RawCode string
}

type RedeemCodeOutput struct {
	Token      string
	Code       domain.CodeID
	Reentry    bool // true = memulihkan sesi, bukan akses baru
	OrdersLeft int
	ExpiresIn  time.Duration
}

type RedeemCode struct {
	repo   CodeRepository
	tokens TokenService
	clock  Clock
	log    Logger
	window time.Duration // batas waktu masuk lagi sebelum memesan
}

// Constructor injection — semua ketergantungan diberikan dari luar.
// Inilah yang membuat use case ini bisa diuji tanpa disk, tanpa jaringan.
func NewRedeemCode(
	repo CodeRepository, tokens TokenService, clock Clock,
	log Logger, window time.Duration,
) *RedeemCode {
	return &RedeemCode{repo: repo, tokens: tokens, clock: clock, log: log, window: window}
}

func (uc *RedeemCode) Execute(ctx context.Context, in RedeemCodeInput) (RedeemCodeOutput, error) {
	id := domain.CodeID(strings.ToUpper(strings.TrimSpace(in.RawCode)))
	if id == "" {
		return RedeemCodeOutput{}, domain.ErrCodeNotFound
	}

	now := uc.clock.Now()
	var outcome domain.RedeemOutcome

	// Transact = baca-ubah-simpan secara eksklusif. Dua permintaan untuk kode
	// yang sama dijalankan berurutan, tidak mungkin saling menimpa.
	err := uc.repo.Transact(ctx, id, func(code *domain.AccessCode) error {
		var err error
		outcome, err = code.Redeem(now, uc.window) // aturan dijaga di domain
		return err
	})
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrCodeSpent):
			uc.log.Warn("redeem.spent", map[string]any{"code": id})
		case errors.Is(err, domain.ErrCodeExpired):
			uc.log.Warn("redeem.expired", map[string]any{"code": id})
		case errors.Is(err, domain.ErrCodeNotFound):
			uc.log.Warn("redeem.invalid", map[string]any{"code": id})
		}
		return RedeemCodeOutput{}, err
	}

	token, err := uc.tokens.Issue(id, now)
	if err != nil {
		return RedeemCodeOutput{}, err
	}

	uc.log.Info("redeem.ok", map[string]any{"code": id, "reentry": outcome.Reentry})
	return RedeemCodeOutput{
		Token: token, Code: id, Reentry: outcome.Reentry,
		OrdersLeft: outcome.OrdersLeft, ExpiresIn: uc.window,
	}, nil
}
