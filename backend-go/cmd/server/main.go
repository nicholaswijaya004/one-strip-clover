package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"onestripclover/internal/adapter/httpx"
	"onestripclover/internal/adapter/notifier"
	"onestripclover/internal/adapter/repository"
	"onestripclover/internal/adapter/token"
	"onestripclover/internal/usecase"
)

// ============================================================================
// COMPOSITION ROOT
//
// Inilah SATU-SATUNYA tempat di seluruh aplikasi yang tahu implementasi
// konkret mana yang dipakai. Semua file lain hanya bicara lewat interface.
//
// Kenapa ini penting: kalau kamu ingin mengganti penyimpanan JSON dengan
// PostgreSQL, kamu cukup mengubah SATU baris di sini. Domain dan use case
// tidak berubah sebaris pun — dan itu bisa dibuktikan oleh compiler.
//
// Ini juga alasan tidak dipakai framework DI: di Go, "dependency injection"
// cukup berarti "berikan lewat parameter konstruktor".
// ============================================================================

func main() {
	cfg := loadConfig()

	// ---- lapisan paling luar: adapter ----
	logger := newStdLogger()

	repo := repository.NewJSONFile(cfg.CodesPath)
	// ↑ ganti baris ini dengan repository.NewPostgres(db) dan selesai.

	tokens, err := token.NewHMACService(cfg.SessionSecret, cfg.SessionTTL)
	if err != nil {
		log.Fatalf("konfigurasi token: %v", err)
	}

	// Strategy + Composite + Null Object bekerja sama di sini:
	// daftar pengirim dirakit sesuai konfigurasi yang tersedia.
	var channels []usecase.Notifier
	if cfg.SMTPHost != "" {
		channels = append(channels, notifier.NewEmail(notifier.SMTPConfig{
			Host: cfg.SMTPHost, Port: cfg.SMTPPort,
			Username: cfg.SMTPUser, Password: cfg.SMTPPass,
			From: cfg.SMTPFrom, StudioEmail: cfg.StudioEmail,
			AttachRaw: cfg.AttachRaw, Location: cfg.Location,
		}, notifier.NewSMTPSender()))
	} else {
		// Null Object: tidak ada percabangan `if email != nil` di use case
		channels = append(channels, notifier.NewNoop("email"))
		logger.Warn("config.no_email", map[string]any{
			"hint": "SMTP_HOST kosong — pesanan tidak akan terkirim",
		})
	}
	if cfg.DriveEnabled {
		channels = append(channels, notifier.NewDrive(cfg.DriveFolderID))
	} else {
		channels = append(channels, notifier.NewNoop("drive"))
	}
	deliver := notifier.NewComposite(channels...)

	locks := newMemoryLocks()
	clock := usecase.RealClock{}

	// ---- lapisan aplikasi: use case ----
	redeemUC := usecase.NewRedeemCode(repo, tokens, clock, logger, cfg.RedeemWindow)
	submitUC := usecase.NewSubmitOrder(repo, tokens, deliver, locks, clock, logger)

	// ---- lapisan transport: HTTP ----
	h := httpx.NewHandler(redeemUC, submitUC, logger)

	publicRL := httpx.NewRateLimiter(15*time.Minute, 12)
	uploadRL := httpx.NewRateLimiter(time.Hour, 10)
	adminRL := httpx.NewRateLimiter(15*time.Minute, 60)

	mux := http.NewServeMux()

	// Perhatikan cara keamanan dipasang: di ROUTER, bukan di dalam handler.
	// Handler tidak bisa "lupa" memeriksa admin key atau rate limit.
	mux.Handle("POST /api/redeem", httpx.Chain(
		http.HandlerFunc(h.Redeem),
		httpx.BodyLimit(16*1024), // 16 KB — cegah DoS lewat body raksasa
		httpx.RateLimit(publicRL, "redeem"),
	))

	mux.Handle("POST /api/orders", httpx.Chain(
		http.HandlerFunc(h.SubmitOrder),
		httpx.BodyLimit(25*1024*1024), // 25 MB hanya di rute foto
		httpx.RateLimit(uploadRL, "upload"),
	))

	mux.Handle("POST /api/admin/stats", httpx.Chain(
		http.HandlerFunc(h.AdminStats),
		httpx.BodyLimit(16*1024),
		httpx.RateLimit(adminRL, "admin"),
		httpx.RequireAdmin(cfg.AdminKey), // satu baris = rute jadi terlindungi
	))

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	root := httpx.Chain(mux, httpx.SecurityHeaders(), httpx.Logging(logger))

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           root,
		ReadHeaderTimeout: 10 * time.Second, // cegah serangan Slowloris
		ReadTimeout:       3 * time.Minute,  // unggah foto bisa lama
		WriteTimeout:      3 * time.Minute,
		IdleTimeout:       2 * time.Minute,
	}

	go func() {
		logger.Info("server.start", map[string]any{"port": cfg.Port})
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server berhenti: %v", err)
		}
	}()

	// Mati dengan rapi: pesanan yang sedang diproses diberi waktu selesai.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	logger.Info("server.shutdown", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("server.shutdown_error", map[string]any{"err": err.Error()})
	}
}

// -------------------------------------------------------------- konfigurasi

type config struct {
	Port          string
	CodesPath     string
	SessionSecret string
	SessionTTL    time.Duration
	RedeemWindow  time.Duration
	AdminKey      string
	SMTPHost      string
	SMTPPort      int
	SMTPUser      string
	SMTPPass      string
	SMTPFrom      string
	StudioEmail   string
	AttachRaw     bool
	DriveEnabled  bool
	DriveFolderID string
	Location      *time.Location
}

func loadConfig() config {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		loc = time.FixedZone("WIB", 7*3600)
	}
	return config{
		Port:          env("PORT", "3000"),
		CodesPath:     env("CODES_PATH", "data/codes.json"),
		SessionSecret: env("SESSION_SECRET", ""),
		SessionTTL:    hours("SESSION_HOURS", 3),
		RedeemWindow:  hours("REDEEM_GRACE_HOURS", 3),
		AdminKey:      env("ADMIN_KEY", ""),
		SMTPHost:      env("SMTP_HOST", ""),
		SMTPPort:      atoi(env("SMTP_PORT", "587"), 587),
		SMTPUser:      env("SMTP_USER", ""),
		SMTPPass:      env("SMTP_PASS", ""),
		SMTPFrom:      env("SMTP_FROM", ""),
		StudioEmail:   env("STUDIO_EMAIL", ""),
		AttachRaw:     env("ATTACH_RAW_PHOTOS", "true") != "false",
		DriveEnabled:  env("GOOGLE_REFRESH_TOKEN", "") != "" && env("DRIVE_FOLDER_ID", "") != "",
		DriveFolderID: env("DRIVE_FOLDER_ID", ""),
		Location:      loc,
	}
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func atoi(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

func hours(k string, def float64) time.Duration {
	if v := os.Getenv(k); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return time.Duration(f * float64(time.Hour))
		}
	}
	return time.Duration(def * float64(time.Hour))
}

// ------------------------------------------------------------- util kecil

type memoryLocks struct {
	mu   sync.Mutex
	held map[string]time.Time
}

func newMemoryLocks() *memoryLocks {
	return &memoryLocks{held: map[string]time.Time{}}
}

func (l *memoryLocks) Acquire(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if t, ok := l.held[key]; ok && time.Since(t) < 2*time.Minute {
		return false
	}
	l.held[key] = time.Now()
	return true
}

func (l *memoryLocks) Release(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.held, key)
}

type stdLogger struct{ l *log.Logger }

func newStdLogger() *stdLogger {
	return &stdLogger{l: log.New(os.Stdout, "", log.LstdFlags)}
}

func (s *stdLogger) Info(e string, f map[string]any)  { s.l.Printf("INFO  %s %v", e, f) }
func (s *stdLogger) Warn(e string, f map[string]any)  { s.l.Printf("WARN  %s %v", e, f) }
func (s *stdLogger) Error(e string, f map[string]any) { s.l.Printf("ERROR %s %v", e, f) }
