# Build envanteri: baseline (2026-09-23, 85be871)

Ölçüm: `node scripts/perf/bundle.mjs --label baseline`. Boyutlar ham / gzip (9) / brotli (11).

| Kapsam | Ham | gzip | brotli |
|---|---|---|---|
| İlk sayfa JS | 818.1 KB | 258.4 KB | 210.7 KB |
| İlk sayfa CSS | 88.3 KB | 15.8 KB | 14.0 KB |
| Bütün dist (14 dosya) | 1282.6 KB | 407.8 KB | 342.8 KB |

## Giriş chunk'ının en büyük modülleri (işlenmiş boyut)

| Modül | Boyut |
|---|---|
| `src/style/system/mpyy/pictogramDrawings.ts` | 34.7 KB |
| `src/tools/catalog.ts` | 27.3 KB |
| `src/viewport/ViewportController.ts` | 20.3 KB |
| `src/style/system/mpyy/nip/09-teknik-altyapi.ts` | 16.5 KB |
| `src/render/webgl2/styledShaders.ts` | 16.1 KB |
| `src/ui/processing/ToolDialog.ts` | 16.0 KB |
| `src/ui/properties/PropertiesPanel.ts` | 15.3 KB |
| `src/tools/areaTools.ts` | 15.2 KB |
| `src/render/webgpu/styledShaders.ts` | 14.5 KB |
| `src/tools/curveTools.ts` | 14.4 KB |
| `src/tools/modifyTools.ts` | 14.2 KB |
| `src/tools/cornerTools.ts` | 13.3 KB |
| `src/app/commands.ts` | 13.3 KB |
| `src/style/compile.ts` | 12.5 KB |
| `src/model/geom/arrangement.ts` | 11.8 KB |
| `src/render/webgl2/styledRenderer.ts` | 11.8 KB |
| `src/ui/processing/paramFields.ts` | 11.3 KB |
| `src/render/styledSink.ts` | 11.2 KB |
| `src/model/sampleProject.ts` | 11.2 KB |
| `src/style/system/mpyy/ortak/02-sit.ts` | 10.9 KB |
| `src/style/file.ts` | 10.6 KB |
| `src/tools/shapeTools.ts` | 10.5 KB |
| `src/viewport/picking.ts` | 10.5 KB |
| `src/viewport/overlay.ts` | 10.3 KB |
| `src/style/system/mpyy/ortak/01-sinirlar.ts` | 10.2 KB |

## İsteğe bağlı (lazy) chunk'lar

| Dosya | gzip | En büyük modüller |
|---|---|---|
| `assets/LayerStyleDialog-CgiPDJ0-.js` | 5.8 KB | `style/LayerStyleDialog.ts`, `style/rulesEditor.ts`, `style/symbolSlot.ts` |
| `assets/LegendDialog-CRcpGpOM.js` | 2.3 KB | `style/LegendDialog.ts`, `style/legend.ts` |
| `assets/ModelDesigner-WYkgOjSo.js` | 10.7 KB | `model/modelInspector.ts`, `model/ModelDesigner.ts`, `model/ModelCanvas.ts` |
| `assets/StyleManager-CUmotXiO.js` | 6.5 KB | `style/StyleManager.ts`, `style/managerDetails.ts` |
| `assets/SvgEditor-DhpkQUC1.js` | 77.0 KB | `svg/importSvg.ts`, `svgedit/SvgEditor.ts`, `svgedit/svgCanvas.ts` |
| `assets/SymbolDesigner-B1ogTTPb.js` | 9.5 KB | `style/layerForms.ts`, `style/SymbolDesigner.ts` |
| `assets/classify-Q9rmCxkY.js` | 1.3 KB | `style/classify.ts` |
| `assets/designerFields-QXQegggm.js` | 1.8 KB | `style/designerFields.ts` |
| `assets/styleFiles-C_mhsWP6.js` | 0.8 KB | `style/styleFiles.ts` |
| `assets/thumbs-Dd7zaBhY.js` | 4.3 KB | `render/symbolPreview.ts`, `style/thumbs.ts` |
