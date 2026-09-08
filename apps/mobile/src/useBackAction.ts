import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

/** Keep screen-local handling ahead of the app's navigation listener. */
export function useBackAction(action: () => boolean) {
  const current = useRef(action);
  current.current = action;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () =>
      current.current(),
    );
    return () => subscription.remove();
  }, []);
}
