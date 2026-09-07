import { FlatList, StyleSheet, Text, View } from "react-native";
import type { CollectionItem } from "../models";
import { colors, text } from "../theme";
import { Button, EmptyState, IconButton } from "../ui";

export function DeletedScreen({
  items,
  onBack,
  onRestore,
}: {
  items: CollectionItem[];
  onBack: () => void;
  onRestore: (id: string) => Promise<void>;
}) {
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <IconButton name="chevron-back" label="Назад" onPress={onBack} />
        <Text style={styles.topTitle}>Удалённые предметы</Text>
        <View style={styles.space} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <EmptyState
            icon="trash-outline"
            title="Здесь пока пусто"
            body="Удалённые карточки можно будет восстановить до окончательного удаления по правилам сервера."
          />
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.copy}>
              <Text style={text.label}>
                {item.title || item.editionName || "Без названия"}
              </Text>
              <Text style={text.body}>
                {item.category === "pringles" ? "Pringles" : "Энергетик"}
              </Text>
            </View>
            <Button
              label="Восстановить"
              icon="refresh-outline"
              tone="quiet"
              onPress={() => void onRestore(item.id)}
            />
          </View>
        )}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  top: {
    height: 68,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  space: { width: 48 },
  list: { padding: 16, paddingTop: 6, gap: 9 },
  row: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  copy: { flex: 1, gap: 3 },
});
