/** Setup failures must remain opaque even when their cause resembles a request failure. */
export async function loadDependencies<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (cause) {
    throw new Error("Route dependencies could not be loaded", { cause });
  }
}
