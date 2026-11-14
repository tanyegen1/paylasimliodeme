export const CATEGORIES = ["rent", "utilities", "internet", "groceries", "food", "transport", "lodging", "fun", "shopping", "health", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_EMOJI: Record<Category, string> = {
  rent: "🏠", utilities: "💡", internet: "📶", groceries: "🛒", food: "🍽️", transport: "🚕", lodging: "🛏️", fun: "🎟️", shopping: "🛍️", health: "💊", other: "🧾",
};
/** Grup türüne göre öne çıkan kategoriler. */
export const CATEGORIES_BY_TYPE: Record<string, Category[]> = {
  home: ["rent", "utilities", "internet", "groceries", "shopping", "other"],
  trip: ["lodging", "transport", "food", "fun", "groceries", "other"],
  meal: ["food", "fun", "transport", "other"],
  event: ["food", "fun", "shopping", "transport", "other"],
  other: [...CATEGORIES],
};
