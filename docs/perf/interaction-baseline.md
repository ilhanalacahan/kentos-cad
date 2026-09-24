# Etkileşim ölçümü: baseline (2026-09-24, c110b15)

11th Gen Intel(R) Core(TM) i5-11300H @ 3.10GHz, 8 iş parçacığı, 15 GB; Google Chrome 153.0.8010.36; başsız, WebGL2 (ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (TGL GT2), OpenGL ES 3.2)); Vite geliştirme sunucusu (`window.kentos`). Pencere 1600×900, çizim alanı 1288×759 CSS px, dpr 1. 3 koşu; her koşu sayfayı yeniden açar ve veri setini yeniden kurar. Toplam 5 dk, Chrome en çok 959 MB (PSS).

Süreler ana iş parçacığında ms'dir (`ViewportProbe`, src/viewport/ViewportController.ts; yalnız geliştirme derlemesinde). Her hücre 3 koşunun ortancasıdır; p95'in yanında koşular arasındaki en düşük–en yüksek p95 yazar. Zamanlayıcı adımı 5 µs (cross-origin isolated). Hedefler [ADR 0005](../adr/0005-performance-acceptance-targets.md)'tedir; ADR **taslaktır ve kullanıcı onayı bekler**, bu rapor yalnızca kayıttır.

## Veri setleri

| Ad | İçerik | Nesne | Ham kenar | Üretme | `replaceWith` | İlk kare (bütün katmanlar) | JS yığını | Chrome (yüklemeden sonra) |
|---|---|---|---|---|---|---|---|---|
| `parsel-50k` | ~50 000 parsel (bir kısmı yaylı, bir kısmı delikli) ve içlerinde yapılar, TM36 | 81 229 | 334 336 | 109 ms | 24.2 ms | 190 ms | 47 MB | 714 MB |
| `hat-1m` | 1 000 000 doğru parçası: 2 000 eşyükselti benzeri çoklu çizgi × 500 parça, TM36 | 2 000 | 1 000 000 | 118 ms | 8.94 ms | 122 ms | 215 MB | 809 MB |

- `parsel-50k`: 50 400 parsel (6 146 yaylı cephe, 2 355 delikli), 30 829 yapı; büyük katman `parsel`. Yakın görünüm 1:1 000, 193 nesne görünür; genel görünüm 1:35 166, 81 229 nesne. Tohum 5256.
- `hat-1m`: 2 000 çoklu çizgi, hepsi tek katmanda; büyük katman `esyukselti`. Yakın görünüm 1:1 000, 71 nesne görünür; genel görünüm 1:57 877, 2 000 nesne. Tohum 1000.

## İmleç hareketi (olay başına)

Aynı tohumlu 240 hareketlik yol (buda: ilk 120 (`parsel-50k`), 40 (`hat-1m`)); her hareket kendi karesini çizer. “Seçme” ve “kenar seçme” aracın hareket işleyicisi, “kenet” nesne kenetidir; “olayın tamamı” `pointermove` işleyicisinin bütünüdür (durum çubuğu koordinatları dahil).

| Veri seti | Araç | Görünüm | Ölçüt | p50 | p95 (aralık) | p99 | en çok |
|---|---|---|---|---|---|---|---|
| `parsel-50k` | Seç (üzerine gelme) | yakın (1:1000) | seçme | 8.01 | 9.21 (9.13–9.66) | 10.1 | 18.9 |
| `parsel-50k` | Seç (üzerine gelme) | yakın (1:1000) | olayın tamamı | 8.07 | 9.31 (9.22–9.79) | 10.3 | 19.0 |
| `parsel-50k` | Seç (üzerine gelme) | genel (tümü) | seçme | 8.50 | 9.87 (9.60–10.2) | 11.3 | 26.4 |
| `parsel-50k` | Seç (üzerine gelme) | genel (tümü) | olayın tamamı | 8.59 | 9.91 (9.64–10.3) | 11.4 | 26.5 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | yakın (1:1000) | kenet | 8.10 | 9.19 (9.04–9.67) | 11.0 | 25.9 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | yakın (1:1000) | olayın tamamı | 8.18 | 9.28 (9.12–9.75) | 11.1 | 26.3 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | genel (tümü) | kenet | 11.0 | 12.6 (12.3–12.7) | 16.9 | 25.1 |
| `parsel-50k` | Çizgi, ilk noktadan sonra | genel (tümü) | olayın tamamı | 11.0 | 12.7 (12.4–12.8) | 17.0 | 25.2 |
| `parsel-50k` | Buda | yakın (1:1000) | kenar seçme | 7.91 | 13.3 (10.6–14.1) | 14.9 | 18.2 |
| `parsel-50k` | Buda | yakın (1:1000) | olayın tamamı | 7.99 | 13.4 (10.7–14.2) | 15.0 | 18.3 |
| `hat-1m` | Seç (üzerine gelme) | yakın (1:1000) | seçme | 2.85 | 3.66 (3.43–3.67) | 3.98 | 30.3 |
| `hat-1m` | Seç (üzerine gelme) | yakın (1:1000) | olayın tamamı | 2.96 | 3.78 (3.53–3.80) | 4.11 | 30.5 |
| `hat-1m` | Seç (üzerine gelme) | genel (tümü) | seçme | 6.00 | 7.15 (7.07–7.17) | 8.80 | 18.6 |
| `hat-1m` | Seç (üzerine gelme) | genel (tümü) | olayın tamamı | 6.13 | 7.30 (7.23–7.32) | 8.91 | 18.8 |
| `hat-1m` | Çizgi, ilk noktadan sonra | yakın (1:1000) | kenet | 4.99 | 5.71 (5.66–5.72) | 6.01 | 7.01 |
| `hat-1m` | Çizgi, ilk noktadan sonra | yakın (1:1000) | olayın tamamı | 5.08 | 5.81 (5.80–5.83) | 6.15 | 7.09 |
| `hat-1m` | Çizgi, ilk noktadan sonra | genel (tümü) | kenet | 28.2 | 31.0 (30.1–31.5) | 32.7 | 62.4 |
| `hat-1m` | Çizgi, ilk noktadan sonra | genel (tümü) | olayın tamamı | 28.3 | 31.1 (30.2–31.5) | 32.8 | 62.6 |
| `hat-1m` | Buda | yakın (1:1000) | kenar seçme | 1.08 | 2.83 (2.77–3.08) | 3.94 | 4.76 |
| `hat-1m` | Buda | yakın (1:1000) | olayın tamamı | 1.15 | 2.98 (2.87–3.16) | 4.04 | 4.83 |

## Kareler

Kaydırma orta tuşla 80 adımdır (gidip gelir); “GPU gönderimi” çizim çağrılarının ana iş parçacığındaki süresidir, GPU'nun kendi çizimi dahil değildir. “Kare aralığı” bir karenin başından sonrakinin başına geçen duvar saatidir: GPU'nun işi ve 60 Hz ekran temposu dahil, ulaşılan kare hızını gösterir (16.7 ms = 60 fps; tempo yüzünden 16.7'nin katlarına yakın çıkar). Yeniden kurma koşu başına 6 stil değişikliğidir.

| Veri seti | Senaryo | Ölçüt | p50 | p95 (aralık) | p99 | en çok |
|---|---|---|---|---|---|---|
| `parsel-50k` | Kaydırma, yakın (1:1000) | üst katman | 7.18 | 8.68 (8.20–8.73) | 10.8 | 11.1 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | etiketler | 7.11 | 8.58 (8.10–8.66) | 10.7 | 11.0 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | GPU gönderimi | 0.26 | 0.40 (0.36–0.40) | 0.45 | 0.48 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | kare (CPU) | 7.46 | 9.04 (8.45–9.08) | 11.2 | 11.4 |
| `parsel-50k` | Kaydırma, yakın (1:1000) | kare aralığı (GPU dahil) | 16.7 | 17.0 (16.9–17.1) | 39.4 | 45.3 |
| `parsel-50k` | Kaydırma, genel (tümü) | üst katman | 10.6 | 11.4 (11.1–13.0) | 16.3 | 17.7 |
| `parsel-50k` | Kaydırma, genel (tümü) | etiketler | 10.5 | 11.3 (11.0–12.9) | 16.1 | 17.6 |
| `parsel-50k` | Kaydırma, genel (tümü) | GPU gönderimi | 0.25 | 0.32 (0.28–0.38) | 0.39 | 0.64 |
| `parsel-50k` | Kaydırma, genel (tümü) | kare (CPU) | 10.9 | 11.8 (11.5–13.2) | 16.5 | 18.0 |
| `parsel-50k` | Kaydırma, genel (tümü) | kare aralığı (GPU dahil) | 25.4 | 26.4 (26.0–26.7) | 51.3 | 52.2 |
| `parsel-50k` | Buda önizlemesi, yakın (1:1000) | önizleme (imleç bir kenardayken) | 7.05 | 8.47 (7.71–9.11) | 8.79 | 10.6 |
| `parsel-50k` | Buda önizlemesi, yakın (1:1000) | kare (CPU), bütün kareler | 6.35 | 15.0 (14.2–15.0) | 15.3 | 20.1 |
| `parsel-50k` | Seç, yakın (1:1000) (vurgu değişince tam çizim) | kare (CPU) | 6.40 | 7.24 (7.20–7.24) | 8.52 | 17.0 |
| `parsel-50k` | Çizgi, yakın (1:1000) | kare (CPU) | 6.12 | 6.73 (6.50–6.85) | 7.23 | 12.0 |
| `parsel-50k` | Büyük katmanı yeniden kurma (stil değişikliği) | kurma ve yükleme | 98.5 | 112 (111–116) | 112 | 116 |
| `hat-1m` | Kaydırma, yakın (1:1000) | üst katman | 0.81 | 1.00 (0.88–1.04) | 1.13 | 1.20 |
| `hat-1m` | Kaydırma, yakın (1:1000) | etiketler | 0.69 | 0.88 (0.70–0.90) | 0.95 | 0.98 |
| `hat-1m` | Kaydırma, yakın (1:1000) | GPU gönderimi | 0.36 | 0.48 (0.44–0.50) | 0.57 | 0.73 |
| `hat-1m` | Kaydırma, yakın (1:1000) | kare (CPU) | 1.21 | 1.47 (1.26–1.60) | 1.70 | 1.74 |
| `hat-1m` | Kaydırma, yakın (1:1000) | kare aralığı (GPU dahil) | 16.7 | 17.1 (17.0–17.3) | 43.4 | 66.3 |
| `hat-1m` | Kaydırma, genel (tümü) | üst katman | 0.89 | 1.17 (1.02–1.20) | 1.21 | 1.22 |
| `hat-1m` | Kaydırma, genel (tümü) | etiketler | 0.74 | 0.96 (0.84–0.97) | 1.02 | 1.02 |
| `hat-1m` | Kaydırma, genel (tümü) | GPU gönderimi | 0.32 | 0.40 (0.36–0.42) | 0.46 | 0.47 |
| `hat-1m` | Kaydırma, genel (tümü) | kare (CPU) | 1.25 | 1.59 (1.41–1.63) | 1.71 | 1.72 |
| `hat-1m` | Kaydırma, genel (tümü) | kare aralığı (GPU dahil) | 45.8 | 48.1 (47.8–48.7) | 48.8 | 90.9 |
| `hat-1m` | Buda önizlemesi, yakın (1:1000) | önizleme (imleç bir kenardayken) | 727 | 763 (744–777) | 780 | 785 |
| `hat-1m` | Buda önizlemesi, yakın (1:1000) | kare (CPU), bütün kareler | 718 | 754 (737–777) | 781 | 785 |
| `hat-1m` | Seç, yakın (1:1000) (vurgu değişince tam çizim) | kare (CPU) | 0.95 | 1.45 (1.39–1.48) | 1.80 | 1.95 |
| `hat-1m` | Çizgi, yakın (1:1000) | kare (CPU) | 0.59 | 0.80 (0.77–0.80) | 0.87 | 0.96 |
| `hat-1m` | Büyük katmanı yeniden kurma (stil değişikliği) | kurma ve yükleme | 110 | 131 (127–140) | 131 | 140 |

## ADR 0005 taslağıyla karşılaştırma (yalnızca kayıt)

| Hedef (taslak) | Ölçülen (p95, koşuların ortancası) | Not |
|---|---|---|
| İmleç hareketinde seçme ve kenet: 100 bin nesnede olay başına < 2 ms | seçme 9.21 / 9.87 ms; kenet 9.19 / 12.6 ms (yakın / genel) | `parsel-50k`, 81 229 nesne |
| Kaydırma: 1 milyon segmentte kare ≤ 16 ms | kare (CPU) 1.47 / 1.59 ms; kare aralığı 17.1 / 48.1 ms (yakın / genel) | `hat-1m`; kare (CPU) yalnız ana iş parçacığıdır, kare aralığı bu makinenin GPU'suyla (başlıktaki) duvar saatidir |
| Bir katmanı yeniden kurma: 100 bin segmentte < 50 ms | 131 ms | `hat-1m` büyük katmanı 1 milyon segmenttir; hedef 100 bin segment içindir |
| Bir katmanı yeniden kurma | 112 ms | `parsel-50k` `parsel` katmanı, 50 400 alan |

Karşılaştırma bir kabul kararı değildir: hedefler onaylanmadı; ölçüm başsız Chrome'da, ana iş parçacığında alındı.

## Gürültü

- p95'i 0.5 ms'den büyük 94 ölçütte koşular arası yayılım (en yüksek − en düşük p95, ortancaya oranla): ortanca %6, en çok %61 (`parsel-50k/rebuild/frame.labels`).
- Tek tek olaylar çöp toplamayla sıçrayabilir: p99 ve “en çok” bu yüzden p95'ten gürültülüdür. Her dizi öncesinde çöp toplama zorlanır.
- Karşılaştırmada iki ölçümün farkı p95 aralıklarının dışına çıkmıyorsa gürültü sayılmalıdır.

## Yöntem

- Veri setleri sayfada, tohumlu üreteçle kurulur ve `kentos.doc.replaceWith` ile açılır (geçmişsiz). Üreteçler ve tohumlar `scripts/perf/datasets.mjs`'tedir; parametreler JSON raporundadır.
- İmleç olayları gerçek `Input.dispatchMouseEvent` hareketleridir. Chrome bir hareketi karesi çizilince yanıtlar; sonraki hareket ancak o zaman gider, böylece olaylar birleşmez ve her olay kendi karesini çizer (her dizide sayılır). Yol, çizim alanının araç kutusu ve komut şeridi dışında kalan kısmında, veri setinin ekrandaki kutusunun içindedir (genel görünümde veri seti tuvali doldurmaz).
- Chrome makinenin GPU'sunda çizer (--use-angle=gl --ignore-gpu-blocklist); kareler Chrome'un kendi 60 Hz hızındadır. SwiftShader (yazılım GPU) ile bu veri setlerinde tek kare saniyeler sürüyor, kareler birikip sayfayı sonradan dakikaya varan sürelerle durduruyordu; ana iş parçacığı süreleri iki durumda da aynıydı.
- Nesne izleme ve bilgi kartı kapalıdır: ikisi de beklemeye (350 ve 500 ms) bağlıdır ve hızlı bir çekirdeğin farklı iş yapmasına yol açardı. Kenet türleri, açıklıklar ve ızgara varsayılandır.
- Google yazı tipleri engellenir (her koşuda aynı yerel yazı tipi, ağ yok). Sunucu bağlantısı yoktur ("Sunucu: yok").
- Başlangıç süreleri bu betikte değil, `scripts/perf/startup.mjs` raporlarındadır.
