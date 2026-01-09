'use client';

import { useMemo } from 'react';

interface VirtualTableProps {
  data: any[];
  headers: string[];
  computeResolutionTime: (row: any) => string;
  handleSort: (column: string) => void;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
}

export default function VirtualTable({
  data,
  headers,
  computeResolutionTime,
  handleSort,
  sortColumn,
  sortDirection
}: VirtualTableProps) {
  
  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-100">
      {/* Header */}
      <div className="flex bg-gradient-to-r from-gray-100 to-gray-50 border-b border-gray-200 sticky top-0 z-10">
        {headers.map((header) => (
          <div
            key={header}
            onClick={() => handleSort(header)}
            className={`px-4 py-3 text-left font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 select-none text-xs flex-shrink-0 ${header === 'Closing Remarks' ? 'w-80' : 'w-48'}`}
          >
            <div className="flex items-center gap-1">
              {header}
              {sortColumn === header && (
                <span className="text-blue-600">{sortDirection === 'asc' ? '↑' : '↓'}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="overflow-auto" style={{ maxHeight: '600px' }}>
        {data.map((row, index) => (
          <div key={index} className="flex border-b border-gray-100 hover:bg-gray-50">
            {headers.map((h, i) => {
              let display: any = (row as any)[h];
              if (h === 'Resolution Time') display = computeResolutionTime(row);
              const isRemarks = h === 'Closing Remarks';
              const isClosedStatus = h === 'Closed Status';

              let cellContent;
              if (isClosedStatus) {
                const status = String(display || '').trim();
                const isWithin = status === 'Closed Within';
                const isBeyond = status === 'Closed Beyond';
                cellContent = (
                  <span className={`px-2 py-1 rounded-full font-medium text-xs ${isWithin ? 'bg-green-100 text-green-700' : isBeyond ? 'bg-red-100 text-red-700' : 'text-gray-600'}`}>
                    {status}
                  </span>
                );
              } else if (isRemarks) {
                cellContent = <span title={String(display || '')} className="line-clamp-2">{String(display || '')}</span>;
              } else {
                cellContent = String(display || '');
              }

              return (
                <div
                  key={i}
                  className={`px-4 py-3 text-xs flex-shrink-0 ${isRemarks ? 'w-80' : 'w-48'}`}
                >
                  {cellContent}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
