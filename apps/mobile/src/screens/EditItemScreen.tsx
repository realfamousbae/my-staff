import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CollectibleCategory, CollectionItem } from "../models";
import { colors, spacing, text } from "../theme";
import { Button, IconButton, Pill } from "../ui";
import { useBackAction } from "../useBackAction";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Patch = Pick<
  CollectionItem,
  "title" | "editionName" | "category" | "notes"
>;
export function EditItemScreen({
  item,
  onBack,
  onSave,
}: {
  item: CollectionItem;
  onBack: () => void;
  onSave: (patch: Patch) => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title ?? "");
  const [editionName, setEditionName] = useState(item.editionName ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [category, setCategory] = useState<CollectibleCategory>(item.category);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const insets = useSafeAreaInsets();
  const close = () => {
    if (busy.current) return;
    if (
      title !== (item.title ?? "") ||
      editionName !== (item.editionName ?? "") ||
      notes !== (item.notes ?? "") ||
      category !== item.category
    ) {
      Alert.alert(
        "Не сохранять изменения?",
        "Изменения в сведениях будут потеряны.",
        [
          { text: "Продолжить редактирование", style: "cancel" },
          { text: "Не сохранять", style: "destructive", onPress: onBack },
        ],
      );
    } else onBack();
  };
  useBackAction(() => {
    close();
    return true;
  });
  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await onSave({
        title: title.trim() || null,
        editionName: editionName.trim() || null,
        notes: notes.trim() || null,
        category,
      });
      onBack();
    } catch {
      Alert.alert(
        "Не удалось сохранить изменения",
        "Введённые сведения остались на экране. Попробуйте сохранить ещё раз.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={[
        styles.page,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
      behavior={Platform.select({ ios: "padding", default: undefined })}
    >
      <View style={styles.top}>
        <IconButton name="close" label="Закрыть" onPress={close} />
        <Text style={styles.topTitle}>Сведения о предмете</Text>
        <View style={styles.spacer} />
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={text.eyebrow}>Личная карточка</Text>
        <Text style={text.title}>Уточнить находку</Text>
        <Text style={[text.body, styles.intro]}>
          Можно сохранить известные данные сейчас и вернуться к ним после
          проверки предмета.
        </Text>
        <Field
          label="Название"
          value={title}
          onChangeText={setTitle}
          placeholder="Например, название вкуса"
        />
        <Field
          label="Издание или оформление"
          value={editionName}
          onChangeText={setEditionName}
          placeholder="Например, лимитированное оформление"
        />
        <Text style={styles.fieldLabel}>Тип предмета</Text>
        <View style={styles.choices}>
          <Pill
            active={category === "energy"}
            onPress={() => setCategory("energy")}
          >
            Энергетик
          </Pill>
          <Pill
            active={category === "pringles"}
            onPress={() => setCategory("pringles")}
          >
            Pringles
          </Pill>
        </View>
        <Field
          label="Заметка"
          value={notes}
          onChangeText={setNotes}
          placeholder="Страна, место находки или другое"
          multiline
        />
        <View style={styles.proposal}>
          <Text style={text.label}>Каталог</Text>
          <Text style={text.body}>
            Предложение новой позиции будет доступно после подключения
            редакторской проверки каталога.
          </Text>
        </View>
        <Button
          label={saving ? "Сохраняем…" : "Сохранить изменения"}
          icon="checkmark"
          disabled={saving}
          onPress={save}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline]}
        textAlignVertical={multiline ? "top" : "center"}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  top: {
    height: 68,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "space-between",
    flexDirection: "row",
  },
  topTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  spacer: { width: 48 },
  scroll: { padding: 16, paddingTop: 6, paddingBottom: 42 },
  intro: { marginTop: 8, marginBottom: 24 },
  field: { gap: 8, marginBottom: 20 },
  fieldLabel: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  input: {
    minHeight: 52,
    paddingHorizontal: 14,
    color: colors.ink,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    fontSize: 16,
  },
  multiline: { minHeight: 112, paddingTop: 13 },
  choices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 10,
    marginBottom: 22,
  },
  proposal: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 7,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.line,
  },
});
