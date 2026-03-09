import { useEffect } from "react";
import { navigate } from "vike/client/router";

export default function RescheduleRedirect() {
  useEffect(() => {
    navigate("/meetings", { overwriteLastHistoryEntry: true });
  }, []);
  return null;
}
