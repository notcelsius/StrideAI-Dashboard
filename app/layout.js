import "@/app/globals.css";

export const metadata = {
  title: "StrideAI Dashboard",
  description: "PI dashboard with Cognito authentication and subject travel monitoring."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
