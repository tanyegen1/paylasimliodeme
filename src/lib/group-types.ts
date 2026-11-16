export const GROUP_EMOJI: Record<string, string> = { home: "🏠", trip: "🏖️", meal: "🍽️", event: "🎉", other: "👥" };
export const GROUP_TYPE_LIST = ["home", "trip", "meal", "event", "other"] as const;
/** Grup türüne göre yumuşak renkli kutu. */
export const GROUP_TILE: Record<string, string> = {
  home: "bg-gradient-to-br from-[#D7F3E8] to-[#BFE9D8]", trip: "bg-gradient-to-br from-[#DCEBFF] to-[#C7DDFB]",
  meal: "bg-gradient-to-br from-[#FFE6C7] to-[#FFD7A8]", event: "bg-gradient-to-br from-[#FFDDE3] to-[#FBC9D3]", other: "bg-gradient-to-br from-[#EADFFF] to-[#DCCBFB]",
};
