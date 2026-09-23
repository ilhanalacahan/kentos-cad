import type { AppContext } from '../../app/context';
import { Component } from '../Component';
import { h } from '../dom';
import { LayersPanel } from '../layers/LayersPanel';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { splitter } from '../widgets/Splitter';

/** Right dock: layer tree over attributes, split by a draggable divider. */
export class RightDock extends Component {
  readonly el: HTMLElement;
  private readonly layers: LayersPanel;
  private readonly props: PropertiesPanel;

  constructor(ctx: AppContext) {
    super();
    const { ui } = ctx;
    this.layers = new LayersPanel(ctx);
    this.props = new PropertiesPanel(ctx);

    let startFrac = 0;
    let height = 1;
    const split = splitter({
      orientation: 'horizontal',
      label: 'Katmanlar ve öznitelikler arası',
      onStart: () => {
        startFrac = ui.layersFraction.value;
        height = this.el.clientHeight || 1;
      },
      onDrag: (dy) => ui.layersFraction.set(Math.min(0.85, Math.max(0.15, startFrac + dy / height))),
      onReset: () => ui.layersFraction.set(0.5),
    });
    this.d.add(split.dispose);

    this.el = h('aside', { class: 'dock', 'aria-label': 'Katmanlar ve öznitelikler' }, this.layers.el, split.el, this.props.el);
    this.d.add(ui.layersFraction.subscribe((f) => this.el.style.setProperty('--layers-frac', String(f)), true));
    const syncCollapsed = () => {
      this.el.dataset.layout = this.layers.collapsed.value ? 'props' : this.props.collapsed.value ? 'layers' : 'split';
    };
    this.d.add(this.layers.collapsed.subscribe(syncCollapsed));
    this.d.add(this.props.collapsed.subscribe(syncCollapsed));
    syncCollapsed();
  }

  override dispose(): void {
    this.layers.dispose();
    this.props.dispose();
    super.dispose();
  }
}
