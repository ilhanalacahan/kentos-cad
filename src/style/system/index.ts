import type { LibraryCategory, LibraryItem } from '../../model/style';
import { BASIC_CATEGORIES, BASIC_ITEMS } from './basic';

/** Everything that ships with KentOS: read-only, copyable (docs/STYLE.md §5). */
export const SYSTEM_LIBRARY: { items: readonly LibraryItem[]; categories: readonly LibraryCategory[] } = {
  items: [...BASIC_ITEMS],
  categories: [...BASIC_CATEGORIES],
};
