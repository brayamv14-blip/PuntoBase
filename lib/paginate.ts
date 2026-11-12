/**
 * Supabase devuelve como maximo 1000 filas por consulta. Esta funcion recorre todas las paginas
 * para que los reportes y respaldos no se trunquen en silencio.
 */
export async function fetchAll<T = Record<string, unknown>>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 200_000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return rows;
}
