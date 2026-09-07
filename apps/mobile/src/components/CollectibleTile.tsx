import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { CollectionItem } from "../models";
import { colors, radius, text } from "../theme";
import { Icon, Status } from "../ui";

export function CollectibleTile({
  item,
  onPress,
}: {
  item: CollectionItem;
  onPress: () => void;
}) {
  const label = item.title?.trim() || "Без названия";
  const isPringles = item.category === "pringles";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Открыть: ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <View style={[styles.image, isPringles && styles.tube]}>
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={styles.photo} />
        ) : (
          <Icon
            name={isPringles ? "nutrition-outline" : "wine-outline"}
            size={28}
            color={colors.muted}
          />
        )}
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} style={styles.title}>
          {label}
        </Text>
        <Text numberOfLines={1} style={text.body}>
          {item.editionName || (isPringles ? "Pringles" : "Энергетик")}
        </Text>
        <Status
          tone={
            item.uploadStatus === "attention"
              ? "danger"
              : item.uploadStatus === "synced"
                ? "lime"
                : "muted"
          }
        >
          {item.uploadStatus === "attention"
            ? "Нужно действие"
            : item.recognitionStatus === "processing"
              ? "Определяем"
              : item.uploadStatus === "synced"
                ? "Сохранено"
                : "На устройстве"}
        </Status>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  wrap: { width: "48%", gap: 9, marginBottom: 18 },
  pressed: { opacity: 0.78 },
  image: {
    aspectRatio: 0.83,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
  },
  tube: { aspectRatio: 0.7 },
  photo: { width: "100%", height: "100%", resizeMode: "cover" },
  info: { gap: 3 },
  title: { color: colors.ink, fontSize: 15, fontWeight: "700", lineHeight: 20 },
});
