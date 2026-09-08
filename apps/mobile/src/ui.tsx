import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps, PropsWithChildren } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { colors, radius, spacing, text } from "./theme";

type Icon = ComponentProps<typeof Ionicons>["name"];
export function Icon({
  name,
  size = 21,
  color = colors.ink,
}: {
  name: Icon;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function Button({
  label,
  icon,
  onPress,
  tone = "lime",
  disabled = false,
  style,
}: {
  label: string;
  icon?: Icon;
  onPress: () => void;
  tone?: "lime" | "quiet" | "danger";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const palette =
    tone === "lime"
      ? { backgroundColor: colors.lime, color: colors.limeInk }
      : tone === "danger"
        ? { backgroundColor: "rgba(255,155,134,.13)", color: colors.danger }
        : { backgroundColor: colors.surfaceRaised, color: colors.ink };
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        palette,
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon && <Icon name={icon} color={palette.color} size={20} />}
      <Text style={[styles.buttonText, { color: palette.color }]}>{label}</Text>
    </Pressable>
  );
}
export function IconButton({
  name,
  label,
  onPress,
  tone = "dark",
}: {
  name: Icon;
  label: string;
  onPress: () => void;
  tone?: "dark" | "lime";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        tone === "lime" && styles.iconLime,
        pressed && styles.pressed,
      ]}
    >
      <Icon name={name} color={tone === "lime" ? colors.limeInk : colors.ink} />
    </Pressable>
  );
}
export function Pill({
  children,
  active = false,
  onPress,
}: PropsWithChildren<{ active?: boolean; onPress?: () => void }>) {
  const C = onPress ? Pressable : View;
  return (
    <C
      {...(onPress ? { onPress, accessibilityRole: "button" as const } : {})}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {children}
      </Text>
    </C>
  );
}
export function Status({
  children,
  tone = "muted",
}: PropsWithChildren<{ tone?: "muted" | "lime" | "danger" }>) {
  const color =
    tone === "lime"
      ? colors.lime
      : tone === "danger"
        ? colors.danger
        : colors.muted;
  return (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.statusText, { color }]}>{children}</Text>
    </View>
  );
}
export function EmptyState({
  icon,
  title,
  body,
  children,
}: PropsWithChildren<{ icon: Icon; title: string; body: string }>) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyGlyph}>
        <Icon name={icon} size={28} color={colors.lime} />
      </View>
      <Text style={text.section}>{title}</Text>
      <Text style={[text.body, styles.emptyBody]}>{body}</Text>
      {children}
    </View>
  );
}
export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    flexShrink: 1,
    textAlign: "center",
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(16,18,16,.76)",
    borderWidth: 1,
    borderColor: "#3B4039",
  },
  iconLime: { backgroundColor: colors.lime, borderColor: colors.lime },
  pill: {
    minHeight: 36,
    paddingHorizontal: 13,
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pillActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  pillText: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  pillTextActive: { color: colors.limeInk },
  status: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { width: 7, height: 7, borderRadius: 5 },
  statusText: { fontSize: 12, fontWeight: "700" },
  empty: {
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: 12,
  },
  emptyGlyph: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  emptyBody: { textAlign: "center", maxWidth: 280 },
  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
});
