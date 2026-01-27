// Lazy load heavy libraries only when needed

export const loadExcelJS = async () => {
  const [excelModule, { saveAs }] = await Promise.all([
    import('exceljs/dist/exceljs.min.js'),
    import('file-saver'),
  ]);
  return { ExcelJS: (excelModule as any).default || excelModule, saveAs };
};

export const loadPDFLibs = async () => {
  const [jsPDF, autoTable] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  return { jsPDF: jsPDF.default, autoTable: autoTable.default };
};

export const loadChartJS = async () => {
  const { Chart } = await import('chart.js/auto');
  return Chart;
};
