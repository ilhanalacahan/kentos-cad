import { sanitizeSvg } from '../../style/file';
import { docFromSvgTree, type XmlNode } from '../../style/svg/importSvg';
import type { SvgDoc } from '../../style/svg/svgModel';

/**
 * SVG text into the editor's model: the browser parses the XML (after the
 * same cleaning the library applies), the pure importer does the rest.
 */

function toNode(el: Element): XmlNode {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  const tag = el.localName;
  return { tag, attrs, children: tag === 'text' ? [] : Array.from(el.children).map(toNode), text: tag === 'text' ? (el.textContent ?? '') : undefined };
}

export function readSvg(text: string): { doc: SvgDoc; skipped: string[] } | { error: string } {
  const xml = new DOMParser().parseFromString(sanitizeSvg(text), 'image/svg+xml');
  const root = xml.documentElement;
  if (!root || root.localName !== 'svg' || xml.getElementsByTagName('parsererror').length) return { error: 'Dosya okunabilir bir SVG çizimi değil.' };
  return docFromSvgTree(toNode(root));
}
