# Stil motoru

KentOS'un semboloji sistemidir: noktaların, çizgilerin ve alanların (ve alan
kenarlarının) nasıl çizileceğini tanımlar, saklar, paylaşır ve GPU'da çizer.
Hedef, **Mekânsal Planlar Yapım Yönetmeliği'nin** (MPYY, 2026 değişikliğiyle)
EK-1a, EK-1c, EK-1ç ve EK-1d gösterimlerinin tamamını birebir üretebilmektir.
Esin kaynakları QGIS sembol motoru (sembol katmanları, işleyiciler, stil
yöneticisi) ve MapLibre stil belirtimidir (ifadeli özellikler, desen
dokuları, GPU dostu yapı). Kod ile bu belge çelişirse önce kodu doğrulayın,
sonra belgeyi güncelleyin.

---

## 1. Araştırma özeti

### 1.1 MPYY gösterimleri ne istiyor

Kaynak: Çevre, Şehircilik ve İklim Değişikliği Bakanlığı, Mekânsal Planlama
Genel Müdürlüğü, "Mekânsal Planlar Yapım Yönetmeliği Değişikliği (22 Ocak
2026)" ekleri: EK-1a Ortak Gösterimler, EK-1c Çevre Düzeni Planı, EK-1ç Nazım
İmar Planı, EK-1d Uygulama İmar Planı, EK-1e Detay Katalogları. Tablolarda
her satır bir gösterimdir ve dört sütunu vardır: **çizgi tipi (sınır)**,
**sembol**, **tarama** ve **alan renk kodu (RGB)**. Bir gösterim birden çok
sütunu birlikte kullanabilir (ör. renkli alan + tarama + alan içi harf).

Gösterimlerden çıkan gereksinimler:

| Gösterim türü | Örnek (EK-1d) | Motorun karşılığı |
|---|---|---|
| Kesik ve nokta gruplu sınırlar | Köy sınırı: uzun çizgi, üç nokta, uzun çizgi; mahalle sınırı: dört nokta | Kesik deseni (`dash`) ve çizgi üzerinde işaret (`markerLine`, aralıklı nokta grupları) |
| Çizgi üzerinde dönüşümlü işaretler | Kentsel tasarım projesi sınırı: çizgi üzerinde sırayla içi boş ve dolu daireler | İki `markerLine`: aynı aralık, biri yarım aralık kaydırılmış |
| Çizgisiz işaret dizileri | Gecekondu önleme bölgesi: yalnızca artılar; toplu konut: ⊕ dizisi | `markerLine` tek başına (alttaki çizgi yok) |
| İç içe şekilli işaretler | İmar hakkı aktarım alanı: çift daire; ⊕ daire içinde artı | Birden çok katmanlı işaret sembolü |
| Çizgiyle dönen işaretler | Sahil şeridi: çizgi üzerinde eşkenar dörtgenler; ok uçları, tırnaklar | `rotate: true`, çizgiye göre açı |
| Alan rengi | Konut, ticaret, sanayi … her biri RGB kodlu | `simpleFill` |
| Tarama | Açılı paralel çizgiler, çapraz, noktalı, kesikli tarama | `hatchFill` (açı, aralık, kalınlık, kesik), `patternFill` |
| Alan içi harf ve kısaltma | T, MİA, EGB, "E =" | Alanın iç noktasında `text` işareti |
| Değişken metinli işaretler | Yapı düzeni dairesi: merkezde A-/B-/BL-, dört yanda kat adedi ve bahçe mesafeleri; TAKS/KAKS kesri; "Yençok = …m" | Metni **ifadeyle** öznitelikten gelen `text` işaret katmanları, konumları `offset` ile |
| Alan kenarı gösterimleri | Sınırın içine doğru tırnaklı ya da taralı bantlı alanlar | Alan sembolünde çizgi katmanları, içe/dışa kaydırma (`offset`) ve kenara dik işaretler |
| Özel sembol çizimleri | İbadet yeri, sağlık tesisi, trafo … | SVG işaretleri (kendi SVG editörümüzle çizilir), gerektiğinde raster |

Ölçü birimi kâğıt milimetresidir: gösterimler belirli bir plan ölçeğinde (1/1000,
1/5000 …) çizilmek üzere tasarlanmıştır.

### 1.2 QGIS'ten alınanlar

- **Sembol = sembol katmanları yığını.** İşaret (marker), çizgi (line) ve alan (fill) sembolleri; her biri alttan üste çizilen katmanlardan oluşur. Alan sembolü kenar için çizgi katmanları da taşır.
- **Katman türleri:** basit işaret, SVG işaret, yazı (font) işareti, raster işaret; basit çizgi, işaretli çizgi (aralık, köşe, uç, orta; çizgiye göre dönme), taralı çizgi; basit dolgu, çizgi deseni dolgusu, nokta deseni dolgusu, SVG ve raster dolgu, merkez noktası işareti.
- **Birimler:** milimetre, piksel, harita birimi.
- **Veriye bağlı özellikler:** her özellik bir ifadeyle değişebilir (boyut, açı, renk, metin).
- **İşleyiciler (renderer):** tek sembol, kategorili, aralıklı (derecelendirilmiş), kural tabanlı (iç içe kurallar, ölçek aralığı, "diğerleri").
- **Stil yöneticisi:** etiketli, gruplu kitaplık; içe/dışa aktarma (XML).

### 1.3 MapLibre'den alınanlar

- **İfadeli özellikler** ve ölçeğe göre değişim (`interpolate`, `step`); bizde ifade dili (`model/expression`) ve kurallardaki ölçek aralığı.
- **Desenler doku atlasından** (`fill-pattern`, `line-pattern`, sprite): SVG ve raster desenler bir kez rasterlanıp atlasa konur, GPU örnekler.
- **GPU dostu yapı:** her şey veri; çizim tarafında kaynaklar değişmedikçe yeniden kurulmaz; ölçekle değişen görünürlük kare başına tamponlar yeniden kurulmadan uygulanır.
- **Sürümlü, JSON stil belgesi:** içe/dışa aktarma ve paylaşmaya uygun.

KentOS'un farkı: bir CAD katmanı karışık geometri taşır (aynı katmanda nokta,
çizgi ve alan olabilir). Bu yüzden katman stili her geometri sınıfı için ayrı
bir sembol bağlar (**sembol takımı**: nokta, çizgi, alan).

---

## 2. Kavramlar

```
Kitaplık (StyleLibrary)
 ├─ Kategori ağacı: MPYY › Uygulama İmar Planı › Sınırlar › …
 ├─ Sembol (Symbol): tür (marker | line | fill) + sembol katmanları
 └─ Varlık (Asset): SVG çizimi ya da raster görüntü (işaret ve desenlerde kullanılır)

Katman stili (LayerRenderer) ─ nesneye hangi sembol takımının uygulanacağı
 ├─ Tek sembol
 ├─ Kategorili (bir ifadenin değerine göre)
 ├─ Aralıklı (sayısal aralıklara göre)
 └─ Kurallı (ifade süzgeci + ölçek aralığı, iç içe, "diğerleri")

Sembol takımı (SymbolSet) = { marker?: sembol, line?: sembol, fill?: sembol }
```

- **Öncelik:** nesnenin kendi sembolü (`entity.symbol`) → katmanın stili (işleyici) → katmanın basit görünümü (renk, çizgi tipi, kalınlık, dolgu). Basit görünüm, motorun ürettiği basit sembollere çevrilir; böylece her şey aynı çizim yolundan geçer.
- **Geometri sınıfları:** alan (kapalı alan, tarama), çizgi (çizgi, çoklu çizgi, yay, daire, elips, eğri, yardımcı çizgiler; CAD'deki gibi daire dolmaz), nokta. Yazı ve ölçü kendi yollarında kalır (etiket motoru ayrı bir adımdır).
- **Alan kenarı:** alan sembolündeki çizgi katmanları halkalara uygulanır; `offset > 0` kenarı alanın **içine**, `< 0` dışına kaydırır. `rings` ile yalnızca dış halka ya da delikler seçilebilir.

## 3. Sembol katmanları

Her katmanın ortak alanları: `enabled` (ifadeyle de olabilir), `opacity`, `unit`
(boyut birimi, aşağıda).

### 3.1 İşaret (marker) katmanları

| Tür | Özellikler |
|---|---|
| `shape` | `shape`: circle, square, rectangle, diamond, triangle, pentagon, hexagon, octagon, star, cross (+), x, line (—), arrow, arrowhead, semicircle, quartercircle, ring; `size`, `width`/`height` (dikdörtgen), `fill`, `stroke`, `strokeWidth`, `rotation`, `offset`, `anchor` |
| `svg` | `asset` (kitaplıktaki SVG), `size`, `rotation`, `offset`, `anchor`; SVG içindeki `param(fill)`/`param(stroke)` renkleri sembolden verilir (tek SVG farklı renklerle kullanılır) |
| `text` | `text` (sabit ya da ifade: `Parsel`, `'E=' \|\| Emsal`), `font` (ui, serif, mono), `weight`, `italic`, `size`, `color`, `halo`, `rotation`, `offset`, `anchor` |
| `raster` | `asset` (PNG/JPEG), `size`, `rotation`, `offset`, `opacity` |

### 3.2 Çizgi katmanları

| Tür | Özellikler |
|---|---|
| `simpleLine` | `color`, `width`, `dash` (açık/kapalı uzunluklar dizisi), `dashOffset`, `cap` (butt, round, square), `join` (miter, round, bevel), `offset` (paralel kaydırma; çizgide sol artı, alan kenarında içe artı) |
| `markerLine` | `marker` (işaret sembolü), `placement` (interval, vertex, innerVertex, first, last, center, segmentCenter), `interval`, `offsetAlong` (ilk işaretin başa uzaklığı), `offset` (dik kaydırma), `rotate` (çizgiyle dönsün mü) |

Tırnaklı (hashed) çizgi, `line` şekilli ve dönen bir `markerLine`'dır; ayrı tür gerekmez.

### 3.3 Alan (fill) katmanları

| Tür | Özellikler |
|---|---|
| `simpleFill` | `color` |
| `hatchFill` | `angle`, `spacing`, `width`, `color`, `offset` (desen kaydırma), `dash` (kesikli tarama). Çapraz tarama iki katmandır |
| `patternFill` | `marker` (işaret sembolü) ızgarada: `spacingX`, `spacingY`, `stagger` (kaydırmalı satırlar), `angle`, `offset` |
| `imageFill` | `asset` (SVG ya da raster), `tileSize`, `angle`, `opacity` |
| `centroidMarker` | `marker` alanın iç noktasına (`pointOnSurface`, varsayılan: ağırlık merkezi alanın içindeyse o, değilse yatay tarama çizgilerindeki en geniş iç aralığın ortası) ya da ağırlık merkezine konur |
| `simpleLine`, `markerLine` | Alanın kenarlarına uygulanır (§2). `rings: 'all' \| 'exterior' \| 'interior'` |

### 3.4 Birimler

| Birim | Anlamı | Zoomla |
|---|---|---|
| `mm` (varsayılan) | Kâğıt milimetresi, projenin çizim ölçeğinde: 1 mm = ölçek/1000 m (1:1000'de 1 m) | Kâğıttaki gibi büyür küçülür; çıktı ne ise ekranda o |
| `px` | Ekran pikseli | Sabit kalır (GIS görünümü) |
| `m` | Harita birimi (metre) | Kâğıttaki gibi |

Kurallar: geometriyi değiştiren uzunluklar (kaydırma, işaret aralığı, desen aralığı) `mm` ya da `m` olur; genişlik, işaret boyu ve kesik uzunlukları `px` de olabilir (gölgelendiricide ölçeklenir). Hiçbir çizgi 1 aygıt pikselinden ince çizilmez (kıl çizgi).

### 3.5 Renkler ve ifadeler

- Renk: `#RRGGBB`, `#RRGGBBAA` ya da tema jetonu (`ink` = CAD renk 7, `fg`, `fg-dim`).
- **Veriye bağlı özellik:** sayı, renk ve metin özellikleri sabit ya da `{ expr: '…', fallback }` olabilir. İfadeler `model/expression` dilidir ($alan, alanlar, işlevler); sembol başına bir kez derlenir, nesne başına değerlendirilir.

## 4. Katman stili (işleyiciler)

```ts
type LayerRenderer =
  | { type: 'single'; symbols: SymbolSet }
  | { type: 'categorized'; expr; categories: { value, label, symbols, enabled }[]; other?: SymbolSet }
  | { type: 'graduated'; expr; classes: { min, max, label, symbols }[] }
  | { type: 'rules'; rules: Rule[] }          // Rule: filter?, minScale?, maxScale?, symbols?, children?, isElse?
```

- Kategorili ve aralıklı işleyiciler tasarımcıda veriden üretilir (benzersiz değerler, eşit aralık ya da doğal kırılmalar); saklanırken yine veridir.
- **Ölçek aralığı** (1:N paydası) kuralın çizilip çizilmeyeceğini belirler; GPU toplulukları bu aralığı taşır, çizici her karede seçer, tampon yeniden kurulmaz.

## 5. Kitaplık

| Kaynak | Nerede | Kim değiştirir |
|---|---|---|
| **Sistem** | Uygulamayla gelir (`style/system/`) | Kimse; kopyalanabilir, silinemez, değiştirilemez |
| **Kullanıcı** | Bu kullanıcının kitaplığı (şimdilik tarayıcı, sonra bulut) | Kullanıcı |
| **Proje** | Proje dosyasında (`.kcad`), projeyi açan herkes görür | Projeyi düzenleyen |

- **Ağaç:** her öğenin bir kategori yolu vardır (`['MPYY', 'Uygulama İmar Planı', 'Sınırlar']`); kategori derinliği sınırsızdır. Boş kategoriler ve sıralama için kategori kayıtları ayrıca tutulur.
- **Kimlikler** kalıcıdır; semboller birbirine ve varlıklara kimlikle bağlanır. Sistem öğesi kopyalanınca yeni kimlik alır ("… (kopya)").
- **Dışa/içe aktarma:** `.kstil` dosyası: sürümlü JSON (`{ format: 'kentos-style', version, items, assets }`), kullandığı SVG/raster varlıkları gömülü. İçe alırken şema denetlenir, kimlik çakışmasında "üzerine yaz / kopya olarak al" sorulur.
- **Paylaşma:** dosya ve pano (JSON) bugün; sunucu gelince bağlantıyla paylaşma ve kurum kitaplıkları.

## 6. Çizim hattı

```
LayerRenderer + Entity ─► resolve (hangi sembol takımı) ─► compile (sembol × geometri → çizim ilkelleri)
   ─► StyledSink (GPU toplulukları, katman başına) ─► RenderBackend (WebGL2 / WebGPU)
                                                  └► önizleme ve lejant (Canvas2D, aynı ilkeller)
```

- **Sembol seçimi (`render/styledLayer.ts`):** nesnenin kendi sembolü (`entity.symbol`), yoksa katmanın işleyicisi (`style.renderer`), yoksa katmanın basit görünüşü (`symbolsOfLayerStyle`: renk, çizgi tipi, kalınlık, dolgu, nokta simgesi). Kurallar:
  - Hiçbir kurala ya da kategoriye uymayan nesne çizilmez (QGIS gibi).
  - Uyan takımda nesnenin geometri türüne sembol yoksa ya da başvurulan sembol kitaplıkta yoksa basit görünüş çizilir; nesne sessizce kaybolmaz.
  - Dolgu sembolü olmayan alan, takımın çizgi sembolüyle kenarından çizilir.
  - Tarama nesneleri kendi desenini (`hatchSymbolOf`), ölçüler ince çizgilerini korur; yazılar üst katmandadır.
- **Derleme (`style/compile.ts`)** saf ve testlidir: kesik ve kaydırma, işaretlerin çizgi boyunca yerleşimi, alanın iç noktası, halka yönleri CPU'da float64 ile hesaplanır. Çıktı arka uçtan bağımsız ilkellerdir: vuruş (stroke), dolgu (düz, tarama, döşeme), işaret (şekil, SVG, yazı, raster). İfadeler katman kurulumu başına bir kez derlenir (`ExprCache`).
- **GPU toplulukları (`render/styledSink.ts`):** ilkeller stil ve ölçek aralığı anahtarıyla toplanır; sembol düzeyine, sonra türe (dolgu < vuruş < işaret) göre sıralanır.
  - **Vuruş:** her parça bir örnek (`ax, ay, bx, by, dist, uç bayrakları`); kapsül SDF'si, yuvarlak birleşim, uçta düz/yuvarlak/kare kapak. Kesik deseni (en çok 8 değer) gölgelendiricide yol boyu mesafeden hesaplanır; desen dönemi 4 px'in altına inince çizgi, desenin dolu oranıyla soluklaşan düz çizgiye döner (titreşim yok).
  - **Tarama:** üçgen başına ek geometri yok; çizgiler gölgelendiricide yerel orijine göre dünya koordinatından (ya da `px` biriminde ekrandan) üretilir, her yakınlıkta tam. Aralık 3 px'in altına inince taramanın ortalama rengine döner.
  - **Döşeme (desen ve görüntü dolgusu):** atlas hücresi `textureGrad` ile tekrarlanır, dünya ızgarasına hizalıdır.
  - **İşaret:** her işaret bir örnek (`x, y, açı, genişlik, yükseklik`); geometrik şekiller SDF ile, SVG, yazı ve raster işaretler atlastan çizilir. Doku ve işaretlerde önceden çarpılmış alfa karışımı kullanılır.
  - **Ölçek aralıkları** her karede topluluk düzeyinde denetlenir (`FrameState.scaleDenominator`, 96 dpi).
- **Doku atlası (`render/atlas.ts`):** iki arka ucun paylaştığı 2048² Canvas2D sayfası. Girdiler içerikle anahtarlanır (aynı SVG ve renk bir kez çizilir). SVG ve raster eşzamansız çözülür; hazır olunca görünüm yeniden çizilir. Çizimden önce topluluğun istediği bütün görüntüler yerleştirilir (`prefetch`), sonra doku yüklenir. Sayfa dolunca baştan kurulur. WebGPU için mip düzeyleri atlasın kendisinde küçültülerek üretilir.
- **Eşitlik:** WebGL2 ve WebGPU aynı gölgelendirici mantığını taşır (`webgl2/styledShaders.ts`, `webgpu/styledShaders.ts`); birinde yapılan değişiklik ötekine de yapılır. Duman testi stilli sahnede iki motorun piksellerini karşılaştırır.
- **Performans:** katman yalnız kirlenince yeniden kurulur (öznitelik değişince yalnız işleyicisi olan katmanlar); çizim ölçeği ya da kitaplık değişince bütün katmanlar kurulur. Vurgu katmanları (`__sel`, `__hover`) eski ince çizgi hattını kullanır.
- **Bilinen sınırlar:**
  - Birleşimler hep yuvarlaktır (`join` yok sayılır); saydam kalın çizgide parça uçları üst üste binip koyulaşır.
  - Bulanık gölge ve parıltı gibi çizim efektleri yok.
  - Atlas çözünürlüğü sabittir (yazı 48 px, SVG 128 px, döşeme 128 px); çok büyütülen SVG işaret yumuşar.

## 7. Tasarımcılar

- **Stil yöneticisi:** kitaplık ağacı (Sistem / Kullanıcı / Proje), arama ve etiketler, önizlemeli ızgara, kopyala, yeniden adlandır, taşı, sil (sistem hariç), içe/dışa aktar.
- **Sembol tasarımcısı:** solda katman yığını (ekle, çoğalt, sırala, gizle), sağda seçilen katmanın özellikleri; ortada örnek geometrilerde (nokta, kırık çizgi, delikli alan) canlı önizleme; ölçek seçici; her özellikte "ifadeye bağla".
- **Katman stili penceresi:** işleyici türü; kategorileri ve aralıkları veriden üret; kurallar ağacı; sembolleri kitaplıktan seç ya da yerinde düzenle.
- **SVG editörü (kendi aracımız):** işaret ve desen varlıkları için: dikdörtgen, elips, çokgen, yol (Bezier), yazı, grup; dolgu/çizgi (param renkler), ızgara ve kenetleme, hizalama, döşeme önizlemesi; SVG dosyası içe alma; raster içe alma (desen için).

## 8. Aşamalar

1. **Çekirdek (yapıldı):** sembol ve işleyici türleri, kitaplık (kaynaklar, ağaç, kopyala-silinemez, dışa/içe aktar), çözümleme, derleme (vuruş, dolgu, işaret ilkelleri), testler.
2. **GPU (yapıldı):** kalın ve kesikli çizgiler, taramalar, işaret örnekleri (SDF), doku atlası (SVG, yazı, raster, desen); katmanlara ve nesnelere bağlama; ölçek aralıkları; iki arka uçta eşit çizim.
3. **Stil yöneticisi ve sembol tasarımcısı**, katman stili penceresi.
4. **SVG editörü** ve raster desenler.
5. **MPYY sistem kitaplığı:** EK-1a, 1c, 1ç, 1d'nin bütün gösterimleri; değişken metinli sembollerin öznitelik şablonları; lejant üretimi.
6. **Paylaşma:** sunucu ile kitaplık paylaşımı ve kurum kitaplıkları.
