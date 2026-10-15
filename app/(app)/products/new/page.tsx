import { redirect } from "next/navigation";
import { getDeviceFromCookies } from "@/lib/auth";
import { ProductForm } from "@/components/products/ProductForm";

export default async function NewProductPage() {
  const device = await getDeviceFromCookies();
  if (!device) redirect("/setup");
  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="font-bold text-xl mb-4">Agregar Producto</h1>
      <ProductForm />
    </div>
  );
}
