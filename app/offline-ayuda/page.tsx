
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        textAlign: "center",
        fontFamily: "Arial, sans-serif",
        background: "#EFE6DD",
        color: "#292524",
      }}
    >
      <h1 style={{ color: "#E4572E" }}>PuntoBase</h1>

      <h2>Sin conexión a internet</h2>

      <p>
        No se pudo cargar esta pantalla. Comprueba tu conexión
        e inténtalo nuevamente.
      </p>

      <p>
        Cuando recuperes internet, vuelve a abrir PuntoBase.
      </p>

      <p>
        Las pantallas que ya abriste antes siguen disponibles sin conexión:{" "}
        <a href="/pos" style={{ color: "#E4572E", fontWeight: 700 }}>ir a Vender</a>.
      </p>
    </main>
  );
}
