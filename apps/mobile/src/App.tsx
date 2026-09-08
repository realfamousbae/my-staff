import { useEffect, useMemo, useReducer, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Sharing from "expo-sharing";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { getDataLayer, type DataSnapshot } from "./data";
import type { CollectibleCategory, CollectionItem } from "./models";
import { CaptureScreen } from "./screens/CaptureScreen";
import { EditItemScreen } from "./screens/EditItemScreen";
import { ItemScreen } from "./screens/ItemScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { SessionScreen } from "./screens/SessionScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { CatalogPickerScreen } from "./screens/CatalogPickerScreen";
import { EditionProposalScreen } from "./screens/EditionProposalScreen";
import { DeletedScreen } from "./screens/DeletedScreen";
import { colors, spacing } from "./theme";
import { Button, Icon, IconButton } from "./ui";
import { navigate, type Screen } from "./navigation";
import { useBackAction } from "./useBackAction";
const layer = getDataLayer();
const initial: DataSnapshot = {
  ready: false,
  items: [],
  activeSession: null,
  auth: null,
};

function Shell() {
  const [snapshot, setSnapshot] = useState<DataSnapshot>(initial);
  const [history, dispatch] = useReducer(navigate, ["library"]);
  const screen = history[history.length - 1];
  const setScreen = (screen: Screen) => dispatch({ type: "open", screen });
  const goBack = () => dispatch({ type: "back" });
  useBackAction(() => {
    if (history.length === 1) return false;
    goBack();
    return true;
  });
  const [selected, setSelected] = useState<CollectionItem | null>(null);
  const [deleted, setDeleted] = useState<CollectionItem[]>([]);
  const [captureCategory, setCaptureCategory] =
    useState<CollectibleCategory>("energy");
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const initialize = () =>
    void layer
      .initialize()
      .then(() => layer.snapshot())
      .then((value) => {
        setSnapshot(value);
        setInitializationError(null);
      })
      .catch((reason) =>
        setInitializationError(
          reason instanceof Error
            ? reason.message
            : "Не удалось открыть локальную коллекцию",
        ),
      );
  useEffect(() => {
    let mounted = true;
    const update = () =>
      void layer
        .snapshot()
        .then((value) => mounted && setSnapshot(value))
        .catch(
          (reason) =>
            mounted &&
            setInitializationError(
              reason instanceof Error
                ? reason.message
                : "Не удалось обновить коллекцию",
            ),
        );
    initialize();
    const unsubscribe = layer.subscribe(update);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!snapshot.auth) return;
    const refresh = () => void layer.refresh().catch(() => undefined);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    const interval = setInterval(refresh, 15_000);
    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, [snapshot.auth]);
  useEffect(() => {
    if (screen === "deleted") void layer.deletedItems().then(setDeleted);
  }, [screen]);
  const filtered = useMemo(
    () => (filter: Parameters<typeof layer.filtered>[0]) =>
      snapshot.items.filter((item) => {
        const q = filter.query?.trim().toLocaleLowerCase() ?? "";
        return (
          (!filter.category ||
            filter.category === "all" ||
            item.category === filter.category) &&
          (!q ||
            `${item.title ?? ""} ${item.editionName ?? ""} ${item.notes ?? ""}`
              .toLocaleLowerCase()
              .includes(q))
        );
      }),
    [snapshot.items],
  );
  const open = (item: CollectionItem) => {
    setSelected(item);
    setScreen("item");
  };
  const goAdd = () => setScreen("choose-category");
  async function savePhoto(uri: string) {
    const item = await layer.capturePhoto(
      uri,
      captureCategory,
      snapshot.activeSession?.id,
    );
    setSelected(item);
    dispatch({ type: "captured" });
  }
  if (initializationError)
    return (
      <View style={styles.loading}>
        <Text style={styles.errorTitle}>Коллекция не открылась</Text>
        <Text style={styles.loadingText}>{initializationError}</Text>
        <Button label="Повторить" onPress={initialize} />
      </View>
    );
  if (!snapshot.ready)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.lime} />
        <Text style={styles.loadingText}>Открываем коллекцию…</Text>
      </View>
    );
  if (screen === "choose-category")
    return (
      <CategoryChoice
        onBack={goBack}
        onSelect={(category) => {
          setCaptureCategory(category);
          setScreen("capture");
        }}
      />
    );
  if (screen === "capture")
    return <CaptureScreen onClose={goBack} onCapture={savePhoto} />;
  if (screen === "auth")
    return (
      <AuthScreen
        onBack={goBack}
        onLogin={(email, password) => layer.login(email, password)}
        onRegister={(email, password) => layer.register(email, password)}
      />
    );
  if (screen === "item" && selected)
    return (
      <ItemScreen
        item={snapshot.items.find((x) => x.id === selected.id) ?? selected}
        onBack={goBack}
        onEdit={() => setScreen("edit")}
        onCatalog={() => setScreen("catalog")}
        onRetry={() => void layer.retry(selected.id)}
        onAttach={(uri: string) => layer.attachPhoto(selected.id, uri)}
        onDelete={async () => {
          await layer.deleteItem(selected.id);
          setScreen("library");
        }}
      />
    );
  if (screen === "catalog" && selected)
    return (
      <CatalogPickerScreen
        category={selected.category}
        currentId={selected.editionId}
        load={(query, category) => layer.searchCatalog(query, category)}
        onPick={async (editionId) => {
          await layer.linkEdition(selected.id, editionId);
          goBack();
        }}
        onPropose={() => setScreen("proposal")}
        onBack={goBack}
      />
    );
  if (screen === "proposal" && selected)
    return (
      <EditionProposalScreen
        category={selected.category}
        onBack={goBack}
        onSubmit={(input) => layer.proposeEdition(input)}
      />
    );
  if (screen === "deleted")
    return (
      <DeletedScreen
        items={deleted}
        onBack={goBack}
        onRestore={async (itemId) => {
          await layer.restoreItem(itemId);
          setDeleted((items) => items.filter((item) => item.id !== itemId));
          await layer.refresh();
        }}
      />
    );
  if (screen === "edit" && selected)
    return (
      <EditItemScreen
        item={snapshot.items.find((x) => x.id === selected.id) ?? selected}
        onBack={goBack}
        onSave={(patch) => layer.updateItem(selected.id, patch)}
      />
    );
  if (screen === "session")
    return (
      <MainFrame active="session" onChange={setScreen}>
        <SessionScreen
          session={snapshot.activeSession}
          items={snapshot.items}
          onCapture={goAdd}
          onNewSession={() => void layer.createSession("Новая серия")}
          onOpenItem={open}
        />
      </MainFrame>
    );
  if (screen === "settings")
    return (
      <MainFrame active="settings" onChange={setScreen}>
        <SettingsScreen
          online={Boolean(snapshot.auth)}
          accountEmail={snapshot.auth?.user.email ?? null}
          onAuth={() => setScreen("auth")}
          onLogout={async () => {
            await layer.logout();
            await layer.snapshot().then(setSnapshot);
          }}
          onServerUrl={(url) => layer.setApiUrl(url)}
          onExport={async () => {
            const uri = await layer.exportCollection();
            if (uri && (await Sharing.isAvailableAsync()))
              await Sharing.shareAsync(uri);
          }}
          onImport={async () => {
            await layer.importCollection();
            await layer.refresh();
          }}
          onRestoreOriginals={() => layer.restoreOriginals()}
          onDeleted={() => setScreen("deleted")}
        />
      </MainFrame>
    );
  return (
    <MainFrame active="library" onChange={setScreen}>
      <LibraryScreen
        items={snapshot.items}
        filterItems={filtered}
        onAdd={goAdd}
        onOpen={open}
      />
    </MainFrame>
  );
}
function MainFrame({
  active,
  onChange,
  children,
}: {
  active: "library" | "session" | "settings";
  onChange: (screen: Screen) => void;
  children: React.ReactNode;
}) {
  return (
    <SafeAreaView style={styles.frame}>
      <View style={styles.content}>{children}</View>
      <View style={styles.tabbar}>
        <Tab
          label="Коллекция"
          icon="albums-outline"
          active={active === "library"}
          onPress={() => onChange("library")}
        />
        <Tab
          label="Серии"
          icon="camera-outline"
          active={active === "session"}
          onPress={() => onChange("session")}
        />
        <Tab
          label="Настройки"
          icon="options-outline"
          active={active === "settings"}
          onPress={() => onChange("settings")}
        />
      </View>
    </SafeAreaView>
  );
}
function Tab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: "albums-outline" | "camera-outline" | "options-outline";
  active: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.tab}>
      <IconButton
        name={icon}
        label={label}
        tone={active ? "lime" : "dark"}
        onPress={onPress}
      />
      <Text style={[styles.tabText, active && styles.tabActive]}>{label}</Text>
    </View>
  );
}
function CategoryChoice({
  onBack,
  onSelect,
}: {
  onBack: () => void;
  onSelect: (category: CollectibleCategory) => void;
}) {
  return (
    <SafeAreaView style={styles.choicePage}>
      <View style={styles.choiceTop}>
        <IconButton name="close" label="Закрыть" onPress={onBack} />
      </View>
      <View style={styles.choiceBody}>
        <Text style={styles.choiceEyebrow}>Перед съёмкой</Text>
        <Text style={styles.choiceTitle}>Что добавляем?</Text>
        <Text style={styles.choiceCopy}>
          Тип нужен сразу, чтобы коллекция была аккуратно разделена. Издание
          можно уточнить после снимка.
        </Text>
        <Button
          label="Банка энергетика"
          icon="wine-outline"
          onPress={() => onSelect("energy")}
        />
        <Button
          label="Тубус Pringles"
          icon="nutrition-outline"
          tone="quiet"
          onPress={() => onSelect("pringles")}
        />
      </View>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Shell />
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 28,
    backgroundColor: colors.canvas,
  },
  errorTitle: { color: colors.ink, fontSize: 24, fontWeight: "800" },
  loadingText: { color: colors.muted, fontSize: 15, textAlign: "center" },
  frame: { flex: 1, backgroundColor: colors.canvas },
  content: { flex: 1 },
  tabbar: {
    minHeight: 78,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: "rgba(16,18,16,.98)",
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 8,
  },
  tab: { alignItems: "center", gap: 2, minWidth: 78 },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  tabActive: { color: colors.lime },
  choicePage: { flex: 1, backgroundColor: colors.canvas },
  choiceTop: { height: 68, paddingHorizontal: 16, justifyContent: "center" },
  choiceBody: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: "center",
    gap: 15,
  },
  choiceEyebrow: {
    color: colors.lime,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  choiceTitle: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  choiceCopy: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 15,
  },
});
