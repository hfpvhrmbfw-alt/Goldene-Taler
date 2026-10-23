// Text aus einem PDF lesen, ganz im Browser. pdf.js liegt in vendor/ und wird erst beim ersten Kontoauszug geladen;
// es geht nichts ins Netz.

let lib;

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<import('./statement.js').PdfPage[]>}
 */
export async function pdfPages(buffer) {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  const doc = await lib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.filter((i) => i.str?.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
    }
    return pages;
  } finally {
    doc.destroy();
  }
}
