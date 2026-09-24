# Etkileşim ölçümü: s1-after (2026-09-24, 21ac4c5)

Intel(R) Xeon(R) Processor @ 2.10GHz, 4 iş parçacığı, 16 GB; Chromium 141.0.7390.37; başsız, WebGL2 (ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)); Vite geliştirme sunucusu (`window.kentos`). Pencere 1600×900, çizim alanı 1288×759 CSS px, dpr 1. 1 koşu; her koşu sayfayı yeniden açar ve veri setini yeniden kurar. Toplam 49 dk, Chrome en çok 941 MB (PSS).

Süreler ana iş parçacığında ms'dir (`ViewportProbe`, src/viewport/ViewportController.ts; yalnız geliştirme derlemesinde). Her hücre 1 koşunun ortancasıdır; p95'in yanında koşular arasındaki en düşük–en yüksek p95 yazar. Zamanlayıcı adımı 5 µs (cross-origin isolated). Hedefler [ADR 0005](../adr/0005-performance-acceptance-targets.md)'tedir; ADR **taslaktır ve kullanıcı onayı bekler**, bu rapor yalnızca kayıttır.

## Veri setleri

| Ad | İçerik | Nesne | Ham kenar | Üretme | `replaceWith` | İlk kare (bütün katmanlar) | JS yığını | Chrome (yüklemeden sonra) |
|---|---|---|---|---|---|---|---|---|
| `parsel-50k` | ~50 000 parsel (bir kısmı yaylı, bir kısmı delikli) ve içlerinde yapılar, TM36 | 81 229 | 334 336 | 326 ms | 42.6 ms | 303 ms | 39 MB | 773 MB |
| `hat-1m` | 1 000 000 doğru parçası: 2 000 eşyükselti benzeri çoklu çizgi × 500 parça, TM36 | 2 000 | 1 000 000 | 161 ms | 19.1 ms | 251 ms | 83 MB | 874 MB |

- `parsel-50k`: 50 400 parsel (6 146 yaylı cephe, 2 355 delikli), 30 829 yapı; büyük katman `parsel`. Yakın görünüm 1:1 000, 193 nesne görünür; genel görünüm 1:35 166, 81 229 nesne. Tohum 5256.
- `hat-1m`: 2 000 çoklu çizgi, hepsi tek katmanda; büyük katman `esyukselti`. Yakın görünüm 1:1 000, 71 nesne görünür; genel görünüm 1:57 877, 2 000 nesne. Tohum 1000.

## İmleç hareketi (olay başına)

Aynı tohumlu 240 hareketlik yol (buda: ilk 120 (`parsel-50k`), 40 (`hat-1m`)); her hareket kendi karesini çizer. “Seçme” ve “kenar seçme” aracın hareket işleyicisi, “kenet” nesne kenetidir; “olayın tamamı” `pointermove` işleyicisinin bütünüdür (durum çubuğu koordinatları dahil).

| Veri seti | Araç | Görünüm | Ölçüt | p50 | p95 (aralık) | p99 | en çok |
|---|---|---|---|---|---|---|---|
| `parsel-50k` | Seç (üzerine gelme) | yakın (1:1000) | seçme | 0.04 | 0.11 (0.11–0.11) | 0.90 | 0.90 |
| `parsel-50k` | Seç (üzerine gelme) | yakın (1:1000) | olayın tamamı | 0.17 | 0.52 (0.52–0.52) | 2.38 | 2.38 |
| `parsel-50k` | Seç (üzerine gelme) | genel (tümü) | seçme | 0.11 | 0.27 (0.27–0.27) | 0.80 | 0.80 |
| `parsel-50k` | Seç (üzerine gelme) | genel (tümü) | olayın tamamı | 0.20 | 0.63 (0.63–0.63) | 0.91 | 0.91 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | yakın (1:1000) | kenet | 0.07 | 0.12 (0.12–0.12) | 1.52 | 1.63 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | yakın (1:1000) | olayın tamamı | 0.17 | 0.65 (0.65–0.65) | 2.00 | 3.72 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | genel (tümü) | kenet | 1.73 | 3.15 (3.15–3.15) | 5.99 | 6.99 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | genel (tümü) | olayın tamamı | 1.85 | 3.66 (3.66–3.66) | 6.25 | 7.20 |
| `parsel-50k` | Buda | yakın (1:1000) | kenar seçme | 0.08 | 0.18 (0.18–0.18) | 1.85 | 1.85 |
| `parsel-50k` | Buda | yakın (1:1000) | olayın tamamı | 0.18 | 0.32 (0.32–0.32) | 1.99 | 1.99 |
| `hat-1m` | Seç (üzerine gelme) | yakın (1:1000) | seçme | 0.42 | 0.66 (0.66–0.66) | 0.81 | 0.81 |
| `hat-1m` | Seç (üzerine gelme) | yakın (1:1000) | olayın tamamı | 0.54 | 0.97 (0.97–0.97) | 1.78 | 1.78 |
| `hat-1m` | Seç (üzerine gelme) | genel (tümü) | seçme | 0.88 | 1.60 (1.60–1.60) | 1.87 | 1.87 |
| `hat-1m` | Seç (üzerine gelme) | genel (tümü) | olayın tamamı | 0.98 | 1.70 (1.70–1.70) | 1.98 | 1.98 |
| `hat-1m` | Çizgi, ilk noktadan sonra | yakın (1:1000) | kenet | 0.68 | 1.40 (1.40–1.40) | 3.52 | 3.93 |
| `hat-1m` | Çizgi, ilk noktadan sonra | yakın (1:1000) | olayın tamamı | 0.79 | 1.72 (1.72–1.72) | 3.88 | 11.1 |
| `hat-1m` | Çizgi, ilk noktadan sonra | genel (tümü) | kenet | 18.9 | 31.9 (31.9–31.9) | 41.7 | 57.9 |
| `hat-1m` | Çizgi, ilk noktadan sonra | genel (tümü) | olayın tamamı | 19.4 | 32.4 (32.4–32.4) | 41.9 | 58.1 |
| `hat-1m` | Buda | yakın (1:1000) | kenar seçme | 0.43 | 1.07 (1.07–1.07) | 1.86 | 1.86 |
| `hat-1m` | Buda | yakın (1:1000) | olayın tamamı | 0.52 | 1.18 (1.18–1.18) | 1.95 | 1.95 |

## Kareler

Kaydırma orta tuşla 80 adımdır (gidip gelir); “GPU gönderimi” çizim çağrılarının ana iş parçacığındaki süresidir, GPU'nun kendi çizimi dahil değildir. “Kare aralığı” bir karenin başından sonrakinin başına geçen duvar saatidir: GPU'nun işi ve 60 Hz ekran temposu dahil, ulaşılan kare hızını gösterir (16.7 ms = 60 fps; tempo yüzünden 16.7'nin katlarına yakın çıkar). Yeniden kurma koşu başına 6 stil değişikliğidir.

| Veri seti | Senaryo | Ölçüt | p50 | p95 (aralık) | p99 | en çok |
|---|---|---|---|---|---|---|
| `parsel-50k` | Kaydırma, yakın (1:1000) | üst katman | 0.53 | 0.88 (0.88–0.88) | 4.46 | 4.46 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | etiketler | 0.43 | 0.71 (0.71–0.71) | 4.30 | 4.30 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | GPU gönderimi | 0.33 | 1.81 (1.81–1.81) | 3.00 | 3.00 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | kare (CPU) | 0.89 | 2.69 (2.69–2.69) | 6.51 | 6.51 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | kare aralığı (GPU dahil) | 4177 | 8292 (8292–8292) | 12515 | 12515 |
| `parsel-50k` | Kaydırma, genel (tümü) | üst katman | 5.03 | 10.2 (10.2–10.2) | 13.4 | 13.4 |
| `parsel-50k` | Kaydırma, genel (tümü) | etiketler | 4.71 | 10.0 (10.0–10.0) | 13.2 | 13.2 |
| `parsel-50k` | Kaydırma, genel (tümü) | GPU gönderimi | 0.32 | 0.62 (0.62–0.62) | 0.77 | 0.77 |
| `parsel-50k` | Kaydırma, genel (tümü) | kare (CPU) | 5.42 | 10.6 (10.6–10.6) | 13.7 | 13.7 |
| `parsel-50k` | Kaydırma, genel (tümü) | kare aralığı (GPU dahil) | 6337 | 12948 (12948–12948) | 14718 | 14718 |
| `parsel-50k` | Buda önizlemesi, yakın (1:1000) | önizleme (imleç bir kenardayken) | – | – | – | – |
| `parsel-50k` | Buda önizlemesi, yakın (1:1000) | kare (CPU), bütün kareler | 0.78 | 2.59 (2.59–2.59) | 4.82 | 4.82 |
| `parsel-50k` | Seç, yakın (1:1000) (vurgu değişince tam çizim) | kare (CPU) | 0.73 | 4.24 (4.24–4.24) | 5.57 | 5.57 |
| `parsel-50k` | Çizgi, yakın (1:1000) | kare (CPU) | 0.63 | 2.20 (2.20–2.20) | 3.93 | 8.20 |
| `parsel-50k` | Büyük katmanı yeniden kurma (stil değişikliği) | kurma ve yükleme | 268 | 307 (307–307) | 307 | 307 |
| `hat-1m` | Kaydırma, yakın (1:1000) | üst katman | 0.30 | 0.65 (0.65–0.65) | 4.83 | 4.83 |
| `hat-1m` | Kaydırma, yakın (1:1000) | etiketler | 0.20 | 0.47 (0.47–0.47) | 4.04 | 4.04 |
| `hat-1m` | Kaydırma, yakın (1:1000) | GPU gönderimi | 0.35 | 4.18 (4.18–4.18) | 4.27 | 4.27 |
| `hat-1m` | Kaydırma, yakın (1:1000) | kare (CPU) | 0.71 | 4.62 (4.62–4.62) | 9.09 | 9.09 |
| `hat-1m` | Kaydırma, yakın (1:1000) | kare aralığı (GPU dahil) | 11646 | 24209 (24209–24209) | 26584 | 26584 |
| `hat-1m` | Kaydırma, genel (tümü) | üst katman | 0.27 | 0.50 (0.50–0.50) | 0.54 | 0.54 |
| `hat-1m` | Kaydırma, genel (tümü) | etiketler | 0.12 | 0.31 (0.31–0.31) | 0.39 | 0.39 |
| `hat-1m` | Kaydırma, genel (tümü) | GPU gönderimi | 0.32 | 1.20 (1.20–1.20) | 1.63 | 1.63 |
| `hat-1m` | Kaydırma, genel (tümü) | kare (CPU) | 0.65 | 1.78 (1.78–1.78) | 1.82 | 1.82 |
| `hat-1m` | Kaydırma, genel (tümü) | kare aralığı (GPU dahil) | 19852 | 53635 (53635–53635) | 53635 | 53635 |
| `hat-1m` | Buda önizlemesi, yakın (1:1000) | önizleme (imleç bir kenardayken) | – | – | – | – |
| `hat-1m` | Buda önizlemesi, yakın (1:1000) | kare (CPU), bütün kareler | 8.33 | 17.9 (17.9–17.9) | 17.9 | 17.9 |
| `hat-1m` | Seç, yakın (1:1000) (vurgu değişince tam çizim) | kare (CPU) | 1.00 | 12.3 (12.3–12.3) | 12.3 | 12.3 |
| `hat-1m` | Çizgi, yakın (1:1000) | kare (CPU) | 0.40 | 2.06 (2.06–2.06) | 4.58 | 12.5 |
| `hat-1m` | Büyük katmanı yeniden kurma (stil değişikliği) | kurma ve yükleme | 12420 | 13129 (13129–13129) | 13129 | 13129 |

## ADR 0005 taslağıyla karşılaştırma (yalnızca kayıt)

| Hedef (taslak) | Ölçülen (p95, koşuların ortancası) | Not |
|---|---|---|
| İmleç hareketinde seçme ve kenet: 100 bin nesnede olay başına < 2 ms | seçme 0.11 / 0.27 ms; kenet 0.12 / 3.15 ms (yakın / genel) | `parsel-50k`, 81 229 nesne |
| Kaydırma: 1 milyon segmentte kare ≤ 16 ms | kare (CPU) 4.62 / 1.78 ms; kare aralığı 24209 / 53635 ms (yakın / genel) | `hat-1m`; kare (CPU) yalnız ana iş parçacığıdır, kare aralığı bu makinenin GPU'suyla (başlıktaki) duvar saatidir |
| Bir katmanı yeniden kurma: 100 bin segmentte < 50 ms | 13129 ms | `hat-1m` büyük katmanı 1 milyon segmenttir; hedef 100 bin segment içindir |
| Bir katmanı yeniden kurma | 307 ms | `parsel-50k` `parsel` katmanı, 50 400 alan |

Karşılaştırma bir kabul kararı değildir: hedefler onaylanmadı; ölçüm başsız Chrome'da, ana iş parçacığında alındı.

## Uyarılar

- `parsel-50k` #1 `select-close`: 240 olaydan 91 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `parsel-50k` #1 `select-close`: 91 olayda 90 kare çizildi.
- `parsel-50k` #1 `trim-close`: 120 olaydan 63 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `parsel-50k` #1 `trim-close`: 63 olayda 62 kare çizildi.
- `parsel-50k` #1 `trim-close`: imleç hiçbir karede bir kenarda görünmedi (`tools.active.hover` okunamıyor olabilir); önizleme ölçütü yok.
- `parsel-50k` #1 `pan-close`: 80 olayda 74 kare çizildi.
- `parsel-50k` #1 `select-overview`: 240 olaydan 39 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `parsel-50k` #1 `select-overview`: 39 olayda 20 kare çizildi.
- `parsel-50k` #1 `pan-overview`: 80 olayda 42 kare çizildi.
- `hat-1m` #1 `select-close`: 240 olaydan 32 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `hat-1m` #1 `select-close`: 32 olayda 13 kare çizildi.
- `hat-1m` #1 `trim-close`: 40 olaydan 30 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `hat-1m` #1 `trim-close`: 30 olayda 9 kare çizildi.
- `hat-1m` #1 `trim-close`: imleç hiçbir karede bir kenarda görünmedi (`tools.active.hover` okunamıyor olabilir); önizleme ölçütü yok.
- `hat-1m` #1 `pan-close`: 80 olayda 27 kare çizildi.
- `hat-1m` #1 `select-overview`: 240 olaydan 27 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `hat-1m` #1 `select-overview`: 27 olayda 6 kare çizildi.
- `hat-1m` #1 `pan-overview`: 80 olayda 20 kare çizildi.

## Gürültü

- p95'i 0.5 ms'den büyük 81 ölçütte koşular arası yayılım (en yüksek − en düşük p95, ortancaya oranla): ortanca %0, en çok %0 (`parsel-50k/select-close/move.total`).
- Tek tek olaylar çöp toplamayla sıçrayabilir: p99 ve “en çok” bu yüzden p95'ten gürültülüdür. Her dizi öncesinde çöp toplama zorlanır.
- Karşılaştırmada iki ölçümün farkı p95 aralıklarının dışına çıkmıyorsa gürültü sayılmalıdır.

## Yöntem

- Veri setleri sayfada, tohumlu üreteçle kurulur ve `kentos.doc.replaceWith` ile açılır (geçmişsiz). Üreteçler ve tohumlar `scripts/perf/datasets.mjs`'tedir; parametreler JSON raporundadır.
- İmleç olayları gerçek `Input.dispatchMouseEvent` hareketleridir. Chrome bir hareketi karesi çizilince yanıtlar; sonraki hareket ancak o zaman gider, böylece olaylar birleşmez ve her olay kendi karesini çizer (her dizide sayılır). Yol, çizim alanının araç kutusu ve komut şeridi dışında kalan kısmında, veri setinin ekrandaki kutusunun içindedir (genel görünümde veri seti tuvali doldurmaz).
- Chrome makinenin GPU'sunda çizer (varsayılan bayraklar); kareler Chrome'un kendi 60 Hz hızındadır. SwiftShader (yazılım GPU) ile bu veri setlerinde tek kare saniyeler sürüyor, kareler birikip sayfayı sonradan dakikaya varan sürelerle durduruyordu; ana iş parçacığı süreleri iki durumda da aynıydı.
- Nesne izleme ve bilgi kartı kapalıdır: ikisi de beklemeye (350 ve 500 ms) bağlıdır ve hızlı bir çekirdeğin farklı iş yapmasına yol açardı. Kenet türleri, açıklıklar ve ızgara varsayılandır.
- Google yazı tipleri engellenir (her koşuda aynı yerel yazı tipi, ağ yok). Sunucu bağlantısı yoktur ("Sunucu: yok").
- Başlangıç süreleri bu betikte değil, `scripts/perf/startup.mjs` raporlarındadır.

## Karşılaştırma: s1-before (2026-09-24, d8a7beb) → s1-after

p95 koşuların ortancasıdır. “Gerileme”: yeni p95, eski ölçümün en yüksek koşusundan %10'dan ve 0.1 ms'den fazla yüksek; “iyileşme”: en düşük koşusundan aynı paylarla düşük. Ölçüm koşulları (makine, Chrome, GPU) aynı değilse karşılaştırma geçersizdir.

Önce: Intel(R) Xeon(R) Processor @ 2.10GHz, Chromium 141.0.7390.37, ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver). Şimdi: Intel(R) Xeon(R) Processor @ 2.10GHz, Chromium 141.0.7390.37, ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver).

| Ölçüt | önce p95 | şimdi p95 | oran | sonuç |
|---|---|---|---|---|
| `hat-1m/line-close/frame.cpu` | 1.57 | 2.06 | 1.32 | gerileme |
| `hat-1m/line-close/frame.overlay` | 1.57 | 2.06 | 1.32 | gerileme |
| `hat-1m/line-overview/move.tool` | 0.09 | 3.18 | 37.41 | gerileme |
| `hat-1m/pan-close/frame.cpu` | 1.37 | 4.62 | 3.37 | gerileme |
| `hat-1m/pan-close/frame.interval` | 10768 | 24209 | 2.25 | gerileme |
| `hat-1m/pan-close/frame.render` | 0.78 | 4.18 | 5.36 | gerileme |
| `hat-1m/pan-overview/frame.interval` | 22884 | 53635 | 2.34 | gerileme |
| `hat-1m/rebuild/frame.build` | 11289 | 13129 | 1.16 | gerileme |
| `hat-1m/rebuild/frame.cpu` | 11293 | 13132 | 1.16 | gerileme |
| `hat-1m/select-close/frame.build` | 0.51 | 1.13 | 2.23 | gerileme |
| `hat-1m/select-close/frame.cpu` | 1.36 | 12.3 | 9.03 | gerileme |
| `hat-1m/select-close/frame.labels` | 0.84 | 7.63 | 9.04 | gerileme |
| `hat-1m/select-close/frame.overlay` | 0.96 | 7.76 | 8.12 | gerileme |
| `hat-1m/select-close/frame.render` | 0.51 | 4.09 | 8.02 | gerileme |
| `hat-1m/select-overview/frame.build` | 0.81 | 11.8 | 14.60 | gerileme |
| `hat-1m/select-overview/frame.cpu` | 1.40 | 12.3 | 8.78 | gerileme |
| `hat-1m/select-overview/frame.labels` | 0.41 | 8.45 | 20.60 | gerileme |
| `hat-1m/select-overview/frame.overlay` | 0.59 | 8.66 | 14.80 | gerileme |
| `hat-1m/select-overview/frame.render` | 0.40 | 3.59 | 8.86 | gerileme |
| `hat-1m/trim-close/frame.render` | 0.32 | 0.57 | 1.80 | gerileme |
| `parsel-50k/pan-close/frame.interval` | 4063 | 8292 | 2.04 | gerileme |
| `parsel-50k/pan-close/frame.render` | 0.76 | 1.81 | 2.39 | gerileme |
| `parsel-50k/pan-overview/frame.interval` | 6348 | 12948 | 2.04 | gerileme |
| `parsel-50k/rebuild/frame.build` | 219 | 307 | 1.41 | gerileme |
| `parsel-50k/rebuild/frame.cpu` | 248 | 310 | 1.25 | gerileme |
| `parsel-50k/rebuild/frame.render` | 0.28 | 1.48 | 5.29 | gerileme |
| `parsel-50k/select-close/frame.build` | 0.24 | 0.45 | 1.88 | gerileme |
| `parsel-50k/select-close/frame.render` | 0.24 | 0.74 | 3.06 | gerileme |
| `parsel-50k/trim-close/frame.render` | 0.28 | 0.51 | 1.82 | gerileme |
| `hat-1m/line-close/frame.labels` | 0.68 | 0.38 | 0.55 | iyileşme |
| `hat-1m/line-close/move.snap` | 7.64 | 1.40 | 0.18 | iyileşme |
| `hat-1m/line-close/move.tool` | 1.09 | 0.07 | 0.06 | iyileşme |
| `hat-1m/line-close/move.total` | 8.25 | 1.72 | 0.21 | iyileşme |
| `hat-1m/line-overview/frame.labels` | 0.51 | 0.18 | 0.34 | iyileşme |
| `hat-1m/line-overview/move.snap` | 46.8 | 31.9 | 0.68 | iyileşme |
| `hat-1m/line-overview/move.total` | 46.9 | 32.4 | 0.69 | iyileşme |
| `hat-1m/pan-close/frame.labels` | 0.58 | 0.47 | 0.82 | iyileşme |
| `hat-1m/pan-overview/frame.cpu` | 2.58 | 1.78 | 0.69 | iyileşme |
| `hat-1m/pan-overview/frame.labels` | 0.73 | 0.31 | 0.43 | iyileşme |
| `hat-1m/pan-overview/frame.overlay` | 0.88 | 0.50 | 0.57 | iyileşme |
| `hat-1m/pan-overview/frame.render` | 1.91 | 1.20 | 0.63 | iyileşme |
| `hat-1m/rebuild/frame.labels` | 3.78 | 2.53 | 0.67 | iyileşme |
| `hat-1m/rebuild/frame.overlay` | 3.92 | 2.77 | 0.70 | iyileşme |
| `hat-1m/rebuild/frame.render` | 14.3 | 3.13 | 0.22 | iyileşme |
| `hat-1m/select-close/move.tool` | 3.40 | 0.66 | 0.19 | iyileşme |
| `hat-1m/select-close/move.total` | 3.50 | 0.97 | 0.28 | iyileşme |
| `hat-1m/select-overview/move.tool` | 8.21 | 1.60 | 0.20 | iyileşme |
| `hat-1m/select-overview/move.total` | 8.31 | 1.70 | 0.20 | iyileşme |
| `hat-1m/trim-close/frame.cpu` | 972 | 17.9 | 0.02 | iyileşme |
| `hat-1m/trim-close/frame.overlay` | 971 | 17.2 | 0.02 | iyileşme |
| `hat-1m/trim-close/frame.tool` | 970 | 16.7 | 0.02 | iyileşme |
| `hat-1m/trim-close/move.tool` | 4.10 | 1.07 | 0.26 | iyileşme |
| `hat-1m/trim-close/move.total` | 4.21 | 1.18 | 0.28 | iyileşme |
| `parsel-50k/line-close/frame.cpu` | 12.5 | 2.20 | 0.18 | iyileşme |
| `parsel-50k/line-close/frame.labels` | 12.2 | 1.07 | 0.09 | iyileşme |
| `parsel-50k/line-close/frame.overlay` | 12.5 | 2.20 | 0.18 | iyileşme |
| `parsel-50k/line-close/move.snap` | 19.0 | 0.12 | 0.01 | iyileşme |
| `parsel-50k/line-close/move.total` | 19.2 | 0.65 | 0.03 | iyileşme |
| `parsel-50k/line-overview/frame.cpu` | 17.3 | 9.61 | 0.56 | iyileşme |
| `parsel-50k/line-overview/frame.labels` | 17.0 | 9.31 | 0.55 | iyileşme |
| `parsel-50k/line-overview/frame.overlay` | 17.3 | 9.61 | 0.56 | iyileşme |
| `parsel-50k/line-overview/move.snap` | 22.6 | 3.15 | 0.14 | iyileşme |
| `parsel-50k/line-overview/move.total` | 22.8 | 3.66 | 0.16 | iyileşme |
| `parsel-50k/pan-close/frame.cpu` | 20.2 | 2.69 | 0.13 | iyileşme |
| `parsel-50k/pan-close/frame.labels` | 19.2 | 0.71 | 0.04 | iyileşme |
| `parsel-50k/pan-close/frame.overlay` | 19.5 | 0.88 | 0.04 | iyileşme |
| `parsel-50k/pan-overview/frame.cpu` | 21.9 | 10.6 | 0.48 | iyileşme |
| `parsel-50k/pan-overview/frame.labels` | 21.2 | 10.0 | 0.47 | iyileşme |
| `parsel-50k/pan-overview/frame.overlay` | 21.4 | 10.2 | 0.47 | iyileşme |
| `parsel-50k/pan-overview/frame.render` | 0.90 | 0.62 | 0.69 | iyileşme |
| `parsel-50k/rebuild/frame.labels` | 28.8 | 3.74 | 0.13 | iyileşme |
| `parsel-50k/rebuild/frame.overlay` | 29.0 | 3.96 | 0.14 | iyileşme |
| `parsel-50k/select-close/frame.cpu` | 18.5 | 4.24 | 0.23 | iyileşme |
| `parsel-50k/select-close/frame.labels` | 18.1 | 1.88 | 0.10 | iyileşme |
| `parsel-50k/select-close/frame.overlay` | 18.3 | 2.03 | 0.11 | iyileşme |
| `parsel-50k/select-close/move.tool` | 18.4 | 0.11 | 0.01 | iyileşme |
| `parsel-50k/select-close/move.total` | 19.4 | 0.52 | 0.03 | iyileşme |
| `parsel-50k/select-overview/frame.cpu` | 19.2 | 8.55 | 0.44 | iyileşme |
| `parsel-50k/select-overview/frame.labels` | 16.5 | 7.98 | 0.48 | iyileşme |
| `parsel-50k/select-overview/frame.overlay` | 18.7 | 8.16 | 0.44 | iyileşme |
| `parsel-50k/select-overview/frame.render` | 0.67 | 0.27 | 0.40 | iyileşme |
| `parsel-50k/select-overview/move.tool` | 20.6 | 0.27 | 0.01 | iyileşme |
| `parsel-50k/select-overview/move.total` | 20.7 | 0.63 | 0.03 | iyileşme |
| `parsel-50k/trim-close/frame.cpu` | 31.6 | 2.59 | 0.08 | iyileşme |
| `parsel-50k/trim-close/frame.labels` | 14.8 | 0.72 | 0.05 | iyileşme |
| `parsel-50k/trim-close/frame.overlay` | 31.1 | 2.10 | 0.07 | iyileşme |
| `parsel-50k/trim-close/frame.tool` | 17.0 | 0.32 | 0.02 | iyileşme |
| `parsel-50k/trim-close/move.tool` | 19.3 | 0.18 | 0.01 | iyileşme |
| `parsel-50k/trim-close/move.total` | 19.3 | 0.32 | 0.02 | iyileşme |
| `hat-1m/line-close/frame.tool` | 0.17 | 0.23 | 1.35 | fark yok |
| `hat-1m/line-overview/frame.cpu` | 0.85 | 0.78 | 0.91 | fark yok |
| `hat-1m/line-overview/frame.overlay` | 0.85 | 0.78 | 0.91 | fark yok |
| `hat-1m/line-overview/frame.tool` | 0.19 | 0.20 | 1.03 | fark yok |
| `hat-1m/pan-close/frame.build` | 0.05 | 0.08 | 1.55 | fark yok |
| `hat-1m/pan-close/frame.overlay` | 0.71 | 0.65 | 0.91 | fark yok |
| `hat-1m/pan-close/frame.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `hat-1m/pan-close/move.snap` | 0.02 | 0.03 | 1.25 | fark yok |
| `hat-1m/pan-close/move.tool` | 0.00 | 0.00 | 0.00 | fark yok |
| `hat-1m/pan-close/move.total` | 0.20 | 0.18 | 0.92 | fark yok |
| `hat-1m/pan-overview/frame.build` | 0.04 | 0.04 | 1.12 | fark yok |
| `hat-1m/pan-overview/frame.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `hat-1m/pan-overview/move.snap` | 0.02 | 0.02 | 1.00 | fark yok |
| `hat-1m/pan-overview/move.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `hat-1m/pan-overview/move.total` | 0.17 | 0.16 | 0.89 | fark yok |
| `hat-1m/rebuild/frame.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `hat-1m/select-close/frame.tool` | 0.01 | 0.02 | 1.50 | fark yok |
| `hat-1m/select-close/move.snap` | 0.04 | 0.06 | 1.50 | fark yok |
| `hat-1m/select-overview/frame.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `hat-1m/select-overview/move.snap` | 0.12 | 0.03 | 0.22 | fark yok |
| `hat-1m/trim-close/frame.build` | 0.58 | 0.58 | 1.00 | fark yok |
| `hat-1m/trim-close/frame.labels` | 0.52 | 0.55 | 1.06 | fark yok |
| `hat-1m/trim-close/move.snap` | 0.03 | 0.03 | 1.00 | fark yok |
| `parsel-50k/line-close/frame.tool` | 0.19 | 0.16 | 0.84 | fark yok |
| `parsel-50k/line-close/move.tool` | 0.09 | 0.05 | 0.58 | fark yok |
| `parsel-50k/line-overview/frame.tool` | 0.21 | 0.21 | 1.00 | fark yok |
| `parsel-50k/line-overview/move.tool` | 0.08 | 0.09 | 1.19 | fark yok |
| `parsel-50k/pan-close/frame.build` | 0.04 | 0.04 | 1.12 | fark yok |
| `parsel-50k/pan-close/frame.tool` | 0.01 | 0.01 | 0.50 | fark yok |
| `parsel-50k/pan-close/move.snap` | 0.02 | 0.04 | 1.60 | fark yok |
| `parsel-50k/pan-close/move.tool` | 0.00 | 0.00 | 1.00 | fark yok |
| `parsel-50k/pan-close/move.total` | 0.23 | 0.23 | 1.02 | fark yok |
| `parsel-50k/pan-overview/frame.build` | 0.05 | 0.04 | 0.90 | fark yok |
| `parsel-50k/pan-overview/frame.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `parsel-50k/pan-overview/move.snap` | 0.03 | 0.03 | 1.20 | fark yok |
| `parsel-50k/pan-overview/move.tool` | 0.00 | 0.01 | 1.00 | fark yok |
| `parsel-50k/pan-overview/move.total` | 0.17 | 0.15 | 0.89 | fark yok |
| `parsel-50k/rebuild/frame.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `parsel-50k/select-close/frame.tool` | 0.01 | 0.01 | 0.50 | fark yok |
| `parsel-50k/select-close/move.snap` | 0.02 | 0.03 | 1.20 | fark yok |
| `parsel-50k/select-overview/frame.build` | 0.31 | 0.33 | 1.03 | fark yok |
| `parsel-50k/select-overview/frame.tool` | 0.01 | 0.01 | 1.00 | fark yok |
| `parsel-50k/select-overview/move.snap` | 0.04 | 0.03 | 0.86 | fark yok |
| `parsel-50k/trim-close/frame.build` | 0.19 | 0.20 | 1.05 | fark yok |
| `parsel-50k/trim-close/move.snap` | 0.04 | 0.04 | 1.00 | fark yok |

**29 ölçütte gerileme var.**
