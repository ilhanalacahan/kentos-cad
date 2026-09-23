# ADR 0007: Kimlik doğrulama: yerel hesap, oturum çerezi, OpenID Connect

- **Durum:** kabul edildi
- **Tarih:** 2026-09-24
- **Bağlam belgesi:** CLAUDE.md §16, §24.4

## Bağlam

Kullanıcının kurumunun kendi OpenID sunucusu var. Kullanıcı şu kararları verdi:

- Şimdilik yerel kullanıcı girişi, yanında OpenID desteği.
- Parola özetini PostgreSQL üretsin; yeni kripto crate'i eklenmesin.
- İlk kurum ve kullanıcılar komut satırından açılsın; açık kayıt yok.

## Karar

### Yerel hesaplar

- **Parola özeti:** pgcrypto `crypt(parola, gen_salt('bf', 12))` (bcrypt, maliyet 12).
- **Parola kuralları:**
  - En az 10 karakter.
  - En çok 72 bayt. bcrypt 72 bayttan sonrasını kesip atar, bu yüzden daha uzun parola reddedilir.
- **Denetim:** yalnızca `kentos.check_local_login` ile yapılır (`SECURITY DEFINER`).
  - Olmayan giriş adında da aynı bcrypt işi yapılır; zamanlamadan hesabın var olup olmadığı anlaşılmaz.
  - Yanlış giriş adı ile yanlış parola aynı iletiyi alır.
- **Risk:** parola, SQL parametresi olarak veritabanına gider. PostgreSQL varsayılan olarak ifade parametrelerini günlüğe yazmaz (`log_statement = none`, `log_parameter_max_length_on_error = 0`). Üretim sunucusunda bu ayarlar böyle kalmalıdır; kuruluş denetim listesine yazılır.
- **Yönetim:**
  - `kentosd user add|password`.
  - Parola komut satırından verilmez, stdin ya da adı verilen bir ortam değişkeniyle gelir.
  - Yeni parola hesabın açık oturumlarını kapatır.

### Oturum

- **Anahtar:** `gen_random_bytes(32)`, hex. Tarayıcıya bir kez `kentos_session` çerezi olarak gider (`HttpOnly; SameSite=Strict; Path=/`, üretimde `Secure`).
- **Saklama:** veritabanında yalnızca SHA-256 özeti (`digest`) durur.
- **Süre:** her kullanımda 12 saat uzar; en çok 7 gün yaşar.
- **Çıkış:** oturumu geri alınamaz biçimde kapatır.
- **CSRF:**
  - Değişiklik yapan her istek `x-kentos-client: web` başlığını taşımak zorundadır. Başka bir sitenin sayfası bu başlığı CORS ön isteği olmadan ekleyemez; sunucu CORS izni vermez.
  - Çerezin `SameSite=Strict` olması ikinci engeldir.
  - Giriş isteği de başlığı ister (giriş CSRF'i).
- **İstek sırası:** her istekte oturum özetle bulunur ve süresi uzatılır. Hesap kullanıcı kapsamında okunur; devre dışı hesap reddedilir.

### OpenID Connect

- **Yapılandırma:** `KENTOS_OIDC_ISSUER` ve `KENTOS_OIDC_CLIENT_ID`; isteğe bağlı `KENTOS_OIDC_CLIENT_SECRET`, `KENTOS_OIDC_AUDIENCE`, `KENTOS_OIDC_LABEL`.
  - Keşif belgesinin `issuer` alanı yapılandırılan adresle birebir aynı olmalıdır.
  - Keşif belgesi ve anahtarlar bir saat önbellekte kalır. Tanınmayan bir `kid` gelirse anahtarlar yeniden indirilir, ama dakikada en çok bir kez.
- **Tarayıcı girişi** (sunucu tarafı, authorization code + PKCE S256):
  - `start`: state, nonce ve doğrulayıcıyı pgcrypto üretir; kayıt `oidc_login` tablosunda on dakika tutulur, istemci S256 özetini alır.
  - `callback`: state bir kez kullanılır (`delete … returning`), kod doğrulayıcıyla değiştirilir.
  - ID token denetimi: imza (JWKS), `iss`, `aud` = istemci kimliği, `exp`/`nbf` (60 sn pay), `nonce`.
  - Kimlik `(issuer, subject)` ile bulunur ya da açılır (`kentos.resolve_identity`); e-posta kimlik değildir. Sonra yerel girişle aynı oturum çerezi verilir.
  - Dönüş yalnızca uygulama içi bir yola yapılır (açık yönlendirme yok). Hata olursa uygulamaya `?oidc=error&reason=<kod>` ile dönülür.
- **API istemcileri:**
  - `Authorization: Bearer <erişim belirteci>`, `aud` = `KENTOS_OIDC_AUDIENCE`.
  - Hesap eşlemesi beş dakika bellekte tutulur.
- **İmza:** yalnızca asimetrik algoritmalar kabul edilir (RS*, PS*, ES256/384). HS* reddedilir, çünkü ortak anahtarla sahte belirteç imzalanabilir.
- **Hesap:** OpenID ile ilk giriş hesabı açar ama üyelik vermez. Kurum ve koltuk yönetimi ayrıdır (`kentosd member add --user <kimlik>`).
- **Sınama:** gerçek sağlayıcıyla entegrasyon denemesi, kurumun OpenID sunucusunun adresi ve istemci kaydı gelince yapılır. Birim testleri süreç içindeki sahte bir sağlayıcıyla çalışır (`apps/api/src/oidc/tests.rs`, sınamaya özel RSA anahtarı).

### Bağımlılıklar

Kullanıcı onayıyla ve tam sürümle:

| Crate | Sürüm |
|---|---|
| jsonwebtoken | 11.1.0 (yalnızca `rust_crypto`) |
| reqwest | 0.13.5 (`rustls`; yalnızca keşif, JWKS ve kod değişimi için) |
| sqlx | 0.9.0 |
| tower-http | 0.7.1 |
| uuid | 1.26.1 |
| time | 0.3.55 |
| tracing | 0.1.44 |
| tracing-subscriber | 0.3.23 |

Parola ve oturum anahtarı için Rust kripto crate'i eklenmedi.

## Sonuçlar

- **Açık kalan işler:**
  - Başarısız girişlerde hız sınırı yok. Şimdilik bcrypt'in maliyeti yavaşlatıyor; hesap ya da IP başına sınır Faz B sonunda eklenmeli.
  - Arayüzden davet ve koltuk yönetimi yok.
  - OpenID ile oturum kapatma (end_session) yok; yalnızca yerel oturum kapanır.
