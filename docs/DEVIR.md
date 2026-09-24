# Devir notları: ortak Rust çekirdeğini tamamlamak

Tarih: 24 Eylül 2026. Bu notlar işi sürdürecek yapay zekâ ajanı içindir.
Önce bu dosyayı, sonra aşağıdaki belgeleri okuyun. İş ilerledikçe bu dosyayı
güncel tutun; biten maddeyi silin, yeni kararı ekleyin.

## 1. Önce okunacaklar

1. `CLAUDE.md`: bağlayıcı proje kuralları. Özellikle §3 (kısıtlar), §4.1
   (katmanlar), §8 (kod kuralları), §9.4 (testler) ve §14 (“Tek hesaplama
   kaynağı kapısı”).
2. `docs/adr/0008-shared-core-boundary.md`: ortak çekirdeğin bütün kararları.
   Taşıma yöntemi, çağrı tablosu, JSON sınırı, doğrulama, taşırken bulunan
   hatalar ve WASM boyut tablosu buradadır.
3. `docs/perf/interaction-baseline.md`: TypeScript geometrisinin etkileşim
   ölçüm tabanı. S1 buna göre karşılaştırılır.
4. `DESIGN.md`: yalnız arayüze dokunulursa.

## 2. Bugünkü durum

- **Kullanıcının hedefi:** “Öncelikle ortak çekirdeği tamamlayalım.”
  - CLAUDE.md §14 der ki: CAD hesabı `crates/geometry-core` içinde bir kez yazılır, native ve wasm32 olarak derlenir.
  - Eşdeğerlik kanıtlanınca TypeScript algoritması silinir.
- **Yapıldı (P0–P8):** `src/model/geom`, `src/model/ops` ve `src/render/triangulate.ts` içindeki bütün işlemler Rust'ta.
  - Her işlem TypeScript ile 20 000 rastgele durumda aynı sonucu veriyor.
  - Donmuş fixture'lar (`fixtures/geometry/v1/calls-p0…p8`) native ve WASM'da geçiyor.
  - P8 ilk tipli toplu girişi getirdi: `triangulateMany(xy, ringSizes, polyRings)` (`src/wasm/core.ts`), üçgen başına üç köşe dizini döner. S2'de `sceneBuilder` ve `styledSink` bunu kullanacak (ADR 0008 “Tipli toplu girişler”).
- **Ama çalışan geometri hâlâ TypeScript.** Uygulama çekirdeği açılışta yükler (`src/wasm/core.ts`), worker derlenmiş modülü ilk işiyle alır. Asıl geçiş S1–S3'tedir.
- **Aynı gün main'e girenler:**
  - Yeni proje (`file.new`);
  - bulut projesini yeniden adlandırma ve yumuşak silme (migration 0002);
  - olay günlüğü budama (migration 0003);
  - etkileşim ölçüm düzeneği (`pnpm perf:interaction`) ve TypeScript tabanı.
- **Son doğrulama (main, P8 commit'i, bulut konteyneri):**
  - `npx tsc --noEmit -p .` temiz, `pnpm test` 764 test geçti.
  - `cargo test --workspace` ve `cargo clippy --workspace --all-targets -- -D warnings` temiz (veritabanı testleri sır olmadığı için atlandı).
  - `pnpm e2e`: WebGPU'ya ait üç denetim dışında hepsi geçti; o üçü taban commit'te de (747d942) aynı biçimde düşüyor (bkz. §5, bulut konteyneri).
- **WASM paketi:** 630 KB, gzip ile 215 KB. ADR 0005 taslağındaki başlangıç sınırı 300 KB gzip.
- **Ölçüm tabanı** (kullanıcının makinesi):
  - 81 000 nesnede seçme ve kenet: fare hareketi başına 9–13 ms (hedef < 2 ms).
  - 1 milyon parçalı eşyükseltide budama önizlemesi: kare başına ~0,75 s.

## 3. Sıradaki işler (bu sırayla)

### S1: WASM geometri deposu (en büyük kazanç)

- **`geometry-core::store`:**
  - belge nesnelerinin kopyası;
  - katman tablosu (görünür, kilitli, `pickInterior`);
  - önbellekli sınır kutuları.
- **PickIndex kuralları birebir taşınır** (`src/viewport/picking.ts`, CLAUDE.md §4.9):
  - seçme önceliği;
  - kenet türleri ve öncelikleri;
  - pencere ve kesişim seçimi.
- **Sorgular:** `snap`, `hit`, `hitEdge`, `inRect`, `touchesRect`, `enclosing`, `bounds`/`extents`.
- **Toplu sorgular:**
  - `anchors` (etiketler), `grips`;
  - `transformOutlines(ids, affine)` (en çok 400 hayalet), `stretchOutlines`;
  - `trimPreview`/`extendPreview` (hedef ve görünür sınırlar tek çağrıda);
  - `measure(ids)` (alan ve uzunluk).
- **Sınır (ADR 0008):** nesneler JSON ile, noktalar `Float64Array` ile taşınır; serde-wasm-bindgen yok.
- **Eşitleme:**
  - `doc.events.touched` (kimlikler) ile yapılır.
  - `load`, `replaceWith` ve `applyExternal` tam yeniden eşitler.
  - Pano için ikinci bir depo örneği kullanılır.
- **Çağıranlar:**
  - `viewport/picking.ts` ince sarmalayıcı olur.
  - `viewport/overlay.ts` (etiket, tutamaç), `tools/edgeTools.ts`, `tools/modifyTools.ts`, `tools/editTools.ts` ve `PropertiesPanel` toplamları depoya geçer.
- **Parity:** aynı örnek projede ve tohumlu imleç konumlarında TS PickIndex ile depo aynı sonucu vermeli.
- **Kabul:** tabana göre p95'te gerileme olmamalı.
  - Ölçüm kullanıcının makinesinde yapılır (bkz. §5); bulutta alınan sayı tabanla karşılaştırılamaz.
  - Ayrıntıları ADR 0008'in “Sıcak yollar” maddesine yazın.

### S2: çizim hattı

- `render/sceneBuilder.ts` ve `style/geometry.ts` katman başına toplu `layerGeometry`/`styledGeometry` alır (paketlenmiş halka ve yollar).
- `render/styledSink.ts` dolguları toplu üçgenler.
- İfadelerdeki `$alan`/`$uzunluk` değerleri katman kurulurken `store.measure` ile önceden alınır.
- İki motor aynı çizimi vermeli (e2e piksel karşılaştırması). Katman kurma süresi ölçülür.

### S3: cephe ve TypeScript'in silinmesi

- **Modül modül:**
  - `src/model/geom/X.ts` ve `src/model/ops/X.ts`, `src/wasm/api/X` cephesinin yeniden dışa aktarımına döner.
  - TypeScript algoritması silinir.
  - Silmeden önce derin koşu yapılır, fixture'lar dondurulur.
- Mevcut birim testleri aynı adlarla artık WASM'ı sınar.
- **Tek kaynak bekçisi:** bir vitest denetimi, silinen modüllerin yerindeki TS dosyalarında koordinat aritmetiği (`Math.`) olmadığını denetler.
- Kare başına binlerce çağrı yapan yerler toplu API alır: bölme noktaları, tarama çizgileri (tek çağrı, `Float64Array`).

### S4: worker

- Worker kendi depo örneğini işin nesne kopyalarından kurar.
- `processing/features.ts` sınırları, `numbering`, `edgeLengths` ve ifade ölçüleri çekirdekten gelir.
- `processing/worker/worker.test.ts` ve e2e worker denetimi geçmeli.

### S5: araç ve görünümdeki satır içi hesaplar

- Belgeye yazılan ya da CAD kararı veren hesaplar çekirdeğe taşınır:
  - `tools/coordinateInput.ts` (göreli, kutupsal);
  - `viewport/objectTracking.ts` (hiza, hiza boyunca mesafe);
  - `tools/pointCalc.ts`;
  - araçlardaki nokta kurma hesapları.
- Bulmak için `src/tools`, `src/viewport` ve `src/ui` içinde `Math.(sin|cos|atan2|hypot|sqrt)` aranır.
- Yalnız kamera ve ekran pikseli hesabı TypeScript'te kalır. Kalanların listesi ADR 0008'e yazılır.

### S6: belgeler ve ölçüm raporu

- CLAUDE.md güncellenir:
  - §2, §4.1, §4.8.1 (çekirdek Rust'ta), §4.9 (PickIndex → depo), §9.4, §11 (“Rust alt küme” borcu kalkar, robust predicates borcu yazılır), §12;
  - §13'e yalnız doğrulanmış durum notu.
- `docs/perf/interaction-*.md`: önce/sonra raporu.

**Kapsam dışı:** stil motoru, ifade dili ve SVG düzenleyicisinin geometrisi (`src/style/svg/*`).
- Bunlar ayrı `style-core` işidir; geometriyi çekirdekten alırlar.
- §23.3 robust predicates, S6'dan sonra ayrı bir dilimdir: yalnız Rust'ta, bağımsız referanslarla. Değişen sonuçlar bilinçli olarak golden dosyaya işlenir.

### Park edilmiş dal: `wip/formats-dxf`

- **Taban:** eski bir main'e (P2 dönemi, `7254f20`) dayanır ve hiç gözden geçirilmedi.
- **Commit'ler:**
  - `7ff6950` koordinat listeleri: Netcad NCN, TXT, CSV içe/dışa aktarma (bitti);
  - `dcf3f2e` DXF içe aktarma: ASCII DXF, bloklar tam patlatılır (bitti);
  - `0320b7f` WIP: DXF genişletilmiş veri (yarım; derlenmedi, sınanmadı).
- **Yeni crate'ler:** `crates/formats` ve `crates/formats-wasm`.
  - Tarayıcıda `src/io/pkg` olarak yalnız dosya içe/dışa aktarılınca yüklenir.
  - Yeni dış bağımlılık yok.
- **Yapılacak:**
  - main'e rebase (CLAUDE.md, package.json, Cargo.toml ve contracts'ta çakışma beklenir);
  - inceleme; WIP commit'ini bitirme ya da çıkarma;
  - testler (`cargo test -p kentos-formats`, `pnpm test`, `pnpm e2e`);
  - sonra main.
- **Öncelik:** ortak çekirdektir; kullanıcı aksini söylemedikçe bu dal ondan sonra ele alınır.

## 4. Taşıma yöntemi (P dilimleri ve S'deki yeni çekirdek işlevleri)

- **Birebir taşıma.** JavaScript sayı anlamı `crates/geometry-core/src/jsmath.rs`'tedir:
  - `js_round`, `js_sign`;
  - NaN yayan `js_min`/`js_max`;
  - V8 algoritmalı `js_hypot`;
  - `js_cmp`, `or`, `truthy`;
  - kararlı `stable_sort`.
- **Aşkın işlevler `libm`'den gelir.** `clippy.toml` std `sin/cos/tan/atan2/hypot/powi/mul_add/round/signum/min/max`'ı yasaklar.
  - V8'in `Math.sin`/`cos`'u çağrıların ~%2'sinde son bitte farklıdır.
  - Native ve WASM ise hep bit bit aynıdır.
- **Kayıt:** TS dosyası başına bir modül; `pub(crate) static OPS: &[Op]` içinde `op!("tsAdı", |a: A, b: B| gövde)`. Modül `crates/geometry-core/src/api/tables.rs` içindeki `TABLES` listesine eklenir.
- **JSON:** `src/api/json.rs`.
  - `json_struct!`, `json_tagged!`; açık `null` için `Nullable`.
  - `None` alan yazılmaz.
- **Hata ve panik:**
  - TypeScript'in istisna fırlattığı yerde `Result<_, String>` döner, JS'te istisna olur.
  - Panik yok: `unwrap`/`expect` test dışı kodda yasaktır.
- **Nesne alanları:** nesnenin kimlik, katman ve öznitelik gibi alanları `Entity.rest`'te olduğu gibi geri döner.
- **Çağrı kümesi:** `src/wasm/parity/sets/pN-*.ts` dosyasına adlı sınır durumları ve tohumlu rastgele çağrılar (`repeat`, `Gen`) yazılır, küme `sets.ts`'e eklenir.
  - Üreteçler TypeScript'in istisna fırlattığı girdileri üretmemeli; test donanımı istisna yakalamaz.
- **Koşu:**
  - normal: `npx vitest run src/wasm/parity/parity.test.ts -t "pN"` (işlem başına 200 durum);
  - derin: `PARITY_CASES=20000` ile aynı komut.
  - Tolerans 1e-9 + 1e-14 · büyüklüktür; gerekçeli istisnalar kümede `tolerance`, eşit ölçülü sıra değişimleri `ties` ile bildirilir.
- **Fark çıkarsa:** çoğu zaman TypeScript'te gizli bir kırılganlık ya da hatadır.
  - Önce hatayı yeniden üreten bir TS birim testi yazın.
  - Sonra TS ve Rust'ı aynı biçimde düzeltin ve ADR 0008'e yazın.
  - Örnekler ADR'dedir: halka izlemede ikiz parça, elipste en yakın nokta, ortak köşede en yakın kenar.
- **Fixture:**
  - `GOLDEN_WRITE=1 npx vitest run scripts/fixtures/record-calls.test.ts`;
  - sonra `npx vitest run src/wasm` ve `cargo test -p kentos-geometry-core --test calls`.
  - Kaydedici işlem başına en çok 25 rastgele durum ve 48 KB tutar.
- **Boyut:** `src/wasm/pkg/kentos_wasm_bg.wasm` ham ve `gzip -9` boyutu ADR 0008 tablosuna yeni satır olarak yazılır.

## 5. Ortam ve çalışma kuralları

- **Kurulum:**
  - `pnpm install --frozen-lockfile`;
  - `rust-toolchain.toml`'daki Rust (wasm32 hedefiyle);
  - `cargo install wasm-bindgen-cli --version 0.2.128 --locked`.
  - `pnpm dev/test/build/e2e`, WASM paketini kaynak değiştiyse kendisi derler (`scripts/wasm/ensure.mjs`). `pnpm e2e` başsız Chrome ister.
- **Sırlar depoda yok** (`.env.local`):
  - Veritabanı testleri atlanır, `pnpm e2e:cloud` çalışmaz; veritabanı kurmaya çalışmayın.
  - `kentos` adlı veritabanına asla dokunulmaz; o başka bir uygulamanındır. KentOS CAD'in veritabanı `kentos_cad`'dir.
- **Bulut konteyneri (Claude Code on the web):** kök kullanıcıyla çalışır.
  - Chromium `/opt/pw-browsers/chromium`'dadır ve kökte `--no-sandbox` ister. `cdp.mjs` bayrak eklemez; depoya dokunmadan `exec /opt/pw-browsers/chromium --no-sandbox "$@"` diyen bir sarmalayıcıyı `CHROME_BIN` ile verin.
  - Başsız SwiftShader'da WebGPU aygıtı ilk karelerde kaybolur (“A valid external Instance reference no longer exists”). `pnpm e2e`'nin üç WebGPU denetimi bu yüzden düşer; taban commit'te de aynıdır. Öbür denetimler anlamlıdır.
  - `wasm-bindgen-cli` kurulu gelmez (`cargo install … --locked`, ~1,5 dk).
- **Ölçüm:** taban kullanıcının makinesinde (Intel Iris Xe GPU) alındı.
  - Karşılaştırmayı kullanıcı kendi makinesinde `pnpm perf:interaction --label s1` ile yapar.
  - Bulutta yalnız aynı makinede önce/sonra çifti anlamlıdır. `--allow-swiftshader` ile çalıştırılırsa yalnız ana iş parçacığı süreleri anlamlıdır.
- **Ağır işler tek tek:** cargo, tam vitest, e2e ve ölçüm aynı anda çalışmaz; kullanıcının makinesi bir kez dondu.
  - Alt ajan en çok 3 olmalı (token bütçesi).
- **Commit ve push:** dilim başına bir commit, mevcut biçimde İngilizce mesajla (ör. “Shared core, P8: …”). `tsc`, `pnpm test`, clippy ve gerekiyorsa `pnpm e2e` geçince main'e push edilir.
- **Test ve doğrulama:**
  - Hata düzeltmesi önce hatayı yeniden üreten testle başlar.
  - Her değişiklikte `npx tsc --noEmit -p .` temiz, `pnpm test` geçer.
  - Arayüze dokunan değişiklik tarayıcıda denenir.
- **Sorulmadan yapılmayanlar:**
  - Çalışma zamanı bağımlılığı eklemek (kullanıcıya sorulur).
  - Global git ayarını değiştirmek.
  - CLAUDE.md §0 ve §13 sonrasını değiştirmek: bunlar kullanıcının metnidir; yalnız doğrulanmış durum notu eklenir. §1–12 gerçeğe uygun tutulur.

## 6. Kullanıcıya sorulacak açık kararlar

1. Bulut projesini silme yalnız yönetici ve sahipte mi kalsın, proje yöneticisi de silebilsin mi?
2. Olay günlüğünü 7 gün tutmak uygun mu? (Veritabanı bir saatten kısasını reddeder.)
3. Silinen projeler bir süre sonra kalıcı silinsin mi? Yönetici arayüzden geri alabilsin mi?
4. Komut günlüğü (idempotency) ve denetim tablosu için saklama süresi gerekiyor mu?
5. ADR 0005 (performans hedefleri) hâlâ taslak; onay bekliyor.
6. Tipli öznitelik alanlarının tasarım onayı. Önerilen: katman başına şema; türler metin, tam sayı, ondalık, mantıksal, tarih ve sabit liste.
7. Gerçek OpenID denemesi için kurumun OpenID sunucusu bilgileri (issuer, client id).
