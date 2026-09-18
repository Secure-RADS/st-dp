import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SiteHeader } from "@/components/site-header";
import { AuthorityPage } from "@/pages/authority-page";
import { HomePage } from "@/pages/home";
import { SubjectPage } from "@/pages/subject-page";

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-dvh bg-background text-foreground">
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-8">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/subject" element={<SubjectPage />} />
            <Route path="/authority" element={<AuthorityPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
