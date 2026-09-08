import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { colors, spacing, text } from "../theme";
import { Button, IconButton, Status } from "../ui";
import { useBackAction } from "../useBackAction";
import { SafeAreaView } from "react-native-safe-area-context";

export function CaptureScreen({
  onClose,
  onCapture,
}: {
  onClose: () => void;
  onCapture: (uri: string) => Promise<void>;
}) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const busy = useRef(false);
  useBackAction(() => {
    if (busy.current) return true;
    if (preview) setPreview(null);
    else onClose();
    return true;
  });
  async function snap() {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await camera.current?.takePictureAsync({
        quality: 0.9,
        exif: false,
      });
      if (result?.uri) setPreview(result.uri);
    } catch {
      Alert.alert(
        "Не удалось сделать снимок",
        "Проверьте доступ к камере и попробуйте ещё раз.",
      );
    } finally {
      busy.current = false;
    }
  }
  async function pick() {
    if (busy.current) return;
    busy.current = true;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.9,
      });
      if (!result.canceled && result.assets[0]?.uri)
        setPreview(result.assets[0].uri);
    } catch {
      Alert.alert(
        "Не удалось открыть фото",
        "Попробуйте выбрать изображение ещё раз.",
      );
    } finally {
      busy.current = false;
    }
  }
  async function commit() {
    if (!preview || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await onCapture(preview);
      setPreview(null);
    } catch {
      Alert.alert(
        "Снимок сохранён не полностью",
        "Попробуйте повторить сохранение. Фото останется на устройстве, пока вы не закроете этот экран.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  if (!permission)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.lime} />
      </View>
    );
  if (preview)
    return (
      <SafeAreaView style={styles.previewPage}>
        <Image source={{ uri: preview }} style={styles.preview} />
        <View style={styles.previewShade} />
        <View style={styles.previewTop}>
          <IconButton
            name="close"
            label="Отменить"
            onPress={() => {
              if (!busy.current) setPreview(null);
            }}
          />
        </View>
        <View style={styles.previewBottom}>
          <Status tone="lime">Оригинальное фото</Status>
          <Text style={styles.previewTitle}>Сохранить этот предмет?</Text>
          <Text style={styles.previewCopy}>
            Можно указать название и издание сразу после добавления.
          </Text>
          <Button
            label={saving ? "Сохраняем…" : "Добавить в коллекцию"}
            icon="add-circle-outline"
            disabled={saving}
            onPress={commit}
          />
          <Button
            label="Выбрать другое фото"
            tone="quiet"
            onPress={pick}
            disabled={saving}
          />
        </View>
      </SafeAreaView>
    );
  if (!permission.granted)
    return (
      <SafeAreaView style={styles.permission}>
        <Text style={text.eyebrow}>Камера и фото</Text>
        <Text style={text.title}>Добавить предмет</Text>
        <Text style={text.body}>
          Разрешите доступ к камере для съёмки или выберите готовое фото.
        </Text>
        <Button label="Разрешить камеру" onPress={requestPermission} />
        <Button label="Импортировать фото" tone="quiet" onPress={pick} />
        <Button label="Назад" tone="quiet" onPress={onClose} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.page}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.shade} />
      <View style={styles.top}>
        <IconButton name="close" label="Закрыть камеру" onPress={onClose} />
        <View style={styles.guide}>
          <Text style={styles.guideText}>Поместите предмет в рамку</Text>
        </View>
      </View>
      <View style={styles.frame} />
      <View style={styles.bottom}>
        <Text style={styles.cameraHint}>
          Снимок сначала сохранится на телефоне
        </Text>
        <View style={styles.controls}>
          <IconButton
            name="images-outline"
            label="Импортировать фото"
            onPress={pick}
          />
          <View style={styles.shutterWrap}>
            <IconButton
              name="radio-button-on"
              label="Сделать снимок"
              tone="lime"
              onPress={snap}
            />
          </View>
          <View style={styles.balance} />
        </View>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.black },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.canvas,
  },
  permission: {
    flex: 1,
    padding: spacing.xl,
    justifyContent: "center",
    gap: 16,
    backgroundColor: colors.canvas,
  },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,.24)" },
  top: {
    paddingTop: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  guide: {
    backgroundColor: "rgba(0,0,0,.55)",
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 99,
  },
  guideText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  frame: {
    position: "absolute",
    left: "10%",
    right: "10%",
    top: "22%",
    bottom: "29%",
    borderWidth: 1.5,
    borderRadius: 22,
    borderColor: "rgba(217,255,112,.92)",
  },
  bottom: {
    marginTop: "auto",
    paddingHorizontal: 16,
    paddingBottom: 24,
    alignItems: "center",
    gap: 13,
  },
  cameraHint: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
    textShadowColor: "#000",
    textShadowRadius: 5,
  },
  controls: {
    alignSelf: "stretch",
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  shutterWrap: {
    borderRadius: 36,
    padding: 5,
    borderWidth: 2,
    borderColor: colors.ink,
  },
  balance: { width: 48 },
  previewPage: { flex: 1, backgroundColor: colors.canvas },
  preview: {
    ...StyleSheet.absoluteFill,
    width: "100%",
    height: "100%",
    resizeMode: "contain",
  },
  previewShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,.35)",
  },
  previewTop: { paddingTop: 12, paddingHorizontal: 16 },
  previewBottom: {
    marginTop: "auto",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 22,
    gap: 10,
  },
  previewTitle: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  previewCopy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 6,
  },
});
