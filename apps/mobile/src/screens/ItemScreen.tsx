import { useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import {
  Animated,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { CollectionItem } from "../models";
import { colors, radius, spacing, text } from "../theme";
import { Button, Icon, IconButton, Status } from "../ui";

export function ItemScreen({
  item,
  onBack,
  onEdit,
  onCatalog,
  onRetry,
  onAttach,
  onDelete,
}: {
  item: CollectionItem;
  onBack: () => void;
  onEdit: () => void;
  onCatalog: () => void;
  onRetry: () => void;
  onAttach: (uri: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const animation = useRef(new Animated.Value(0)).current;
  const [back, setBack] = useState(false);
  const flip = () => {
    Animated.spring(animation, {
      toValue: back ? 0 : 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
    setBack((value) => !value);
  };
  const front = {
    transform: [
      { perspective: 1100 },
      {
        rotateY: animation.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", "180deg"],
        }),
      },
    ],
  };
  const rear = {
    transform: [
      { perspective: 1100 },
      {
        rotateY: animation.interpolate({
          inputRange: [0, 1],
          outputRange: ["180deg", "360deg"],
        }),
      },
    ],
  };
  const addAngle = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!picked.canceled && picked.assets[0]?.uri)
      await onAttach(picked.assets[0].uri);
  };
  const remove = () =>
    Alert.alert(
      "Убрать предмет из коллекции?",
      "Карточку можно будет восстановить из удалённых предметов после синхронизации.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Убрать",
          style: "destructive",
          onPress: () => void onDelete(),
        },
      ],
    );
  const name = item.title || item.editionName || "Без названия";
  const status =
    item.uploadStatus === "attention"
      ? (["Нужно действие", "danger"] as const)
      : item.uploadStatus === "synced"
        ? (["Синхронизировано", "lime"] as const)
        : (["Сохранено на устройстве", "muted"] as const);
  return (
    <View style={styles.page}>
      <View style={styles.top}>
        <IconButton name="chevron-back" label="Назад" onPress={onBack} />
        <Text style={styles.topTitle}>Карточка</Text>
        <IconButton
          name="create-outline"
          label="Изменить сведения"
          onPress={onEdit}
        />
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.cardArea}>
          <Animated.View style={[styles.card, styles.front, front]}>
            <Art item={item} />
            <View style={styles.frontInk}>
              <Text style={styles.category}>
                {item.category === "pringles" ? "PRINGLES" : "ЭНЕРГЕТИК"}
              </Text>
              <Text numberOfLines={2} style={styles.cardName}>
                {name}
              </Text>
              {item.editionName && (
                <Text numberOfLines={1} style={styles.cardEdition}>
                  {item.editionName}
                </Text>
              )}
            </View>
          </Animated.View>
          <Animated.View style={[styles.card, styles.back, rear]}>
            <Text style={styles.backLabel}>ОРИГИНАЛЬНОЕ ФОТО</Text>
            <Art item={item} contain original />
            <Text style={styles.date}>
              Добавлено{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }).format(new Date(item.addedAt))}
            </Text>
          </Animated.View>
        </View>
        <Button
          label={back ? "Показать лицевую сторону" : "Перевернуть карточку"}
          icon="sync-outline"
          tone="quiet"
          onPress={flip}
        />
        <View style={styles.info}>
          <Status tone={status[1]}>
            {item.artworkStatus === "processing"
              ? "Оформляем карточку"
              : status[0]}
          </Status>
          <Button
            label={
              item.editionName
                ? "Изменить издание каталога"
                : "Связать с каталогом"
            }
            icon="albums-outline"
            tone="quiet"
            onPress={onCatalog}
          />
          <Button
            label="Добавить дополнительный ракурс"
            icon="images-outline"
            tone="quiet"
            onPress={() => void addAngle()}
          />
          <Text style={text.section}>Сведения</Text>
          <Fact
            label="Тип"
            value={
              item.category === "pringles"
                ? "Тубус Pringles"
                : "Банка энергетика"
            }
          />
          <Fact
            label="Издание каталога"
            value={item.editionName || "Не связано"}
          />
          <Fact label="Заметка" value={item.notes || "Нет заметки"} />
          {item.uploadStatus === "attention" && (
            <Button
              label="Повторить синхронизацию"
              icon="refresh-outline"
              tone="danger"
              onPress={onRetry}
            />
          )}
          <Button
            label="Убрать из коллекции"
            icon="trash-outline"
            tone="danger"
            onPress={remove}
          />
        </View>
      </ScrollView>
    </View>
  );
}
function Art({
  item,
  contain = false,
  original = false,
}: {
  item: CollectionItem;
  contain?: boolean;
  original?: boolean;
}) {
  const uri = original ? item.photoUri : (item.artworkUri ?? item.photoUri);
  return (
    <View style={styles.art}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.artImage, contain && styles.contain]}
        />
      ) : (
        <View style={styles.artEmpty}>
          <Icon
            name={
              item.category === "pringles"
                ? "nutrition-outline"
                : "wine-outline"
            }
            size={48}
            color={colors.muted}
          />
          <Text style={styles.emptyText}>Оригинальное фото недоступно</Text>
        </View>
      )}
    </View>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
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
  scroll: { paddingHorizontal: 16, paddingBottom: 42 },
  cardArea: { height: 462, marginBottom: 16 },
  card: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: radius.lg,
    overflow: "hidden",
    backfaceVisibility: "hidden",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  front: {},
  back: { padding: 18 },
  art: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  artImage: { width: "100%", height: "100%", resizeMode: "cover" },
  contain: { resizeMode: "contain" },
  artEmpty: { alignItems: "center", gap: 10 },
  emptyText: { color: colors.muted, fontSize: 13 },
  frontInk: { padding: 18, backgroundColor: colors.paper },
  category: {
    color: "#586227",
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "800",
  },
  cardName: {
    color: colors.black,
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 4,
  },
  cardEdition: { color: "#4C5148", fontSize: 14, marginTop: 5 },
  backLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: 12,
  },
  date: { color: colors.muted, fontSize: 12, marginTop: 12 },
  info: { paddingTop: 26, gap: 12 },
  fact: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.line,
    gap: 3,
  },
  factLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  factValue: { color: colors.ink, fontSize: 16, lineHeight: 22 },
});
