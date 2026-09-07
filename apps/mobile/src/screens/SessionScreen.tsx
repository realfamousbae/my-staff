import { StyleSheet, Text, View } from "react-native";
import type { CaptureSession, CollectionItem } from "../models";
import { colors, spacing, text } from "../theme";
import { Button, Card, EmptyState, Status } from "../ui";

export function SessionScreen({
  session,
  items,
  onCapture,
  onNewSession,
  onOpenItem,
}: {
  session?: CaptureSession | null;
  items: CollectionItem[];
  onCapture: () => void;
  onNewSession: () => void;
  onOpenItem: (item: CollectionItem) => void;
}) {
  const recent = session
    ? items.filter((i) => i.sessionId === session.id).slice(0, 3)
    : [];
  return (
    <View style={styles.page}>
      <Text style={text.eyebrow}>Серийное добавление</Text>
      <Text style={[text.title, styles.heading]}>
        {session ? "Текущая серия" : "Добавляйте без пауз"}
      </Text>
      <Card style={styles.hero}>
        <Status tone="lime">
          {session
            ? `${session.itemCount} предметов в серии`
            : "Можно начать в любое время"}
        </Status>
        <Text style={styles.heroTitle}>
          {session
            ? session.title || "Новая серия"
            : "Сначала сохраните первый предмет"}
        </Text>
        <Text style={text.body}>
          {session
            ? "После снимка камера сразу будет готова к следующей банке или тубусу."
            : "Фото сохраняется на телефоне прежде, чем начнётся синхронизация и определение."}
        </Text>
        <Button
          label={session ? "Продолжить съёмку" : "Начать серию"}
          icon="camera-outline"
          onPress={onCapture}
          style={styles.cta}
        />
      </Card>
      <View style={styles.row}>
        <Text style={text.section}>Последние в серии</Text>
        {session && (
          <Button label="Новая" tone="quiet" onPress={onNewSession} />
        )}
      </View>
      {recent.length ? (
        recent.map((item) => (
          <Card key={item.id} style={styles.recent}>
            <View>
              <Text style={text.label}>{item.title || "Без названия"}</Text>
              <Text style={text.body}>
                {item.uploadStatus === "synced"
                  ? "Синхронизировано"
                  : "Сохранено на устройстве"}
              </Text>
            </View>
            <Button
              label="Открыть"
              tone="quiet"
              onPress={() => onOpenItem(item)}
            />
          </Card>
        ))
      ) : (
        <EmptyState
          icon="camera-outline"
          title="Серия пока пуста"
          body="Здесь появятся последние предметы, чтобы можно было быстро проверить результат съёмки."
        />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, padding: spacing.md },
  heading: { marginTop: 4, marginBottom: spacing.lg },
  hero: { padding: spacing.lg, gap: 14 },
  heroTitle: {
    color: colors.ink,
    fontSize: 23,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  cta: { marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 28,
    marginBottom: 8,
  },
  recent: {
    padding: 14,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
