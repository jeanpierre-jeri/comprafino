export function downloadShoppingList(document: string, filename: string) {
  const url = URL.createObjectURL(new Blob([document], { type: "application/json" }));
  try {
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
