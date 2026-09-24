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

- Çekirdek geometri tipini kendisi tanımlar: `entity::Shape` (13 tür, `kind` etiketli, TS'teki `EntityGeometry` biçiminde). `kentos-contracts`'a bağlanmaz; ts-rs ve sözleşme türetmeleri WASM paketine girmez. Plan metnindeki “geometry-core → contracts” bağımlılığı bu yüzden kurulmadı.
- `entity::Entity` = `Shape` + çekirdeğin yorumlamadığı bütün alanlar (`rest`: kimlik, katman, renk, öznitelikler, etiket, sembol), geldikleri gibi ve sırasıyla. TS'te `{ ...e, … }` döndüren işlemler (dönüşüm, tutamaç) bu alanları değişmeden geri verir; yeni bir şekil kuran işlemler (`{ kind: 'arc', … }`) vermez. `entityGeometry` TS'teki gibi yalnız kimlik, katman, öznitelik, renk ve etiketi düşürür.

### Sınır

- **Çağrı tablosu** (`geometry-core/src/api`): her işlem TS'teki adıyla kayıtlıdır.
  - Argümanlar konumsal JSON dizisi olarak gelir (`undefined` → `null`), sonuç JSON olarak döner.
  - WASM `opId(ad)` ile `callOp(id, argümanlar)` dışa açar; TS cephesi `op(ad)` ile tipli bir çağırıcı kurar (`src/wasm/core.ts`).
  - Yerel golden testleri aynı tablodan geçer, yani iki hedef de uygulamanın yolunu sınar.
- **JSON serde'siz:** çekirdeğin tipleri kendilerini küçük bir JSON modülüyle okur ve yazar (`api/json.rs`: ayrıştırıcı, yazıcı, `FromJson`/`ToJson`, `json_struct!`/`json_tagged!` makroları). serde'nin tip başına ziyaretçi ve yazıcı kodu paketin %42'siydi; çekirdek artık serde'ye yalnız testlerde bağlıdır.
- **Sayılar bit bit geçer:**
  - Sayılar Rust'ın doğru yuvarlayan `str::parse::<f64>` işleviyle okunur; JSON.parse ile aynı float64'ü verir.
  - Sonuçlar en kısa geri dönüşlü biçimde yazılır; NaN, +∞ ve −∞ sırasıyla `"#NaN"`, `"#Inf"`, `"#-Inf"` olur ve `core.ts` bunları sayıya geri çevirir. serde_json bu değerleri `null` yapardı; `null · 2 = 0` sessizce yanlış sonuç verirdi.
  - JSON.stringify NaN ve ±∞'u `null` yazdığı için, sayı beklenen yerde `null` NaN okunur; TS de NaN'ı taşımaya devam ederdi. Eksik alan `null` sayılır; `None` olan `Option` alanları yazılmaz (TS'in tanımsız özellikleri yazmaması gibi); bilinmeyen alanlar yok sayılır.
  - `JSON.stringify(-0)` `"0"` yazar. Girdideki −0 korunmaz; `.kcad` ve bulut kaydı da bunu zaten korumuyor.
- **`undefined` ve `null`:** JSON'da `undefined` yoktur. `op(ad, true)`, TS işlevi yokluk için `undefined` döndürüyorsa `null`'u `undefined`'a çevirir. İsteğe bağlı alanlar çekirdekte yazılmaz (`skip_serializing_if`).
- **Tipli toplu girişler:** kare başına binlerce çağrı yapan yerler JSON tablosundan değil, `Float64Array` giren ve dizi dönen tipli girişlerden geçer (`crates/wasm`, `core.ts`). Tuzak bildirimi `op` ile aynıdır.
  - İlki `triangulateMany(xy, ringSizes, polyRings)`: bir katmanın bütün dolguları tek çağrıda. Halkaların noktaları art arda, halka başına köşe sayısı, çokgen başına halka sayısı (önce dış halka, sonra delikler) girer; üçgen başına üç köşe dizini döner.
  - Dizin dönmesinin nedeni: köprü köşeleri yalnız yineler, yeni nokta kurmaz. Dolgunun koordinatları çağıranın kendi noktalarıdır; orijine göre fark (§4.9) çizim paketlemesidir ve TS'te kalır.
  - Tipli giriş adıyla çağrılan karşılığıyla (`triangulate`) sınanır (`src/wasm/triangulate.wasm.test.ts`); o da parity testiyle TS'e bağlıdır ve fixture'la dondurulur. Aynı test basit halkalarda üçgen alanlarının toplamının halkanın alanına eşit olduğunu denetler.
  - Aynı makinede (bulut, Node 22) 50 000 halka: TS döngüsü 160–350 ms, paketleme dahil toplu çağrı ısındıktan sonra 48–60 ms; Float32 çıktı bit bit aynı.
- **Sıcak yollar (S1, S2):** kenet, seçme, etiket, tutamaç, hayaletler, budama ve uzatma önizlemesi, seçim toplamları ve katman kurulurken çizilen geometri JSON tablosundan geçmez. Belgenin kopyasını tutan bir geometri deposuna (`Store`) tipli, `Float64Array` giriş-çıkışlı toplu sorgular yapılır. Ayrıntısı aşağıda “Geometri deposu” başlığındadır.

### Geometri deposu (S1)

- **Yer:** `geometry-core::store` (Rust), WASM'da `GeometryStore` sınıfı (`crates/wasm/src/store.rs`), TS'te `CoreStore` (`src/wasm/core.ts`). `src/viewport/picking.ts` (`PickIndex`) artık ince bir yüzdür: aynı API'yi depoyla karşılar ve depoyu belgeyle eşit tutar. Pano gibi ikinci bir kopya kendi deposunu açar.
- **İçerik:** nesne başına kimlik, şekil (`Shape`), katman, etiket bayrağı ve önbellekli sınır kutusu; katman tablosu (görünür, kilitli, `pickInterior`; atalardan çözülmüş olarak TS'ten gelir, tabloda olmayan katman TS'teki gibi görünür, kilitsiz ve içi seçilebilir sayılır).
- **Belge sırası:** eşit sonuçları (ortak kenarı olan iki parsel) TS'teki `Map` sırası seçiyordu. Depo bu sırayı birebir tutar: yeni kimlik sona eklenir, bilinen kimlik yerinde kalır, silinip geri gelen (geri alma) sona gider. Her sorgu adaylarını bu sıraya dizip TS'in karşılaştırmalarını aynen uygular.
- **Uzamsal dizin:** Hilbert sıralı, paketlenmiş bir R-ağacı (flatbush düzeni, düğümde 16 kutu). Ağaç yalnız adayları daraltır: sorgu kutusu yuvarlamaya karşı biraz genişletilir, karar TS'teki kesin testle verilir. Son kurulumdan beri değişen nesneler ve ağaca girmeyen “özel” nesneler (sonsuz doğrular, boş ya da sonlu olmayan kutular: TS bunları her zaman aday sayıyordu ya da hiç saymıyordu) her sorguda doğrudan taranır; değişenler 256'yı ya da nesnelerin on altıda birini aşınca ağaç yeniden kurulur.
- **Eşitleme:** `doc.events.touched` ile. Silmeler hemen gider; eklenen ya da değişenler bir sonraki sorguya kadar bekler ve ilk dokunuş sırasıyla gönderilir. Böylece yeni nesneler belgenin sırasıyla eklenir; silinip geri gelen nesne bekleyenlerden düştüğü için sona eklenir. `applyExternal` de `touched` yaydığı için ayrıca tam eşitleme gerekmez. `load` ve `replaceWith` yeni `reset` olayını yayar; depo her şeyi baştan alır, bunu ilk imleç hareketine bırakmadan hemen ardından ayrı bir görevde yapar. Katman ağacı ya da durumu değişince tablo yeniden gönderilir.
- **Paketli gönderim:** nesneler ilk sürümde JSON ile gidiyordu. 80 000 parsel 26 MB JSON'du; çekirdeğin ayrıştırıcısı önce milyonlarca küçük değerden bir ağaç kurduğu için WASM'da 5–7 s sürdü (JS yığını büyükken WASM belleği binlerce küçük adımda büyüyor, V8 her adımda yığını süpürüyor; aynı iş native'de 0,6 s). Artık nesneler `src/wasm/pack.ts` ile tek bir `Float64Array` sayı akışına ve kısa bir metin listesine (katman kimlikleri, yazılar) paketlenir, Rust doğrudan şekle okur (`store/pack.rs`). Aynı makinede ilk eşitleme `parsel-50k` için 0,28 s (paketleme 66 ms), sonrakiler 0,11 s; `hat-1m` 0,10–0,16 s. Sayılar float64 olarak bit bit geçer; JSON'un kaybettiği −0 ve NaN da korunur. JSON yolu fixture'lar ve testler için kalır; paketli yolun her türde JSON ile aynı nesneyi kurduğunu `src/wasm/pack.test.ts` denetler.
- **Sorgular (S1a):** `hit`, `hitEdge` (en yakından uzağa aday listesi; TS'teki süzgeç işlevi listede ilk kabul edilene uygulanır, sonuç aynıdır), `snap` (türler bit kümesi, son nokta isteğe bağlı), `inRect`, `overlapping`, `enclosing`, `edgesIn` (kenarlar paketli sayı olarak). Kurallar `picking.ts`'teki gibidir: nokta ve kenar içlerden önce, imleci içeren en küçük alan, eşit uzaklıkta daha anlamlı kenet türü, “en yakın” yalnız başka aday yoksa, çokgenin delik köşeleri dahil TS'in gezdiği biçimde orta noktalar.
- **Doğrulama:** eski TS `PickIndex` parity referansı olarak `src/wasm/parity/reference/picking.ts`'te kalır (S3'te silinecek). `src/wasm/parity/store.test.ts` örnek projede ve tohumlu rastgele bir sahnede (gizli, kilitli, yalnız kenardan seçilen ve ağaçta olmayan katmanlar; ortak kenarlı parseller ve taramalar; bozuk nesneler) aynı imleç, tolerans, kenet türleri ve kutularla iki tarafı karşılaştırır; turlar arasında belge düzenlenir (ekle, taşı, sil, geri al, yinele, işlem, başka editörün değişikliği, katman gizle ve kilitle, yeniden yükle) ve depo sırasının belgeninkiyle aynı kaldığı denetlenir. Derin koşu (`PARITY_CASES=20000`, tur başına dokuz sorgu) temiz geçti. Sabit bir sahnede TS'in yanıtları `fixtures/geometry/v1/store-v1.json`'a dondurulur (`scripts/fixtures/record-store.test.ts`); native (`tests/store.rs`) ve WASM (`src/wasm/store.wasm.test.ts`) aynı dosyayı okur.
- **Etiketler ve tutamaçlar (S1b):** üst katman her karede bütün nesneleri gezip etiket kararını veriyordu. Artık depo `labels(görünüm, ölçek, düzenlenen)` ile karar verir: görünür katman, kutusu görünümde, yazı ve ölçü ekranda 5–240 px, etiket stilinin `minScale`/`maxScale`/`minFeaturePx` süzgeçleri; katmanın etiket kuralı katman tablosuyla, türlerin varsayılanları (`DEFAULT_LABELS`, `viewport/storeRecords.ts`) bir kez gider. Kayıt başına sekiz sayı döner (kimlik, ne, yer ve ölçüde açı, değer, birim, önek; yol boyunca yerleşimde iki köşe); metin, şablon, boyut ve renk TS'te nesneden ve stilden okunur, çizim değişmedi. `grips(ids)` seçili nesnelerin tutamaçlarını ve orta tutamaçların kenarını verir; `drawGrips`, `gripAt` ve `midGripVisible` bunu kullanır. Köşesi olmayan bir yolun merkez etiketi TS'te `undefined` noktayla hata verirdi; depo onu atlar. Parity için eski karar mantığı çizimsiz olarak `src/wasm/parity/reference/overlay.ts`'te durur ve aynı kayıtları üretir.
- **Araç önizlemeleri ve toplamlar (S1c):**
  - **Buda ve uzat** hedefi ve sınırları tek çağrıda verir (`trimPreview`, `extendPreview`; TS'te `view.trim`, `view.extend`). Sınırlar TS'teki gibidir: seçilen nesneler ya da görünümdeki görünür nesneler, hedef hariç. Budama ve uzatmanın sonucu yalnız hedefe değen kenarlara bağlıdır: kesimler sıralanıp birleştirilir, uzatmada en yakın erişim alınır; kenarların sırası ve hedefe değmeyen kenarlar sonucu değiştirmez. Bu yüzden depo `trim_entity`/`extend_entity`'e yalnız kutusu hedefin kenar kutularına (budama; elipste bütün elipsin kutusu) ya da ucun uzayacağı ışına veya çembere (uzatma; uç ve dal `extend_entity`'deki gibi seçilir) değen kenarları verir. Kutular kesişim toleransları için mikrometre düzeyinde genişletilir; sonsuz doğrulara her zaman bakılır. TS 1 milyon parçalık eşyükseltide görünümdeki her kenarı hedefin her kenarıyla kesiştiriyordu.
  - **Hayaletler:** `transformOutlines(ids, afinler, sınır)` taşı, kopyala, döndür, ölçekle, aynala, dizi ve yapıştırmanın hayaletlerini `strokeGeometry`'nin çizdiği yollar olarak verir: yol başına bayrak (0 açık, 1 kapalı, 2 işaret), köşe sayısı ve noktalar; en çok `sınır` + 1 nesne, `SelectionFirstTool.draw`'ın saydığı gibi. `stretchOutlines` esnetin hayaletlerini, `measure(ids)` özellikler panelinin toplamlarını verir (alanların çevresi uzunluğa girmez; toplama sırası seçiminki). Yolları `tools/preview.ts` `strokePaths` çizer.
  - **Pano:** yapıştırılacak nesneler belgede olmadığı için `PasteTool` panodan kendi `CoreStore`'unu kurar (nesneler 1…n numarasıyla) ve araç kapanınca bırakır.
  - **Doğrulama:** eski hesap `src/wasm/parity/reference/tools.ts`'te referanstır. Depo parity testi her turda beş sorguyu (buda ve uzat, seçilen ya da bütün sınırlarla; dönüşüm ve esnet hayaletleri; toplamlar) karşılaştırır; derin koşu (20 000 tur) temiz geçti ve TS'in hata verdiği bir girdi çıkmadı. Donmuş dosyaya 400 durum eklendi; hedefler çoğunlukla işlemin kabul ettiği türlerdendir (80 budamanın 63'ü, 80 uzatmanın 50'si sonuç verir, gerisi TS'in hata metnidir). Önceki durumlar değişmedi.
  - **Aynı makinede ölçüm** (bulut, Node 22, `hat-1m`, çağrı başına): budama önizlemesi 1:1000 görünümde (~340 × 210 m) TS 1 525 ms, S1b (kenarlar depodan, budama TS'te) 1 580 ms, S1c 9,8 ms; genel görünümde TS 43 s, S1c 6,9 ms. Uzatma 1:1000'de 13,6 → 1,2 ms, genel görünümde 286 → 1,1 ms (S1b → S1c).
- **Çok adaylı sorgular:** adaylar belge sırasına dizilir. Aday nesnelerin sekizde birini aşınca sıralama yerine belge sırasındaki liste bir kez yürünür; sorgu kutusu ağacın tamamını kapsıyorsa (genel görünüm) ağaç araması da atlanır.
- **Aynı makinede ölçüm (bulut, Node 22):** imleç başına `parsel-50k`'da seçme yakın görünümde 10,2 → 0,008 ms, genel görünümde 9,9 → 0,05 ms; kenet yakında 10,1 → 0,01 ms, genelde 17,4 → 1,2 ms. Kare başına etiket kararı (çizim hariç; TS referansı sınır kutularını her seferinde yeniden hesapladığı için uygulamadakinden yavaştır): `parsel-50k` yakında 29 → 0,04 ms, genel görünümde 32 → 1,8 ms; `hat-1m` 18 → 0,03 ms. Uygulamadaki etkileşim ölçümü S1'in sonunda alınır (`docs/perf`).

### Çizim hattı (S2)

- **Toplu kayıt:** katman kurucuları nesnelerin çizilecek geometrisini depodan katman başına tek çağrıda alır (`drawn(ids, oriented, clip)`, `store/draw.rs`; TS'te `PickIndex.drawn`, `render/styledLayer.ts` `GeometrySource`). Kayıt başına tür (hiç, işaret, çizgiler, alan), yol ya da halka sayısı ve noktalar gelir. Eğriler (daire, yay, elips, eğri, yaylı çoklu çizgi ve alan) Rust'ta parçalanır. Stil motoru için halkalar TS'teki `oriented` gibi işaretli alanla döndürülür (dış halka saat yönünün tersine, delikler saat yönünde); vurgu katmanlarında halkalar olduğu gibi kalır. Yardımcı çizgiler kırpma kutusuna kırpılır, kutu yoksa çizilmez. Ölçünün yerleşim çizgileri iki noktalı açık yollar olarak gelir.
- **Kopyasız düz geometri:** nesnenin kendi noktaları olan bir yol ya da halka kopyalanmaz. Kayıtta `SOURCE` (−1), yönü dönmüşse `REVERSED` (−2) yazar; TS okuyucu (`style/geometry.ts` `DrawnReader`) nesnenin kendi dizisini kullanır: çizginin iki ucu, çoklu çizginin ve alanın köşeleri (k + 1. halka için k. deliğin köşeleri), taramanın halkası ve adaları. Bir milyon parçalık eşyükselti katmanı sınırı böylece hiç geçmez; eski `styledGeometry` de bu nesnelerde diziyi olduğu gibi veriyordu.
- **Dolgular:** `StyledSink` ve vurgu katmanı dolguları bir kuyrukta toplar (`render/fillQueue.ts`) ve katman bitince tek bir `triangulateMany` çağrısıyla üçgenler. Üçgenler çokgen çokgen döner; her çokgenin noktaları ayrı bir aralıkta olduğu için üçgenin hangi diziye gideceği dizinden bulunur. Her dolgu, tek başına adıyla üçgenlense alacağı üçgenleri bit bit alır (`render/fillQueue.test.ts`).
- **İfadelerin geometri değerleri:** `$alan`, `$uzunluk`, `$y` ve `$x` çizim sırasında depodan gelir (`measures(ids)`: bayrak, uzunluk, alan, yer noktası). Katmanın bir ifadesi ilk kez geometri değeri isteyince bütün katman için bir kez alınır, hiçbir ifade istemezse hiç hesaplanmaz. İfade kapsamına `measured` eklendi; işlem araçları, lejant ve sınıflama gibi depo dışı kullanımlar değerleri eskisi gibi nesneden hesaplar (S4). Köşesi olmayan bir yolun `$y`'si TS'te hata verirdi; depo boş değer döndürür.
- **Tek nesne:** depo dışındaki çağıranlar (sembol önizlemeleri, testler) `styledGeometry(e)` ile aynı kaydı `drawnGeometry` işlemiyle alır; uygulama tektir ve Rust'tadır.
- **Doğrulama:** eski hesap `src/wasm/parity/reference/draw.ts`'tedir (`styledGeometry`, vurgu katmanının anahatları, ifadelerin değerleri). Depo parity testi her turda rastgele nesnelerin kayıtlarını okuyucuyla geri kurar ve eskisiyle karşılaştırır: döndürülmüş ve döndürülmemiş, kırpmalı ve kırpmasız, ayrıca tek nesnelik yol ve bilinmeyen nesne. Derin koşu (20 000 tur) temiz geçti. Donmuş dosyaya 71 çizim ve 80 değer durumu eklendi; native okuyucu kayıtları aynı biçimde çözer. E2e'de WebGL2'nin çizdiği piksel sayısı S1c ile birebir aynı kaldı.
- **Ölçüm** (bulut, Node 22, makine başka işlerle meşgulken iki sürüm art arda, büyük katmanı `buildStyledLayer` ile 9 kez kurma, ısınmış medyan): `parsel-50k` S1c 142,8/142,9 ms, S2 141,6/146,9 ms; `hat-1m` S1c 180/193 ms, S2 179/175 ms. Fark gürültü içindedir. Aynı süreçte parçalar: eski geometri ve TS üçgenleme 82–85 ms, yeni kayıt, okuma ve toplu üçgenleme 71–74 ms. Katmanın geri kalanı (stil motorunun vuruş paketleme işi) değişmedi. İlk kurulum, depo o ana kadar eşitlenmediyse ilk eşitlemeyi de öder (+130 ms); bu iş S1c'de ilk seçme sorgusundaydı.

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
  | P2 (+43 işlem) | 388 KB | 135 KB | Argümanlar artık tek bir `Value` yolundan okunuyor (kazanç 1,5 KB) |
  | P3 (+10 işlem) | 454 KB | 156 KB | Fonksiyon başına döküm (kod 365 KB): serde 155 KB (serde_json ayrıştırma 53, türetilmiş okuyucular 43, yazıcı 60), her `sort_by` için ayrı sıralama kodu ~25 KB, geometri 74 KB, libm 11 KB, bellek ayırıcı 19 KB |
  | serde'siz JSON | 303 KB | 105 KB | Kendi JSON modülü (27 KB kod) ve tek bir kararlı sıralama (`jsmath::stable_sort`; std `sort_by` her karşılaştırıcı için yeniden üretiliyordu). Kod 244 KB, geometri 70 KB |
  | P4 + P5 (+40 işlem) | 494 KB | 170 KB | Düzlem bindirme motoru, alan cebiri, nesne modeli ve işlemleri |
  | P6 (+23 işlem) | 559 KB | 190 KB | Yol parametresi, budama, uzatma, kırma, uzat-kısalt; elips ve yardımcı çizgi kesimleri |
  | P7 (+13 işlem) | 618 KB | 210 KB | Öteleme, köşe yuvarla ve pah, birleştir, köşe ekle/sil, patlat, nesne ↔ alan |
  | P8 (+1 işlem, 1 toplu giriş) | 630 KB | 215 KB | Delikli halkaların üçgenlenmesi (köprü ve kulak kırpma), tipli `triangulateMany` |
  | S1a (geometri deposu) | 727 KB | 247 KB | Depo, R-ağacı, seçme ve kenet kuralları, paketli okuyucu, `GeometryStore` sınıfı; std `HashMap` ve sıralama örnekleri de geldi |
  | S1b (etiket, tutamaç) | 741 KB | 252 KB | Etiket kararı ve kuralları, tutamaç listesi, belge sırası listesi |
  | S1c (araç önizlemeleri) | 760 KB | 260 KB | Buda ve uzat önizlemesi (kenar kutusu ağacı, ışın ve çember süzgeci), hayalet yolları, esnet, toplamlar; hesapların kendisi zaten tablodaydı |
  | S2 (çizim hattı) | 770 KB | 263 KB | Çizilen geometrinin kayıtları, ifadelerin geometri değerleri, `drawnGeometry` işlemi |

### Doğrulama

- **Çağrı kümeleri** (`src/wasm/parity/sets/*.ts`): her modül için adlı sınır durumları (birim testlerinden: paralel, çakışık, sıfır uzunluk, 0/2π, TM koordinatı) ve tohumlu rastgele çağrılar.
- **Parity testi** (`src/wasm/parity/parity.test.ts`): aynı çağrıyı TS'e ve çekirdeğe verir. İşlem başına 200 rastgele durum kullanır; `PARITY_CASES` bunu artırır.
  - Sonucu sin/cos'un son bitine duyarlı bir işlem (dünya koordinatında döndürülen tarama çizgileri gibi) kümede gerekçesi yazılı daha geniş bir sınır alır (`tolerance`, ör. `hatchLines`: 2·10⁻⁸ m, TM büyüklüğünde birkaç ulp). Kaydedici bu sınırı durumlara yazar (`tol`); native ve WASM okuyucuları onu kullanır.
  - Bir rastgele çağrının bütün noktaları tek bir çerçevededir (başlangıç yakını ya da TM dilimi). Eksen ve yön vektörleri konum değil vektör olarak üretilir. 4 400 km'yi aşan bir “şekil” çizim değildir ve yalnız son bit farklarını büyütür.
  - Sayılar golden toleransıyla (1e-9 + 1e-14·büyüklük) karşılaştırılır.
  - Metin, mantıksal değer, dizi uzunluğu ve nesne anahtarları tam eşit olmalıdır.
- **Kaydedici** (`scripts/fixtures/record-calls.test.ts`, `GOLDEN_WRITE=1`): TS varken her kümeyi `fixtures/geometry/v1/calls-*.json` dosyasına dondurur; satır başına bir durum. Adlı durumların hepsi, rastgelelerden ise üretim sırasıyla işlem başına en çok 25 durum ve 48 KB girer (en az 3; 512 noktalı bir elips ötelemesi tek başına 25 KB).
- **Aynı dosyaları okuyanlar:**
  - native: `crates/geometry-core/tests/calls.rs`;
  - WASM, uygulamanın yolundan: `src/wasm/calls.wasm.test.ts`.
- **Bağımsız referanslar** her dilimde kapalı biçimli ölçülerle genişletilir (§23.4): `reference.json` (alanlar) ve `reference-calls.json` (adıyla çağrılan işlemler: TM doğru kesişimi, üç noktadan çember, yarım daire yayı, parçaya uzaklık, güzergâh uzunluğu, iki çember kesişimi, teğet noktaları, yay uzunluğu; `scripts/fixtures/geometry_call_reference.py`). Native (`tests/calls.rs`), WASM ve TS varken TS (`src/wasm/parity/reference.test.ts`) hata sınırı içinde kalmalıdır.
- **Eşit ölçülü sonuçların sırası:** alana göre sıralanan listelerde (alan cebiri, yüzler) eşit alanlı iki öğenin sırasını yayın alanındaki sin'in son biti belirleyebilir. Kümeler `ties` ile ölçüyü bildirir; parity testi, ölçüler aynı sırada ve öğeler eşleşiyorsa bu yer değişimini kabul eder. Kaydedici böyle durumları dondurmaz.
- **Taşırken bulunan kırılgan karar (TS de düzeltildi):** bindirmede halka izleme, “aynı parçadan geri dönme” durumunu açıyla sınıyordu (`cw < 1e-12`). Kısa bir yayda iki açı 10⁻⁴'lük kirişlerden gelir ve sin/cos'un son bit farkı 2,4·10⁻¹²'ye büyür. TS bunu şans eseri tutturuyordu, libm tutturamadı; izleme yanlış yöne dönüp yüzleri kaybetti. Şimdi iki tarafta da ikiz parça yapısal olarak tanınır (aynı parça, ters yön). TS geometri testleri değişmeden geçer. Bu, §23.3'ün istediği türden sağlam bir karardır.
- **Elipste en yakın nokta (TS de düzeltildi, P6):** `closestParam` en yakın örnekten 30 Newton adımı atıyordu.
  - Yayın ucu en yakın noktaysa ya da nokta evrimin (evolute) içindeyse Newton uzaktaki bir durağan noktaya, bazen en uzak noktaya kaçıyordu. Nokta yay üzerindeyse onu döndürüyordu; elips kırma ve budama yanlış parametreyi alıyordu.
  - TM koordinatında `P(t) − p` 4 400 km'lik sayıların farkıydı; adımlar yuvarlama gürültüsünde gezinip durmuyordu. V8 ile libm'in son bit farkı iki tarafı farklı yerlere götürüyordu.
  - Şimdi iki tarafta aynı algoritma çalışır:
    - fark önce merkezden alınır;
    - en yakın örnek ile uzaklığın düştüğü yöndeki komşu örnek bir aralık kurar;
    - aralıktan çıkan Newton adımı yerine ikiye bölme yapılır;
    - uzaklık yay ucunun ötesinde düşüyorsa uç kalır.
  - Eski iki beklenti yanlıştı: “yay dışında en yakın uç” 15,97 m uzaktaki noktayı veriyordu (doğru uç 11,18 m), bir diğeri ise normalleştirilmemiş açıydı (2π farkı). P2 dosyası yeniden kaydedildi.
  - Hatayı `ellipse.test.ts` yeniden üretir: yay ucu olan beş durum ve TM'de dik ayak.
- **TS'in çöktüğü yer:** tek köşeli çoklu çizgiyi uzatmak TS'te `TypeError` fırlatıyordu. İki taraf da “Uzatmak için en az iki köşe gerekir.” der (`ops.test.ts`). Uzat-kısalt böyle bir çizgiyi zaten “Nesnenin uzunluğu yok.” diyerek reddeder; Rust'taki denetim yalnız dizin erişimini korur.
- **P7'de bulunanlar (TS de düzeltildi):**
  - Sıfır uzunluklu çizgiyi ötelemek TS'te noktasız bir çizgi (`a`, `b` tanımsız) döndürüyordu. Artık iki taraf da “Öteleme sonucu geçerli bir şekil oluşmadı.” der (`ops.test.ts`).
  - `nearestSegment` ortak köşede eşit uzaklıktaki iki kenardan birini yayın ucundaki sin/cos'un son bitine göre seçiyordu; 20 000 durumda 2 kez iki taraf farklı kenarı verdi. Artık 1e-9 m içindeki kenarlar eşit sayılır ve ilki kazanır (`edit.test.ts`).
- **TS'in istisna fırlattığı girdiler:** boş çoklu çizgiyi birleştirmek, olmayan kenara köşe eklemek, kapalı alanda olmayan köşeyi yuvarlamak. Çekirdek de burada hata fırlatır (`Err` → JS istisnası), panik olmaz; kümeler bu girdileri üretmez.
- **Golden sahipliği:** TS silindikten sonra dosyalar donmuş davranış kilididir. Bilinçli bir davranış değişikliği (ör. §23.3 robust kararlar) dosyayı incelemeyle günceller.

## Sonuçlar

- Mevcut TS birim testleri modül silinince aynı adlarla cephe üzerinden Rust'ı sınamaya devam eder.
- Etkileşim ölçüm tabanı S1'den (geometri deposu) hemen önce alınır: taşıma dilimleri çağıranları değiştirmediği için TS tabanı o zamana kadar geçerlidir.
- JSON tablosu ılık yollar içindir (çağrı başına birkaç mikrosaniye). Kare başına binlerce çağrı yapan yerler toplu API alır (depo, bölme noktaları, tarama çizgileri).
