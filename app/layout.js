import "@/app/globals.css";

export const metadata = {
  title: "StrideAI Dashboard Demo",
  description: "Demo dashboard for PI login, projects, and subjects."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
