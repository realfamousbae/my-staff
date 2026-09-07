import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, text } from "../theme";
import { Button, Card, Icon, Status } from "../ui";

export function SettingsScreen({
  online,
  accountEmail,
  onAuth,
  onLogout,
  onServerUrl,
  onExport,
  onImport,
  onRestoreOriginals,
  onDeleted,
}: {
  online: boolean;
  accountEmail: string | null;
  onAuth: () => void;
  onLogout: () => Promise<void>;
  onServerUrl: (url: string) => Promise<void>;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onRestoreOriginals: () => Promise<number>;
  onDeleted: () => void;
}) {
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [backupAction, setBackupAction] = useState<"export" | "import" | null>(
    null,
  );
  async function saveUrl() {
    await onServerUrl(url);
    setSaved(true);
  }
  async function restore() {
    setRestoring(true);
    try {
      const count = await onRestoreOriginals();
      Alert.alert(
        "Восстановление завершено",
        count
          ? `Возвращено файлов: ${count}.`
          : "Все доступные оригиналы уже есть на устройстве.",
      );
    } catch (reason) {
      Alert.alert(
        "Не удалось восстановить",
        reason instanceof Error
          ? reason.message
          : "Проверьте подключение и повторите.",
      );
    } finally {
      setRestoring(false);
    }
  }
  async function backup(action: "export" | "import") {
    setBackupAction(action);
    try {
      await (action === "export" ? onExport() : onImport());
    } catch (reason) {
      Alert.alert(
        action === "export"
          ? "Не удалось экспортировать"
          : "Не удалось импортировать",
        reason instanceof Error
          ? reason.message
          : "Проверьте доступ к файлам и попробуйте ещё раз.",
      );
    } finally {
      setBackupAction(null);
    }
  }
  const logout = () =>
    Alert.alert(
      "Выйти из аккаунта?",
      "Локальные карточки и оригиналы останутся на этом телефоне.",
      [
        { text: "Отмена", style: "cancel" },
        { text: "Выйти", style: "destructive", onPress: () => void onLogout() },
      ],
    );
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={text.eyebrow}>Приложение</Text>
      <Text style={text.title}>Настройки</Text>
      <Card style={styles.sync}>
        <View>
          <Text style={text.label}>Состояние коллекции</Text>
          <Status tone={online ? "lime" : "muted"}>
            {online ? "Подключено к синхронизации" : "Работаем локально"}
          </Status>
        </View>
        <Icon
          name={online ? "cloud-done-outline" : "phone-portrait-outline"}
          color={colors.lime}
          size={29}
        />
      </Card>
      <Section title="Подключение">
        <Text style={text.body}>
          Укажите доступный для телефона адрес сервера перед входом.
        </Text>
        <TextInput
          accessibilityLabel="Адрес сервера"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          keyboardType="url"
          placeholder="https://server.example"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <Button
          label={saved ? "Адрес сохранён" : "Сохранить адрес"}
          tone="quiet"
          disabled={!url.trim()}
          onPress={() => void saveUrl()}
        />
      </Section>
      <Section title="Аккаунт">
        <Text style={text.body}>
          {online
            ? `Подключён: ${accountEmail}`
            : "Войдите, чтобы синхронизировать подтверждённые предметы с сервером."}
        </Text>
        <Button
          label={online ? "Выйти из аккаунта" : "Войти или создать аккаунт"}
          icon={online ? "log-out-outline" : "person-outline"}
          tone="quiet"
          onPress={online ? logout : onAuth}
        />
      </Section>
      <Section title="Резервная копия">
        <Text style={text.body}>
          Экспорт создаёт ZIP-копию коллекции и исходных снимков. Импорт
          добавляет совместимый ZIP без удаления существующих карточек.
        </Text>
        <Button
          label={
            backupAction === "export" ? "Экспортируем…" : "Экспортировать ZIP"
          }
          icon="download-outline"
          tone="quiet"
          disabled={backupAction !== null}
          onPress={() => void backup("export")}
        />
        <Button
          label={
            backupAction === "import" ? "Импортируем…" : "Восстановить из ZIP"
          }
          icon="cloud-upload-outline"
          tone="quiet"
          disabled={backupAction !== null}
          onPress={() => void backup("import")}
        />
        {online && (
          <Button
            label={
              restoring ? "Восстанавливаем…" : "Загрузить оригиналы с сервера"
            }
            icon="images-outline"
            tone="quiet"
            disabled={restoring}
            onPress={() => void restore()}
          />
        )}
      </Section>
      <Section title="Хранилище">
        <Button
          label="Удалённые предметы"
          icon="trash-bin-outline"
          tone="quiet"
          onPress={onDeleted}
        />
      </Section>
      <View style={styles.privacy}>
        <Icon name="lock-closed-outline" color={colors.muted} />
        <Text style={styles.privacyText}>
          Исходные фотографии остаются частью личной коллекции. Передача на
          сервер и обработка отражаются в состоянии конкретной карточки.
        </Text>
      </View>
    </ScrollView>
  );
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={text.section}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 16, paddingBottom: 110 },
  sync: {
    padding: 16,
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  section: { gap: 13, paddingTop: 31 },
  sectionContent: { gap: 12 },
  input: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    fontSize: 15,
  },
  privacy: {
    flexDirection: "row",
    gap: 11,
    padding: 16,
    marginTop: 28,
    borderTopWidth: 1,
    borderColor: colors.line,
  },
  privacyText: { color: colors.muted, fontSize: 13, lineHeight: 19, flex: 1 },
});
