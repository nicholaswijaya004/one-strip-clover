package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"onestripclover/internal/domain"
)

// ============================================================================
// ADAPTER: token sesi premium bertanda tangan HMAC.
//
// Kenapa ditandatangani, bukan disimpan di memori server:
// token tetap sah setelah server restart/deploy. Pembeli yang sudah bayar
// tidak kehilangan aksesnya hanya karena kamu melakukan deploy.
// ============================================================================

var ErrInvalidToken = errors.New("token tidak sah atau kedaluwarsa")

type HMACService struct {
	secret []byte
	ttl    time.Duration
}

func NewHMACService(secret string, ttl time.Duration) (*HMACService, error) {
	if len(secret) < 16 {
		return nil, errors.New("SESSION_SECRET minimal 16 karakter")
	}
	return &HMACService{secret: []byte(secret), ttl: ttl}, nil
}

type payload struct {
	Code string `json:"code"`
	Exp  int64  `json:"exp"`
}

func (s *HMACService) Issue(code domain.CodeID, now time.Time) (string, error) {
	raw, err := json.Marshal(payload{Code: string(code), Exp: now.Add(s.ttl).UnixMilli()})
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(raw)
	return body + "." + s.sign(body), nil
}

func (s *HMACService) Verify(tok string, now time.Time) (domain.CodeID, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 2 {
		return "", ErrInvalidToken
	}
	// hmac.Equal = perbandingan tahan timing-attack
	if !hmac.Equal([]byte(parts[1]), []byte(s.sign(parts[0]))) {
		return "", ErrInvalidToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", ErrInvalidToken
	}
	var p payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", ErrInvalidToken
	}
	if p.Code == "" || p.Exp < now.UnixMilli() {
		return "", ErrInvalidToken
	}
	return domain.CodeID(p.Code), nil
}

func (s *HMACService) sign(body string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(body))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}
