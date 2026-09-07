export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function formatVertical(vertical: string): string {
  return vertical.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatPricingModel(model: string): string {
  switch (model) {
    case "PER_APPOINTMENT":
      return "Per Appointment";
    case "PER_CALL_DURATION":
      return "Per Call (Duration)";
    case "CPL":
      return "Cost Per Lead";
    default:
      return model;
  }
}
