import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Edition } from "@my-staff/contracts";
import type { CollectibleCategory } from "../models";
import { colors, spacing, text } from "../theme";
import { Button, Icon, IconButton, Pill } from "../ui";
import { SafeAreaView } from "react-native-safe-area-context";

export function CatalogPickerScreen({
  category,
  currentId,
  load,
  onPick,
  onPropose,
  onBack,
}: {
  category: CollectibleCategory;
  currentId?: string | null;
  load: (query: string, category: CollectibleCategory) => Promise<Edition[]>;
  onPick: (editionId: string | null) => Promise<void>;
  onPropose: () => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Edition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = async (term = query) => {
    setLoading(true);
    setError(null);
    try {
      setItems(await load(term, category));
    } catch {
      setError(
        "Каталог пока недоступен. Проверьте подключение и попробуйте снова.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void reload("");
  }, [category]);
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.top}>
        <IconButton name="chevron-back" label="Назад" onPress={onBack} />
        <Text style={styles.topTitle}>Выбрать издание</Text>
        <View style={styles.space} />
      </View>
      <View style={styles.content}>
        <Text style={text.eyebrow}>Каталог</Text>
        <Text style={text.title}>
          {category === "energy" ? "Энергетики" : "Pringles"}
        </Text>
        <View style={styles.search}>
          <Icon name="search-outline" color={colors.muted} />
          <TextInput
            accessibilityLabel="Поиск в каталоге"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void reload()}
            placeholder="Бренд, вкус или оформление"
            placeholderTextColor={colors.muted}
            style={styles.input}
            returnKeyType="search"
          />
        </View>
        <Button label="Найти" tone="quiet" onPress={() => void reload()} />
        <View style={styles.current}>
          <Pill active>
            Текущий тип: {category === "energy" ? "энергетик" : "Pringles"}
          </Pill>
          <Button
            label="Нет совпадения"
            tone="quiet"
            onPress={() => void onPick(null)}
          />
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.lime} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={text.body}>{error}</Text>
            <Button label="Повторить" onPress={() => void reload()} />
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(x) => x.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={text.section}>Совпадений пока нет</Text>
                <Text style={text.body}>
                  Не добавляйте вымышленное издание. Можно отправить предложение
                  с данными вашей упаковки.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <EditionRow
                item={item}
                selected={item.id === currentId}
                onPick={() => void onPick(item.id)}
              />
            )}
          />
        )}
      </View>
      <View style={styles.bottom}>
        <Button
          label="Предложить новое издание"
          icon="add-circle-outline"
          tone="quiet"
          onPress={onPropose}
        />
      </View>
    </SafeAreaView>
  );
}
function EditionRow({
  item,
  selected,
  onPick,
}: {
  item: Edition;
  selected: boolean;
  onPick: () => void;
}) {
  const facts = [
    item.brand,
    item.line,
    item.flavor,
    item.market,
    item.quantity,
  ].filter((value): value is string => Boolean(value));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPick}
      style={({ pressed }) => [
        styles.row,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.name}>{item.name}</Text>
        {selected && <Icon name="checkmark-circle" color={colors.lime} />}
      </View>
      <Text style={styles.facts}>{facts.join(" · ")}</Text>
      {item.design && (
        <Text numberOfLines={1} style={styles.design}>
          {item.design}
        </Text>
      )}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  top: {
    height: 68,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  space: { width: 48 },
  content: { flex: 1, paddingHorizontal: 16 },
  search: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    marginTop: 17,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  input: { height: "100%", flex: 1, color: colors.ink, fontSize: 16 },
  current: {
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  list: { paddingBottom: 16 },
  row: {
    padding: 15,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginBottom: 9,
    gap: 5,
  },
  selected: { borderColor: colors.lime },
  pressed: { opacity: 0.78 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  name: { color: colors.ink, fontSize: 16, fontWeight: "700", flex: 1 },
  facts: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  design: { color: colors.muted, fontSize: 12, fontStyle: "italic" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 28,
  },
  bottom: { padding: 16, borderTopWidth: 1, borderColor: colors.line },
});
