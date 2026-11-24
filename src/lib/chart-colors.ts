/**
 * Validated with the dataviz validator (light mode, surface #FFFFFF; all checks pass):
 *   leads #5B7FC7 / won #3D8A5F
 *   qualified #3D8A5F / needs info #D4A017 / unqualified #8B6BB8
 *   series order blue #5B7FC7 / gold #D4A017 / green #3D8A5F / purple #8B6BB8 passes (CVD worst ΔE 13.3);
 *   blue next to purple FAILS (ΔE 2.5 deutan), so keep that order:
 *   channels: Quote Builder / Contact form / Goodshuffle / Other; quote stages: sent (blue) / signed incl. action needed (green) / lost (purple)
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
  ch_quote_builder: "#5B7FC7",
  ch_contact_us_form: "#D4A017",
  ch_goodshuffle: "#3D8A5F",
  ch_other: "#8B6BB8",
  q_quote_sent: "#5B7FC7",
  q_signed: "#3D8A5F",
  q_lost: "#8B6BB8",
  grid: "#ECE8E0",
  axis: "#7B786F",
  ink: "#1B2420",
} as const;
