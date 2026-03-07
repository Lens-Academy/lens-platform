/**
 * useRoleplayToggles - Three independent toggle states with localStorage persistence.
 *
 * Manages text display, TTS enabled, and input mode settings for a roleplay
 * conversation. All combinations are valid -- these are independent settings.
 *
 * Defaults: text display OFF, TTS ON, voice input mode.
 * Persisted in localStorage keyed by roleplay_id to survive page refresh.
 */

import { useState, useEffect, useCallback } from "react";

export type InputMode = "text" | "voice";

interface ToggleState {
  textDisplay: boolean;
  ttsEnabled: boolean;
  inputMode: InputMode;
}

export interface UseRoleplayTogglesReturn {
  textDisplay: boolean;
  ttsEnabled: boolean;
  inputMode: InputMode;
  toggleTextDisplay: () => void;
  toggleTTS: () => void;
  toggleInputMode: () => void;
}

const STORAGE_KEY_PREFIX = "roleplay-toggles-";

const DEFAULT_STATE: ToggleState = {
  textDisplay: false,
  ttsEnabled: true,
  inputMode: "voice",
};

export function useRoleplayToggles(
  roleplayId: string,
): UseRoleplayTogglesReturn {
  const storageKey = `${STORAGE_KEY_PREFIX}${roleplayId}`;

  const [state, setState] = useState<ToggleState>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ToggleState>;
        // Merge with defaults to handle missing keys from older versions
        return { ...DEFAULT_STATE, ...parsed };
      }
    } catch {
      // Invalid JSON or localStorage unavailable -- use defaults
    }
    return { ...DEFAULT_STATE };
  });

  // Persist to localStorage on every state change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // localStorage full or unavailable -- ignore
    }
  }, [state, storageKey]);

  const toggleTextDisplay = useCallback(() => {
    setState((s) => ({ ...s, textDisplay: !s.textDisplay }));
  }, []);

  const toggleTTS = useCallback(() => {
    setState((s) => ({ ...s, ttsEnabled: !s.ttsEnabled }));
  }, []);

  const toggleInputMode = useCallback(() => {
    setState((s) => ({
      ...s,
      inputMode: s.inputMode === "text" ? "voice" : "text",
    }));
  }, []);

  return {
    textDisplay: state.textDisplay,
    ttsEnabled: state.ttsEnabled,
    inputMode: state.inputMode,
    toggleTextDisplay,
    toggleTTS,
    toggleInputMode,
  };
}
