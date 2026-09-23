import type { CadDocument } from '../model/document';
import type { LibraryCategory, LibraryItem } from '../model/style';
import { StyleLibrary } from '../style/library';
import { SYSTEM_LIBRARY } from '../style/system';
import { persistedSignals } from './state';

/**
 * The style library in the app (docs/STYLE.md §5): system symbols from
 * the code, the user's own kept in this browser (`kentos.styles.v1`,
 * later the cloud), and the project's kept in the document.
 */
export interface StyleService {
  readonly library: StyleLibrary;
}

interface UserStyles {
  items: LibraryItem[];
  categories: LibraryCategory[];
}

const isItem = (v: unknown): v is LibraryItem => !!v && typeof v === 'object' && ((v as LibraryItem).kind === 'symbol' || (v as LibraryItem).kind === 'asset') && typeof (v as LibraryItem).id === 'string';

export function createStyles(doc: CadDocument): StyleService {
  const library = new StyleLibrary(SYSTEM_LIBRARY);
  const stored = persistedSignals<UserStyles>('kentos.styles.v1', { items: [], categories: [] });
  library.load('user', (stored.items.value ?? []).filter(isItem), stored.categories.value ?? []);
  library.load('project', doc.styles.value.items, doc.styles.value.categories);
  library.events.on('changed', ({ source }) => {
    const d = library.dump(source);
    if (source === 'user') {
      stored.items.set(d.items);
      stored.categories.set(d.categories);
    } else doc.styles.set(d);
  });
  return { library };
}
