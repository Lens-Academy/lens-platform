"use client";

import { Suspense } from "react";
import Auth from "@/views/Auth";

function AuthContent() {
  return <Auth />;
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <AuthContent />
    </Suspense>
  );
}
