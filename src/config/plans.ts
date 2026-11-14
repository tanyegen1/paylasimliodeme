/**
 * Ücretsiz / premium yapılandırması. Fiyat burada TANIMLI DEĞİLDİR; abonelik entegrasyonu yoktur.
 * Temel akış (grup, davet, manuel harcama, bakiye, hesaplaşma, temel hatırlatma) her zaman ücretsizdir.
 *
 * Grup kuralı: Grubu kuran kişi premium ise, o gruptaki TÜM üyeler grup içinde
 * dışa aktarım ve gelişmiş raporlardan yararlanır; fiş tarama kotası grup kurucusunun kotasından düşmez,
 * her üye kendi kotasını kullanır ama premium gruptaki üyelere premium kota uygulanır.
 * Davet edilen kimsenin premium alması gerekmez.
 */
export const PLANS = {
  free: { ocrScansPerMonth: 5, nlDraftsPerMonth: 30, export: false, advancedReports: false },
  premium: { ocrScansPerMonth: 100, nlDraftsPerMonth: 1000, export: true, advancedReports: true },
} as const;
export type PlanId = keyof typeof PLANS;
