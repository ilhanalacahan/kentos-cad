import type { LayerNode } from '../../model/layers';
import { resolveColor, type CanvasPalette } from '../../render/color';

/** CSS colour for a layer's swatch (theme tokens resolved). */
export const layerSwatch = (n: LayerNode, palette: CanvasPalette) => resolveColor(n.style.color, palette);
