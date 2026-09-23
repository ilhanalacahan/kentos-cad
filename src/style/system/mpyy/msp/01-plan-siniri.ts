import { BLACK, rgb, sheet, stroke } from '../dsl';

/**
 * MSP (EK-1e bölüm I, s.1) › Sınırlar: plan sınırı. Mekânsal strateji planı
 * gösterimleri yalnız EK-1e'nin ilk bölümünde; MSP satırları sembol ölçüsü
 * vermez, ölçüler çizimden (not düşülür).
 */

export const sinirlar = sheet('msp', ['Sınırlar'], 'sinirlar', 10);

sinirlar.line('plan-siniri', 'Plan sınırı', [stroke(rgb(178, 178, 178), 1, { offset: 0.6 }), stroke(BLACK, 1)], {
  ref: 'EK-1e s.1',
  note: '1 mm siyah çizgi, 178/178/178 gölgeli. Gölge çizimde çizginin altında yumuşak bir bant; motorda bulanıklık ve sayfaya sabit gölge yönü yok: gölge 1 mm gri çizgi olarak 0,6 mm içe (çizim yönünün soluna, alanın içine) kaydırıldı. Kayma ölçüsü çizimden kestirildi.',
});
