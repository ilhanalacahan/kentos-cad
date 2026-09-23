import { BLACK, dashDots, sheet } from '../dsl';

/** UİP (EK-1d) › Sınırlar: idari, planlama ve özel kanunlarla belirlenen sınırlar; ölçüler EK-1e. */

export const idari = sheet('uip', ['Sınırlar', 'İdari sınırlar'], 'idari', 1);

idari.line('koy-siniri', 'Köy sınırı', [dashDots(BLACK, 0.7, { dash: 10, gap: 2, dots: 3, dot: 1, dotGap: 1 })], { ref: 'EK-1d s.1; EK-1e s.14' });
idari.line('mahalle-siniri', 'Mahalle sınırı', [dashDots(BLACK, 0.7, { dash: 10, gap: 2, dots: 4, dot: 1, dotGap: 1 })], { ref: 'EK-1d s.1; EK-1e s.15' });
