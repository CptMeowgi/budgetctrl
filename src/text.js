// Small pieces of wording shared across screens.

// 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st.
export function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th")}`;
}
