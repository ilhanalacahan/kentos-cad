# Etkileşim ölçümü: s1-before (2026-09-24, d8a7beb)

Intel(R) Xeon(R) Processor @ 2.10GHz, 4 iş parçacığı, 16 GB; Chromium 141.0.7390.37; başsız, WebGL2 (ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)); Vite geliştirme sunucusu (`window.kentos`). Pencere 1600×900, çizim alanı 1288×759 CSS px, dpr 1. 1 koşu; her koşu sayfayı yeniden açar ve veri setini yeniden kurar. Toplam 46 dk, Chrome en çok 877 MB (PSS).

Süreler ana iş parçacığında ms'dir (`ViewportProbe`, src/viewport/ViewportController.ts; yalnız geliştirme derlemesinde). Her hücre 1 koşunun ortancasıdır; p95'in yanında koşular arasındaki en düşük–en yüksek p95 yazar. Zamanlayıcı adımı 5 µs (cross-origin isolated). Hedefler [ADR 0005](../adr/0005-performance-acceptance-targets.md)'tedir; ADR **taslaktır ve kullanıcı onayı bekler**, bu rapor yalnızca kayıttır.

## Veri setleri

| Ad | İçerik | Nesne | Ham kenar | Üretme | `replaceWith` | İlk kare (bütün katmanlar) | JS yığını | Chrome (yüklemeden sonra) |
|---|---|---|---|---|---|---|---|---|
| `parsel-50k` | ~50 000 parsel (bir kısmı yaylı, bir kısmı delikli) ve içlerinde yapılar, TM36 | 81 229 | 334 336 | 187 ms | 57.9 ms | 256 ms | 115 MB | 714 MB |
| `hat-1m` | 1 000 000 doğru parçası: 2 000 eşyükselti benzeri çoklu çizgi × 500 parça, TM36 | 2 000 | 1 000 000 | 157 ms | 16.2 ms | 268 ms | 178 MB | 877 MB |

- `parsel-50k`: 50 400 parsel (6 146 yaylı cephe, 2 355 delikli), 30 829 yapı; büyük katman `parsel`. Yakın görünüm 1:1 000, 193 nesne görünür; genel görünüm 1:35 166, 81 229 nesne. Tohum 5256.
- `hat-1m`: 2 000 çoklu çizgi, hepsi tek katmanda; büyük katman `esyukselti`. Yakın görünüm 1:1 000, 71 nesne görünür; genel görünüm 1:57 877, 2 000 nesne. Tohum 1000.

## İmleç hareketi (olay başına)

Aynı tohumlu 240 hareketlik yol (buda: ilk 120 (`parsel-50k`), 40 (`hat-1m`)); her hareket kendi karesini çizer. “Seçme” ve “kenar seçme” aracın hareket işleyicisi, “kenet” nesne kenetidir; “olayın tamamı” `pointermove` işleyicisinin bütünüdür (durum çubuğu koordinatları dahil).

| Veri seti | Araç | Görünüm | Ölçüt | p50 | p95 (aralık) | p99 | en çok |
|---|---|---|---|---|---|---|---|
| `parsel-50k` | Seç (üzerine gelme) | yakın (1:1000) | seçme | 12.8 | 18.4 (18.4–18.4) | 21.5 | 21.5 |
| `parsel-50k` | Seç (üzerine gelme) | yakın (1:1000) | olayın tamamı | 12.8 | 19.4 (19.4–19.4) | 21.6 | 21.6 |
| `parsel-50k` | Seç (üzerine gelme) | genel (tümü) | seçme | 12.0 | 20.6 (20.6–20.6) | 23.8 | 23.8 |
| `parsel-50k` | Seç (üzerine gelme) | genel (tümü) | olayın tamamı | 12.1 | 20.7 (20.7–20.7) | 23.9 | 23.9 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | yakın (1:1000) | kenet | 12.5 | 19.0 (19.0–19.0) | 22.1 | 24.1 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | yakın (1:1000) | olayın tamamı | 12.7 | 19.2 (19.2–19.2) | 22.3 | 29.5 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | genel (tümü) | kenet | 15.0 | 22.6 (22.6–22.6) | 28.1 | 42.6 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | genel (tümü) | olayın tamamı | 15.1 | 22.8 (22.8–22.8) | 28.2 | 42.9 |
| `parsel-50k` | Buda | yakın (1:1000) | kenar seçme | 13.8 | 19.3 (19.3–19.3) | 20.5 | 20.5 |
| `parsel-50k` | Buda | yakın (1:1000) | olayın tamamı | 14.7 | 19.3 (19.3–19.3) | 20.6 | 20.6 |
| `hat-1m` | Seç (üzerine gelme) | yakın (1:1000) | seçme | 1.99 | 3.40 (3.40–3.40) | 4.65 | 4.65 |
| `hat-1m` | Seç (üzerine gelme) | yakın (1:1000) | olayın tamamı | 2.10 | 3.50 (3.50–3.50) | 4.90 | 4.90 |
| `hat-1m` | Seç (üzerine gelme) | genel (tümü) | seçme | 3.72 | 8.21 (8.21–8.21) | 8.29 | 8.29 |
| `hat-1m` | Seç (üzerine gelme) | genel (tümü) | olayın tamamı | 3.82 | 8.31 (8.31–8.31) | 8.38 | 8.38 |
| `hat-1m` | Çizgi, ilk noktadan sonra | yakın (1:1000) | kenet | 3.32 | 7.64 (7.64–7.64) | 9.44 | 9.96 |
| `hat-1m` | Çizgi, ilk noktadan sonra | yakın (1:1000) | olayın tamamı | 3.47 | 8.25 (8.25–8.25) | 10.1 | 10.1 |
| `hat-1m` | Çizgi, ilk noktadan sonra | genel (tümü) | kenet | 33.8 | 46.8 (46.8–46.8) | 60.3 | 80.4 |
| `hat-1m` | Çizgi, ilk noktadan sonra | genel (tümü) | olayın tamamı | 33.9 | 46.9 (46.9–46.9) | 60.5 | 80.6 |
| `hat-1m` | Buda | yakın (1:1000) | kenar seçme | 2.02 | 4.10 (4.10–4.10) | 11.1 | 11.1 |
| `hat-1m` | Buda | yakın (1:1000) | olayın tamamı | 2.11 | 4.21 (4.21–4.21) | 11.2 | 11.2 |

## Kareler

Kaydırma orta tuşla 80 adımdır (gidip gelir); “GPU gönderimi” çizim çağrılarının ana iş parçacığındaki süresidir, GPU'nun kendi çizimi dahil değildir. “Kare aralığı” bir karenin başından sonrakinin başına geçen duvar saatidir: GPU'nun işi ve 60 Hz ekran temposu dahil, ulaşılan kare hızını gösterir (16.7 ms = 60 fps; tempo yüzünden 16.7'nin katlarına yakın çıkar). Yeniden kurma koşu başına 6 stil değişikliğidir.

| Veri seti | Senaryo | Ölçüt | p50 | p95 (aralık) | p99 | en çok |
|---|---|---|---|---|---|---|
| `parsel-50k` | Kaydırma, yakın (1:1000) | üst katman | 14.1 | 19.5 (19.5–19.5) | 20.8 | 20.8 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | etiketler | 13.9 | 19.2 (19.2–19.2) | 20.7 | 20.7 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | GPU gönderimi | 0.33 | 0.76 (0.76–0.76) | 1.97 | 1.97 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | kare (CPU) | 14.5 | 20.2 (20.2–20.2) | 21.3 | 21.3 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | kare aralığı (GPU dahil) | 3970 | 4063 (4063–4063) | 4140 | 4140 |
| `parsel-50k` | Kaydırma, genel (tümü) | üst katman | 16.2 | 21.4 (21.4–21.4) | 23.3 | 23.3 |
| `parsel-50k` | Kaydırma, genel (tümü) | etiketler | 16.0 | 21.2 (21.2–21.2) | 21.7 | 21.7 |
| `parsel-50k` | Kaydırma, genel (tümü) | GPU gönderimi | 0.36 | 0.90 (0.90–0.90) | 1.31 | 1.31 |
| `parsel-50k` | Kaydırma, genel (tümü) | kare (CPU) | 16.5 | 21.9 (21.9–21.9) | 24.0 | 24.0 |
| `parsel-50k` | Kaydırma, genel (tümü) | kare aralığı (GPU dahil) | 6100 | 6348 (6348–6348) | 12488 | 12488 |
| `parsel-50k` | Buda önizlemesi, yakın (1:1000) | önizleme (imleç bir kenardayken) | 11.8 | 20.1 (20.1–20.1) | 26.1 | 26.1 |
| `parsel-50k` | Buda önizlemesi, yakın (1:1000) | kare (CPU), bütün kareler | 10.5 | 31.6 (31.6–31.6) | 35.0 | 35.0 |
| `parsel-50k` | Seç, yakın (1:1000) (vurgu değişince tam çizim) | kare (CPU) | 9.58 | 18.5 (18.5–18.5) | 23.0 | 23.0 |
| `parsel-50k` | Çizgi, yakın (1:1000) | kare (CPU) | 9.11 | 12.5 (12.5–12.5) | 14.5 | 20.2 |
| `parsel-50k` | Büyük katmanı yeniden kurma (stil değişikliği) | kurma ve yükleme | 186 | 219 (219–219) | 219 | 219 |
| `hat-1m` | Kaydırma, yakın (1:1000) | üst katman | 0.52 | 0.71 (0.71–0.71) | 0.71 | 0.71 |
| `hat-1m` | Kaydırma, yakın (1:1000) | etiketler | 0.43 | 0.58 (0.58–0.58) | 0.59 | 0.59 |
| `hat-1m` | Kaydırma, yakın (1:1000) | GPU gönderimi | 0.38 | 0.78 (0.78–0.78) | 0.79 | 0.79 |
| `hat-1m` | Kaydırma, yakın (1:1000) | kare (CPU) | 0.93 | 1.37 (1.37–1.37) | 1.41 | 1.41 |
| `hat-1m` | Kaydırma, yakın (1:1000) | kare aralığı (GPU dahil) | 10520 | 10768 (10768–10768) | 10778 | 10778 |
| `hat-1m` | Kaydırma, genel (tümü) | üst katman | 0.54 | 0.88 (0.88–0.88) | 1.04 | 1.04 |
| `hat-1m` | Kaydırma, genel (tümü) | etiketler | 0.39 | 0.73 (0.73–0.73) | 0.88 | 0.88 |
| `hat-1m` | Kaydırma, genel (tümü) | GPU gönderimi | 0.34 | 1.91 (1.91–1.91) | 2.50 | 2.50 |
| `hat-1m` | Kaydırma, genel (tümü) | kare (CPU) | 0.91 | 2.58 (2.58–2.58) | 3.30 | 3.30 |
| `hat-1m` | Kaydırma, genel (tümü) | kare aralığı (GPU dahil) | 16620 | 22884 (22884–22884) | 25402 | 25402 |
| `hat-1m` | Buda önizlemesi, yakın (1:1000) | önizleme (imleç bir kenardayken) | – | – | – | – |
| `hat-1m` | Buda önizlemesi, yakın (1:1000) | kare (CPU), bütün kareler | 0.88 | 972 (972–972) | 972 | 972 |
| `hat-1m` | Seç, yakın (1:1000) (vurgu değişince tam çizim) | kare (CPU) | 1.09 | 1.36 (1.36–1.36) | 1.36 | 1.36 |
| `hat-1m` | Çizgi, yakın (1:1000) | kare (CPU) | 0.59 | 1.57 (1.57–1.57) | 4.11 | 8.00 |
| `hat-1m` | Büyük katmanı yeniden kurma (stil değişikliği) | kurma ve yükleme | 10373 | 11289 (11289–11289) | 11289 | 11289 |

## ADR 0005 taslağıyla karşılaştırma (yalnızca kayıt)

| Hedef (taslak) | Ölçülen (p95, koşuların ortancası) | Not |
|---|---|---|
| İmleç hareketinde seçme ve kenet: 100 bin nesnede olay başına < 2 ms | seçme 18.4 / 20.6 ms; kenet 19.0 / 22.6 ms (yakın / genel) | `parsel-50k`, 81 229 nesne |
| Kaydırma: 1 milyon segmentte kare ≤ 16 ms | kare (CPU) 1.37 / 2.58 ms; kare aralığı 10768 / 22884 ms (yakın / genel) | `hat-1m`; kare (CPU) yalnız ana iş parçacığıdır, kare aralığı bu makinenin GPU'suyla (başlıktaki) duvar saatidir |
| Bir katmanı yeniden kurma: 100 bin segmentte < 50 ms | 11289 ms | `hat-1m` büyük katmanı 1 milyon segmenttir; hedef 100 bin segment içindir |
| Bir katmanı yeniden kurma | 219 ms | `parsel-50k` `parsel` katmanı, 50 400 alan |

Karşılaştırma bir kabul kararı değildir: hedefler onaylanmadı; ölçüm başsız Chrome'da, ana iş parçacığında alındı.

## Uyarılar

- `parsel-50k` #1 `select-close`: 240 olaydan 96 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `parsel-50k` #1 `trim-close`: 120 olaydan 67 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `parsel-50k` #1 `select-overview`: 240 olaydan 39 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `parsel-50k` #1 `select-overview`: 39 olayda 20 kare çizildi.
- `parsel-50k` #1 `pan-overview`: 80 olayda 42 kare çizildi.
- `hat-1m` #1 `select-close`: 240 olaydan 37 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `hat-1m` #1 `select-close`: 37 olayda 14 kare çizildi.
- `hat-1m` #1 `trim-close`: 40 olaydan 34 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `hat-1m` #1 `trim-close`: 34 olayda 16 kare çizildi.
- `hat-1m` #1 `trim-close`: imleç hiçbir karede bir kenarda görünmedi (`tools.active.hover` okunamıyor olabilir); önizleme ölçütü yok.
- `hat-1m` #1 `pan-close`: 80 olayda 28 kare çizildi.
- `hat-1m` #1 `select-overview`: 240 olaydan 31 tanesi ölçüldü (dizi 120 s sınırına takıldı).
- `hat-1m` #1 `select-overview`: 31 olayda 9 kare çizildi.
- `hat-1m` #1 `pan-overview`: 80 olayda 22 kare çizildi.

## Gürültü

- p95'i 0.5 ms'den büyük 87 ölçütte koşular arası yayılım (en yüksek − en düşük p95, ortancaya oranla): ortanca %0, en çok %0 (`parsel-50k/select-close/move.total`).
- Tek tek olaylar çöp toplamayla sıçrayabilir: p99 ve “en çok” bu yüzden p95'ten gürültülüdür. Her dizi öncesinde çöp toplama zorlanır.
- Karşılaştırmada iki ölçümün farkı p95 aralıklarının dışına çıkmıyorsa gürültü sayılmalıdır.

## Yöntem

- Veri setleri sayfada, tohumlu üreteçle kurulur ve `kentos.doc.replaceWith` ile açılır (geçmişsiz). Üreteçler ve tohumlar `scripts/perf/datasets.mjs`'tedir; parametreler JSON raporundadır.
- İmleç olayları gerçek `Input.dispatchMouseEvent` hareketleridir. Chrome bir hareketi karesi çizilince yanıtlar; sonraki hareket ancak o zaman gider, böylece olaylar birleşmez ve her olay kendi karesini çizer (her dizide sayılır). Yol, çizim alanının araç kutusu ve komut şeridi dışında kalan kısmında, veri setinin ekrandaki kutusunun içindedir (genel görünümde veri seti tuvali doldurmaz).
- Chrome makinenin GPU'sunda çizer (varsayılan bayraklar); kareler Chrome'un kendi 60 Hz hızındadır. SwiftShader (yazılım GPU) ile bu veri setlerinde tek kare saniyeler sürüyor, kareler birikip sayfayı sonradan dakikaya varan sürelerle durduruyordu; ana iş parçacığı süreleri iki durumda da aynıydı.
- Nesne izleme ve bilgi kartı kapalıdır: ikisi de beklemeye (350 ve 500 ms) bağlıdır ve hızlı bir çekirdeğin farklı iş yapmasına yol açardı. Kenet türleri, açıklıklar ve ızgara varsayılandır.
- Google yazı tipleri engellenir (her koşuda aynı yerel yazı tipi, ağ yok). Sunucu bağlantısı yoktur ("Sunucu: yok").
- Başlangıç süreleri bu betikte değil, `scripts/perf/startup.mjs` raporlarındadır.
