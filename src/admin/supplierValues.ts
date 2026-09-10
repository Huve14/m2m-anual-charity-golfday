export function supplierPrizeSummary(items: Array<{ status: string; prizeValueMinor?: number | null }>) {
  return items.filter((item) => item.status !== "cancelled").reduce((summary, item) => ({
    totalMinor: summary.totalMinor + (item.prizeValueMinor ?? 0),
    unvalued: summary.unvalued + (item.prizeValueMinor == null ? 1 : 0),
  }), { totalMinor: 0, unvalued: 0 });
}

export function prizeValueRand(minor: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
}
