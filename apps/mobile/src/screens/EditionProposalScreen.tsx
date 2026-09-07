import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CollectibleCategory } from "../models";
import { colors, text } from "../theme";
import { Button, IconButton } from "../ui";

export function EditionProposalScreen({
  category,
  onBack,
  onSubmit,
}: {
  category: CollectibleCategory;
  onBack: () => void;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [flavor, setFlavor] = useState("");
  const [market, setMarket] = useState("");
  const [quantity, setQuantity] = useState("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        category,
        brand,
        name,
        flavor: flavor || null,
        market: market || null,
        quantity: quantity || null,
        line: null,
        manufacturedIn: null,
        design: null,
        series: null,
        barcodes: [],
        evidence,
      });
      onBack();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось отправить предложение",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.select({ ios: "padding", default: undefined })}
    >
      <View style={styles.top}>
        <IconButton name="chevron-back" label="Назад" onPress={onBack} />
        <Text style={styles.topTitle}>Новое издание</Text>
        <View style={styles.space} />
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={text.eyebrow}>Предложение каталогу</Text>
        <Text style={text.title}>Что написано на упаковке?</Text>
        <Text style={[text.body, styles.copy]}>
          Сведения отправятся на редакторскую проверку и не станут
          подтверждённым каталогом автоматически.
        </Text>
        <Field label="Бренд" value={brand} onChangeText={setBrand} required />
        <Field label="Название" value={name} onChangeText={setName} required />
        <Field label="Вкус" value={flavor} onChangeText={setFlavor} />
        <Field
          label="Рынок или страна продажи"
          value={market}
          onChangeText={setMarket}
        />
        <Field
          label="Объём или масса"
          value={quantity}
          onChangeText={setQuantity}
        />
        <Field
          label="Что подтверждает отличие издания"
          value={evidence}
          onChangeText={setEvidence}
          multiline
        />
        <Text style={styles.note}>
          Текст исходной упаковки и ваши фотографии помогут редактору отличить
          похожие варианты. Не указывайте предположения как подтверждённые
          факты.
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <Button
          label={busy ? "Отправляем…" : "Отправить на проверку"}
          icon="send-outline"
          disabled={busy || !brand.trim() || !name.trim()}
          onPress={() => void submit()}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  required = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? " *" : ""}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        style={[styles.input, multiline && styles.multiline]}
        multiline={multiline}
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
  topTitle: { color: colors.ink, fontWeight: "700", fontSize: 16 },
  space: { width: 48 },
  content: { padding: 16, paddingBottom: 42 },
  copy: { marginTop: 8, marginBottom: 24 },
  field: { marginBottom: 16, gap: 8 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingHorizontal: 13,
    fontSize: 16,
  },
  multiline: { height: 112, paddingTop: 13 },
  note: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 18 },
  error: { color: colors.danger, fontSize: 14, marginBottom: 14 },
});
