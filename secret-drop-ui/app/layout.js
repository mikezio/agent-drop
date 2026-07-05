import "./globals.css";

export const metadata = {
  title: "Agent Drop",
  description: "Two-way file bridge for humans and Agent.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
