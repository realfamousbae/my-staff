import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, text } from "../theme";
import { Button, IconButton, Pill } from "../ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function AuthScreen({
  onBack,
  onLogin,
  onRegister,
}: {
  onBack: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await (mode === "login"
        ? onLogin(email.trim(), password)
        : onRegister(email.trim(), password));
      onBack();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось подключиться к серверу",
      );
    } finally {
      setBusy(false);
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
        <IconButton name="close" label="Закрыть" onPress={onBack} />
      </View>
      <View style={styles.body}>
        <Text style={text.eyebrow}>Синхронизация</Text>
        <Text style={text.title}>
          {mode === "login" ? "Войти в коллекцию" : "Создать аккаунт"}
        </Text>
        <Text style={[text.body, styles.copy]}>
          Аккаунт связывает сохранённые предметы с серверной копией и не
          заменяет локальные оригиналы.
        </Text>
        <View style={styles.switcher}>
          <Pill active={mode === "login"} onPress={() => setMode("login")}>
            Войти
          </Pill>
          <Pill
            active={mode === "register"}
            onPress={() => setMode("register")}
          >
            Регистрация
          </Pill>
        </View>
        <TextInput
          accessibilityLabel="Электронная почта"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="Электронная почта"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="Пароль"
          autoCapitalize="none"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="Пароль"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Button
          label={
            busy
              ? "Подключаем…"
              : mode === "login"
                ? "Войти"
                : "Создать аккаунт"
          }
          disabled={busy || !email.trim() || !password}
          onPress={submit}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  top: { height: 68, paddingHorizontal: 16, justifyContent: "center" },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 13 },
  copy: { marginBottom: 8 },
  switcher: { flexDirection: "row", gap: 8, marginBottom: 8 },
  input: {
    height: 52,
    color: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
