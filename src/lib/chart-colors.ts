/**
 * Validated with the dataviz validator (light mode, surface #FFFFFF; all checks pass):
 *   leads #5B7FC7 / won #3D8A5F
 *   qualified #3D8A5F / needs info #D4A017 / unqualified #8B6BB8
 *   open #5B7FC7 / quote out #D4A017 / won #3D8A5F / lost #8B6BB8 (stack order; CVD worst ΔE 13.3)
 * Gold is under 3:1 contrast, so values are always available as text (tooltip, labels, table view).
 */
export const C = {
  leads: "#5B7FC7",
  won: "#3D8A5F",
  qualified: "#3D8A5F",
  needs_info: "#D4A017",
  unqualified: "#8B6BB8",
  open: "#5B7FC7",
  quote_out: "#D4A017",
  lost: "#8B6BB8",
  grid: "#ECE8E0",
  axis: "#7B786F",
  ink: "#1B2420",
} as const;
