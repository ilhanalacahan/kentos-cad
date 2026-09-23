# Performans ölçümleri

Ölçümler betikle alınır ve buraya yazılır; elle sayı girilmez. Hedefler [ADR 0005](../adr/0005-performance-acceptance-targets.md)'tedir. ADR **taslaktır ve kullanıcı onayı bekler**; aşağıdaki karşılaştırma bu yüzden yalnızca kayıttır, kabul kararı değildir.

```bash
node scripts/perf/bundle.mjs  --label baseline   # production build + chunk envanteri
node scripts/perf/startup.mjs --label baseline   # vite preview + başsız Chrome, soğuk/ılık × 3
```

Ölçüm sırasında makinede başka ağır süreç (Vite, e2e, cargo) çalışmaz.

## Faz A başlangıç kaydı (2026-09-23, `85be871`)

Kaynaklar:
- [bundle-baseline-2026-09-23.md](bundle-baseline-2026-09-23.md)
- [startup-baseline-2026-09-23.md](startup-baseline-2026-09-23.md) (ham veri `.json`)

| Ölçüt | Ölçülen | ADR 0005 önerisi |
|---|---|---|
| İlk sayfa JS (gzip) | 258,4 KB | ≤ 350 KB |
| İlk sayfa CSS (gzip) | 15,8 KB | ≤ 40 KB |
| Başlangıç WASM | yok (uygulama WASM yüklemiyor) | ≤ 300 KB |
| Etkileşime hazır, soğuk (ortanca) | 557 ms | ≤ 1,5 s |
| Etkileşime hazır, ılık (ortanca) | 288 ms | ≤ 0,8 s |
| Script süresi, soğuk | 177 ms | ≤ 600 ms |
| Ağır modülün ilk / ikinci açılışı | ölçülmedi | ≤ 400 ms / ≤ 150 ms |
| Etkileşim bütçeleri (§6.1) | ölçülmedi | ADR 0005 tablosu |

Notlar:

- **İlk yük demo projeyi ve bütün MPYY sistem kitaplığını içeriyor.** ADR'nin başlangıç hedefleri demo ayrıldıktan sonrası içindir; bugünkü değerler bu yükle birlikte ölçüldü.
- **Oturumun ilk soğuk yüklemesi ~1,8 s sürüyor** (her ölçümde tekrarlandı). Sonraki soğuk yüklemeler de boş profille açılıyor ve ~0,55 s sürüyor. Fark uygulamada değil, tarayıcının ve işletim sisteminin soğuk başlangıcında görünüyor. Ortanca bu ilk yüklemeyi içermiyor; en kötü durum aralık sütunundadır.
- Aktarım `vite preview`'un gzip boyutudur. Brotli ile ilk sayfa JS'i 210,7 KB olur (envanter).
- İstek listesinde `/v1/health` (API yokken 503) vardır. Denetim uygulama boştayken yapılır, etkileşime hazır olmayı beklemez.
- Ağır modül açılışları ve §6.1 etkileşim bütçeleri için henüz betik ve veri seti (`hat-1m`, `parsel-50k`) yok. Bunlar ADR 0005 onaylandıktan sonraki ilk ölçüm işidir.
- Referans ortam: Intel Core i5-11300H, 16 GB, Ubuntu, Chrome 153 başsız, WebGL2.
