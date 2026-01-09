export const optimizeExcelExport = async (rows: any[], ExcelJS: any, saveAs: any) => {
  if (rows.length > 10000) {
    const confirm = window.confirm(
      `⚠️ Exporting ${rows.length} rows. This will take 1-2 minutes. Continue?`
    );
    if (!confirm) return false;
  }

  return true;
};

export const addProgressIndicator = () => {
  const div = document.createElement('div');
  div.id = 'export-progress';
  div.className = 'fixed top-4 right-4 bg-blue-600 text-white px-6 py-4 rounded-lg shadow-2xl z-50 flex items-center gap-3';
  div.innerHTML = `
    <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
    <span class="font-semibold">Exporting... Please wait</span>
  `;
  document.body.appendChild(div);
  return div;
};

export const removeProgressIndicator = (div: HTMLElement) => {
  div.remove();
};
