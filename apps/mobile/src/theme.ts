import { StyleSheet } from "react-native";

export const colors = {
  canvas: "#101210",
  surface: "#191c18",
  surfaceRaised: "#232721",
  ink: "#F4F0E6",
  muted: "#A9ADA2",
  line: "#383D35",
  lime: "#D9FF70",
  limeInk: "#223000",
  danger: "#FF9B86",
  paper: "#EDE9DD",
  black: "#11130F",
  shadow: "#000000",
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
export const radius = { sm: 12, md: 18, lg: 26, pill: 999 } as const;
export const text = StyleSheet.create({
  eyebrow: {
    color: colors.lime,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: colors.ink,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  section: {
    color: colors.ink,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  body: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  label: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "700" },
});
