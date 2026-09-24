# ADR 0008: Ortak çekirdek: tek hesap kaynağı, WASM sınırı ve birebir taşıma

- **Durum:** kabul edildi
- **Tarih:** 2026-09-24
- **Bağlam belgesi:** CLAUDE.md §14 (“Tek hesaplama kaynağı kapısı”), §23.4, §6

## Bağlam

CLAUDE.md §14 her CAD hesabının `crates/geometry-core` içinde bir kez yazılmasını, aynı crate'in native ve wasm32 derlenmesini, aynı fixture'ların iki hedefte geçmesini ve eşdeğerlik kanıtlanınca TypeScript algoritmasının silinmesini istiyor.

Bugün çalışan geometri TypeScript'tir: `src/model/geom`, `src/model/ops`, `model/geometry.ts`, `model/entities.ts` ve `render/triangulate.ts`. Toplam 36 dosya, yaklaşık 200 KB, 206 birim testi. Rust'ta yalnız küçük bir alt küme var.

Çağrıların hepsi eşzamanlıdır; kenet, seçme, etiket, tutamaç ve araç önizlemeleri pointermove ile animasyon karesi içinde çalışır. Bir imleç hareketi 500–1 500, budama önizlemesi 10⁴–10⁶ geometri çağrısı yapar.

Kullanıcının kararları (2026-09-24):

| Konu | Karar |
|---|---|
| Derleme | Rust araç zinciri gereklidir; paket kaynak değişince kendiliğinden yeniden derlenir. |
| `libm` | Eklenir; aşkın işlevler her hedefte aynı bitleri verir. |
| Sıra | Önce birebir taşıma. §23.3 sağlam (robust) kararlar ayrı dilimde, yalnız Rust'ta gelir. |
| Sınır | Geometri deposu WASM'da, sıcak yollarda toplu sorgular. Nesneler JSON ile, noktalar `Float64Array` ile taşınır; serde-wasm-bindgen yoktur. |

## Karar

### Tek kaynak

- Belgeye yazılan ya da bir CAD kararı veren her hesap `geometry-core`'dadır. TypeScript'te kalan cephe (`src/wasm/`) yalnız paketler ve açar; koordinat aritmetiği yapmaz.
- Kamera, ekran pikseli ve üst katman çizim hesabı TS'te kalır. Stil motoru, ifade dili ve SVG düzenleyicisinin kendi geometrisi `style-core`'un işidir; o zamana kadar TS'te kalır ve geometriyi çekirdekten alır.
- Bir modülün TS algoritması şu dört koşulla silinir:
  - parity testi derin koşuda (`PARITY_CASES=20000`) temiz geçer;
  - sonuçlar golden'a dondurulur;
  - bütün çağıranlar çekirdeğe geçer;
  - `tsc`, `pnpm test` ve `pnpm e2e` geçer, sıcak yolda ölçülen gerileme olmaz.

### Birebir taşıma

- **JavaScript sayı anlamı:** `jsmath.rs`.
  - `js_round`: `Math.round` gibi yarımları +∞ yönüne yuvarlar.
  - `js_sign`, `js_min` ve `js_max`: NaN'ı ve işaretli sıfırı JavaScript gibi korur.
  - `js_hypot`: V8'in `Math.hypot` yöntemidir (en büyüğe bölme ve Kahan toplamı). Node 24'te 2 milyon rastgele çiftte bit bit aynı çıktı.
  - `js_cmp`: `(a, b) => a − b` karşılaştırıcısıdır; NaN eşit sayılır.
- **Aşkın işlevler:** sin, cos, tan, atan, atan2, asin, acos, exp, log ve pow `libm` 0.2.16'dan gelir. Native derlemede standart kütüphane platformun C kütüphanesini çağırır; bu yüzden native ve WASM son bitte ayrışabilirdi (§23.4).
  - **TS ile son bit farkı:** Node 24'te `Math.atan2`, `tan` ve `asin` libm ile bit bit aynı çıktı (20 000'er deneme). `Math.sin` ve `cos` ise çağrıların yaklaşık %2'sinde bir ulp farklı; V8 bunlar için kendi içine aldığı glibc kodunu kullanır (LGPL olduğu için taşınamaz). İyi koşullu hesaplarda fark toleransın çok altındadır. Sonucun zaten keyfî olduğu kaotik girdilerde (çemberin tam merkezine en yakın parametre gibi) iki taraf ayrışabilir; bu girdiler parity üreteçlerine konmaz. Native ile WASM aynı libm'i kullandığı için her zaman bit bit aynıdır.
  - `crates/geometry-core/clippy.toml`, çekirdekte standart kütüphanenin `f64` aşkın yöntemlerini, `hypot`, `powi`, `mul_add`, `round`, `signum`, `min` ve `max`'ı yasaklar.
  - Toplama, çarpma, bölme, `sqrt`, `floor`, `abs` ve `%` IEEE'de iki dilde de aynıdır.
- **TS kalıplarının karşılıkları:**
  - Ekleme sırası korunan Map/Set → Vec ve indeks;
  - nesne kimliği → indeks;
  - geri çağırma → enum ya da girdi (overlay kuralı enum olur; ölçü ve patlatma yazısı biçimlenmiş metin olarak girer, değeri Rust hesaplar, `ctx.format` biçimler).
- **Hata metinleri** Türkçe ve birebir aynıdır; fixture'lar metni tam karşılaştırır.
- **Panik yok:** test dışı çekirdek kodunda `unwrap`, `expect` ve `panic` yasaktır (`clippy::unwrap_used` vb. deny). Her işlem bir değer ya da `{ error }` döndürür.

### Nesne tipi

- Çekirdek geometri tipini kendisi tanımlar (serde ile, TS'teki `EntityGeometry` biçiminde). `kentos-contracts`'a bağlanmaz: ts-rs ve sözleşme türetmeleri WASM paketine girmez.
- Sözleşmedeki `Entity`, ortak alanlar ile bu geometrinin toplamıdır. İkisinin aynı kaldığını P5 dilimindeki bir Rust testi denetler.
- Plan metnindeki “geometry-core → contracts” bağımlılığı bu yüzden kurulmadı.

### Sınır

- **Çağrı tablosu** (`geometry-core/src/api`): her işlem TS'teki adıyla kayıtlıdır.
  - Argümanlar konumsal JSON dizisi olarak gelir (`undefined` → `null`), sonuç JSON olarak döner.
  - WASM `opId(ad)` ile `callOp(id, argümanlar)` dışa açar; TS cephesi `op(ad)` ile tipli bir çağırıcı kurar (`src/wasm/core.ts`).
  - Yerel golden testleri aynı tablodan geçer, yani iki hedef de uygulamanın yolunu sınar.
- **Sayılar bit bit geçer:**
  - `serde_json` `float_roundtrip` özelliğiyle kesin ayrıştırır.
  - Sonuçları çekirdeğin kendi JSON yazıcısı (`api/json.rs`) yazar: en kısa geri dönüşlü biçim; NaN, +∞ ve −∞ sırasıyla `"#NaN"`, `"#Inf"`, `"#-Inf"` olur ve `core.ts` bunları sayıya geri çevirir. serde_json bu değerleri `null` yapardı; `null · 2 = 0` sessizce yanlış sonuç verirdi.
  - `JSON.stringify(-0)` `"0"` yazar. Girdideki −0 korunmaz; `.kcad` ve bulut kaydı da bunu zaten korumuyor.
- **`undefined` ve `null`:** JSON'da `undefined` yoktur. `op(ad, true)`, TS işlevi yokluk için `undefined` döndürüyorsa `null`'u `undefined`'a çevirir. İsteğe bağlı alanlar çekirdekte yazılmaz (`skip_serializing_if`).
- **Sıcak yollar (S1):** kenet, seçme, etiket, tutamaç, hayaletler ve budama önizlemesi JSON tablosundan geçmez. Belgenin kopyasını tutan bir geometri deposuna (`Store`) tipli, `Float64Array` giriş-çıkışlı toplu sorgular yapılır. Depo `doc.events.touched` ile eşitlenir. Ayrıntısı o dilimde bu ADR'ye eklenir.

### Başlatma, worker ve hata

- **Sayfa:** `src/main.ts`, `createApp`'tan önce `initCore()` çalıştırır (`WebAssembly.compileStreaming`; tür başlığı yanlışsa baytlardan derler). Yüklenemezse Türkçe hata ve “Yeniden dene” gösterilir.
- **Worker:** worker ES modülüdür (`vite.config.mjs` → `worker.format: 'es'`). Sayfanın derlediği `WebAssembly.Module` yeni worker'ın ilk işiyle (`core` alanı) gider; worker `initCoreFrom` ile kendi kopyasını başlatır, dosya ikinci kez indirilmez.
- **Testler:** Vitest'te `src/wasm/testSetup.ts` çekirdeği paketin baytlarından başlatır.
- **Tuzak:** WASM `panic = "abort"` ile derlenir; bir panik tuzak (trap) olur. `core.ts` bunu bir kez `onCoreFault`'a bildirir; uygulama “çizimi kaydedip sayfayı yenileyin” der.
  - wasm-bindgen'in ürettiği yapıştırıcı kod tek örnek tuttuğu için çekirdek sayfada yeniden kurulamaz.
  - Kaydetme çekirdeğe muhtaç değildir, çizim kaybolmaz.

### Derleme

- **Rust zorunlu:** `pnpm dev`, `test`, `test:watch`, `build`, `e2e`, `e2e:cloud` ve `pnpm wasm` önce `scripts/wasm/ensure.mjs`'i çalıştırır.
  - Betik; `crates/geometry-core`, `crates/wasm`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` ve `.cargo/config.toml` özetini `src/wasm/pkg/.stamp` ile karşılaştırır.
  - Özet değiştiyse `nice pnpm rust:wasm` çalıştırır. Rust araç zinciri artık `pnpm test` için de gereklidir; ADR 0001'in ilgili maddesi bu kararla değişti.
- **`wasm` profili:** release'den türer; `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`. Paket `target/wasm32-unknown-unknown/wasm/`'dan `wasm-bindgen` ile `src/wasm/pkg`'a yazılır; paket depoya girmez.
- **Boyut:** her taşıma diliminde ADR 0005 taslağındaki başlangıç sınırıyla (300 KB gzip) karşılaştırılıp raporlanır.

  | Dilim | Ham | gzip | Not |
  |---|---|---|---|
  | 0 (altyapı) | 183 KB | 76 KB | JSON ayrıştırma ve sayı yazma kodu eklendi (önce 37 KB) |
  | P1 (60 işlem) | 302 KB | 112 KB | `opt-level = "s"` yalnız %10 kazandırır |
  | P2 (+43 işlem) | 388 KB | 135 KB | Argümanlar artık tek bir `Value` yolundan okunuyor (kazanç 1,5 KB); büyümenin asıl kaynağı satır içine açılan geometri ve libm kodu. Fonksiyon başına döküm P3'te çıkarılacak |

### Doğrulama

- **Çağrı kümeleri** (`src/wasm/parity/sets/*.ts`): her modül için adlı sınır durumları (birim testlerinden: paralel, çakışık, sıfır uzunluk, 0/2π, TM koordinatı) ve tohumlu rastgele çağrılar.
- **Parity testi** (`src/wasm/parity/parity.test.ts`): aynı çağrıyı TS'e ve çekirdeğe verir. İşlem başına 200 rastgele durum kullanır; `PARITY_CASES` bunu artırır.
  - Bir rastgele çağrının bütün noktaları tek bir çerçevededir (başlangıç yakını ya da TM dilimi). Eksen ve yön vektörleri konum değil vektör olarak üretilir. 4 400 km'yi aşan bir “şekil” çizim değildir ve yalnız son bit farklarını büyütür.
  - Sayılar golden toleransıyla (1e-9 + 1e-14·büyüklük) karşılaştırılır.
  - Metin, mantıksal değer, dizi uzunluğu ve nesne anahtarları tam eşit olmalıdır.
- **Kaydedici** (`scripts/fixtures/record-calls.test.ts`, `GOLDEN_WRITE=1`): TS varken her kümeyi `fixtures/geometry/v1/calls-*.json` dosyasına dondurur; işlem başına 25 rastgele durum, satır başına bir durum.
- **Aynı dosyaları okuyanlar:**
  - native: `crates/geometry-core/tests/calls.rs`;
  - WASM, uygulamanın yolundan: `src/wasm/calls.wasm.test.ts`.
- **Bağımsız referanslar** her dilimde kapalı biçimli ölçülerle genişletilir (§23.4): `reference.json` (alanlar) ve `reference-calls.json` (adıyla çağrılan işlemler: TM doğru kesişimi, üç noktadan çember, yarım daire yayı, parçaya uzaklık, güzergâh uzunluğu, iki çember kesişimi, teğet noktaları, yay uzunluğu; `scripts/fixtures/geometry_call_reference.py`). Native (`tests/calls.rs`), WASM ve TS varken TS (`src/wasm/parity/reference.test.ts`) hata sınırı içinde kalmalıdır.
- **Golden sahipliği:** TS silindikten sonra dosyalar donmuş davranış kilididir. Bilinçli bir davranış değişikliği (ör. §23.3 robust kararlar) dosyayı incelemeyle günceller.

## Sonuçlar

- Mevcut TS birim testleri modül silinince aynı adlarla cephe üzerinden Rust'ı sınamaya devam eder.
- Etkileşim ölçüm tabanı S1'den (geometri deposu) hemen önce alınır: taşıma dilimleri çağıranları değiştirmediği için TS tabanı o zamana kadar geçerlidir.
- JSON tablosu ılık yollar içindir (çağrı başına birkaç mikrosaniye). Kare başına binlerce çağrı yapan yerler toplu API alır (depo, bölme noktaları, tarama çizgileri).
