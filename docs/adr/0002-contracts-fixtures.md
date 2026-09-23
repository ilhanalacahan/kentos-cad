# ADR 0002: Sözleşmeler ve paylaşılan golden fixture'lar

- **Durum:** kabul edildi
- **Tarih:** 2026-09-23
- **Bağlam belgesi:** CLAUDE.md §14, §20 Faz A

## Bağlam

Tarayıcı, WASM, API ve saklanan dosyalar aynı veriyi konuşacak. Tipler iki dilde elle tutulursa zamanla ayrışır. Geometrinin iki dilde aynı sonucu verdiği de ölçülerek gösterilmelidir, varsayılamaz.

## Karar

### Sözleşmeler: tek tanım Rust'ta

- **Tek kaynak `crates/contracts`'tır.** `cargo test -p kentos-contracts`, ts-rs ile TypeScript tiplerini `src/contracts/generated/` altına yazar; bu dosyalar depoya girer.
- **Uygulamanın iç tipleri** (`Entity`, `LayerNode` …) derleme anında sözleşmeye karşı denetlenir (`src/contracts/contracts.test.ts`). Bir alan eklenip sözleşmeye yazılmazsa `tsc` hata verir.
- **v1 sözleşmeleri:**
  - `Entity` (13 tür, `kind` etiketli);
  - `LayerNode` ve `LayerStyle`;
  - `ProjectSettings`;
  - `DocumentSnapshotV1` (`format: "kentos.document"`, `version: 1`);
  - `StyleFile` (`kentos-style` v1);
  - `RunJob`;
  - `Health`;
  - `CommandEnvelope` (§18);
  - `NumericPolicy`, `DecimalString`, `ShareValue` (§23, ADR 0004).
- **Sürüm kuralı:** saklanan ya da gönderilen her belge `format` ve `version` taşır. Okuyucu bilmediği sürümü açık bir hatayla reddeder, tahmin etmez.
- **v1 sınırları:**
  - `id` belgenin yerel kimliğidir. Sunucunun kalıcı kimliği UUID'dir; Faz B'de PostgreSQL `feature` tablosuyla ayrı bir `FeatureRef` sözleşmesi olarak gelir (§15). MVT'nin sayısal kimliği ayrı bir eşlemedir.
  - Öznitelikler v1'de metindir.
  - Stil motorunun kendi tipleri (katman işleyicisi, kitaplık öğeleri) opak JSON'dur (`unknown`). `style-core` Rust'a taşınınca tiplenecek.
- **`SceneLayer` sözleşme değildir.** GPU'ya özel iç tiptir (`Float32Array` toplulukları, yerel orijin) ve ağdan gitmez.
  - Sunucudan veri MVT/TileJSON ile gelir; MVT CAD için kayıplıdır, editör gerçek CAD tanımını ayrı feature API'sinden alır (§17).
  - Özel ikili sahne karosu yalnızca MVT'nin ölçülmüş sınırı ortaya çıkarsa ayrı sürüm olarak tasarlanır.

### Golden fixture'lar

- `fixtures/geometry/v1/cases.json` her durum için girdi ve beklenen sonucu taşır. Beklenen sonuçlar bir kez TypeScript referansından kaydedildi (`GOLDEN_WRITE=1`) ve kilitlendi. Değiştirmek, bilinçli ve incelenmiş bir davranış değişikliğidir.
- Bağımsız referanslar (ADR 0004, §23.4): `fixtures/geometry/v1/reference.json` ve `fixtures/numeric/v1/*`. KentOS kodu olmadan, Python kesin aritmetiğiyle üretildi. Eski TypeScript sonucuna eşitlik tek doğruluk ölçütü değildir.
- Aynı dosyayı okuyanlar:
  - TypeScript: `src/model/geom/golden.test.ts`;
  - yerel Rust: `crates/geometry-core/tests/golden.rs`;
  - WASM: `src/wasm/golden.wasm.test.ts`, `pnpm test:rust` ile.
- **Tolerans:** `|gerçek − beklenen| ≤ 1e-9 + 1e-14·max(|gerçek|, |beklenen|)`.
  - Formüller ve işlem sırası iki dilde aynı olduğu için toplama ve çarpma aynı sonucu verir.
  - Fark yalnızca `atan2`, `sin`, `hypot` gibi kütüphane işlevlerinin son bitinden gelebilir.
  - TM koordinatlarında (4,4·10⁶ m) 1 ulp ≈ 9·10⁻¹⁰ m'dir. Göreli terim bu ölçekte 4,4·10⁻⁸ m'ye izin verir; bu da milimetrenin çok altıdır.
- **Faz A kapsamı:** tanımı iki tarafta da tam olan işlevler:
  - bulge yayı, yollu uzunluk, halka alanı, işaretli alan;
  - delikli çokgen alanı ve çevresi;
  - nokta-çokgen testi;
  - düz şekillerin ve dairenin sınır kutusu.
- **Bilinen fark:** TypeScript `entityBounds`, yaylı yolların ve yayların sınırını 72 parçalı ana hatla bulur (yaklaşık). Rust'a kesin yay sınırı taşınırken iki taraf birlikte değişecek; o güne kadar bu işlevler golden setinde yoktur.

## Sonuçlar

- Rust ve TypeScript arasındaki her uyumsuzluk bir testte görünür. Sözleşme değişikliği TS tarafında derleme hatası olarak ortaya çıkar.
- Opak stil alanları v1'de doğrulanmaz. Doğrulama şimdilik `src/style/file.ts` içindeki TypeScript okuyucusunda kalır.
