import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const exportLargePDF = async (rows: any[], title: string, headers: string[]) => {
  if (rows.length === 0) {
    alert('No data to export');
    return;
  }

  if (rows.length > 5000) {
    const confirm = window.confirm(
      `⚠️ You are exporting ${rows.length} rows. This may take 30-60 seconds. Continue?`
    );
    if (!confirm) return;
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  
  const CHUNK_SIZE = 1000;
  const chunks = [];
  
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE));
  }

  let isFirstPage = true;

  for (const chunk of chunks) {
    if (!isFirstPage) {
      doc.addPage();
    }

    const body = chunk.map(row => 
      headers.map(h => String(row[h] || ''))
    );

    autoTable(doc, {
      head: isFirstPage ? [headers] : undefined,
      body: body,
      startY: isFirstPage ? 40 : 20,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [59, 130, 246], fontSize: 9 },
      margin: { top: 20, left: 20, right: 20 },
      didDrawPage: (data: any) => {
        if (isFirstPage) {
          doc.setFontSize(16);
          doc.text(title, 40, 30);
        }
      }
    });

    isFirstPage = false;
  }

  doc.save(`${title.toLowerCase().replace(/\s+/g, '-')}.pdf`);
};
