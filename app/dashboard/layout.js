import { Suspense } from "react";
import StudyProvider from "@/app/dashboard/StudyProvider";
import DashboardShell from "@/app/dashboard/DashboardShell";

export default function DashboardLayout({ children }) {
  return (
    <Suspense
      fallback={
        <main className="centered-page">
          <p>Loading...</p>
        </main>
      }
    >
      <StudyProvider>
        <DashboardShell>{children}</DashboardShell>
      </StudyProvider>
    </Suspense>
  );
}
