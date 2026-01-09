'use client';

import { useMemo } from 'react';

interface VirtualizedTableProps {
  data: any[];
  headers: string[];
  computeResolutionTime: (row: any) => string;
  isClosedRow: (row: any) => boolean;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  handleSort: (column: string) => void;
}

export default function VirtualizedTable({
  data,
  headers,
  computeResolutionTime,
  isClosedRow,
  sortColumn,
  sortDirection,
  handleSort
}: VirtualizedTableProps) {
  
  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-100">
      {/* Header */}
      <div className="flex bg-gradient-to-r from-gray-100 to-gray-50 border-b border-gray-200 sticky top-0 z-10">
        {headers.map((header) => (
          <div
            key={header}
            onClick={() => handleSort(header)}
            className="px-4 py-3 text-left font-medium text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200 select-none flex-shrink-0"
            style={{ width: header === 'Closing Remarks' ? '300px' : '200px' }}
          >
            <div className="flex items-center gap-1 text-xs">
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
                  <span className={`px-2 py-1 rounded-full font-medium text-xs ${
                    isWithin ? 'bg-green-100 text-green-700' : 
                    isBeyond ? 'bg-red-100 text-red-700' : 
                    'text-gray-600'
                  }`}>
                    {display || '—'}
                  </span>
                );
              } else {
                cellContent = display || '—';
              }

              return (
                <div
                  key={i}
                  className={`px-4 py-3 text-sm ${isRemarks ? 'max-w-xs truncate' : ''} flex-shrink-0`}
                  style={{ width: isRemarks ? '300px' : '200px' }}
                  title={isRemarks ? String(display || '') : undefined}
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
