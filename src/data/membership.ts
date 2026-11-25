/** The monthly rate, in sen. Shown to invited members and charged through CHIP. Never shown on the public site. */
export const MONTHLY_PRICE_SEN = 9900;
export const formatRinggit = (sen: number) => `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: sen % 100 ? 2 : 0 })}`;
/** "RM 99 a month" */
export const monthlyRate = `${formatRinggit(MONTHLY_PRICE_SEN)} a month`;
