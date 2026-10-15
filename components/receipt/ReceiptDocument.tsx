"use client";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Sale } from "@/types";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, padding: 16, width: 226 }, // ~80 mm
  center: { textAlign: "center" },
  bold: { fontFamily: "Helvetica-Bold" },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#000", marginVertical: 4 },
  total: { fontSize: 11, fontFamily: "Helvetica-Bold" },
});

export function ReceiptDocument({ sale, storeName }: { sale: Sale & { items: { description: string; qty: number; unit_price: number; line_total: number }[] }; storeName: string }) {
  const subtotal = Number(sale.subtotal);
  const discountAmount = sale.discount_type === "flat"
    ? Number(sale.discount_value)
    : sale.discount_type === "percent"
    ? (subtotal * Number(sale.discount_value)) / 100
    : 0;

  return (
    <Document>
      <Page size={[226, 1000]} style={styles.page} wrap={false}>
        <Text style={[styles.bold, styles.center, { fontSize: 12, marginBottom: 2 }]}>{storeName}</Text>
        <Text style={[styles.center, { marginBottom: 6 }]}>{formatDateTime(sale.created_at)}</Text>

        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.bold}>Ticket n.º</Text>
          <Text>{sale.sale_number}</Text>
        </View>
        {sale.device && (
          <View style={styles.row}>
            <Text>Cajero</Text>
            <Text>{(sale.device as { name: string }).name}</Text>
          </View>
        )}
        {sale.customer && (
          <View style={styles.row}>
            <Text>Cliente</Text>
            <Text>{(sale.customer as { name: string }).name}</Text>
          </View>
        )}
        <View style={styles.divider} />

        {sale.items?.map((item, i) => (
          <View key={i} style={{ marginBottom: 3 }}>
            <Text style={styles.bold}>{item.description}</Text>
            <View style={styles.row}>
              <Text>{item.qty} × {formatCurrency(Number(item.unit_price))}</Text>
              <Text>{formatCurrency(Number(item.line_total))}</Text>
            </View>
          </View>
        ))}

        <View style={styles.divider} />
        <View style={styles.row}>
          <Text>Subtotal</Text>
          <Text>{formatCurrency(subtotal)}</Text>
        </View>
        {discountAmount > 0 && (
          <View style={styles.row}>
            <Text>Descuento{sale.discount_type === "percent" ? ` (${sale.discount_value}%)` : ""}</Text>
            <Text>-{formatCurrency(discountAmount)}</Text>
          </View>
        )}
        <View style={[styles.row, { marginTop: 4 }]}>
          <Text style={styles.total}>TOTAL</Text>
          <Text style={styles.total}>{formatCurrency(Number(sale.total))}</Text>
        </View>
        <View style={styles.row}>
          <Text>Forma de pago</Text>
          <Text>{sale.payment_method === "cash" ? "Efectivo" : "Transferencia bancaria"}</Text>
        </View>
        <View style={styles.divider} />
        <Text style={styles.center}>¡Gracias por tu compra!</Text>
      </Page>
    </Document>
  );
}
