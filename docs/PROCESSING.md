# İşlem araçları (Processing)

KentOS'un toplu işlem çatısıdır. QGIS Processing'e benzer ama KentOS'un belge
modeline, katmanlarına ve CAD alışkanlıklarına göre kurulmuştur. Bu belge
mimariyi, dizin yapısını, yeni araç yazma tarifini ve ileride gelecek
parçaların (worker, sunucu, PostGIS, modeller) nasıl takılacağını anlatır.
Kod ile bu belge çelişirse önce kodu doğrulayın, sonra belgeyi güncelleyin.

---

## 1. Çizim aracı ile işlem aracı arasındaki fark

| | Çizim aracı (`tools/`) | İşlem aracı (`processing/`) |
|---|---|---|
| Kullanım | Etkileşimli: tıkla, sürükle, yaz | Toplu: bir kez ayarla, çok nesneye uygula |
| Girdi | İmleç, kenet, komut satırı | Tanımlı parametreler (pencere, model, sunucu isteği) |
| Belgeye dokunur mu | Evet, `doc.transact` ile kendisi yazar | **Hayır.** Değişiklik kümesi (`ChangeSet`) döndürür; çalıştırıcı yazar |
| DOM | Yok, `ctx.view` üzerinden | Yok, `ctx` de yok; yalnızca girdiler ve salt okunur belge |
| Nerede çalışır | Tarayıcıda, ana iş parçacığında | Tarayıcı; ileride worker, sunucu, PostGIS |
| Arayüz | Katalogdan üretilen düğme, istem, seçenekler | Tanımdan üretilen pencere, araç kutusu, menü, komut |

Örnekler: köşe noktalarını numaralandırmak, kenar uzunluklarını yazmak, bir
katmandaki bütün parsellerin alanını özniteliğe yazmak, çizgileri
sadeleştirmek, bir ada içindeki parselleri yeniden numaralamak.

## 2. İlkeler

1. **Bildirimsel tanım.** Bir araç ne yaptığını, hangi parametreleri aldığını, hangilerinin zorunlu olduğunu, varsayılanlarını, sınırlarını, çıktılarını ve nerede çalışabileceğini bir nesne olarak söyler. Pencere, araç kutusu, menü, komut satırı takma adları, geçmiş ve modeller bu tanımdan üretilir.
2. **Saf çalışma.** `run(values, ctx, feedback)` belgeyi değiştirmez; `ChangeSet` döndürür. Böylece araç test edilebilir, zincirlenebilir, geri alınabilir (tek adım) ve başka bir çalışma yerine taşınabilir.
3. **Tipler tanımdan çıkar.** `defineTool` parametre listesinden `run`'ın aldığı değerlerin tiplerini türetir; tanım ile kod birbirinden ayrışamaz.
4. **Kullanıcı dili.** Etiket, açıklama, yardım, hata ve özet metinleri Türkçedir ve kullanıcıya yöneliktir. Kimlikler ve kod İngilizcedir.
5. **Katman bağımlılığı.** `processing/` yalnızca `core`, `geo` ve `model` içe aktarır. DOM, `render`, `viewport`, `tools`, `ui` ve `app` bilmez. Bu, aracın worker'da ve (aynı TypeScript ile) sunucuda çalışabilmesinin koşuludur.

## 3. Dizin yapısı

```
src/processing/
  types.ts           Sözleşme: parametre türleri, değer tipleri, ProcessingTool, ChangeSet, RunContext, Feedback, defineTool
  parameters.ts      Varsayılanlar, görünürlük, doğrulama (kullanıcı mesajlı), kayıtlı değerleri güvenle geri yükleme
  features.ts        Nesne kapsamını çözme (seçili, görünen, tümü, katman, kimlikler) ve "12 kapalı alan" özetleri
  categories.ts      Araç kutusu kategorileri (üst kategori destekli)
  registry.ts        ProcessingRegistry: kayıt, kategori ağacı, Türkçe katlamalı arama, version sinyali
  runner.ts          ProcessingRunner: doğrula → çöz → çalıştır → tek geri alma adımıyla uygula → geçmiş; Executor arayüzü
  model.ts           Modeller (akış diyagramı) veri yapısı, sıralama ve denetim
  expression.ts      İfade dili: sözcüklere ayırma, ayrıştırma, closure'a derleme, hata mesajları, önizleme
  expressionLib.ts   İfade değerleri (tür dönüşümleri, eşitlik, sıralama), değişkenler ($alan …), işlevler
  processing.test.ts, expression.test.ts   Birim testleri
  builtin/
    index.ts         BUILTIN_TOOLS listesi
    numbering.ts     Saf numaralandırma çekirdeği (biçim, halka yönü, başlangıç köşesi, ortak köşe)
    vertexNumbering.ts   points.numberVertices: Köşe noktalarını numarala
    edgeLengths.ts       annotation.edgeLengths: Kenar uzunluklarını yaz
    calculateField.ts    attributes.calculate: Öznitelik hesapla
    selectByExpression.ts  selection.byExpression: İfadeyle seç

src/app/processing.ts         ProcessingService (registry + runner + son değerler), komut kaydı
src/ui/processing/
  ToolDialog.ts      Tanımdan üretilen araç penceresi
  paramFields.ts     Parametre türü başına kontrol
  ProcessingPanel.ts Sağ doktaki araç kutusu ve geçmiş
src/tools/pickPointTool.ts    Nokta parametresi için "Haritadan göster"
src/styles/processing.css     Pencere ve panel stilleri
```

Yeni bir araç ailesi büyüdükçe `builtin/` altında alt klasör açılır
(`builtin/cadastre/…`). Saf geometri yardımcıları araç dosyasında değil,
`model/geom` ya da `model/ops` altında durur ve orada test edilir; yalnızca
işlem aracına özgü hesaplar (ör. `numbering.ts`) `builtin/` içindedir.

## 4. Sözleşme

### 4.1 Araç

```ts
export const vertexNumbering = defineTool({
  id: 'points.numberVertices',          // alan.eylem, İngilizce, değişmez
  label: 'Köşe noktalarını numarala',   // pencere başlığı, menü, araç kutusu
  category: 'points',                   // categories.ts kimliği
  icon: 'numberVertices',               // ui/icons.ts
  description: 'Tek cümle: ne yapar.',
  help: 'Paragraflar boş satırla ayrılır.',
  keywords: ['numara', 'köşe', 'vertex'],   // arama
  aliases: ['KOSENUMARA', 'KNUM'],          // komut satırı
  targets: ['client', 'worker'],            // tercih sırasıyla
  parameters: [ … ] as const,               // `as const` şart
  outputs: [{ name: 'points', label: 'Numaralı noktalar', type: 'features' }],
  validate: (v) => … ?? null,               // parametreler arası denetim
  preview: (v) => 'P00001, P00002 …',       // pencerede canlı önizleme
  run: (v, ctx, feedback) => ({ changes: { add }, outputs: { count }, summary: '…' }),
});
```

- `parameters` dizisi `as const` ile yazılır; `defineTool<const Ds>` bu listeden `run` ve `validate` için değer tiplerini çıkarır.
- **Tanım içindeki ok fonksiyonlarının argümanı tiplenir:** `visibleWhen: (v: Shown) => …`, `default: (c: DefaultsContext) => …`. Tipsiz ok fonksiyonu TypeScript'in çıkarımını durdurur ve bütün değerler birleşim tipine düşer.
- `summary` geçmişte, günlükte ve pencerenin alt çubuğunda görünen tek satırdır: "68 nesnede 126 köşe numaralandı: P00001 – P00126."

### 4.2 Parametre türleri

| Tür | Pencerede değer (`ParamValues`) | `run`'da değer (`ResolvedValues`) | Seçenekler |
|---|---|---|---|
| `features` | `{ scope: 'selection' \| 'visible' \| 'all' }`, `{ scope: 'layer', layerId }`, `{ scope: 'ids', ids }` | `FeatureSet { entities, description }` | `kinds` (uygun nesne türleri), `scopes` (sunulan kapsamlar) |
| `number` | `number` | aynı | `min`, `max`, `integer`, `unit` |
| `string` | `string` | aynı | `placeholder`, `maxLength`, `allowEmpty` |
| `boolean` | `boolean` | aynı | — |
| `enum` | seçenek değeri (dar tip) | aynı | `options: { value, label, hint? }[]` |
| `layer` | `{ layerId }` ya da `{ newName }` | `TargetLayer { id, name, isNew }` | `newLayerStyle` |
| `point` | `Vec2 \| null` | aynı | — |
| `expression` | ifade metni | `CompiledExpression` (isteğe bağlı ve boşsa `null`) | `returns: 'condition' \| 'value'`, `of` (okuduğu `features` parametresi), `placeholder` |
| `field` | alan adı | aynı (kırpılmış) | `of` (alanları sunulan `features` parametresi), `allowNew` (yeni alan adı yazılabilir) |

Ortak alanlar: `name` (değer anahtarı), `label`, `description`, `optional`,
`advanced` ("Gelişmiş ayarlar" altında), `visibleWhen` (yalnızca koşul
sağlanınca gösterilir ve denetlenir), `default` (sabit ya da
`(c: DefaultsContext) => …` ile proje ayarından; ör. ondalık basamak).

- **Zorunluluk:** parametreler varsayılan olarak zorunludur. `optional: true` olan boş (`null`) bırakılabilir ve pencerede "isteğe bağlı" yazar. Metinde boş değer ayrıca `allowEmpty` ister (boş önek gibi).
- **Nesne türü süzgeci:** `features` değeri isteğe bağlı `kinds` taşır. Kapsamda aracın alabildiği iki ya da daha çok tür varsa pencere her tür için sayılı bir düğme gösterir ("Kapalı alan 118"); kullanıcı bu çalıştırmada yalnızca bazı türleri alabilir (örneğin yalnızca kapalı alanların kenarlarını yazmak). Hiç tür kalmazsa araç çalışmaz.
- **Kapsamlar:** "Seçili" seçimdeki nesneler; "Görünen" ekrandaki görünür alanla kesişen, görünür katmanlardaki nesneler (yardımcı çizgiler hariç); "Tümü" görünür katmanlardaki bütün nesneler; "Katman" bir katman ya da grubun altındaki bütün katmanlar (gizli olsa bile); "ids" modellerde önceki adımın çıktısıdır ve pencerede sunulmaz. `kinds` dışındaki nesneler sessizce elenir; pencere ne kadar nesne okunacağını canlı gösterir.
- **Boş girdi:** zorunlu bir `features` parametresi hiç nesneye çözülmezse çalıştırıcı aracı çalıştırmaz ve alanın altına yönlendiren bir mesaj yazar ("Önce nesneleri seçin ya da kapsamı değiştirin"). Model içinde (`ids`) boş çıktı hata değildir.
- **Hedef katman:** `{ newName }` aynı adlı bir katman varsa onu kullanır (araç ikinci kez çalışınca aynı "Köşe noktaları" katmanına yazar); yoksa katman yalnızca araç gerçekten ona yazarsa oluşturulur. Kilitli katman seçilemez; kilitli katmana düşen değişiklikler atlanır ve sayısı bildirilir.

### 4.3 Çalışma bağlamı ve değişiklik kümesi

```ts
run(values: ResolvedValues<Ds>, ctx: RunContext, feedback: Feedback): RunResult | Promise<RunResult>

RunContext { doc: DocumentSnapshot /* get, all, byLayer; salt okunur */, units: DefaultsContext,
             layerName(id): string, selection: readonly number[] /* çalıştırma başındaki seçim */ }
Feedback   { progress(fraction, label?), info(m), warn(m), canceled, yield() }
ChangeSet  { add?: NewEntity[], update?: { id, patch }[], remove?: number[] }
RunResult  { changes?, select?: readonly number[] /* çalıştırmadan sonraki seçim */, outputs?, summary? }
```

- Uzun döngülerde `await feedback.yield()` sayfanın donmasını önler (16 ms'de bir gerçekten bekler) ve `feedback.canceled` denetlenir. İptal edilen çalıştırmanın değişiklikleri uygulanmaz.
- `ctx.units.plotScale` kâğıt ölçüsünü dünyaya çevirir: 2 mm yazı, 1:1000'de 2 m'dir.
- Araç `NewEntity` üretirken `layerId` olarak hedef katmanın `id`'sini kullanır; yeni katman o anda henüz yoktur, çalıştırıcı uygularken kurar.
- **Seçim üreten araçlar** (İfadeyle seç) belgeyi değiştirmez, `select` döndürür; çalıştırıcı seçimi uygular (`FeatureHost.select`). Geri alınacak bir şey yoktur. Mevcut seçimle birleştirme (ekle, çıkar, içinde ara) aracın işidir, `ctx.selection` ile yapılır.
- **Öznitelik değiştiren araçlar** `update` içinde `attrs` alanının tamamını verir (`{ ...e.attrs, [alan]: değer }`); yalnızca öznitelik değişirse belge `attrs` olayı yayar ve GPU tamponu kurulmaz.
- **`features` çıktıları:** `outputs[ad]` bir kimlik dizisiyse o kullanılır (seçilenler, değişenler); yoksa çalıştırmanın eklediği nesneler çıktıdır. Modeller bu kimlikleri sonraki adıma `{ scope: 'ids' }` olarak verir.

### 4.4 Çalıştırma akışı (`ProcessingRunner.run`)

```
değerler ─► validateValues (parametre + araç düzeyi) ── sorun varsa ─► { status: 'invalid', issues }
        ─► girdileri çöz: features → FeatureSet, layer → TargetLayer   (boş girdi → invalid)
        ─► executorFor(tool): targets sırasıyla ilk uygun Executor
        ─► executor.execute(tool, çözülmüş değerler, { doc, units }, feedback)
        ─► iptal edildiyse değişiklik yok
        ─► apply: tek doc.transact (tek geri alma adımı), yeni katmanlar, kilitli katman atlama
        ─► RunRecord geçmişe (en çok 100), { status: 'ok', result, added, record }
```

`running` sinyali ilerlemeyi, `history` sinyali geçmişi yayınlar. Pencere ve
panel bunlara abone olur.

## 5. İfade dili

Koşul ve değer parametreleri (`expression`) küçük, güvenli bir ifade dili kullanır (`processing/expression.ts`, `expressionLib.ts`). `eval` yoktur: metin sözcüklere ayrılır, öncelik tırmanmasıyla ayrıştırılır ve closure'lara derlenir. Hata mesajı yerini söyler: "15. karakterde: İfade yarım kalmış: sonunda bir değer eksik."

```
Nitelik = 'Arsa' ve $alan > 500
'P' || doldur($sıra, 5)
yuvarla([Tapu alanı (m²)] - $alan, 2)
eğer(boş(Parsel), 'numarasız', Ada || '/' || Parsel)
```

- **Alanlar:** düz ad (`Parsel`) ya da boşluk ve işaret içerenler için köşeli parantez (`[Tapu alanı (m²)]`). Olmayan alan boş (`null`) verir; pencere ifadenin okuduğu ama nesnelerde olmayan alanları önizlemede söyler.
- **Değerler:** sayı (ondalık ayırıcı nokta), metin (`'…'` ya da `"…"`, içte çift tırnak bir tırnaktır), `doğru`/`true`, `yanlış`/`false`, `boş`/`null`.
- **İşleçler:** `ve`/`and`, `veya`/`or`, `değil`/`not`; `= != <> < <= > >=`; `+ - * / %`; `||` metin birleştirir. `+` iki taraf da sayıysa toplar, değilse birleştirir.
- **Tür kuralları:** öznitelikler metindir; aritmetik ve karşılaştırma metindeki sayıyı okur ("472.27" → 472.27). Boş bir değerle aritmetik boş verir, karşılaştırma yanlış verir; `= boş` yalnızca boş için doğrudur. Sıfıra bölme boştur. Metin karşılaştırması Türkçe sıralamayla ve büyük/küçük harfe duyarlıdır; `içerir`, `başlar`, `biter` harf farkı gözetmez.
- **Değişkenler:** `$alan`, `$uzunluk` (`$çevre`), `$köşe`, `$tür`, `$katman`, `$etiket`, `$y` (sağa), `$x` (yukarı), `$sıra` (bu çalıştırmadaki sıra, 1'den), `$id`.
- **İşlevler** (Türkçe adı ve QGIS'teki İngilizce adıyla): `yuvarla/round`, `metin/to_string` (sabit ondalık), `sayı/to_real`, `tamsayı/int`, `mutlak/abs`, `min`, `max`, `büyük/upper`, `küçük/lower`, `kırp/trim`, `uzunluk/length`, `parça/substr`, `doldur/lpad`, `değiştir/replace`, `içerir/contains`, `başlar/starts_with`, `biter/ends_with`, `eğer/if`, `boş/is_empty`, `varsayılan/coalesce`.
- **Adlar Türkçe harf farkı gözetmez:** `YUVARLA` = `yuvarla`, `$cevre` = `$çevre`, `DEGIL` = `değil`.
- Yazılan değer metne `toText` ile çevrilir: tam sayılar ondalıksız, ondalıklar kayan nokta gürültüsü atılarak (0.1 + 0.2 → "0.3"), doğru/yanlış olarak.

Pencerede ifade alanı tek satırdır (komut satırı gibi eşaralıklı yazıyla). Altında girdi nesnelerinin alanları düğme olarak (tıklayınca imlecin yerine eklenir), "Değişkenler" ve "İşlevler" menüleri (her biri ne yaptığını söyler) ve canlı bir satır bulunur: koşulda "16 / 340 nesne koşulu sağlıyor.", değerde "İlk nesnede (10): “472.26”."

Yeni işlev eklemek için `EXPR_FUNCTIONS` listesine ad, İngilizce karşılık, değer sayısı, kullanım, açıklama ve `call` ekleyin ve `expression.test.ts`'e bir satır yazın. Menü ve belge buradan beslenir.

## 6. Çalışma yerleri (client, worker, server, postgis)

Her araç `targets` ile nerelerde çalışabileceğini tercih sırasıyla bildirir.
Çalıştırıcı, listedeki ilk **kullanılabilir** `Executor`'ı seçer:

```ts
interface Executor {
  readonly target: 'client' | 'worker' | 'server' | 'postgis';
  available(): boolean;
  execute(tool, values, ctx, feedback): Promise<RunResult>;
}
```

Bugün yalnızca `clientExecutor` vardır (araç sayfada, canlı belge üzerinde
çalışır). Diğerleri aynı arayüzle eklenecek; araç kodu değişmeyecek:

| Yer | Ne zaman | Tasarım |
|---|---|---|
| `client` | Küçük ve orta işler | Bugünkü yol. |
| `worker` | Binlerce nesne, ağır geometri (tampon, sadeleştirme, TIN) | Worker, aynı `BUILTIN_TOOLS` kaydını içe aktarır. Çalıştırıcı çözülmüş girdileri ve belge anlık görüntüsünü (`DocumentSnapshot` için gereken nesneler) yapılandırılmış kopya ya da `Float64Array` havuzu olarak gönderir; `progress` ve `warn` mesajla gelir, iptal `postMessage` ile gider; `ChangeSet` geri döner ve ana iş parçacığında aynı `apply` ile uygulanır. Bu yüzden `run` DOM ve `ctx` dışı hiçbir şeye erişmez. |
| `server` | Belge sunucuda yaşadığında, paylaşılan projelerde, uzun işler | KentOS servisine iş gönderilir (araç kimliği, değerler, belge sürümü). İlerleme bir akıştan (SSE/WebSocket) gelir. Sonuç yine `ChangeSet`'tir; istemci uygular ya da sunucu belgeye yazıp olay yayınlar. Aynı TypeScript araçları Node'da çalışabilir. |
| `postgis` | Çok büyük veri, mekânsal sorgular (kesişim, birleşim, tampon, alan istatistiği) | Araç, `run`'a ek olarak (planlı) bir `sql` üreticisi verir; sunucu bunu PostGIS'te parametreli sorgu olarak çalıştırır. Sonuç nesneleri `ChangeSet`'e çevrilir ya da doğrudan veritabanında kalır. |

Pencere, aracın hangi yerlerde çalışabildiğini ve bu çalıştırmada hangisinin
seçildiğini sağ panelde gösterir ("Nerede çalışır").

## 7. Modeller (akış diyagramları)

Araçlar birbirine bağlanarak modeller (QGIS Model Designer gibi) kurulur.
Veri yapısı bugünden sabittir (`processing/model.ts`), diyagram düzenleyicisi
ve model çalıştırıcısı sonra gelecek:

```ts
ValueSource = { kind: 'value', value } | { kind: 'input', name } | { kind: 'output', step, output }
ModelStep   { id, tool, values: Record<string, ValueSource>, position?, caption? }
ProcessingModel { id, label, category, description, inputs: ParamDef[], steps, outputs }
```

- Bir adımın parametresi sabit bir değer, modelin kendi girdisi ya da önceki bir adımın çıktısı olabilir. `features` çıktısı sonraki adıma `{ scope: 'ids', ids }` olarak geçer; böylece adımlar birbirinin ürettiği nesneler üzerinden zincirlenir.
- Model girdileri araç parametreleriyle aynı `ParamDef` türündedir; model penceresi aynı `ToolDialog` ile üretilecek.
- `orderSteps` adımları bağımlılık sırasına dizer ve döngüyü bulur; `checkModel` bilinmeyen araç, bağlanmamış zorunlu parametre, olmayan girdi ya da çıktı ve döngü hatalarını kullanıcı diliyle döndürür.
- Planlanan: model çalıştırıcı (her adım bir `runner.run`, bütün model tek geri alma adımı), diyagram düzenleyici (kutular ve bağlantılar, `position`), modellerin proje dosyasında ya da kullanıcı kitaplığında saklanması ve araç kutusunda "Modeller" kategorisi.

## 8. Arayüz

- **Araç kutusu:** sağ dokun üst yuvasında "Katmanlar | İşlemler" sekmeleri. İşlemler sekmesinde arama (Türkçe harfler katlanır: "kose" = "köşe"), kategori ağacı (katlama durumu `ui.processingFolded`) ve "Araçlar | Geçmiş" seçicisi vardır. Araç satırına **tek tık** pencereyi açar.
- **Menü:** üst menüde **İşlemler**: İşlem araç kutusu, İşlem geçmişi ve her kategori için bir alt menü. Alt menüler kayıttan üretilir (`'@processing'` işaretçisi, `app/menus.ts`).
- **Komutlar:** her araç `processing.run.<id>` komutudur; takma adları komut satırından yazılabilir (`KOSENUMARA`). `processing.toolbox`, `processing.history` ve eski `map.edgeLengths` (Harita menüsü) de komuttur.
- **Pencere** (`ui/processing/ToolDialog.ts`): solda Girdi, Ayarlar, Çıktı ve katlanır "Gelişmiş ayarlar"; sağda kategori, açıklama, yardım, canlı önizleme, çalışma yerleri ve komut satırı takma adları; altta Varsayılanlar, durum, Kapat ve Çalıştır. Hatalar dokunulan alanda anında, Çalıştır'dan sonra hepsi görünür. Enter (metin alanında) ya da Ctrl+Enter çalıştırır. Başarılı çalıştırmada "Sonuçları seç" ve "Geri al" sunulur; pencere açık kalır, değer değiştirip yeniden çalıştırılabilir.
- **Nokta parametresi:** "Haritadan göster" pencereyi kapatır, `PickPointTool` ile tek nokta ister (kenet ve `Y,X` yazımı çalışır; Esc vazgeçer) ve pencereyi değerlerle yeniden açar.
- **Geçmiş:** her çalıştırmanın durumu, saati, süresi ve özeti; "Yeniden aç" aynı değerlerle pencereyi açar, "n nesneyi seç" çalıştırmanın eklediği ve hâlâ var olan nesneleri seçip yakınlaştırır.

### 8.1 Durum kapsamları

| Durum | Kapsam | Yer |
|---|---|---|
| Her aracın son değerleri | Uygulama ayarı (bu tarayıcı) | `localStorage` `kentos.processing.v1` |
| Dok sekmesi, İşlemler görünümü, katlanan kategoriler | Çalışma alanı yerleşimi | `kentos.ui.v1` (`dockTab`, `processingTab`, `processingFolded`) |
| Çalıştırma geçmişi | Oturum | `runner.history` (bellekte, en çok 100) |
| Araçların ürettiği nesneler ve katmanlar | Belge verisi | `CadDocument` (tek geri alma adımı) |

Kayıtlı değerler `restoreValues` ile geri yüklenir: artık uymayan (araç
değişmiş, katman silinmiş) değerler varsayılana döner.

## 9. Yeni işlem aracı tarifi

1. Hesabın saf kısmını yazın ve test edin: genel geometri `model/geom` ya da `model/ops` altında, araca özgü hesap `processing/builtin/` altında.
2. `processing/builtin/<ad>.ts` içinde `defineTool({...})` ile tanımı yazın: kimlik, etiket, kategori, simge, açıklama, yardım, anahtar kelimeler, takma adlar, `targets`, `parameters` (`as const`), `outputs`, gerekirse `validate` ve `preview`, `run`.
3. `processing/builtin/index.ts` içindeki `BUILTIN_TOOLS` listesine ekleyin. Kategori yoksa `categories.ts`'e ekleyin.
4. Simge yoksa `ui/icons.ts`'e çizin (DESIGN.md §6).
5. `processing.test.ts`'e (ya da aracın yanına `*.test.ts`) saf çekirdek ve `ProcessingRunner` üzerinde belgeyle bir test ekleyin: değişiklik, tek geri alma adımı, sınır durumları.
6. Yeni bir kullanıcı akışıysa `scripts/e2e/smoke.mjs`'e bir kontrol ekleyin.

Pencere, araç kutusu satırı, menü öğesi, komut ve takma adlar kendiliğinden
oluşur. Arayüz kodu yazmak gerekmez; gerekiyorsa bu, yeni bir parametre
türünün işaretidir (bkz. §10).

## 10. Genişletme noktaları

- **Yeni parametre türü:** `types.ts` (tanım + `ValueOf` + gerekirse `ResolvedOf`), `parameters.ts` (`defaultValue`, `fits`, `checkParam`), `runner.ts` (çözme), `ui/processing/paramFields.ts` (kontrol). Planlananlar: çoklu seçim, dosya, CRS, mesafe (birimli), renk, tablo (satır listesi).
- **Yeni çalışma yeri:** bir `Executor` yazıp `createProcessing` içinde `ProcessingRunner`'a verin.
- **Eklenti araçları:** `registry.register(tool)` bir `Disposable` döndürür; eklenti kaldırılınca araç ve menü öğeleri kaybolur (`version` sinyali).

## 11. Yerleşik araçlar

| Kimlik | Ad | Ne yapar |
|---|---|---|
| `points.numberVertices` | Köşe noktalarını numarala | Alanların (ve çoklu çizgilerin) köşelerine biçimli numaralı nokta ve/veya yazı koyar. Biçim: önek + doldurma karakteri + sayı, toplam uzunluk sabit (`P` + `00001` = 6). Yön saat yönünde ya da tersine; başlangıç kuzeybatı, en kuzey, ilk çizilen ya da gösterilen noktaya en yakın köşe. Delikli alanlarda önce dış halka. Komşu alanların ortak köşesi tek numara alır (tolerans ayarlı); hedef katmandaki aynı biçimli numaralar korunur ve numara kaldığı yerden devam eder. |
| `attributes.calculate` | Öznitelik hesapla | Seçilen alana (var olan ya da yeni) her nesne için bir ifadenin değerini yazar; varsayılan `metin($alan, <proje alan hassasiyeti>)`. İsteğe bağlı koşulla yalnızca bazı nesnelere yazar; sonuç boşsa alana dokunmaz ya da boşaltır. Etiket alanın eski değerini gösteriyorsa yeni değeri gösterir. Tek geri alma adımı. |
| `selection.byExpression` | İfadeyle seç | Koşulu sağlayan nesneleri seçer: yeni seçim, seçime ekle, seçimden çıkar ya da seçim içinde ara. Belgeyi değiştirmez. |
| `annotation.edgeLengths` | Kenar uzunluklarını yaz | Alan, çoklu çizgi ve çizgilerin her kenarına uzunluğunu, kenar ortasına ve okunur açıyla, dışa ya da içe yazar. Yay kenarında yay boyu yazılır. Ortak kenarlar bir kez yazılır; ondalık basamak varsayılanı proje ayarından gelir; önek, sonek ve en kısa kenar süzgeci gelişmiş ayarlardadır. |
