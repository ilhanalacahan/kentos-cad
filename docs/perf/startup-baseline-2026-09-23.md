# Başlangıç ölçümü: baseline (2026-09-23, 85be871)

11th Gen Intel(R) Core(TM) i5-11300H @ 3.10GHz, 8 iş parçacığı, 15 GB; Google Chrome 153.0.8010.36; başsız, WebGL2; `vite preview` (yerel). 3 ölçümün ortancası. Hedefler: docs/adr/0005.

| Ölçüt | Soğuk | Ilık |
|---|---|---|
| Etkileşime hazır (`kentos:interactive`; aralık) | 557 ms (554–1789) | 288 ms (198–775) |
| İstek sayısı | 6 | 5 |
| Aktarılan toplam | 278.3 KB | 0.7 KB |
| JS aktarımı | 260.2 KB | 0.4 KB |
| CSS aktarımı | 16.3 KB | 0.2 KB |
| WASM aktarımı | 0.0 KB | 0.0 KB |
| Script süresi (ana iş parçacığı) | 177 ms | 49 ms |
| Görev süresi (toplam) | 1049 ms | 283 ms |
| JS yığını | 10 MB | 16 MB |

Aktarım, sunucunun gönderdiği sıkıştırılmış boyuttur (`content-encoding: gzip`). Brotli karşılığı için build envanterine bakın.

İlk soğuk yüklemenin istekleri:

| Yol | Durum | Aktarım | Kodlama |
|---|---|---|---|
| `/` | 200 | 1.2 KB | – |
| `/assets/index-DjdBx8ZX.css` | 200 | 16.3 KB | gzip |
| `/assets/color-C4jILryO.js` | 200 | 13.0 KB | gzip |
| `/assets/index-DsB-wuvL.js` | 200 | 247.2 KB | gzip |
| `/v1/health` | 503 | 0.0 KB | – |
| `/favicon.svg` | 200 | 0.6 KB | – |
