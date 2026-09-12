package httpx

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"sync"
	"time"

	"onestripclover/internal/usecase"
)

// ============================================================================
// DECORATOR PATTERN (di Go dikenal sebagai middleware)
//
// Setiap middleware MEMBUNGKUS http.Handler dan mengembalikan http.Handler
// lagi — tipe yang sama. Karena itu bisa ditumpuk sesuka hati tanpa handler
// aslinya tahu apa-apa:
//
//     Chain(handler, Logging(log), RateLimit(...), RequireAdmin(key))
//
// Bandingkan versi Node: handler harus memanggil adminOk(req) sendiri.
// Handler baru yang lupa memanggilnya = celah keamanan (ini benar-benar
// terjadi: /api/admin/stats sempat tanpa rate limit).
// Dengan decorator, keamanan dipasang di router, bukan dititipkan ke handler.
// ============================================================================

type Middleware func(http.Handler) http.Handler

// Chain menerapkan middleware dari kanan ke kiri (yang terakhir membungkus paling luar).
func Chain(h http.Handler, mw ...Middleware) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}

// ------------------------------------------------------------ SecurityHeaders

func SecurityHeaders() Middleware {
	csp := strings.Join([]string{
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"font-src 'self' https://fonts.gstatic.com",
		"img-src 'self' data: blob:",
		"connect-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
	}, "; ")

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "same-origin")
			h.Set("Permissions-Policy", "camera=(self), geolocation=(), microphone=()")
			h.Set("Content-Security-Policy", csp)
			if r.Header.Get("X-Forwarded-Proto") == "https" || r.TLS != nil {
				h.Set("Strict-Transport-Security", "max-age=15552000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ------------------------------------------------------------------ Logging

func Logging(log usecase.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: 200}
			next.ServeHTTP(rec, r)

			f := map[string]any{
				"method": r.Method, "path": r.URL.Path,
				"status": rec.status, "ms": time.Since(start).Milliseconds(),
			}
			switch {
			case rec.status >= 500:
				log.Error("api.fail", f)
			case rec.status >= 400:
				log.Warn("api.reject", f)
			default:
				log.Info("api.ok", f)
			}
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// ---------------------------------------------------------------- RateLimit

type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	window  time.Duration
	max     int
}

type bucket struct {
	count int
	reset time.Time
}

func NewRateLimiter(window time.Duration, max int) *RateLimiter {
	rl := &RateLimiter{buckets: map[string]*bucket{}, window: window, max: max}
	go rl.sweepLoop()
	return rl
}

func (rl *RateLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok || now.After(b.reset) {
		rl.buckets[key] = &bucket{count: 1, reset: now.Add(rl.window)}
		return true, 0
	}
	if b.count >= rl.max {
		return false, time.Until(b.reset)
	}
	b.count++
	return true, 0
}

func (rl *RateLimiter) sweepLoop() {
	for range time.Tick(10 * time.Minute) {
		rl.mu.Lock()
		now := time.Now()
		for k, b := range rl.buckets {
			if now.After(b.reset) {
				delete(rl.buckets, k)
			}
		}
		rl.mu.Unlock()
	}
}

func RateLimit(rl *RateLimiter, name string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ok, wait := rl.allow(name+":"+clientIP(r), time.Now())
			if !ok {
				w.Header().Set("Retry-After", formatSeconds(wait))
				writeJSON(w, http.StatusTooManyRequests,
					errorBody("TOO_MANY_REQUESTS", "terlalu banyak percobaan"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// -------------------------------------------------------------- RequireAdmin

func RequireAdmin(key string) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			given := r.Header.Get("X-Admin-Key")
			// subtle.ConstantTimeCompare = tahan timing-attack.
			// `given == key` biasa akan membocorkan panjang kecocokan.
			if key == "" || subtle.ConstantTimeCompare([]byte(given), []byte(key)) != 1 {
				writeJSON(w, http.StatusUnauthorized,
					errorBody("UNAUTHORIZED", "kunci admin salah"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ------------------------------------------------------------- BodyLimit

// BodyLimit membatasi ukuran body PER RUTE. Di versi Node, batas 25 MB
// sempat berlaku global — siapa pun bisa mengirim 25 MB ke /api/redeem
// berulang kali sampai memori server habis.
func BodyLimit(maxBytes int64) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

func clientIP(r *http.Request) string {
	if f := r.Header.Get("X-Forwarded-For"); f != "" {
		if i := strings.IndexByte(f, ','); i > 0 {
			return strings.TrimSpace(f[:i])
		}
		return strings.TrimSpace(f)
	}
	if i := strings.LastIndexByte(r.RemoteAddr, ':'); i > 0 {
		return r.RemoteAddr[:i]
	}
	return r.RemoteAddr
}

func formatSeconds(d time.Duration) string {
	s := int(d.Seconds())
	if s < 1 {
		s = 1
	}
	return itoa(s)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [12]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
