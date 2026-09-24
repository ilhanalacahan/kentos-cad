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
- **Geçiş tamam (S1–S5, S3a–S3c):** seçme, kenar seçme, kenet, pencere seçimi, çevreleyen şekil, sınır kenarları, etiket kararları, tutamaçlar, buda ve uzat önizlemesi ve sonucu, taşıma/kopyalama/esnetme/yapıştırma hayaletleri, seçim toplamları, katman kurulurken çizilen geometri, dolguların üçgenlenmesi ve çizimdeki ifadelerin geometri değerleri Rust geometri deposundan geliyor (`viewport/picking.ts` → `geometry-core::store`). S3a/S3b'de `model/ops`, `model/geom` ve ilkel modüller (`model/geometry.ts`'in ölçüleri, `entities.ts`, `render/triangulate.ts`) çekirdeğin ince cephelerine döndü; S3c'de son TS referansları silindi ve tek kaynak bekçisi geldi. Stil motoru, ifade dili ve SVG düzenleyicisinin kendi geometrisi dışında TS'te geometri algoritması yok. Uygulama çekirdeği açılışta yükler (`src/wasm/core.ts`), worker derlenmiş modülü ilk işiyle alır.
- **S4 yapıldı:** işlem araçlarının geometrisi (köşe numaralama, köşe yazısının yeri, kenar ölçüleri, “görünen” kapsamının kutu testi, ifadelerin geometri değerleri) çekirdekten geliyor. Her çalıştırma okuduğu nesnelerden kendi deposunu kurar, sayfada da worker'da da aynı kodla (`processing/job.ts` `runJob`, `processing/geometry.ts`; ADR 0008 “İşlem araçları ve worker (S4)”).
- **S5 yapıldı:** araçların ve nesne izlemenin satır içi hesapları (nokta girişi, orto/kutupsal imleç, nesne izleme, nokta hesabının kendi aritmetiği, araçların yapı hesapları; 39 işlem) `geometry-core::tools`'tan geliyor (`src/tools/constructions.ts`, ADR 0008 “Araç ve görünüm hesapları (S5)”).
- **Aynı gün main'e girenler:**
  - Yeni proje (`file.new`);
  - bulut projesini yeniden adlandırma ve yumuşak silme (migration 0002);
  - olay günlüğü budama (migration 0003);
  - etkileşim ölçüm düzeneği (`pnpm perf:interaction`) ve TypeScript tabanı.
- **Son doğrulama (main, S2 commit'i, bulut konteyneri):**
  - `npx tsc --noEmit -p .` temiz, `pnpm test` geçti.
  - `cargo test --workspace` ve `cargo clippy --workspace --all-targets -- -D warnings` temiz (veritabanı testleri sır olmadığı için atlandı).
  - `pnpm e2e`: WebGPU'ya ait üç denetim dışında hepsi geçti; o üçü taban commit'te de (747d942) aynı biçimde düşüyor (bkz. §5, bulut konteyneri).
- **WASM paketi:** 882 KB, gzip ile 298 KB (S1a'da +32, S1b'de +5, S1c'de +8, S2'de +3, S3a'da +4, S5'te +16, S4'te +14, S3b'de +0,3 KB gzip; S3b'de kullanılmayan eski girişler silindi). ADR 0005 taslağındaki başlangıç sınırı 300 KB gzip; ~2 KB kaldı (§6 madde 8).
- **Ölçüm tabanı** (kullanıcının makinesi):
  - 81 000 nesnede seçme ve kenet: fare hareketi başına 9–13 ms (hedef < 2 ms).
  - 1 milyon parçalı eşyükseltide budama önizlemesi: kare başına ~0,75 s.

## 3. Sıradaki işler (bu sırayla)

### S1: WASM geometri deposu (en büyük kazanç)

- **S1a yapıldı:** `geometry-core::store` (nesnelerin kopyası, katman tablosu, sınır kutuları, Hilbert sıralı R-ağacı, belge sırası), `hit`/`hitEdge`/`snap`/`inRect`/`overlapping`/`enclosing`/`edgesIn`; `viewport/picking.ts` ince yüz oldu. Ayrıntılar ADR 0008 “Geometri deposu”nda.
  - Eşitleme `touched` ile; `load`/`replaceWith` yeni `reset` olayını yayar. `applyExternal` `touched` yaydığı için tam eşitleme gerekmedi.
  - Nesneler JSON değil paketli gider (`src/wasm/pack.ts`, `store/pack.rs`): 26 MB JSON WASM'da 5–7 s sürüyordu, paketli 0,1–0,3 s.
  - Eski TS `PickIndex` parity referansıydı; S3c'de silindi. Donmuş yanıtlar `fixtures/geometry/v1/store-v1.json`.
- **S1b yapıldı:** etiket kararları (`labels`) ve tutamaçlar (`grips`) depodan; `drawLabels`, `drawGrips`, `gripAt` kayıtları kullanır (`viewport/storeRecords.ts`). Eski karar mantığı referanstı (S3c'de silindi).
- **S1c yapıldı:** `trimPreview`/`extendPreview` (hedef ve sınırlar tek çağrıda; depo `trim_entity`/`extend_entity`'e yalnız hedefe ya da ucun ışınına/çemberine değebilecek kenarları verir), `transformOutlines` (hayalet yolları), `stretchOutlines`, `measure` (`PropertiesPanel` toplamları); `PasteTool` kendi deposunu kurar. Eski hesap referanstı (S3c'de silindi); donmuş dosyaya 400 durum eklendi. Aynı makinede `hat-1m` budama önizlemesi 1:1000'de 1,5 s → 10 ms (ADR 0008).
- **S1d yapıldı (bulut ölçümü):** P8 (`d8a7beb`) ve S1c (`21ac4c5`) aynı konteynerde SwiftShader ile ölçüldü (`docs/perf/interaction-s1-before.md`, `interaction-s1-after.md`, özet `docs/perf/README.md`, ADR 0008 “Uygulamada önce/sonra”). İmleç başına seçme ve kenet `parsel-50k`'da ~19 ms'den 0,1–3 ms'ye, `hat-1m` budama önizlemesi 972 ms'den 18 ms'ye indi. `hat-1m` genel görünümde kenet 32 ms (p95) ile hâlâ yüksek: sıradaki iyileştirme hedefi.
- **Kabul ölçümü kullanıcıda:** `pnpm perf:interaction --label s1` (tabanla karşılaştırmalı, kullanıcının makinesinde). Kabul: tabana göre p95'te gerileme olmamalı. Sonuç gelince ADR 0008 ve `docs/perf/README.md`'ye yazılır.
- **Ölçüm yöntemi (bulut):** `pnpm perf:interaction` her veri setinde sayfayı yeniden açar ve çalışma dizinindeki kaynağı sunar; ölçüm sürerken kaynak değişirse ölçüm bozulur. “Önce” ölçümünü taban commit'in ayrı bir git worktree'sinde (kendi `node_modules` bağı ve WASM paketiyle), “sonra”yı ardından çalışma dizininde alın. SwiftShader'da `--allow-swiftshader` gerekir; yalnız ana iş parçacığı süreleri anlamlıdır, bir koşu ~50 dk sürer. Makinede başka iş varken p95 güvenilmez.

### S2: çizim hattı (yapıldı)

- `render/styledLayer.ts` ve `render/sceneBuilder.ts` çizilecek geometriyi katman başına tek çağrıda alır (`PickIndex.drawn` → `store/draw.rs`; `style/geometry.ts` `DrawnReader` okur). Nesnenin kendi noktaları kopyalanmaz, kayıt onlara başvurur. Tek nesnelik `styledGeometry` (sembol önizlemeleri) aynı kaydı `drawnGeometry` işlemiyle alır.
- `render/styledSink.ts` ve vurgu katmanı dolguları `render/fillQueue.ts` ile katman bitince tek `triangulateMany` çağrısında üçgenler.
- Çizimdeki ifadelerin `$alan`, `$uzunluk`, `$y`, `$x` değerleri ilk istenince katman için bir kez `measures` ile gelir (`ExprScope.measured`). İşlem araçları ve sınıflama S4'te bunları da depodan alır (lejant ifade değerlendirmez).
- Eski hesap referanstı (S3c'de silindi); derin koşu temiz, donmuş dosyada çizim ve değer durumları var. E2e'de WebGL2'nin piksel sayısı değişmedi. Katman kurma süresi S1c ile başa baş (ADR 0008 “Çizim hattı”).

### S3: cephe ve TypeScript'in silinmesi

- **S3a yapıldı:** `model/ops`'un 16 dosyası ve üst düzey `model/geom` modülleri ince cephe (`op('ad')`); `geom/arrangement.ts` silindi. Ayrıntılar ADR 0008 “Cephe ve TypeScript'in silinmesi (S3a)”.
  - Silmeden önce 192 işlemin derin koşusu (20 000'er durum) P8 worktree'sinde temiz geçti.
  - Nesne döndüren işlemler `model/ops/entityOp.ts` ile sarılır: çekirdek `None` alanı yazmaz, `doc.update` birleştirdiği için eksik `bulges`/`holes` `undefined` olarak eklenir.
  - Parity kümelerinin `fns` alanı yalnız TS'i duran işlemleri tutar; çevrilenler donmuş fixture'larla sınanır. Kaydedici TS'i olmayan işlemde çekirdeğin sonucunu yazar.
  - Yeni sınır girişleri: WASM `FaceIndex` sınıfı (tarama ve içine tıklayarak alanın yüz dizini), `offsetPathXY`, `hatchLinesXY`, `transformEntities` (taşı/kopyala/dizi/yapıştır tek çağrı), `divisionPoints` (Böl önizlemesi tek çağrı).
  - Bilinen maliyet: 10 000 nesneyi taşımak JSON yüzünden ~0,15 s (TS ~0,01 s). İyileştirme: dönüşümü depoda yapıp sonucu paketli döndürmek.
- **S3b yapıldı:** ilkel modüller (`model/geometry.ts`'in ölçüleri, `geom/affine`, `arc`, `bulge`, `intersect`, `ellipse`, `spline`, `model/entities.ts`, `render/triangulate.ts`) de cephe; stil motoru, ifade dili ve SVG düzenleyicisinin kendi geometrisi dışında TS'te geometri algoritması kalmadı. Ayrıntılar ADR 0008 “İlkel modüller (S3b)”.
  - `dist`, `angleDeg`, `bearingGrad`, `distToSegment` sayı alan girişlerden; halka ölçüleri çekirdeğin belleğindeki kazıma tamponundan (bellek ayırmadan) geçer.
  - Tümünü göster, pano taban noktası ve kutupsal dizinin seçim ortası depodaki `extent(ids)` sorgusundan gelir.
  - TS'te kalan kayıt işleri: tipler, kutu büyütme, `bulgeAt`, `entityGeometry`, sabitler.
- **S3c yapıldı:** son TS referansları silindi, tek kaynak bekçisi eklendi. Ayrıntılar ADR 0008 “Tek kaynak bekçisi ve TS referanslarının silinmesi (S3c)”.
  - Son derin koşu (S3b'den sonra): S4/S5 çağrı kümeleri işlem başına 20 000, depo parity'si iki sahnede 5 000'er tur, işlem parity'si 2 000 tur; temiz. Depo turu ~75 ms sürdüğü için 20 000 tur 50 dakikayı ve testin süre sınırını aşardı.
  - Silinenler: `src/wasm/parity/reference/*`, `parity.test.ts`, depo ve işlem parity testleri, kümelerin `fns`/`ties` alanları. Kalan `src/wasm/calls/` (kümeler, sahne, `storeCases.ts`, bağımsız referans testi).
  - Referanssız yerine geçenler: `viewport/picking.test.ts` (eşitlenen depo = baştan kurulan depo, düzenlemeler boyunca), `processing/runs.test.ts` (sayfa = worker, kapsam ve önizleme iki yoldan aynı).
  - Bekçi `src/model/singleSource.test.ts`: cephelerde aritmetik ve `Math.` yok (TypeScript sözdizimi ağacıyla; sayma/dizinleme serbest, tek istisna `extendBounds`).
  - Kaydediciler çekirdekten kaydeder; mevcut dosyaları son bite kadar yeniden ürettiler (ADR'de), donmuş dosyalar TS'ten kaydedildiği gibi kaldı.
- Kare başına binlerce çağrı yapan yerler toplu API alır; bölme noktaları ve tarama önizlemesi S3a'da yapıldı.

### S4: worker (yapıldı)

- Sayfadaki `clientExecutor` ve worker'ın `handleJob`'ı aynı `runJob`'ı çağırır: çalıştırma okuduğu nesneleri (features girdileri) kendi deposuna paketler (`ObjectStore`, `processing/geometry.ts`), araç `ctx.geometry` ile kimlikten sorar; depo çalıştırma bitince bırakılır.
- Çekirdeğe geçenler (`crates/geometry-core/src/processing/`, `store/processing.rs`): köşe numaralama (halka sırası, ortak köşe ızgarası, dışa bakan yön; adlar ve sayaç TS'te `nameCorners`), köşe yazısının yeri (`cornerTexts`), kenar ölçüsü yazıları ve ortak kenar anahtarları (`edgeLengths`), “görünen” kapsamının kutu testi (`inBox`, pencerede görünümün deposu). İfadelerin geometri değerleri Öznitelik hesapla, İfadeyle seç, pencere önizlemesi, sınıflama ve kural süzgeçlerinde bütün nesneler için bir kez depodan gelir.
- Taşırken TS'te üç kırılganlık bulundu ve iki tarafta düzeltildi (ADR 0008 “S4'te bulunanlar”): boş halkada `TypeError`, adsız noktanın numara yutması, 2^53'ün ötesinde bitmeyen ızgara döngüsü.
- Eski hesap referanstı (S3c'de silindi). Çağrı kümesi S4 ve araç parity'si derin koşuda temiz; donmuş dosyalar `calls-s4-processing.json` ve `store-processing.json`.
- **Ölçüm (bulut, 50 000 parsel):** numaralama 871 → 289 ms, kenar uzunlukları 280 → 158 ms (ortanca); `$alan` yazan Öznitelik hesapla sayfada 53 → 136 ms (depo kurulumu; Otomatik 2 000 nesneden sonra worker'ı seçer).

### S5: araç ve görünümdeki satır içi hesaplar (yapıldı)

- **Yapıldı:** nokta girişi (`coordinateInput.ts`: göreli, kutupsal, imleç yönünde), orto ve kutupsal imleç (`tracking.ts` → `constrainCursor`), nesne izleme (`viewport/objectTracking.ts`), nokta hesabının kendi aritmetiği ve araçların yapı hesapları (yarıçapla düzgün çokgen, yay devamı, açıortay, çoklu çizgi yay parçaları, köşe yuvarla ve pah, döndür, ölçekle, kutupsal dizi, hizala, ölçü kolları, halka …) `geometry-core::tools`'ta; araçlar `src/tools/constructions.ts` ile çağırır. Derin koşu temiz, `calls-s5-*.json` donduruldu. Kutupsal dizide TM'deki bir kırılganlık iki tarafta düzeltildi. TS'te kalanların listesi ve gerekçesi ADR 0008'de.
- **Doğrulama (S5 dalı):** `npx tsc --noEmit -p .` ve `pnpm test` temiz, `pnpm rust:test` (clippy dahil) temiz, `pnpm e2e`'de yalnız WebGPU'nun bilinen üç denetimi düştü.
- **Kalan:**
  - Araçların çağırdığı ilkel model işlevleri (`dist`, `angleDeg` …) S3b'de o modüllerle birlikte cepheye döndü (`survey` S3a'da); eski TS referansları S3c'de silindi.
  - Yazılan değerlerin tek IEEE işlemiyle yeniden ifadesi (derece → radyan, kâğıt mm → metre, `hedef − temel`, uzat-kısalt farkı) ve dikdörtgen dizinin ötelemeleri (tek çarpım; büyük bir dizinin önizlemesi her karede binlerce ötelemeyi JSON'dan geçirirdi) bilerek TS'te kaldı; komutlar sunucuya gidince (CLAUDE.md §18) komut zarfıyla birlikte yeniden bakılır. Kullanıcı aksini isterse küçük işlemlerle taşınır.

### S6: belgeler ve ölçüm raporu

- CLAUDE.md güncellenir:
  - §2, §4.1, §4.8.1 (çekirdek Rust'ta), §4.9 (PickIndex → depo), §9.4, §11 (“Rust alt küme” borcu kalkar, robust predicates borcu yazılır), §12;
  - §13'e yalnız doğrulanmış durum notu.
- `docs/perf/interaction-*.md`: önce/sonra raporu.

**Kapsam dışı:** stil motoru, ifade dili ve SVG düzenleyicisinin geometrisi (`src/style/svg/*`).
- Bunlar ayrı `style-core` işidir; geometriyi çekirdekten alırlar.
- §23.3 robust predicates, S6'dan sonra ayrı bir dilimdir: yalnız Rust'ta, bağımsız referanslarla. Değişen sonuçlar bilinçli olarak golden dosyaya işlenir.

### Dosya biçimleri (eski `wip/formats-dxf`, main'e alındı)

- **Durum (24 Eylül):** park edilmiş dal yeniden kuruldu, incelendi, düzeltildi, sınandı ve S5'ten sonra main'e alındı (beş commit). Uzak `wip/formats-dxf` olduğu gibi duruyor. ADR 0009 “önerildi”: sahibinin onayını bekliyor; açık kararlar §6'da.
- **Commit'ler (sırayla):**
  - koordinat listeleri: Netcad NCN, TXT, CSV içe/dışa aktarma (eski `7ff6950`);
  - DXF içe aktarma: ASCII DXF, bloklar tam patlatılır (eski `dcf3f2e`);
  - incelemenin düzeltmeleri ve testleri;
  - `crates/formats` ve `crates/formats-wasm`'da yalnız rustfmt (dal biçimlenmemişti, `cargo fmt --all -- --check` düşüyordu);
  - belgeler (CLAUDE.md §1–12, ADR 0009, bu dosya).
- **Çakışmalar:** CLAUDE.md (§4.3 `files` satırı, §4.8 Kaydet/Aç ve Yeni proje, §9.4 duman testi, §11, §12), `app/createApp.ts` (bulut yeniden adlandırma ve silme ile komut kaydı), `app/fileIO.ts` (`DiscardChoice` ile `PickedFile`, `pickForImport`). Hepsinde main'in metni korundu, dalın eklemeleri üstüne kondu. `Cargo.lock` yalnız cargo ile güncellendi; yeni dış bağımlılık yok (npm de).
- **WIP `0320b7f` alınmadı** (uzak dalda duruyor). DXF yazıcısının (Dosya → Dışa aktar → DXF) başlangıcıydı ve derlenmiyordu (`dxf/xdata.rs` modül listesinde bile yoktu):
  - sözleşmede `DxfWriteLayer` ve `DxfWriteInput`;
  - KentOS'un kendi genişletilmiş verisini (1001 `KENTOS`: etiket, öznitelikler, deliğin dış halkasının tanıtıcısı, Catmull-Rom ve kapalı işaretleri) okuyan bir ayrıştırıcı;
  - KentOS eğrisini tam Bézier parçalarına çeviren `catmull_rom_beziers` (testli).
  - Yazıcının kendisi, `writeDxf`, pencere, komut ve testler yoktu. DXF dışa aktarma ayrı bir dilimdir ve oradan başlayabilir. İçe aktarıcıdaki kancaları (varlık tanıtıcısı, `KENTOS` verisinin okunması) bu yüzden kaldırıldı.
- **İncelemede düzeltilenler** (ayrıntı commit iletisinde ve ADR 0009'da):
  - Biçimler, uygulamanın da hesapladığını ortak çekirdekten alır (`bulge_path_outline`, alan, içerme); kopyaları silindi. DXF taramasının çoklu çizgi sınırı artık uygulamanın kendi taramasıyla aynı noktaları alır. Biçim modülü 494 KB (gzip 187 KB), öncekinden 5 KB küçük.
  - DXF: katman adı tablodaki yazılışıyla (büyük/küçük harf); okunamayan ATTRIB raporlanır; blok açmada adım sınırı (hiçbir şey çizmeyen iç içe bloklar worker'ı kilitliyordu); MINSERT hücreleri 10 000'den çok sütunda yanlış satıra düşüyordu, dizi 10 000 × 10 000 ile sınırlandı; NURBS derecesi en çok 25; hesaplanamayan tarama eğrisi raporlanır; ACI 251–254 AutoCAD'in gri tonları.
  - Tarayıcı: `readDxf` bütün arabelleği devreder, görünümü kopyalar (pencere `bytes.buffer` gönderiyordu); koordinat listesi penceresi kapanınca önizleme okuması durur; açık düzenleme ya da model grubu varken içe aktarma beklenir (modelin geri alma adımına katılıp iptaliyle geri alınıyordu).
  - Yeni testler: `io/client.test.ts`, `io/coords.test.ts`, `io/apply.test.ts`'e çalışan model; Rust'ta katman adı, öznitelik raporu, dolaşma sınırı, MINSERT ızgarası, derece sınırı, sınır bayrakları, örnekleme kuralı, gri tonlar.
- **Doğrulama (bulut konteyneri, dalın son hâli):** `cargo test -p kentos-formats` 49 test; `pnpm rust:test` (workspace testleri ve clippy `-D warnings`) temiz, 220 test (veritabanı testleri sır olmadığı için atlandı); `cargo fmt --all -- --check` temiz; `npx tsc --noEmit -p .` temiz; `pnpm test` 791 test geçti (5 fixture kaydedicisi atlandı); `pnpm e2e`: 100 denetim geçti; düşen üçü bu konteynerde main'de de düşen WebGPU denetimleri (aygıt kaybı).
- **Kalan:** sahibinin ADR 0009 onayı; DXF dışa aktarma dilimi; büyük dosyada içe aktarmanın ana iş parçacığındaki süresinin ölçülmesi (JSON ayrıştırma, denetim, belgeye ekleme; ölçülmedi).

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
- **Çağrı kümesi:** `src/wasm/calls/sets/*.ts` dosyasına adlı sınır durumları ve tohumlu rastgele çağrılar (`repeat`, `Gen`) yazılır, küme `sets.ts`'e eklenir. Yeni bir çekirdek işlevi (TS karşılığı olmayan) kümeye yazılır ve kaydediciyle dondurulur; beklenen değerler çekirdekten gelir, fark okunarak doğrulanır, bağımsız referans eklenir.
  - Üreteçler çekirdeğin hata döndürdüğü girdileri üretmemeli; test donanımı istisna yakalamaz.
- **TS'ten taşıma (style-core gibi):** S3c'de TS ↔ Rust karşılaştırması (`parity.test.ts`, kümelerin `fns` ve `ties` alanları) son referanslarla birlikte silindi; `git show c7445e0:src/wasm/parity/parity.test.ts` ve `c7445e0:src/wasm/parity/harness.ts` yöntemin çalışan biçimidir. Taşınacak TS'i kümenin `fns` alanına koyup testi geri getirin:
  - normal: işlem başına 200 durum; derin: `PARITY_CASES=20000`;
  - tolerans 1e-9 + 1e-14 · büyüklüktür; gerekçeli istisnalar kümede `tolerance`, eşit ölçülü sıra değişimleri `ties` ile bildirilir;
  - derin koşu temizse TS silinir, karşılaştırma yeniden kaldırılır ve tek kaynak bekçisi (`src/model/singleSource.test.ts`) yeni cephe dosyalarını listesine alır.
- **Fark çıkarsa:** çoğu zaman TypeScript'te gizli bir kırılganlık ya da hatadır.
  - Önce hatayı yeniden üreten bir TS birim testi yazın.
  - Sonra TS ve Rust'ı aynı biçimde düzeltin ve ADR 0008'e yazın.
  - Örnekler ADR'dedir: halka izlemede ikiz parça, elipste en yakın nokta, ortak köşede en yakın kenar.
- **Fixture:**
  - `GOLDEN_WRITE=1 npx vitest run scripts/fixtures/record-calls.test.ts` (depo için `record-store.test.ts`, `record-store-processing.test.ts`); kaydediciler S3c'den beri yanıtı çekirdekten alır, yeniden kayıt bilinçli bir golden değişikliğidir;
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
8. WASM paketi ADR 0005 taslağındaki 300 KB gzip başlangıç sınırına dayandı (S3a'da 267 KB, S5 ile 283 KB, S4 ile 297 KB, S3b'de kullanılmayan girişler silinince 298 KB; ~2 KB kaldı, bir sonraki dilim aşar). Seçenekler: işlev adları bölümünü üretim paketinden atmak (S1 sonunda −18 KB gzip; bedeli tuzakta yığın izinde ad yerine numara), sınırı değiştirmek ya da ağır işlemleri ayrı pakete bölmek.
9. Dosya biçimleri (ADR 0009) main'e alındı; ADR'nin onayı bekliyor.
10. İçe aktarmada “Bu koordinatlar hangi sistemde?” sorusu projenin sistemi seçili açılıyor; içe aktarılabilen tek seçenek o olduğu için kullanıcı hiçbir şeye dokunmadan içe aktarabiliyor. Seçim yapılmadan “İçe aktar” düğmesi kapalı mı kalsın (açık onay)?
11. DXF ACI 251–254 gri tonları AutoCAD 2000 ve sonrasının tablosuna (ezdxf ile aynı: 80, 105, 130, 190) göre düzeltildi; bir AutoCAD çizimiyle doğrulanması iyi olur.
