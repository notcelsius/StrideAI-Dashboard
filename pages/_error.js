function ErrorPage({ statusCode }) {
  const title = statusCode ? `Request failed with ${statusCode}` : "Something went wrong";

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <p style={styles.eyebrow}>Error</p>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.text}>Refresh the page or return to the dashboard.</p>
        <a href="/dashboard" style={styles.link}>Back to dashboard</a>
      </section>
    </main>
  );
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default ErrorPage;

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "2rem",
    background: "#f2f4f8",
    color: "#0f172a",
    fontFamily: "Avenir Next, Segoe UI, Helvetica Neue, Arial, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "440px",
    display: "grid",
    gap: "0.75rem",
    padding: "2rem",
    border: "1px solid #d9e2ef",
    borderRadius: "14px",
    background: "#fff",
  },
  eyebrow: {
    margin: 0,
    color: "#475569",
    fontSize: "0.75rem",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    fontSize: "1.5rem",
  },
  text: {
    margin: 0,
    color: "#475569",
  },
  link: {
    color: "#1d4ed8",
    fontWeight: 700,
    textDecoration: "none",
  },
};
