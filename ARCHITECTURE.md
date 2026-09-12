# 🏛️ ARSITEKTUR & DESIGN PATTERN — One Strip Clover (versi belajar)

Dokumen ini memakai **domain nyata** (photobox + kode akses) untuk menjelaskan
OOAD dan design pattern. Setiap konsep ditunjukkan pada masalah yang benar-benar
ada di proyek ini, bukan contoh `Animal`/`Dog`/`Cat`.

> ⚠️ Proyek Node yang sekarang **tetap jadi sistem produksi**. Folder
> `backend-go/` dan `frontend-react/` adalah proyek belajar paralel.

---

# BAGIAN 1 — OOAD: dari cerita ke kelas

## 1.1 Analisis: temukan kata benda & kata kerja

Ambil deskripsi bisnisnya:

> "Pembeli **membeli kode** di marketplace. Dia **menukarkan kode** di website,
> lalu **mengambil 4 foto**, memilih **bingkai**, dan **mengirim pesanan** ke
> studio. Studio **mencetak strip** dan **mengirimkannya** ke alamat pembeli.
> Satu kode hanya untuk satu pesanan."

**Kata benda → kandidat entitas / value object:**

| Kata benda | Jadi apa | Alasan |
|---|---|---|
| Kode akses | **Entity** | Punya identitas & siklus hidup (dibuat → dibagikan → ditukar → hangus) |
| Pesanan | **Entity** | Punya identitas (nomor pesanan) dan berubah status |
| Alamat, Email, No. WA | **Value Object** | Tidak punya identitas; dua alamat sama isi = sama. Selalu valid sejak dibuat |
| Bingkai, Filter | **Value Object** | Hanya nilai/pilihan |
| Foto, Strip | **Value Object** | Data, dibandingkan dari isinya |
| Studio | **Aktor eksternal** | Di luar sistem — kita hanya mengirim notifikasi |

**Kata kerja → use case (bukan method di entitas!):**

- `RedeemCode` — menukar kode
- `SubmitOrder` — mengirim pesanan ke studio
- `IssueCode` — admin membagikan kode
- `GenerateCodeBatch` — membuat batch kode

## 1.2 Entity vs Value Object — bedanya penting

```
Entity          : identitas > isi.  Kode "OSC-ABC123" tetap kode yang sama
                  walau statusnya berubah dari belum-dipakai jadi hangus.
Value Object    : isi > identitas. Email "a@b.com" == Email "a@b.com".
                  Tidak bisa diubah (immutable). Kalau berubah, buat baru.
```

Manfaat nyatanya: dengan `Email` sebagai value object yang **memvalidasi di
konstruktor**, mustahil ada objek `Email` tidak valid beredar di sistem.
Validasi tidak lagi tersebar di 5 tempat seperti di versi Node.

```go
// Tidak mungkin membuat Email yang tidak valid — itu inti value object.
email, err := domain.NewEmail("bukan-email")   // err != nil, objek tidak jadi
```

## 1.3 Aggregate & invariant

**Aggregate** = sekelompok objek dengan satu "pintu masuk" (aggregate root)
yang menjaga aturan (invariant).

Di sini `AccessCode` adalah aggregate root dengan invariant:

> "Sebuah kode tidak boleh dipakai memesan lebih dari `maxOrders` kali."

Aturan ini **hanya boleh** dilanggar/diubah lewat method di `AccessCode`.
Tidak ada kode lain yang boleh menyentuh field `ordersUsed` langsung.
Inilah **enkapsulasi** yang sesungguhnya — bukan sekadar membuat getter/setter.

Di versi Node, aturan ini tercecer di `server.js` (cek `submissions >= MAX`).
Kalau suatu hari ada endpoint baru yang lupa mengecek → jebol. Di versi Go,
lupa mengecek itu tidak mungkin, karena satu-satunya jalan menambah pemakaian
adalah `code.ConsumeOrder()` yang memeriksa sendiri.

## 1.4 Layering (Hexagonal / Ports & Adapters)

```
        ┌─────────────────────────────────────────┐
        │  ADAPTER (HTTP, JSON file, SMTP, Drive) │  ← detail teknis, gampang diganti
        │   ┌─────────────────────────────────┐   │
        │   │  USE CASE (orkestrasi)          │   │  ← alur aplikasi
        │   │   ┌─────────────────────────┐   │   │
        │   │   │  DOMAIN (aturan bisnis) │   │   │  ← murni, tanpa import apa pun
        │   │   └─────────────────────────┘   │   │
        │   └─────────────────────────────────┘   │
        └─────────────────────────────────────────┘
              Arah ketergantungan: dari LUAR ke DALAM
```

**Aturan emas:** domain **tidak boleh** mengimpor HTTP, database, SMTP.
Cek cepat: kalau `internal/domain/` mengimpor `net/http`, arsitekturnya bocor.

Kenapa ini berguna di proyekmu: mengganti penyimpanan dari file JSON ke
PostgreSQL berarti menulis satu adapter baru — domain dan use case **tidak
berubah sebaris pun**. Bandingkan dengan `server.js` sekarang, di mana
`fs.readFileSync` menempel langsung di dalam logika bisnis.

---

# BAGIAN 2 — Design pattern yang dipakai & alasannya

Pattern dipakai **karena ada masalah**, bukan karena ingin terlihat canggih.
Tabel ini menunjukkan masalah nyata di proyekmu → pattern yang menjawabnya.

| # | Pattern | Masalah nyata di proyek ini | Ada di file |
|---|---|---|---|
| 1 | **Repository** | Logika bisnis tercampur `fs.readFileSync` | `usecase/ports.go`, `adapter/repository/` |
| 2 | **Strategy** | Kirim via email? Drive? Keduanya? | `usecase/ports.go` (`Notifier`) |
| 3 | **Composite** | Email + Drive harus jalan bersamaan, satu gagal tak membatalkan yang lain | `adapter/notifier/composite.go` |
| 4 | **Null Object** | Drive belum dikonfigurasi → `if drive != nil` bertebaran | `adapter/notifier/noop.go` |
| 5 | **State** | Kode punya 4 status dengan transisi ketat | `domain/code.go` |
| 6 | **Factory Method** | Pembuatan kode harus selalu unik & format benar | `domain/code.go` (`NewCodeBatch`) |
| 7 | **Decorator / Middleware** | Log, rate limit, auth tanpa mengotori handler | `adapter/http/middleware.go` |
| 8 | **Dependency Injection** | Supaya bisa diuji tanpa SMTP/disk sungguhan | `cmd/server/main.go` |
| 9 | **Value Object** | Validasi email/WA/alamat tersebar | `domain/valueobject.go` |
| 10 | **Adapter** | `localStorage`/`fetch` menempel di komponen React | `frontend-react/src/services/` |
| 11 | **Facade** | Komponen React tahu terlalu banyak detail API | `frontend-react/src/services/api.ts` |
| 12 | **Observer** | Perubahan status sesi harus terlihat di banyak komponen | React Context + `useSyncExternalStore` |

## 2.1 Repository — contoh paling jelas

**Sebelum (Node sekarang):**
```js
// Logika bisnis DAN cara penyimpanan bercampur
const codes = JSON.parse(fs.readFileSync(CODES_FILE));
if (codes[raw].used) return res.status(409)...
```
Untuk mengujinya, kamu butuh file sungguhan di disk.

**Sesudah (Go):**
```go
type CodeRepository interface {
    FindByID(ctx context.Context, id domain.CodeID) (*domain.AccessCode, error)
    Save(ctx context.Context, code *domain.AccessCode) error
    Transact(ctx context.Context, id domain.CodeID, fn func(*domain.AccessCode) error) error
}
```
Use case cuma tahu **interface** ini. Saat uji, pasang `InMemoryCodeRepo`;
saat produksi, pasang `JSONFileCodeRepo` atau nanti `PostgresCodeRepo`.
Tidak ada file, tidak ada mock rumit.

> `Transact` sengaja ada di interface — pelajaran dari bug balapan data yang
> kita temukan di audit. Penguncian adalah **tanggung jawab penyimpanan**,
> dan use case tidak boleh perlu tahu caranya.

## 2.2 Strategy + Composite + Null Object — trio pengiriman

Masalahnya: pesanan harus dikirim ke email **dan** Drive; Drive opsional;
satu gagal tidak boleh membatalkan yang lain.

```go
type Notifier interface {
    Notify(ctx context.Context, o domain.Order) error
    Name() string
}
```

- **Strategy**: `EmailNotifier` dan `DriveNotifier` sama-sama `Notifier`,
  cara kerjanya beda total.
- **Composite**: `CompositeNotifier` juga sebuah `Notifier` yang berisi
  banyak `Notifier`. Use case memanggil satu objek, tidak tahu isinya berapa.
- **Null Object**: kalau Drive belum diatur, pasang `NoopNotifier` yang tidak
  melakukan apa-apa. Tidak perlu `if drive != nil` di mana-mana — inilah cara
  pattern menghapus percabangan, bukan menambah kelas percuma.

## 2.3 State — siklus hidup kode

```
   Fresh ──IssueToChatbot()──> Issued ──Redeem()──> Redeemed ──ConsumeOrder()──> Spent
     │                                                  │
     └──────────────Redeem()────────────────────────────┘
                                                        │
                                          (lewat batas waktu) └──> Expired
```

Transisi yang tidak sah **ditolak oleh objeknya sendiri**:

```go
func (c *AccessCode) ConsumeOrder(now time.Time, ref string) error {
    if c.ordersUsed >= c.maxOrders {
        return ErrCodeSpent          // invariant dijaga di dalam
    }
    ...
}
```

Bandingkan dengan Node: `if ((codeEntry.submissions||0) >= MAX)` ditulis di
handler. Handler kedua yang lupa menulisnya = celah. Di sini tidak bisa lupa.

---

# BAGIAN 3 — Struktur folder

```
backend-go/
├── cmd/server/main.go            # composition root: semua disambungkan DI SINI
├── internal/
│   ├── domain/                   # murni. Tidak impor apa pun dari luar
│   │   ├── valueobject.go        # Email, PhoneNumber, Address, CodeID
│   │   ├── code.go               # AccessCode (aggregate root + state machine)
│   │   ├── order.go              # Order
│   │   └── errors.go             # error domain (sentinel)
│   ├── usecase/
│   │   ├── ports.go              # SEMUA interface (port) ada di sini
│   │   ├── redeem_code.go
│   │   └── submit_order.go
│   └── adapter/
│       ├── repository/jsonfile.go
│       ├── notifier/{email,drive,composite,noop}.go
│       ├── token/hmac.go
│       └── httpx/{handler,middleware,router}.go
└── go.mod

frontend-react/
├── src/
│   ├── domain/                   # tipe & aturan murni (diuji tanpa DOM)
│   ├── services/                 # ApiClient, StorageService (Adapter/Facade)
│   ├── hooks/                    # usePhotoBooth, usePremiumSession
│   ├── components/               # presentational (tanpa fetch/localStorage)
│   └── App.tsx
```

**Cara membaca kode ini nanti:** mulai dari `domain/` (aturan bisnis murni),
lalu `usecase/` (alur), baru `adapter/` (detail teknis). Kalau langsung
membaca `adapter/`, kamu akan tenggelam di detail dan kehilangan gambaran besar.

---

# BAGIAN 4 — Kenapa desain ini lebih gampang diuji

| Yang diuji | Node sekarang | Go versi ini |
|---|---|---|
| Aturan "kode hangus" | Butuh file `codes.json` | Objek murni, tanpa I/O |
| Alur penukaran | Butuh server hidup | Pasang repo in-memory |
| Kegagalan email | Sulit disimulasikan | `FailingNotifier` 3 baris |
| Balapan data | Sulit | Repo in-memory + goroutine |

Ini bukan efek samping — **itu tujuan utamanya**. Kalau sebuah desain sulit
diuji, biasanya ketergantungannya belum dipisah dengan benar.

---

# BAGIAN 5 — Salah kaprah yang perlu dihindari

1. **Pattern bukan tujuan.** Kalau hanya ada satu cara kirim selamanya,
   `Notifier` interface itu berlebihan. Di sini dibenarkan karena memang ada
   3 varian (email, Drive, tidak ada).
2. **Getter/setter ≠ enkapsulasi.** `GetOrdersUsed()/SetOrdersUsed()` sama
   bocornya dengan field publik. Yang benar: `ConsumeOrder()` yang menjaga aturan.
3. **Anemic Domain Model.** Kelas hanya berisi data, semua logika di "service"
   — itu pemrograman prosedural berbaju OOP. `AccessCode` di sini punya
   perilaku, bukan cuma field.
4. **Layer berlebihan.** Untuk proyek sekecil ini, 3 layer sudah cukup.
   Menambah `Repository → Service → Manager → Helper` hanya menambah lelah.
