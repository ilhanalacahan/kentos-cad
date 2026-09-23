# KentOS CAD — Geliştirme kılavuzu

Bu dosya, KentOS CAD üzerinde çalışan Claude (ve ekipteki herkes) için bağlayıcı
kuralları ve mimariyi anlatır. Görsel dil, renkler ve bileşen kuralları için
[DESIGN.md](DESIGN.md) dosyasına bakın. Kod ile bu belge çelişirse önce kodu
doğrulayın, sonra belgeyi güncelleyin; belge güncel tutulmak zorundadır.

---

## 1. Ürün

**KentOS CAD**, tarayıcıda çalışan bir harita, kadastro ve kent bilgi sistemi
çizim ortamıdır. Doğrudan rakibi **Netcad**'dir. Hedef kullanıcılar harita
mühendisleri, LİHKAB ve serbest harita büroları, kadastro ve belediye imar
teknisyenleridir: günde saatlerce, çoğunlukla klavye kısayoluyla çalışan
profesyoneller.

- **Yalnızca masaüstü.** Mobil ve dar ekran için çalışma yapılmaz. Kabuk en az 1100×600 px'tir.
- **Arayüz dili Türkçedir.** Kod, tanımlayıcılar ve yorumlar İngilizcedir.
- **Marka:** menü çubuğunda "KentOS" yazar, sayfa başlığı "KentOS CAD"dir, logo "K" harfidir.

### 1.1 Hibrit ilke: CAD çekirdeği, GIS veri modeli

KentOS ne saf bir CAD (AutoCAD) ne de saf bir GIS (QGIS) olacak. Kullanıcının
günlük işi hassas çizimdir, verisi ise coğrafi ve özniteliklidir.

| Konu | CAD tarafı (nasıl çizilir) | GIS tarafı (veri ne anlama gelir) |
|---|---|---|
| Geometri | Hassas nokta girişi, kenetleme, orto, komut satırı, tutamaçlar | Her nesne bir koordinat sisteminde (SRID) yaşar |
| Nesne | Çizgi, çoklu çizgi, yay, daire, yazı, ölçü | Öznitelikli detay (ada, parsel, nitelik, tapu alanı) |
| Katman | Renk, çizgi tipi, kalınlık, kilit | Tipli öznitelik şeması, sorgu, tematik gösterim (planlı) |
| Doğruluk | Geri alınabilir düzenleme, toleranslar | Topoloji: komşu parseller ortak sınır paylaşır (planlı) |
| Çıktı | Pafta, yazdırma, DXF | GeoJSON, Shapefile, WFS, PostGIS (planlı) |

Karar verirken sorulacak soru şu: **"Bir harita mühendisi bunu Netcad'de nasıl
yapıyor ve biz bunu verinin anlamını bozmadan nasıl daha iyi yaparız?"**

---

## 2. Çalıştırma

```bash
pnpm install
pnpm dev                  # Vite geliştirme sunucusu
pnpm build                # tsc (tip denetimi) + vite build
pnpm test                 # Vitest birim testleri (geometri, işlemler, belge, biçimlendirici)
pnpm e2e                  # Başsız Chrome'da uçtan uca duman testi (kendi Vite sunucusunu açar)
npx tsc --noEmit -p .     # yalnızca tip denetimi
```

- `?renderer=webgpu` ya da `?renderer=webgl2` URL parametresi kayıtlı çizim motoru tercihini geçersiz kılar.
- Her değişiklikten sonra `tsc` temiz olmalı ve `pnpm test` geçmeli (bkz. §9.4).
- Geliştirme modunda uygulama bağlamı `window.kentos` olarak açıktır (üretim derlemesinde yoktur). Tarayıcıda doğrulama yaparken durumu buradan okuyun, ör. `kentos.doc.size`, `kentos.tools.activeId.value`.
- Arayüzü etkileyen her değişiklik **gerçek tarayıcıda** denenmelidir: tıklama, klavye, açık ve koyu tema, "Büyük" yazı boyutu.
- Tercihler `localStorage`'da `kentos.ui.v1` (yerleşim) ve `kentos.prefs.v1` (uygulama ayarları) anahtarlarında durur. Temiz başlangıç için bu anahtarları silin.

---

## 3. Değişmez teknik kısıtlar

- **TypeScript strict** ve `erasableSyntaxOnly`:
  - `enum`, `namespace` ve yapıcı parametre özellikleri (`constructor(private x)`) yasaktır.
  - Birleşim tipleri (`'a' | 'b'`) ve `as const` nesneleri kullanın.
  - Alanları açıkça tanımlayıp yapıcıda atayın.
- **`verbatimModuleSyntax`:** yalnızca tip olan içe aktarmalar `import type` ile yazılır.
- **UI çatısı yok.** DOM, `ui/dom.ts` içindeki `h()` ile kurulur; tepkisellik `core/signal.ts` ile sağlanır. React, Vue veya Lit eklenmez.
- **Çalışma zamanı bağımlılığı eklemek bir karardır.** Kabul ölçütleri:
  - küçük olmalı, ağaç sallamaya (tree-shaking) uygun olmalı
  - MIT/BSD lisanslı olmalı
  - worker içinde çalışabilmeli, DOM gerektirmemeli
  - bakım altında olmalı

  Aday örnekleri: `earcut` (üçgenleme), `flatbush`/`rbush` (R-tree), `proj4` (dönüşüm). Eklemeden önce kullanıcıya sorun.
- **Araç zinciri:** Vite 8, TypeScript 6, pnpm. Hedef ES2023.
- **Tarayıcı kısayolları:** Tarayıcının yakaladığı kısayollar bağlanmaz: `Ctrl+N`, `Ctrl+T`, `Ctrl+W`, `Ctrl+Shift+T`, `Alt+F`, `Alt+D`, `Alt+E`.

---

## 4. Mimari

### 4.1 Katmanlar ve bağımlılık yönü

```
core ─► geo ─► model ─► render ─► viewport ─► tools ─► ui ─► app (kompozisyon kökü)
```

Oklar "şunu kullanabilir" yönündedir: bir katman yalnızca **solundakileri**
içe aktarabilir. `app/context.ts` içindeki `AppContext` **tipi** her yerden
`import type` ile kullanılabilir; somut servisler yalnızca `app/createApp.ts`
içinde kurulur.

| Klasör | Sorumluluk | İçe aktarabileceği | Asla |
|---|---|---|---|
| `core/` | Signal, Emitter, Disposable, CommandRegistry, Keymap | Yalnızca DOM tipleri | model, ui |
| `geo/` | EPSG/CRS kaydı; ileride dönüşümler, geodezik hesaplar | core | DOM, model |
| `model/` | Belge, varlıklar, katman ağacı, geometri, seçim, proje ayarları, geri alma | core, geo | DOM, render, ui |
| `render/` | `RenderBackend` sözleşmesi, sahne verisi, WebGL2 ve WebGPU arka uçları | core, model (tip + stil) | ui, tools, viewport |
| `viewport/` | Kamera, seçme ve kenetleme dizini, 2B üst katman, çizim döngüsü | core, model, render, tools (tip), app (tip) | ui |
| `tools/` | Etkileşimli araçlar ve araç kataloğu | core, model, viewport (tip), app (tip) | ui |
| `ui/` | Bileşenler, paneller, pencereler, widget'lar | hepsi (servisler `AppContext` üzerinden) | model'i doğrudan değiştirmek (bkz. §8) |
| `app/` | Kompozisyon kökü, komutlar, menüler, kısayollar, durum depoları, biçimlendirici | hepsi | — |

Bağımlılık yönünü bozan bir içe aktarma gerekiyorsa tasarım yanlıştır. Bu
durumda bir arayüz ya da olay ekleyin, döngüsel bağımlılık kurmayın.

### 4.2 Kompozisyon kökü

`app/createApp.ts` tek kurulum noktasıdır. Sıra şöyledir:

1. `CommandRegistry` ve `Keymap`
2. `UiState` ve `Preferences` (localStorage)
3. `CadDocument` (şimdilik örnek proje, SRID = `prefs.defaultSrid`)
4. Tema ve yazı ölçeği CSS'e uygulanır. Bu, paleti okuyan her şeyden önce olmalıdır.
5. `AppContext` nesnesi kurulur; `ToolManager` ve `ViewportController` ona bağlanır.
6. Komutlar ve kısayollar kaydedilir; `AppShell` DOM'a takılır.
7. `view.mount()` çizim arka ucunu başlatır.

Başka hiçbir modül servis oluşturmaz.

### 4.3 AppContext

Bütün özellik modüllerinin tek bağımlılığıdır (`app/context.ts`):

| Servis | Tür | Görev |
|---|---|---|
| `commands` | `CommandRegistry` | Kullanıcının tetikleyebildiği her şey |
| `keymap` | `Keymap` | Kısayol → komut eşlemesi |
| `doc` | `CadDocument` | Açık proje: varlıklar, katmanlar, proje ayarları, geçmiş |
| `selection` | `Selection` | Seçili ve üzerine gelinen varlık kimlikleri |
| `settings` | `DraftingSettings` | Oturumluk çizim yardımcıları (kenet, ızgara, orto, geçerli renk ve tip) |
| `prefs` | `Preferences` | Uygulama ayarları (kalıcı, kullanıcıya özel) |
| `ui` | `UiState` | Çalışma alanı yerleşimi (kalıcı) |
| `format` | `Formatter` | Sayıdan metne tek geçit (proje birimlerini kullanır) |
| `log` | `MessageLog` | Komut geçmişi, uyarılar, durum çubuğu mesajı |
| `tools` | `ToolManager` | Etkin araç, istem metni |
| `view` | `ViewportController` | Kamera, seçme, çizim isteği |
| `clipboard` | `Clipboard` | Kopyalanan nesneler (oturumluk; `app/clipboard.ts`) |

İleride birden fazla belge açılacaksa, belgeye bağlı servisler (`format`,
`view` içindeki önbellekler) belge değişince yeniden kurulmalıdır. Bunun için
`doc` doğrudan önbelleğe alınmaz; her seferinde `ctx.doc` üzerinden okunur.

### 4.4 Durum kapsamları (en önemli ayrım)

Yeni bir ayar ya da durum eklemeden önce **hangi kapsama ait olduğuna** karar verin:

| Kapsam | Nerede | Saklama | Kim görür | Örnekler |
|---|---|---|---|---|
| **Proje ayarları** | `model/projectSettings.ts` → `doc.settings` | Proje dosyası (.kcad) | Projeyi açan herkes | SRID, uzunluk ve alan hassasiyeti, alan birimi, açı birimi, çizim ölçeği, proje adı |
| **Belge verisi** | `CadDocument`, `LayerStore` | Proje dosyası | Projeyi açan herkes | Varlıklar, katman ağacı ve stilleri, öznitelikler |
| **Uygulama ayarları** | `app/state.ts` → `ctx.prefs` | `localStorage` `kentos.prefs.v1` | Yalnızca bu kullanıcı, tüm projeler | Tema, yazı boyutu, artı imleç, fare yardımcıları (imleç yanında giriş, bilgi kartı), kenet türleri ve yarıçapları, çizim motoru, **yeni proje varsayılan SRID'si (5256)** |
| **Çalışma alanı yerleşimi** | `app/state.ts` → `ctx.ui` | `localStorage` `kentos.ui.v1` | Yalnızca bu kullanıcı | Panel genişlikleri, araç kutusu konumu, sütun sayısı ve katlanan grupları, açık sekme |
| **Oturum durumu** | `DraftingSettings`, `Selection`, `ToolManager`, `Clipboard` | Saklanmaz | Bu oturum | Kenet/Izgara/Orto düğmeleri, seçim, etkin araç, pano |

Kurallar:

- **Bir iş arkadaşı projeyi açtığında aynısını görmesi gerekiyorsa proje ayarıdır.** Kişisel tercih ise uygulama ayarıdır.
- Proje ayarı değişince proje kaydedilmemiş sayılır (`doc.dirty`).
- Proje ayarları **Dosya → Proje ayarları…** penceresinde (`ui/settings/ProjectSettingsDialog.ts`) düzenlenir.
- Uygulama ayarları **Araçlar → Uygulama ayarları…** penceresinde (`ui/settings/AppSettingsDialog.ts`, `Ctrl+,`) düzenlenir.
- İki pencere de `SettingsShell` kullanır ve kapsamını sol altta açıkça yazar. Bir ayar asla iki pencerede birden durmaz. Karşı pencereye bağlantı verilebilir (ör. "Proje ayarlarını aç").
- Bir değer hem varsayılan hem proje değeri olarak varsa (SRID gibi): varsayılan uygulama ayarıdır, projedeki kopya proje ayarıdır. Varsayılanı değiştirmek açık projeyi etkilemez.

### 4.5 Komutlar (`core/commands.ts`, `app/commands.ts`)

Kullanıcının yaptığı her şey bir `Command`'dır: menü, araç çubuğu, araç
kutusu, kısayol, komut satırı ve bağlam menüsü hep aynı komutu çağırır.

```ts
{ id: 'view.zoomExtents', title: 'Tümünü göster', category: 'Görünüm', icon: 'zoomExtents',
  aliases: ['ZE', 'TUMU'], run: () => view.zoomExtents(),
  isEnabled?: () => boolean, isChecked?: () => boolean, watch?: [signal…] }
```

- **Kimlik biçimi:** `alan.eylem`. Örnekler: `file.save`, `edit.undo`, `view.rightPanel`, `draft.snap`, `tool.line`, `layer.new`, `crs.set`.
- **`watch`:** `isEnabled` ve `isChecked` sonucunu etkileyen sinyallerdir. Düğmeler bunlara abone olarak kendini günceller.
- **`aliases`:** Komut satırından yazılabilen adlardır. Türkçe karakterler katlanır (`CIZGI` = `ÇİZGİ`).
- **Henüz yapılmamış özellikler** `pending(...)` ile kaydedilir ve dürüstçe uyarı verir. Sessizce hiçbir şey yapmayan düğme olmaz.
- **Menü modeli** `app/menus.ts` içindedir. Menü öğeleri komut kimliğidir; başlık, simge, kısayol ve durum komuttan çözülür.

### 4.6 Kısayollar (`core/keymap.ts`, `app/keybindings.ts`)

- **Akor biçimi:** `Ctrl+Shift+Z`, `Alt+P`, `L`, `F3`, `+`, `Ctrl+,`. Sıra her zaman Ctrl, Alt, Shift'tir.
- **Harfler basılan karaktere göre eşlenir** (`e.key`, ı ve i → I). Böylece Türkçe Q ve F klavyede de tuşun üstünde yazan harf çalışır. Değiştirici tuş karakteri bozarsa fiziksel konuma (`e.code`) düşülür.
- **Metin kutusunda** yalnızca `allowInInput: true` olan bağlar çalışır. Bunlar F tuşları ve `Ctrl+S`, `Ctrl+O`, `Ctrl+P` gibi global komutlardır.
- **Odak bir düğme, ağaç satırı ya da menüdeyken** Enter ve Boşluk yerel anlamını korur.
- **Hiçbir bağa uymayan** rakam, `@` ya da `.` basılırsa komut satırı odak alır. Böylece koordinat hemen yazılabilir (`Keymap.fallback`).
- **Açık bir pencere** (Dialog) içindeki tuşlar uygulama kısayollarına ulaşmaz.
- **Kısayol listesi** (F1) kısayol haritasından üretilir. Elle liste tutulmaz.

### 4.7 Araçlar (`tools/`)

- **`tools/catalog.ts`:** tek bildirimsel liste. Her araç bir kimlik, etiket, simge, grup (`select | draw | annotate | transform | modify | map`), kısayol, takma adlar, açıklama, **fareyle kullanım adımları** (`steps`) ve `create(ctx)` içerir. Araç kutusu, menüler, kısayollar, ipuçları ve komut satırı bu listeden üretilir. Yeni araç `steps` olmadan eklenmez: kullanıcı aracı fareyle nasıl kullanacağını ipucundan öğrenir.
- **Henüz yapılmamış araçlar** `create` vermez; `PendingTool` olur, `ready: false` görünür ve ipucunda "Geliştirme aşamasında" yazar.
- **`Tool` sözleşmesi** (`tools/Tool.ts`):
  - `pointerDown/Move/Up`
  - `input(text)`: komut satırı
  - `confirm()`: Enter ya da sağ tık
  - `cancel()`: Esc; `true` dönerse araç kendi içinde halletmiştir (ör. sıcak tutamaç bırakıldı) ve açık kalır
  - `draw(g, view)`: üst katman önizlemesi
  - `snapFrom()`: dik kenetin başlangıç noktası
  - `activeGrip()`: sıcak tutamaç
  - `prompt` sinyali, `cursor`, `snaps` (getter olabilir)
- **Araçlar DOM'a dokunmaz.** Görünüm alanına `ctx.view` üzerinden erişir: `pick`, `pickEdge`, `pickRect`, `edgesIn`, `gripAt`, `worldTolerance`, `requestOverlay`, `camera`.
- **Araç aileleri** (yeni araç yazarken birine dahil edin):

  | Aile | Dosya | Akış |
  |---|---|---|
  | `PointInputTool` | `tools/drawTools.ts`, `tools/curveTools.ts`, `tools/shapeTools.ts`, `tools/annotateTools.ts` | Nokta dizisi: çizgi (G geri, K kapat), çoklu çizgi (Y teğet yay parçası, D düz), alan, nokta, ölçüm, parsel; dikdörtgen (köşe yuvarla/pah, döndür, boyutlar), döndürülmüş dikdörtgen (kenar → genişlik), düzgün çokgen (içten, dıştan, kenardan); daire (merkez-yarıçap/çap, 2N, 3N, TTY), yay (AutoCAD'in tüm yöntemleri, bkz. §10), eğri; yazı, ölçü |
  | Tek tık | `tools/annotateTools.ts` | Tarama: tıklanan noktayı içeren en küçük kapalı şekli (`view.enclosingRing`) desenle doldurur |
  | `SelectionFirstTool` | `tools/modifyTools.ts` | Seçim yoksa önce seçtirir, Enter ile aşamalara geçer, sonucu **afin dönüşümle** uygular: taşı, kopyala, döndür, ölçekle, aynala, dizi |
  | `SelectionActionTool` | `tools/editTools.ts` | Seçim varsa hemen çalışır, yoksa seçtirip Enter bekler: birleştir, patlat |
  | `EdgePickTool` | `tools/edgeTools.ts`, `tools/pathEditTools.ts`, `tools/cornerTools.ts` | İmlecin altındaki kenara doğrudan etki eder: ötele, buda, uzat; kır, böl, köşe ekle/sil; `CornerTool` alt ailesi iki çizgiye ya da çoklu çizginin komşu iki kenarına etki eder: köşe yuvarla, pah |
  | Diğer | `tools/SelectTool.ts`, `tools/editTools.ts` | Seçim (pencere/kesişim, tutamaçla düzenleme), kaydırma, pencere yakınlaştırma; esnet (kesişim penceresi → temel → hedef); yapıştır |

- **Katalog dışı araçlar** (`ctx.tools.run(tool, label)`): içeriği o anki duruma bağlı olan araçlar (ör. panodaki nesnelerle `PasteTool`) katalogda durmaz, "son komutu yinele"ye girmez.

- **İmleç kısıtlaması** tek yerdedir (`tools/tracking.ts` → `constrainPoint`). Öncelik sırası: nesne keneti, nesne izleme, orto (Shift tersine çevirir), kutupsal izleme (F10, adım `prefs.polarIncrement`). Kutupsal kilit ışına 10 px yaklaşınca devreye girer.
- **Nesne izleme** (`viewport/objectTracking.ts`, saf ve testli; `settings.tracking`, Shift+F3, durum çubuğunda "İzleme"): nokta bekleyen bir komutta uç, orta, merkez, düğüm, çeyrek ya da kesişim keneti üzerinde 350 ms beklemek o noktayı izleme noktası yapar (yeşil artı, en çok 3). Aynı noktada tekrar beklemek bırakır. İmleç bir izleme noktasının yatay/dikey hizasına (kutupsal açıksa açı adımlarına) 8 px yaklaşınca kilitlenir. İki hizanın kesişimi tek hizadan önce gelir; aracın son noktası (`snapFrom`) yalnızca kesişimlere katılır. Eksen yönleri tam değerle hesaplanır, böylece "tam üstü" aynı X'i verir. Kenet varken izleme uygulanmaz. İzleme varken yazılan tek sayı izleme noktasından hiza boyunca mesafedir: araçlar yazılan noktayı `pointFromText` ile çözer (`parsePointInput` + `view.trackAlong`). İzleme noktaları komut değişince silinir.
- **`ToolPointer.track`:** kilitlenilen hiza. `world` önceliği `snap → track → raw`'dır.
- **Tutamaçla düzenleme** (seçim aracı): seçili ve kilitsiz bir nesnenin tutamacını sürüklemek o noktayı taşır. Tıklayıp bırakmak tutamacı "sıcak" yapar; sonraki tıklama ya da yazılan koordinat yerleştirir, Esc vazgeçer. Kenet ve kutupsal izleme bu sırada çalışır. Tutamaç anlamları `model/ops/grips.ts` içindedir.
- **Kenar ortası tutamaçları:** çoklu çizgi ve kapalı alanda köşelerden sonra her kenar için bir orta tutamaç gelir (içi boş baklava). Düz kenarda sürüklemek oraya yeni köşe ekler, yay kenarında yayı sürüklenen noktadan geçecek biçimde büker. Ekranda 28 px'ten kısa kenarlarda gösterilmez (`midGripVisible`).
- **Pano:** `Ctrl+C` seçimi `ctx.clipboard`'a derin kopya olarak alır; taban noktası sınır kutusunun sol alt köşesidir. `Ctrl+V` bu köşeyi imlece bağlayıp tıklanan yere koyar, `Ctrl+Shift+V` özgün koordinatlara yapıştırır. `Ctrl+X` kopyalayıp siler. Nesne katmanı yoksa ya da kilitliyse etkin katmana yapıştırılır.
- **Yerinde yazı düzenleme:** Seçim aracında yazı ya da ölçüye çift tıklamak `view.requestTextEdit(id)` çağırır. Asıl düzenleyici arayüz katmanındadır (`ui/shell/InlineTextEditor.ts`), çünkü araçlar DOM'a dokunmaz. Düzenleyici yazının üstüne aynı boyut ve açıyla oturur; düzenlenen yazı üst katmanda gizlenir (`view.setEditing`).
- **Yazılı seçenekler** aşamaya göre değişir: sayı (açı, faktör, mesafe, yarıçap, satır/sütun), harf (`K` kopya, `S` kaynağı sil, `K` kapat, `G` geri).
- **İstem düzeni (bağlayıcı):** `Araç: adım [Seçenek (TUŞ) / Seçenek (TUŞ): değer; not]`. `ui/promptOptions.ts` bunu ayrıştırır ve her seçeneği komut şeridinde (çizim alanının üstü) ve komut satırında **düğmeye** çevirir; düğme, tuşu yazmakla aynı işi yapar (`tool.input(TUŞ)`, `Enter` → onay, `Esc` → iptal). Köşeli parantez içinde `(TUŞ)` taşımayan parçalar not olarak gösterilir. Bölücüler ` / ` ve `;`'dür; bu yüzden değerlerin içinde bu karakterler kullanılmaz. Fareyle ulaşılamayan bir seçenek yazılmaz.
- **Fare önce gelir:** her araç yalnızca fareyle tamamlanabilmelidir. Sayı gerektiren yerlerde fareyle gösterme yolu sunulur (ör. köşe yuvarlamada yarıçap imleç çekilerek, ötelemede "Noktadan geç"), yazılan değer yalnızca kesinlik içindir.
- **Sağ tuş (zamana duyarlı, `ViewportController.onRightDown/onRightUp`):** kısa sağ tık çalışan komutta Enter'dır, seçim aracında bağlam menüsünü açar. 300 ms basılı tutmak komut menüsünü açar (onayla, iptal, istemdeki seçenekler, tek seferlik kenet, orto, kutupsal). Shift+sağ tık doğrudan kenet menüsünü açar. Tarayıcının `contextmenu` olayı yalnızca engellenir; zamanlaması işletim sistemine göre değiştiği için kullanılmaz. Menüleri `ui/shell/viewportMenus.ts` kurar (`contextmenu` olayı `kind: 'select' | 'command' | 'snap'` taşır).
- **Tek seferlik kenet:** `view.snapOverride` bir sonraki sol tıklamada yalnızca seçilen türe kenetler (F3 kapalı olsa bile) ve tıklamadan sonra kendiliğinden temizlenir. Komut şeridi bunu "Sonraki tık: …" etiketiyle gösterir. Kenet menülerinde her tür, çizimdeki işaretiyle aynı biçimde çizilmiş bir simge taşır (`ui/icons.ts` → `snapEndpoint` …).
- **İmleç yanında değer girişi** (`ui/shell/CursorInput.ts`, `prefs.cursorInput`): komut çalışırken ve fare çizim alanındayken rakam, `@` ya da `.` basılırsa alan imlecin yanında açılır; metni komut satırıyla aynı yoldan (`tool.input`) gönderir. Kapalıyken ya da fare çizim alanı dışındayken komut satırı kullanılır.
- **Bilgi kartı** (`ui/shell/HoverCard.ts`, `prefs.hoverInfo`): seçim aracında bir nesnenin üzerinde 500 ms durunca tür, katman, ada/mahalle/nitelik, tapu alanı ile hesaplanan alan, uzunluk ya da yarıçap gösterilir.
- **Tutamaç menüsü:** seçili çoklu çizgi ya da alanın köşe tutamacına sağ tık "Köşeyi sil", kenar ortası tutamacına sağ tık "Ortasına köşe ekle" ve "Yaya dönüştür" ya da "Düz kenar yap" sunar.
- **Seçim isteyen araçlar** (`SelectionFirstTool` ve alt aileleri) seçim aşamasında tıklamayla tek tek ve sürüklemeyle pencere/kesişim seçimi kabul eder; sağ tık seçimi onaylar.
- **Köşe yuvarla ve pah** (`tools/cornerTools.ts`): imleç bir köşeye (çoklu çizgi köşesi ya da iki çizginin birleştiği uç) 12 px yaklaşınca köşe halkayla işaretlenir. Tıklayınca köşe kilitlenir; imleç bir kenar boyunca çekildikçe teğet/kesim mesafesi canlı büyür (yakınlığa göre yuvarlanmış adımla), ikinci tık uygular. Yazılan değer tam uygular, sağ tık son değeri kullanır. Birleşmeyen iki çizgide sırayla iki çizgiye tıklanır.
- **Semantik:**

  | Tuş | Davranış |
  |---|---|
  | Esc | Araçtan çıkar, seçime döner. Seçim aracındaysa seçimi temizler. |
  | Enter / sağ tık | Geçerli nesneyi bitirir; araçta kalınır. Bekleyen bir şey yoksa araçtan çıkar. |
  | Seçim aracında Enter | Son aracı tekrarlar. |
  | Boşluk | Komut satırına gider. |

- **Koordinat girişi** (`tools/coordinateInput.ts`):
  - `Y,X` mutlak
  - `@dY,dX` göreli
  - `@mesafe<açı` kutupsal (derece, doğudan saat yönünün tersine)
  - tek sayı: imleç doğrultusunda mesafe

  Ondalık ayırıcı nokta, koordinat ayırıcı virgüldür.
- **Harita araçlarının hedef katmanları** (`parsel`, `kot`) katalogdaki `LAYERS` yapılandırmasındadır. Araç kodunda katman kimliği sabit yazılmaz.

### 4.8 Belge modeli (`model/`)

- **`CadDocument`:** varlıklar `Map<id, Entity>` içinde durur. Bütün düzenlemeler `add`, `update`, `remove` ve bunları gruplayan `transact(label, fn)` üzerinden yapılır. Her işlem tersine çevrilebilir bir `Op` olarak kaydedilir; geri alma yığını 200 adımla sınırlıdır.
- **Olaylar:**
  - `changed { layerIds }`: geometri ya da üyelik değişti; GPU tamponu yeniden kurulur.
  - `attrs { ids }`: yalnızca öznitelik değişti; tampon kurulmaz, etiket ve panel yenilenir.
- **`load()`:** geçmiş tutmadan toplu yükleme yapar (dosya açma).
- **`Entity`:** türler `point | line | polyline | polygon | circle | arc | ellipse | spline | xline | ray | text | dimension | hatch`.
  - `ellipse`: DXF ELLIPSE biçimi: merkez `c`, büyük eksen vektörü `major`, küçük/büyük `ratio`, parametreler `t0 → t1` (saat yönünün tersine; eşitse tam elips). Nokta `c + major·cos t + minor·sin t`. Budama, kırma ve uzatma parametre uzayında yapılır, parçalar eliptik yay kalır. Öteleme (matematikte elips değildir) gerçek öteleme noktalarından sık bir çoklu çizgi verir.
  - `xline` / `ray`: taban noktası `p` ve birim yön `dir`; iki yöne ya da tek yöne sonsuz yardımcı çizgi. Tümünü göster ve sınır kutusu yalnızca `p`'yi sayar; pencere seçimi (tamamen içeride) onları hiç seçmez, kesişim seçimi seçer. Budama ve kırma AutoCAD gibi ışın ya da çizgi parçası üretir.
  - `spline`: geçiş noktalarından merkezcil Catmull-Rom eğrisi (`pts`, `closed`); benzerlik dönüşümlerinde tam doğrudur.
  - `dimension`: hizalı ölçü (`a`, `b`, işaretli `offset`, yazı yüksekliği `height`, isteğe bağlı `text`). Boş `text` ölçülen değeri proje birimiyle gösterir; aralıklar ve ölçü uçları yazı yüksekliğinden türetilir.
  - `polyline` / `polygon`: köşeler (`pts`) ve isteğe bağlı `bulges`. `bulges[i] = tan(θ/4)`, `pts[i] → pts[i+1]` kenarının (kapalı alanda son eleman kapanış kenarının) yay açısıdır; pozitif saat yönünün tersidir, 0 düz kenardır. DXF LWPOLYLINE ile birebir aynıdır. Yay yoksa alan hiç yazılmaz. **Geometriyi `doc.update` ile değiştirirken yeni şekilde yay yoksa `bulges: undefined` açıkça verilir**, yoksa eski yaylar birleştirmede kalır. Yaylı bir şeklin halkası `polygonRing(e)`, çevresi `entityOutline(e)` ile alınır; `e.pts` doğrudan dolgu ya da içerik testi için kullanılmaz.
  - `hatch`: sınır halkası (`ring`) ve desen (`solid | lines | cross`, açı, aralık). Sınır şekline bağlı (ilişkisel) değildir; desen dünya ızgarasına hizalı olduğu için komşu taramalar ortak sınırda örtüşür.
  - `text`: seçim ve sınır kutusu, döndürülmüş yaklaşık metin kutusudur (`textBox`, harf başına ~0,55 em). Yay (`arc`) merkez, yarıçap ve radyan cinsinden `a0 → a1` açılarıyla, **her zaman saat yönünün tersine** tutulur; aynalama gibi yönü çeviren işlemler başlangıç ve bitişi değiştirerek bu kuralı korur. Ortak alanlar `layerId`, `color?` (yoksa katmana göre), `attrs: Record<string,string>` ve `label?` (çizimde gösterilen kısa metin: parsel no, nokta adı).
- **`LayerStore`:** ağaç yapısı (grup ya da katman).
  - Görünürlük ve kilit üst düğümden devralınır (`isVisible`, `isLocked`).
  - `events.structure` ağaç şekli değişince tetiklenir.
  - `events.state` görünürlük, kilit ya da stil değişince etkilenen yaprak kimlikleriyle tetiklenir.
  - `version` sinyali ucuz liste aboneliği içindir.
- **`LayerStyle`:** çizim motoru ve üst katman katman adını **bilmez**. Her görsel davranış stil alanıdır:
  - `color`: hex ya da tema jetonu: `fg` / `fg-dim` (ana ve ikincil mürekkep) ya da `ink` (CAD renk 7, "Siyah": açık zeminde siyah, koyu zeminde beyaz). Jetonlar `render/color.ts` içindeki `resolveColor` ile çözülür; arayüzdeki renk örnekleri `colorSwatch` kullanır, jetonu doğrudan CSS'e yazmaz. Taslak katmanı `ink` ile başlar.
  - `lineType`, `lineWeight` (mm), `fill`
  - `point { symbol, size }`
  - `label` (`LabelStyle`: yerleşim, boyut, şablon, görünür ölçek aralığı)
  - `pickInterior` (çokgenin içine tıklayınca seçilsin mi)

  Yeni bir görsel özel durum gerekiyorsa `LayerStyle`'a alan ekleyin; `if (layerId === '…')` yazmayın.
- **`ProjectSettings`:** SRID ve CRS tanımı, uzunluk ve alan hassasiyeti, alan birimi, açı birimi, çizim ölçeği. `toJSON()` ve `assign()` dosya biçimine hazırdır.

### 4.8.1 Geometri çekirdeği (`model/geom/`, `model/ops/`)

CAD doğruluğunun kaynağıdır. **Saf fonksiyonlardan oluşur, DOM ve belge bilmez, her fonksiyonun birim testi vardır.**

| Dosya | İçerik |
|---|---|
| `geom/affine.ts` | `Affine` (`[a,b,c,d,e,f]`), öteleme, döndürme, ölçekleme, aynalama, birleştirme, `isReflection` |
| `geom/arc.ts` | Açı normalleştirme, süpürme açısı, üç noktadan çember ve yay, yay parçalama (tessellation) |
| `geom/bulge.ts` | Çoklu çizgi yay parçaları: bulge → merkez/yarıçap/işaretli açı, üç noktadan ve teğetten bulge, kenar ortası ve teğeti, kenarlar, çevre, alan (shoelace + daire parçaları), ters çevirme, sıfır uzunluklu kenar temizliği |
| `geom/intersect.ts` | **`Edge`** (doğru parçası ya da yay/daire) ve kesişimler: parça-parça, parça-yay, yay-yay, ışın-kenar; en yakın nokta, dik ayak. Yay kenarının `sweep`'i **işaretlidir** (negatif = saat yönü), böylece çoklu çizgi yaylarında yol yönü korunur; yay üzerinde olma testi `onEdgeArc` ile yapılır |
| `geom/offset.ts` | Gönyeli (miter) yol öteleme, keskin köşede pah; yaylı yolda yaylar merkezleri etrafında büyür/küçülür, komşular taşıyıcı doğru/çember kesişiminde birleşir; noktanın hangi tarafta olduğu |
| `geom/shapes.ts` | Dikdörtgen (kenardan, döndürülmüş köşelerden, boyuttan), düzgün çokgen (içten, dıştan, kenardan), AutoCAD yay yöntemleri (başlangıç-merkez-bitiş/açı/kiriş, başlangıç-bitiş-açı/yön/yarıçap/merkez) |
| `geom/ellipse.ts` | Elips ve eliptik yay: nokta, türev, parametre (afin dönüşümle birim çembere), yay uzunluğu (Simpson), alan, en yakın parametre (Newton), doğru kesişimi (tam), teğet noktaları (tam), eksenden/merkezden kurulum |
| `geom/tangentCircle.ts` | İki nesneye teğet, verilen yarıçaplı daire (TTY): paralel doğru ve çemberlerin kesişimleri, tıklanan yerlere en yakın çözüm |
| `geom/spline.ts` | Merkezcil Catmull-Rom (Barry–Goldman), açık ve kapalı |
| `geom/hatch.ts` | Tarama çizgilerini halkaya kırpma (tek-çift kuralı, yarı açık tepe kuralı, dünya ızgarasına hizalı, en çok 20 000 çizgi) |
| `geom/dimension.ts` | Hizalı ölçü yerleşimi: uzatma çizgileri, eğik uçlar, her zaman okunur yazı konumu; işaretli ötelenme |
| `ops/edgeLabels.ts` | Kenar ölçüsü yazılarının yeri: kenar ortası, halkanın dışı, okunur açı |
| `ops/edges.ts` | Nesne → `Edge[]`. **Yeni nesne türü yalnızca kenarlarını vererek** kesişim, budama, uzatma ve kenetlemeye katılır. |
| `ops/transform.ts` | Her nesne türüne afin dönüşüm. Yazı aynalanınca okunur kalır (MIRRTEXT = 0). |
| `ops/curveCuts.ts` | Yol olmayan eğriler için budama, kırma, uzatma, öteleme: elips (parametre uzayında, kesimler doğruda tam, yayda alternatif izdüşümle) ve yardımcı çizgiler (parçalar ışın ya da çizgi; kesimler taban noktasından çözülür) |
| `ops/path.ts` | Nesneyi uzunluk parametreli yol (`s ∈ [0, L]`) olarak görür: noktası, teğeti, en yakın `s`, kesimler, alt yol (yay parçaları tam kesilir), eşit bölme ve aralık parametreleri. Buda, kır ve böl bunu kullanır. |
| `ops/trim.ts` | Hızlı budama ve uzatma. Kapalı şekiller açılır, daire yaya dönüşür; yayla biten çoklu çizgi kendi çemberi boyunca uzar. |
| `ops/break.ts`, `ops/join.ts`, `ops/explode.ts`, `ops/stretch.ts`, `ops/vertex.ts` | Kır (iki nokta arası ya da tek noktadan; kapalıda saat yönünün tersine), birleştir (uç toleranslı zincir; kapanırsa alan), patlat (çizgi/yay, eğri → çoklu çizgi, ölçü → çizgi + yazı), esnet (penceredeki köşeler), köşe ekle/sil (yay kenarı aynı çember üzerinde ikiye bölünür) |
| `ops/offset.ts`, `ops/fillet.ts`, `ops/grips.ts` | Nesne öteleme; iki çizgi için köşe yuvarlama ve pah, çoklu çizgi köşesinde yuvarlama (yay parçası) ve pah (`cornerOfPath`); tutamaç anlamları |

- **İşlemler geometri döndürür, belgeyi değiştirmez.** Sonuç `EntityGeometry` ya da `{ error }` olur. Kaydı araç yapar (`doc.transact`); böylece her değişiklik tek adımda geri alınır.
- **Hata dili kullanıcıya yöneliktir** (`{ error: 'Yarıçap bu çizgiler için çok büyük.' }`). Araç bunu doğrudan `log.warn` ile gösterir.
- **Toleranslar:** kesişimde parametre toleransı `1e-9`, kesim noktası birleştirmede `1e-7 × L`. Ekran toleransı araçtan `view.worldTolerance(px)` ile gelir; geometri çekirdeğinde piksel yoktur.
- **Sayısal kararlılık:** yardımcı çizgiler CPU'da `CONSTRUCTION_REACH` (1000 km) yarı uzunluğunda kenar olarak hesaba girer. Bu uzunlukta ikinci derece denklemin diskriminantı basamak kaybeder; bu yüzden `lineCircleParams` merkezden doğruya dikme ayağından çözer, yardımcı çizgi kesimleri uzak uçlardan değil taban noktasından hesaplanır ve doğruyla kesişen eğrilerde nokta doğrunun üzerinden alınır. Yeni bir kesişim yazarken aynı kural geçerlidir: büyük sayıların farkını almayın.

### 4.9 Çizim hattı (`render/`, `viewport/`)

```
CadDocument ──(changed/state olayları)──► ViewportController.dirtyLayers
                                               │ rAF
                                               ▼
                          sceneBuilder.buildSceneLayer(layer) → SceneLayer (Float32Array)
                                               ▼
                          RenderBackend.upload(layer) / render(FrameState)
```

- **`RenderBackend` sözleşmesi** (`render/types.ts`): `init`, `resize`, `upload(SceneLayer)`, `remove(id)`, `render(FrameState)`, `dispose`.
  - WebGL2 tam olarak uygulanmıştır.
  - WebGPU aynı sözleşmeyi uygulayan bir iskelettir.
  - Arka uca yalnızca `SceneLayer` ve `FrameState` gider; varlık, katman ağacı ya da DOM gitmez.
- **`SceneLayer`:** katman başına çizgi, dolgu ve nokta topluları. Renk ve kesikli çizgi deseni topluya aittir.
  - Çizgi: segment listesi ve kümülatif mesafe. Kesik desen parça gölgelendiricide piksel cinsinden hesaplanır.
  - Dolgu: kulak kırpma (ear clipping) ile üçgenlenir.
  - Nokta: gölgelendiricide çizilen simgeler (halka, artı, üçgen).
- **Yerel orijin (RTC):** Dünya koordinatları CPU'da float64 ve mutlaktır. GPU'ya yalnızca `doc.origin`'e göre farklar float32 olarak gider. TM koordinatları 4,4 milyon metreye ulaşır; mutlak float32 santimetre titremesine yol açar. **GPU'ya asla mutlak koordinat yüklemeyin.**
- **Çizim sırası:** alt katmanlar (ızgara), ağaçtaki yaprak sırasının tersi (listede üstteki en son, yani en üstte çizilir), üst katmanlar (`__hover`, `__sel`). Her geçişte önce dolgular, sonra çizgiler, sonra noktalar çizilir.
- **Yardımcı çizgiler** (`xline`, `ray`) GPU'ya görünüm alanının üç katı büyüklüğündeki bir kutuya kırpılarak gider (`BuildOptions.clip`); görünüm kutudan çıkınca ya da ölçek iki kattan fazla değişince bu çizgileri içeren katmanlar ve vurgular yeniden kurulur. Böylece GPU'ya hiçbir zaman uzak (float32'de titreyen) koordinat gitmez.
- **Vurgu ayrı katmandır.** Seçim değişince yalnızca `__sel` ve `__hover` yeniden kurulur, belge katmanlarına dokunulmaz.
- **`ViewportController`:**
  - `requestRender()` GPU'yu ve üst katmanı, `requestOverlay()` yalnızca 2B üst katmanı çizdirir. İkisi de `requestAnimationFrame` içinde birleştirilir.
  - Olay işleyicisinde asla eşzamanlı çizim yapmayın.
  - **Tek istisna boyut değişimidir:** canvas'ın `width`/`height` değeri değişince tampon temizlenir ve WebGL bağlamı `alpha: false` olduğu için siyah görünür. Çizim bir sonraki kareye bırakılırsa tarayıcı arada bu siyah tamponu gösterir; panel ayırıcısı sürüklenirken ekran yanıp söner. Bu yüzden `resize()` (ResizeObserver içinde, düzenden sonra ve boyamadan önce çalışır) boyut gerçekten değiştiyse hemen `frame()` çağırır. Duman testi sürükleme sırasında ekran akışını kare kare inceleyerek bunu denetler.
- **Üst katman** (`viewport/overlay.ts`, Canvas2D) şunları çizer: etiketler (`LabelStyle` ile), tutamaçlar, kenet işareti, artı imleç, ölçek çubuğu, "K" kuzey oku ve araç önizlemeleri. GPU metni (SDF) gelene kadar yazılar buradadır.
- **`PickIndex`** (`viewport/picking.ts`):
  - Seçme önceliği: nokta ve kenar, sonra imleci içeren en küçük çokgen (bina, parsel, ada sırasıyla).
  - Kenetleme türleri: uç, orta, merkez, nokta, çeyrek, kesişim, dik, en yakın. Tercihlerden süzülür (`prefs.snap*`).
  - Kenet önceliği: eşit uzaklıkta uç ve nokta, kesişimden; kesişim, merkezden; merkez, çeyrekten; çeyrek, ortadan; orta, dikten önce gelir. "En yakın" yalnızca başka aday yoksa kullanılır.
  - **Kenet her `pointerdown` ve `pointerup`'ta yeniden hesaplanır.** Fare hareketi olmadan gelen tıklama (kalem, dokunma, hızlı tıklama) eski kenet noktasına yapışmamalıdır.
  - `hitEdge` (yalnızca kenar seçimi) ve `edgesIn` (sınır kenarları) değiştirme araçları içindir. Budama ve uzatma sınır olarak görünür alandaki tüm kenarları kullanır.
  - Pencere seçimi (soldan sağa, tamamen içeride) ve kesişim seçimi (sağdan sola, temas).
  - Şimdilik sınır kutusu önbelleğiyle doğrusal tarama yapar. API aynı kalacak, iç yapı R-tree'ye geçecek.

### 4.10 Arayüz (`ui/`)

- **`Component`:** tek kök elemana ve bir `DisposableStore`'a sahiptir. `dispose()` her aboneliği ve dinleyiciyi bırakır. Her `subscribe` ve `listen` çağrısının dönüşü `this.d.add(...)` ile saklanır.
- **`ui/widgets/`:** genel ve bağımsız parçalar: `PopupMenu`, `Dropdown`, `TreeView`, `PropertyGrid`, `Dialog`, `Splitter`, `tooltip`, `controls` (segmented, switch, stepper, textField, settingRow, note). Widget'lar `AppContext` bilmez. Tek istisna `CommandButton`'dır, çünkü komuta bağlı düğmedir.
- **Paneller** (`LayersPanel`, `PropertiesPanel`, `BottomPanel`) modelden okur, değişikliği komut ya da belge API'si ile yapar. Panel içi yeniden çizimler mikro görevde birleştirilir (`PropertiesPanel.schedule`).
- **`AppShell`** yerleşimi kurar ve bölgeleri doldurur. Bileşenler birbirini tanımaz.
- **Ayar pencereleri** `ui/settings/`: `SettingsShell` (iskelet, taslak ve Kaydet/Vazgeç), `crsPicker` (ortak EPSG seçici), `ProjectSettingsDialog`, `AppSettingsDialog`.

---

## 5. Koordinat, birim ve hassasiyet kuralları

1. **Eksen adları terstir; dikkat.** İç temsilde `x` = doğu (Türk ölçmeciliğinde **Y, sağa değer**), `y` = kuzey (**X, yukarı değer**). Arayüzde her zaman "Y (sağa)" ve "X (yukarı)" yazılır, Y önce gelir. Kod içinde `x/y` kullanın; arayüz metninde `Y/X` kullanın.
2. **Her proje açık bir SRID taşır** (`doc.settings.crs`). Yeni projelerin varsayılanı `prefs.defaultSrid = 5256` (TUREF / TM36).
3. **CRS bilgisinin tek kaynağı `geo/crs.ts`'tir.** Projeksiyon parametreleri başka yerde yazılmaz. Yeni sistem gerekiyorsa kayda ekleyin.
4. **Atamak ile dönüştürmek farklıdır.** Proje SRID'sini değiştirmek yalnızca etiketi değiştirir, koordinatlar aynı kalır; arayüz bunu uyarıyla söyler. Dönüşüm (TUREF ↔ ED50, TM dilimleri arası) `geo/transform.ts` içinde açık, geri alınabilir bir işlem olacak. **Sessizce yeniden projeksiyon yapılmaz.**
5. **Açılar:**
   - Geometri içinde radyan ya da doğudan saat yönünün tersine derece kullanılır.
   - Ölçmecilik semti **kuzeyden saat yönünde grad** olarak `bearingGrad()` ile hesaplanır.
   - Gösterim `ctx.format.bearing()` ile yapılır; birim proje ayarından gelir.
6. **Toleranslar ekran pikselinden türetilir:** `px / camera.scale`. Seçme ve kenet için metre sabitlenmez. Geometrik bozulma eşiği `1e-9` m'dir.
7. **Alan ve uzunluk** CPU'da float64 koordinatlardan hesaplanır (shoelace). GPU verisinden ya da ekrandan ölçülmez.
8. **Birimler:** metre, m², dönüm = 1 000 m², hektar = 10 000 m².
9. **Sayıdan metne tek geçit `ctx.format`'tır** (`coord`, `length`, `area`, `bearing`, `point`). `toFixed`'i arayüz metninde doğrudan kullanmayın.
10. **Ondalık ayırıcı her yerde noktadır** (`486512.340`). Komut satırı `Y,X` biçiminde virgülü koordinat ayırıcı olarak kullanır; görülen değer kopyalanıp aynen yazılabilmelidir.
11. **Öznitelik değerleri veridir, gösterim metni değildir.** Şimdilik metin olarak saklanıyor; tipli şema geldiğinde sayı ve tarih alanları gerçek tipte tutulacak.

---

## 6. Performans

### 6.1 Bütçeler (hedef)

| Senaryo | Hedef |
|---|---|
| Kaydırma ve yakınlaştırma | 1 milyon segmentte 60 fps (16 ms kare) |
| İmleç hareketinde seçme ve kenet | 100 bin varlıkta her olayda < 2 ms |
| Bir katmanı yeniden kurma | 100 bin segmentte < 50 ms (gerekirse worker) |
| İlk açılış (örnek proje) | < 1 s |
| Açık panelde seçim değişikliği | < 8 ms |

Bugünkü uygulama örnek proje ölçeğinde (yüzlerce varlık) rahattır. Aşağıdaki
kurallar büyük veriye geçerken kodun yeniden yazılmasını önlemek içindir.

### 6.2 Kurallar

1. **Sıcak yollarda** (`pointermove`, kare döngüsü) bellek ayırmayı en aza indirin. Döngüde closure, JSON, regex ya da dizi kopyası üretmeyin.
2. **GPU tamponları yalnızca kirlenen katman için** yeniden kurulur. Seçim, üzerine gelme ve ızgara kendi katmanlarıdır.
3. **Her çizim `requestRender` ya da `requestOverlay` ile istenir.** Tek karede birleşir.
4. **Uzamsal sorgular `PickIndex` üzerinden yapılır.** Arayüz kodunda imleç hareketi başına `doc.all()` gezilmez.
5. **Uzun listeler sanallaştırılır.** 500 satırı aşabilecek her liste (katman ağacı, öznitelik tablosu, koordinat listesi, komut geçmişi) büyük veri desteğinden önce sanallaştırılmalıdır.
6. **Ağır işler worker'a gider:** dosya ayrıştırma (DXF, NCZ, SHP), büyük çokgen üçgenleme, eşyükselti ve TIN üretimi. Veri `ArrayBuffer` aktarımıyla taşınır; worker içinde DOM kullanılmaz.
7. **Büyük ölçekte geometri** `Float64Array` koordinat havuzlarında tutulur. Bugünkü `Vec2[]` binlerce varlıkta yeterlidir, milyonlarda değildir. Geçiş, `Entity` API'sini koruyarak yapılacak.
8. **Çizgi kalınlığı** için `gl.lineWidth` kullanılmaz (çoğu sürücüde 1 px). Kalın çizgiler örneklenmiş dörtgenlerle (instanced quads) çizilecek.
9. **Etiketler ölçek eşikleriyle ayıklanır** (`LabelStyle.minScale`, `minFeaturePx`). Görünmeyecek etiket için metin ölçülmez.
10. **DOM okuma ve yazma karışmaz.** Önce ölçün, sonra yazın; döngü içinde `getBoundingClientRect` ile stil yazmayı art arda yapmayın.
11. **Ölçmeden optimizasyon yapılmaz.** `performance.mark/measure` kullanın. Planlanan `?debug=perf` bayrağı kare süresi, yüklenen segment sayısı ve seçme süresini gösterecek.

### 6.3 Bilinen darboğazlar (büyük veri öncesi çözülecek)

- `CadDocument.byLayer()` her katman için bütün varlıkları geziyor → katman başına dizin gerekiyor.
- `PickIndex` doğrusal tarıyor → R-tree gerekiyor (statik veri için `flatbush`, düzenlenen veri için `rbush` benzeri).
- Izgara her kamera değişiminde yeni `Float32Array` ayırıyor → önceden ayrılmış tampona `bufferSubData` ile yazılmalı.
- Üst katman etiketleri her karede bütün varlıkları geziyor → görünür karo ve etiket önbelleği gerekiyor.
- `LayersPanel` her değişiklikte ağacın tamamını yeniden çiziyor → satır bazlı güncelleme ve sanallaştırma gerekiyor.
- `geometryChanged()` `JSON.stringify` ile karşılaştırıyor → alan bazlı karşılaştırma gerekiyor.

---

## 7. GIS ve CAD doğruluk ilkeleri

- **Her düzenleme geri alınabilir.** Belgeyi değiştiren her yol `CadDocument` API'sinden geçer. Çok adımlı işlemler `transact` ile tek adım olur.
- **Kilitli katman** düzenlenmez, taşınmaz, silinmez. Araç bunu kullanıcıya söyler ve atlanan nesne sayısını raporlar.
- **Gizli katmana çizim** yapılabilir ama uyarı verilir.
- **Parsel numaralandırma:** Yeni parsel, hedef katmandaki en büyük `Parsel` özniteliğinin bir fazlasını alır. Ada ve mahalle kullanıcıdan istenir. Tapu alanı float64 koordinatlardan hesaplanıp özniteliğe yazılır.
- **Etiket ve öznitelik tutarlılığı:** `Parsel` ya da `Ada` özniteliği değişince, etiket aynı değeri gösteriyorsa etiket de güncellenir.
- **Topoloji (planlı):** Parseller ortak kenarları paylaşan bir düzlemsel graf üzerinde tutulacak. İfraz ve tevhid bu graf üzerinde çalışacak; alan toplamları ada alanıyla doğrulanacak. Bu karar veri modelinin temelidir; paylaşımsız çokgenlerle ifraz yazılmamalıdır.

---

## 8. Kod kuralları (sürdürülebilirlik)

- **Çevredeki kod gibi yazın:** aynı adlandırma, aynı yorum yoğunluğu, aynı deyimler.
- **Yorumlar "neden"i açıklar,** "ne"yi değil. Her dosyanın başında kısa bir amaç yorumu bulunur.
- **Tek dosya, tek kavram.** 400 satırı geçen dosya bölünmeyi düşündürmelidir.
- **Sabit renk yok.** Arayüz renkleri CSS jetonlarından (`var(--c-…)`), çizim alanı renkleri `readCanvasPalette()` üzerinden alınır. Katman renkleri veridir.
- **Sabit piksel yazı boyutu yok.** `--fs-*` jetonları kullanılır; yükseklikler `--ui-scale` ile ölçeklenir (bkz. DESIGN.md).
- **Katman kimliğine göre dal yok** (`render/`, `viewport/`, `ui/`): davranış `LayerStyle`'dan gelir.
- **Model değişikliği:**
  - Arayüz, belgeyi yalnızca `CadDocument` API'si ya da komutlar üzerinden değiştirir.
  - `Signal`'lere dışarıdan `set` yalnızca sahibi olan depoda yapılır. Ayar pencereleri taslak üzerinde çalışır, Kaydet'te uygular.
- **Kaynak sızıntısı yok.** Her abonelik ve dinleyici bir `DisposableStore`'a eklenir. Global dinleyiciler (`window`) yalnızca açıkça bırakılabilen yerlerde kurulur.
- **Hata mesajları** ne olduğunu ve nasıl düzeltileceğini söyler, özür dilemez: "“Parsel sınırı” katmanı kilitli. Kilidi Katmanlar panelinden açın…"
- **Yapılmamış özellik** asla sessiz kalmaz: `pending(...)` komutu ya da `PendingTool` kullanılır.

### 8.1 Tamam sayılma listesi (her değişiklik için)

- [ ] `npx tsc --noEmit -p .` temiz, `pnpm build` başarılı.
- [ ] Katman bağımlılık yönü korunuyor (§4.1).
- [ ] Yeni durum doğru kapsamda (§4.4).
- [ ] Yeni eylemler komut olarak kayıtlı, gerekiyorsa kısayolu ve takma adı var, menüde yer alıyor.
- [ ] Belge değişiklikleri geri alınabilir.
- [ ] Sayılar `ctx.format` üzerinden gösteriliyor.
- [ ] Renk, yazı ve ölçü DESIGN.md jetonlarıyla uyumlu; koyu ve açık temada denendi.
- [ ] Tarayıcıda gerçek fare ve klavyeyle denendi.
- [ ] Bu belge ya da DESIGN.md etkilendiyse güncellendi.

---

## 9. Tarifler

### 9.1 Yeni komut

`app/commands.ts` içinde `registerCoreCommands` listesine ekleyin. Kısayol
gerekiyorsa `app/keybindings.ts`'e, menüde görünecekse `app/menus.ts`'e komut
kimliğini yazın. Araç çubuğu düğmesi için `commandButton(ctx, id, this.d)`
kullanın.

### 9.2 Yeni araç

1. `tools/` içinde `Tool` uygulayın. Uygun aileden türetin (§4.7): nokta dizisi → `PointInputTool`, seçime dönüşüm → `SelectionFirstTool`, seçime tek adımlık işlem → `SelectionActionTool`, kenara etki → `EdgePickTool`. Geometri hesabını `model/ops/` altına saf fonksiyon olarak yazıp test edin; araç yalnızca akışı ve önizlemeyi yönetir.
2. `tools/catalog.ts`'e tanımı ekleyin: kimlik, etiket, simge, grup, kısayol, takma adlar, açıklama, `create`.
3. Simge yoksa `ui/icons.ts`'e 20×20, 1,4 px çizgili bir simge çizin (bkz. DESIGN.md §6).

Komut, kısayol, araç kutusu düğmesi ve F1 listesi kendiliğinden oluşur.

### 9.3 Yeni ayar

1. Kapsama karar verin (§4.4).
2. **Proje ayarıysa:** `ProjectSettingsData`, `PROJECT_SETTINGS_DEFAULTS`, `ProjectSettings` sinyali, `toJSON` ve `assign` güncellenir; `ProjectSettingsDialog`'a bölüm ya da satır eklenir.
3. **Uygulama ayarıysa:** `PreferencesData` ve `PREFERENCE_DEFAULTS` güncellenir; `AppSettingsDialog`'a satır eklenir.
4. Ayarı okuyan kod sinyale abone olur. Bölümün `keys` listesine alanı ekleyin ki "varsayılana döndür" çalışsın.

### 9.4 Testler

**Vitest** (`pnpm test`). Test dosyaları kodun yanında `*.test.ts` olarak durur ve yalnızca saf katmanları sınar:

| Dosya | Kapsam |
|---|---|
| `model/geom/geom.test.ts` | Afin dönüşüm (büyük TM koordinatında hassasiyet dahil), yay, kesişimler, öteleme |
| `model/ops/ops.test.ts` | Nesne dönüşümü, budama (kapalı şekil ve daire dahil), uzatma, öteleme, köşe yuvarlama, tutamaçlar |
| `model/geom/curves.test.ts` | Eğri, tarama kırpma, ölçü yerleşimi, teğet noktaları, kenar ölçüleri |
| `model/document.test.ts` | Geri alma ve yineleme, `transact`, katman devralma, proje ayarları, `Formatter` |
| `model/geom/ellipse.test.ts` | Elips: parametre, uzunluk (Ramanujan'a karşı), doğru kesişimi, en yakın nokta, teğetler, eksenden kurulum |
| `model/ops/curves2.test.ts` | Elips nesnesi (aynalama, budama, kırma, uzatma, öteleme, tutamaçlar) ve yardımcı çizgiler (budama → ışın/çizgi, kırma, öteleme) |
| `model/geom/shapes.test.ts` | Dikdörtgen ve düzgün çokgen yapıları, yay yöntemleri |
| `model/geom/bulge.test.ts` | Bulge yardımcıları, teğet devam, ters çevirme, TTY dairesi |
| `ui/promptOptions.test.ts` | İstem ayrıştırma: araç, adım, seçenekler, değerler, notlar |
| `viewport/objectTracking.test.ts` | Nesne izleme: tek hiza, kesişim, son noktayla kesişim, kutupsal açılar, hiza boyunca mesafe |
| `model/ops/edit.test.ts` | Yaylı çoklu çizgide uzunluk/alan/budama/uzatma/öteleme; birleştir, patlat, kır, esnet, köşe ekle/sil, pah ve köşe yuvarlama, bölme |
| `tools/coordinateInput.test.ts` | Mutlak, göreli, kutupsal ve mesafe girişi |

Kurallar:

- `model/geom` ve `model/ops` altındaki her yeni fonksiyon test ile gelir. Sınır durumları (paralel, çakışık, sıfır uzunluk, açı 0/2π geçişi) mutlaka sınanır.
- Hata düzeltmesi, önce hatayı yeniden üreten bir testle başlar.
- **Uçtan uca duman testi** `scripts/e2e/smoke.mjs` (`pnpm e2e`): kendi Vite sunucusunu açar, başsız Chrome'u DevTools protokolüyle (`scripts/e2e/cdp.mjs`, bağımlılıksız) sürer, gerçek fare ve klavye olayları gönderir ve belgeyi `window.kentos` ile doğrular. Ekran görüntüleri `scripts/e2e/out/`'a düşer. Çizim, budama, eğri, ölçü, yazı, tarama, yerinde düzenleme, yay kipli çoklu çizgi, patlat/birleştir, pah, kır, pano, araç kutusu (tüm araçlar kaydırmasız görünür, grup katlama), komut şeridi düğmeleri, fareyle köşe yuvarlama, basılı sağ tıkla tek seferlik kenet, imleç yanında değer girişi, tutamaç menüsü, nesne izleme, panel boyutlandırırken siyah kare çıkmaması (`Page.startScreencast` ile) ve geri alma akışlarını sınar. Tam değer bekleyen kontrollerde noktalar komut satırından mutlak koordinatla girilir; ekrandan tıklanan nokta piksel yuvarlaması kadar (~0,1 m) sapar. Yeni bir kullanıcı akışı eklendiğinde buraya bir kontrol eklenir.
- Tıklama noktaları ekrandan tahmin edilmez; dünya koordinatından `camera.worldToScreen` ile hesaplanır.
- Sıradaki eksikler: `core` (komut arama, kısayol çözümleme) ve `geo` (CRS arama).

### 9.5 Yeni çizim arka ucu (WebGPU)

`render/webgpu/WebGPUBackend.ts` aynı `RenderBackend` sözleşmesini uygular:

- çizgiler için `line-list` hattı, köşe verisi `{pos: vec2f, dist: f32}`
- dolgular için `triangle-list`
- noktalar için örneklenmiş dörtgenler (WebGPU'da nokta boyutu yoktur)

Kesik desen ve nokta simgesi mantığı WebGL2 gölgelendiricilerindeki ile aynı olmalıdır. `createBackend` tarayıcı desteklemiyorsa WebGL2'ye düşer.

### 9.6 Yeni dosya biçimi (planlı arayüz)

`io/` altında her biçim bir bağdaştırıcıdır:

```ts
{ id, label, extensions, read(buffer, opts) → { entities, layers, srid }, write(doc) → ArrayBuffer }
```

Okuma ve yazma worker'da çalışır. Kaynağın SRID'si bilinmiyorsa kullanıcıya sorulur; asla tahmin edilmez.

---

## 10. Yol haritası ve hedef mimari

1. **CAD çekirdeği:**
   - **Yapıldı:** yay; döndür, ölçekle, aynala, ötele, buda, uzat, köşe yuvarla, dikdörtgen dizi; tutamaçla düzenleme; kutupsal izleme; kesişim, dik, en yakın ve çeyrek kenetleri
   - **Yapıldı (2. aşama):** eğri; hizalı ölçü; tarama (dolu, çizgili, çapraz); yerinde yazı düzenleme; yazı açısı ve yüksekliği; teğet keneti; "Kenar ölçülerini yaz"
   - **Yapıldı (3. aşama, A grubu):** çoklu çizgide yay parçaları (bulge) ve yay kipi; birleştir, patlat (eğri → çoklu çizgi dahil), kır, esnet, köşe ekle/sil ve kenar ortası tutamaçları, pah ve çoklu çizgi köşesinde yuvarlama/pah; böl (eşit parça ve aralık); pano (kes, kopyala, yapıştır, özgün koordinata yapıştır); daire 2N/3N/TTY, merkezden yay
   - **AutoCAD/Netcad çizim eşdeğerliği (bağlayıcı hedef: çizim kusursuz olmadan başka işe geçilmez):**
     - *Var:* ELLIPSE (eksenden, merkezden, döndürme, eliptik yay), XLINE (nokta, yatay, düşey, açı, açıortay), RAY, LINE (Geri, Kapat), PLINE (teğet yay kipi, Geri), RECTANG (köşe yuvarla, pah, döndür, boyutlar) ve üç noktalı dikdörtgen, POLYGON (içten, dıştan, kenardan), CIRCLE (merkez-yarıçap, merkez-çap, 2N, 3N, TTY), ARC (üç nokta; başlangıç-merkez-bitiş/açı/kiriş; başlangıç-bitiş-merkez/açı/yön/yarıçap; merkez-başlangıç-bitiş/açı/kiriş; devam), SPLINE, POINT, DIVIDE/MEASURE, TEXT, hizalı ölçü, HATCH; MOVE, COPY, ROTATE, SCALE, MIRROR, STRETCH, dikdörtgen ARRAY, OFFSET (mesafe, noktadan geç), TRIM, EXTEND, BREAK, JOIN, EXPLODE, FILLET, CHAMFER, tutamaçlar, tek seferlik kenet, nesne izleme, kutupsal izleme, orto, dinamik giriş.
     - *Eksik:* PLINE yay alt seçenekleri (açı, merkez, yön, yarıçap, ikinci nokta), Uzunluk ve kalınlık; CIRCLE TTT; DONUT; REVCLOUD; MTEXT; kutupsal ve yol boyunca ARRAY; LENGTHEN; ALIGN; ROTATE/SCALE referans ve kopya ayrıntıları; yatay/düşey, açı, yarıçap ölçüleri; TRIM/EXTEND için sınır seçme kipi; FILLET/CHAMFER çoklu ve "kırpma yok" seçenekleri.
   - **Sıradaki (B, semboloji):** sembol ve blok kütüphanesi (belgeye tanım kaydı, `insert` türü, ölçek/açı, patlatma); çizgi tipi kütüphanesi (desenli ve sembollü hatlar); Mekânsal Planlar Yapım Yönetmeliği gösterimleri ve lejant
   - **Sonra (C, D):** yatay/düşey, açı ve yarıçap ölçüsü; adalı ve ilişkisel tarama; nokta hesapları (dik ayak, doğrultu-mesafe, otomatik nokta numarası); kutupsal ve yol boyunca dizi; özellik eşle, yön ters çevir, benzerini seç; imleç yanında dinamik giriş kutusu
2. **Veri modeli:**
   - tipli katman şemaları (alan, tür, alan kümesi)
   - `Float64Array` geometri havuzu, R-tree
   - parsel topolojisi
3. **GIS:**
   - öznitelik tablosu (alt panelde, seçimle eşlenik), sorgu ve filtre, tematik stil
   - raster, WMS ve XYZ altlık (yeni `SceneLayer` türü)
   - CRS dönüşümleri: TUREF ↔ ED50 7 parametre ve grid; TM ve UTM dilimleri
4. **Harita işleri:**
   - ifraz, tevhid, aplikasyon (istasyondan semt ve mesafe)
   - kot noktası ve TIN, eşyükselti, boy kesit, hacim
   - pafta düzeni ve PDF çıktı
5. **Kalıcılık:**
   - `.kcad` biçimi: JSON manifest (proje ayarları, katmanlar, şemalar) ve ikili geometri parçaları
   - IndexedDB otomatik kayıt
   - ileride sunucu eşitleme ve PostGIS
6. **WebGPU arka ucu** ve GPU metin (SDF).
7. **Eklenti API'si:** komut, araç, panel ve IO bağdaştırıcısı katkıları; mevcut kayıtlar bu API'nin ilk kullanıcılarıdır.

---

## 11. Teknik borç ve bilinen kısayollar

- Örnek proje kodla üretiliyor (`model/sampleProject.ts`). Dosya açma ve kaydetme yok; bilinçli olarak ertelendi, çünkü kayıt bulut üzerinde olacak ve sunucu tarafı henüz yok. "Kaydet" yalnızca kaydedilmemiş işaretini temizliyor.
- Pano yalnızca bu sekmede (bellekte) çalışıyor; sekmeler ya da uygulamalar arası kopyalama yok.
- Öznitelikler serbest metin; şema yok.
- WebGPU arka ucu iskelet.
- Çizgi kalınlıkları ekranda 1 px. `lineWeight` şimdilik yalnızca veri.
- Budama ve uzatma, sınır olarak görünür alandaki tüm kenarları her imleç hareketinde yeniden topluyor (önizleme için). Büyük veride R-tree ile yalnızca hedefin çevresine bakılmalı.
- Köşe yuvarlama ve pah iki çizgi arasında ya da bir çoklu çizginin iki düz komşu kenarı arasında çalışıyor; çizgi ile çoklu çizgi, yay ile çizgi arası ve "tüm köşeler" seçeneği yok.
- Uzatma yalnızca çizgi, açık çoklu çizgi ve yayda çalışıyor; budama çoklu çizgide kendi kendini kesmeyi yok sayıyor.
- Birleştirme aynı uçta birden fazla aday varsa ilk bulunanla devam ediyor (dallanan ağlarda sonuç seçim sırasına bağlı).
- Esnet, aynı pencereye giren bir yayı üç tanımlama noktasından yeniden kuruyor; tek ucu taşınan yayın orta noktası yarı yol kadar kayıyor (AutoCAD'deki gibi sehim korunmuyor).
- Yol ötelemesinde, dar iç köşelerde oluşan kendi kendini kesen parçalar temizlenmiyor.
- Dizi yalnızca dikdörtgen; kutupsal dizi yok.
- Tarama tek halka (ada/delik yok) ve ilişkisel değil: sınır değişince tarama güncellenmez.
- Eğri doğrudan budanamaz, kırılamaz, uzatılamaz, ötelenemez; önce Patlat ile çoklu çizgiye dönüştürülür (kenarları sınır olarak her zaman kullanılır).
- Ölçü yalnızca hizalı; ölçü yazısı ve yazıların seçim kutusu yaklaşık genişlikle hesaplanıyor (gerçek glif ölçüsü yok).
- Tarama deseni her katman yeniden kurulumunda CPU'da üretiliyor; çok sayıda sık taramada GPU tarafına (desen gölgelendiricisi) taşınmalı.
- Pencere seçiminde çokgenlerin sınır kutusu kullanılıyor (tam geometri testi değil).
- Ayar pencereleri her değişiklikte bölümü yeniden çiziyor (odak korunuyor); kısa formlar için yeterli.
- Arayüz için otomatik test yok; yalnızca saf katmanların birim testleri var.

---

## 12. Dosya haritası

```
src/
  main.ts                    Giriş: stiller + createApp
  app/                       Kompozisyon kökü
    createApp.ts             Servisleri kurar, AppContext'i bağlar, kabuğu takar
    context.ts               AppContext arayüzü
    commands.ts              Çekirdek komutlar, tema ve yazı ölçeği uygulama
    keybindings.ts           Varsayılan kısayollar
    menus.ts                 Ana menü modeli, komuttan menü öğesi çözümü
    state.ts                 DraftingSettings, MessageLog, UiState, Preferences (localStorage)
    clipboard.ts             Clipboard: kopyalanan nesneler ve taban noktası (oturumluk)
    format.ts                Formatter: sayıdan metne tek geçit
  core/                      Bağımsız temel yapılar (signal, emitter, disposable, commands, keymap)
  geo/crs.ts                 EPSG kaydı (TUREF/ED50 TM, UTM, WGS84), arama, dilim önerisi
  model/                     Belge, varlıklar, geometri, katmanlar, seçim, proje ayarları, örnek proje
    geom/                    Saf geometri çekirdeği: afin, yay, bulge, kesişim, öteleme, teğet daire (+ testler)
    ops/                     Nesne işlemleri: kenarlar, yol parametresi, dönüşüm, budama/uzatma, kır, birleştir, patlat, esnet, köşe, öteleme, köşe yuvarlama/pah, tutamaçlar (+ testler)
  render/                    RenderBackend sözleşmesi, sahne kurucu, ızgara, renk; webgl2/ ve webgpu/
  viewport/                  Kamera, ViewportController, PickIndex, üst katman çizimi
  tools/                     Tool sözleşmesi, ToolManager, katalog, koordinat girişi, imleç kısıtlaması (tracking)
    drawTools.ts             PointInputTool ailesi: çizgi, yol (yay kipiyle), dikdörtgen, nokta, sil
    curveTools.ts            Yay (tüm AutoCAD yöntemleri), daire (merkez-yarıçap/çap, 2N, 3N, TTY), eğri
    shapeTools.ts            Dikdörtgen (seçenekleriyle), döndürülmüş dikdörtgen, düzgün çokgen
    ellipseTool.ts           Elips ve eliptik yay (eksenden, merkezden, döndürmeyle)
    constructionTools.ts     Yardımcı çizgi (nokta, yatay, düşey, açı, açıortay) ve ışın
    annotateTools.ts         Yazı, ölçü, tarama
    modifyTools.ts           SelectionFirstTool ailesi: taşı, kopyala, döndür, ölçekle, aynala, dizi
    edgeTools.ts             EdgePickTool tabanı: ötele, buda, uzat
    cornerTools.ts           CornerTool: köşe yuvarla, pah (köşeye tıkla, imleçle boyut göster)
    pathEditTools.ts         Kır, böl, köşe ekle/sil
    editTools.ts             Birleştir, patlat, esnet, yapıştır
    SelectTool.ts            Seçim (tutamaçla düzenleme dahil), kaydırma, pencere yakınlaştırma
  ui/
    shell/AppShell.ts        Yerleşim ve bölgeler
    shell/InlineTextEditor.ts  Yazı ve ölçü için yerinde düzenleyici
    shell/CommandBar.ts      Komut şeridi: çalışan komutun adımı, seçenek düğmeleri, tek seferlik kenet, fare hatırlatması
    shell/CursorInput.ts     İmleç yanında değer girişi (dinamik giriş)
    shell/HoverCard.ts       Üzerine gelinen nesnenin bilgi kartı
    shell/viewportMenus.ts   Çizim alanındaki sağ tuş menüleri: boşta, komut, kenet, tutamaç
    promptOptions.ts         İstem ayrıştırma ve seçenek düğmeleri (komut şeridi ve komut satırı ortak)
    menu/ toolbar/ toolbox/  Menü çubuğu, araç çubuğu, kayan araç kutusu
    dock/ layers/ properties/  Sağ dok, katman ağacı, öznitelik paneli
    bottom/                  Komut satırı ve alt panel (geçmiş, koordinat listesi, uyarılar)
    statusbar/               Durum çubuğu
    settings/                SettingsShell, crsPicker, Proje ve Uygulama ayarları pencereleri
    widgets/                 Genel parçalar (menü, açılır liste, ağaç, özellik ızgarası, pencere, kontroller)
    dialogs.ts               Kısayol listesi ve Hakkında
    icons.ts                 Simge seti
  styles/                    tokens, base, shell, controls, panels, settings
scripts/e2e/                 Başsız Chrome duman testi (cdp.mjs sürücü, smoke.mjs senaryo)
```
