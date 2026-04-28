import CookieBanner from "./CookieBanner";
import TosConsentModal from "./TosConsentModal";
import SlowRequestBanner from "./SlowRequestBanner";

export function GlobalComponents() {
  return (
    <>
      <CookieBanner />
      <TosConsentModal />
      <SlowRequestBanner />
    </>
  );
}
