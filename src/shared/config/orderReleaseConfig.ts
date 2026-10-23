export const DEFAULT_HOLD_PERIOD_HOURS = 48;

// Cloud Tasks cannot schedule more than 30 days ahead.
const MAX_HOLD_PERIOD_HOURS = 24 * 29;

// Fails loudly on a bad value: a mistyped hold period must not silently shorten
// the window in which buyers can raise a dispute.
export const getHoldPeriodHours = (): number => {
  const raw = process.env.ORDER_HOLD_PERIOD_HOURS?.trim();
  if (!raw) {
    return DEFAULT_HOLD_PERIOD_HOURS;
  }

  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOLD_PERIOD_HOURS) {
    throw new Error(
      `ORDER_HOLD_PERIOD_HOURS must be a number between 0 and ${MAX_HOLD_PERIOD_HOURS}`,
    );
  }
  return hours;
};

export const calculateReleaseAt = (
  deliveredAt: Date,
  holdPeriodHours = getHoldPeriodHours(),
): Date => new Date(deliveredAt.getTime() + holdPeriodHours * 60 * 60 * 1000);
