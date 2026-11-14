/** TR IBAN doğrulaması (biçim + mod 97). Boşluksuz büyük harfe çevirir; geçersizse null. */
export function normalizeIban(input: string): string | null {
  const s = input.replace(/\s+/g, "").toUpperCase();
  if (!/^TR\d{24}$/.test(s)) return null;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1 ? s : null;
}
export const formatIban = (iban: string) => iban.replace(/(.{4})/g, "$1 ").trim();
export const maskIban = (iban: string) => `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
