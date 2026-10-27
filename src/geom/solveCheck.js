// Sanity check of a solver result: compliance c (and the first step's c0) must be finite and positive, the sag finite and below maxSagMm.
// Returns null when the numbers make sense, else a short plain-language warning for the panel.
export function solveCheck({ c, c0, sag }, maxSagMm) {
  if (![c, c0].every((v) => v == null || (Number.isFinite(v) && v > 0)))
    return "The solver failed on this setup (its numbers are not valid), so this result cannot be trusted. Run Generate Draft again, move the tool part a little, or change the design space size.";
  if (sag != null && !(Number.isFinite(sag) && sag <= maxSagMm))
    return `The sag came out at ${Number.isFinite(sag) ? Math.round(sag).toLocaleString() + " mm" : "an invalid value"}, which makes no sense for this connector: the solver probably failed. Run Generate Draft again, move the tool part a little, or change the design space size.`;
  return null;
}
