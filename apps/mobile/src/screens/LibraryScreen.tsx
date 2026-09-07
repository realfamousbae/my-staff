import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { CollectibleTile } from "../components/CollectibleTile";
import type { CollectibleCategory, CollectionItem } from "../models";
import { colors, spacing, text } from "../theme";
import { EmptyState, Icon, IconButton, Pill } from "../ui";

export function LibraryScreen({
  items,
  onAdd,
  onOpen,
  filterItems,
}: {
  items: CollectionItem[];
  onAdd: () => void;
  onOpen: (item: CollectionItem) => void;
  filterItems: (filter: {
    query?: string;
    category?: CollectibleCategory | "all";
  }) => CollectionItem[];
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CollectibleCategory | "all">("all");
  const visible = useMemo(
    () => filterItems({ query, category }),
    [filterItems, query, category],
  );
  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={text.eyebrow}>Личная витрина</Text>
          <Text style={text.title}>Коллекция</Text>
        </View>
        <IconButton
          name="add"
          label="Добавить предмет"
          tone="lime"
          onPress={onAdd}
        />
      </View>
      <View style={styles.search}>
        <Icon name="search-outline" color={colors.muted} />
        <TextInput
          accessibilityLabel="Поиск по коллекции"
          value={query}
          onChangeText={setQuery}
          placeholder="Найти банку или тубус"
          placeholderTextColor={colors.muted}
          style={styles.input}
          returnKeyType="search"
        />
      </View>
      <View style={styles.filters}>
        <Pill active={category === "all"} onPress={() => setCategory("all")}>
          Все · {items.length}
        </Pill>
        <Pill
          active={category === "energy"}
          onPress={() => setCategory("energy")}
        >
          Энергетики
        </Pill>
        <Pill
          active={category === "pringles"}
          onPress={() => setCategory("pringles")}
        >
          Pringles
        </Pill>
      </View>
      {visible.length ? (
        <FlatList
          data={visible}
          numColumns={2}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CollectibleTile item={item} onPress={() => onOpen(item)} />
          )}
          columnWrapperStyle={styles.columns}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <EmptyState
          icon="albums-outline"
          title={
            items.length ? "Ничего не найдено" : "Витрина ждёт первую находку"
          }
          body={
            items.length
              ? "Попробуй изменить запрос или фильтр."
              : "Сфотографируй банку энергетика или тубус Pringles. Исходное фото останется с предметом."
          }
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: spacing.md },
  header: {
    paddingTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  search: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  input: { color: colors.ink, fontSize: 16, flex: 1, height: "100%" },
  filters: { flexDirection: "row", gap: 8, paddingVertical: 16 },
  list: { paddingBottom: 108 },
  columns: { justifyContent: "space-between" },
});
