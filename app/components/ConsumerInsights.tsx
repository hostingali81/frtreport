import React, { useMemo, useState } from 'react';
import { FiSmartphone, FiUser, FiMapPin, FiClock, FiActivity, FiX, FiList } from 'react-icons/fi';

interface ConsumerInsightsProps {
    data: any[];
}

const ConsumerInsights: React.FC<ConsumerInsightsProps> = ({ data }) => {
    const [limit, setLimit] = useState(10);
    const [selectedConsumer, setSelectedConsumer] = useState<{
        type: 'mobile' | 'address';
        key: string;
        details: any;
        complaints: any[];
    } | null>(null);

    // 1. Repeaters by Mobile
    const byMobile = useMemo(() => {
        const map = new Map<string, { mobile: string; name: string; address: string; total: number; pending: number; closed: number; timestamps: string[]; }>();

        data.forEach(r => {
            const mobile = r['Consumer Mobile'] ? String(r['Consumer Mobile']).trim() : null;
            if (!mobile || mobile.length < 5) return;

            const entry = map.get(mobile) || {
                mobile,
                name: r['Consumer Name'] || 'Unknown',
                address: r['Consumer Address'] || 'Unknown',
                total: 0,
                pending: 0,
                closed: 0,
                timestamps: [] as string[]
            };

            entry.total += 1;
            const status = String(r['Status'] || '').toLowerCase();
            if (status.includes('pending')) entry.pending += 1;
            else if (status.includes('closed')) entry.closed += 1;

            if (r['Consumer Name']) entry.name = r['Consumer Name'];
            if (r['Consumer Address']) entry.address = r['Consumer Address'];

            map.set(mobile, entry);
        });

        return Array.from(map.values())
            .filter(x => x.total > 1)
            .sort((a, b) => b.total - a.total)
            .slice(0, 50);
    }, [data]);

    // 2. Repeaters by Name + Address
    const byNameAddress = useMemo(() => {
        const map = new Map<string, { mobile: string; name: string; address: string; total: number; pending: number; closed: number; }>();

        data.forEach(r => {
            const name = r['Consumer Name'] ? String(r['Consumer Name']).trim() : '';
            const address = r['Consumer Address'] ? String(r['Consumer Address']).trim() : '';
            if (!name) return;

            const key = `${name}|${address}`.toLowerCase();
            const entry = map.get(key) || {
                mobile: r['Consumer Mobile'] || 'N/A',
                name,
                address,
                total: 0,
                pending: 0,
                closed: 0
            };

            entry.total += 1;
            const status = String(r['Status'] || '').toLowerCase();
            if (status.includes('pending')) entry.pending += 1;
            else if (status.includes('closed')) entry.closed += 1;

            if (r['Consumer Mobile']) entry.mobile = r['Consumer Mobile'];

            map.set(key, entry);
        });

        return Array.from(map.values())
            .filter(x => x.total > 1)
            .sort((a, b) => b.total - a.total)
            .slice(0, 50);
    }, [data]);

    const handleRowClick = (type: 'mobile' | 'address', item: any) => {
        let complaints = [];
        if (type === 'mobile') {
            complaints = data.filter(r => (r['Consumer Mobile'] ? String(r['Consumer Mobile']).trim() : '') === item.mobile)
                .sort((a, b) => new Date(b['Complaint Date and Time']).getTime() - new Date(a['Complaint Date and Time']).getTime());
        } else {
            const key = `${item.name}|${item.address}`.toLowerCase();
            complaints = data.filter(r => {
                const n = r['Consumer Name'] ? String(r['Consumer Name']).trim() : '';
                const a = r['Consumer Address'] ? String(r['Consumer Address']).trim() : '';
                return `${n}|${a}`.toLowerCase() === key;
            }).sort((a, b) => new Date(b['Complaint Date and Time']).getTime() - new Date(a['Complaint Date and Time']).getTime());
        }

        setSelectedConsumer({
            type,
            key: type === 'mobile' ? item.mobile : `${item.name}|${item.address}`,
            details: item,
            complaints
        });
    };

    const renderProgressBar = (value: number, max: number, colorClass: string) => {
        const width = Math.min(100, Math.max(5, (value / max) * 100));
        return (
            <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden mt-2">
                <div className={`h-full ${colorClass} rounded-full`} style={{ width: `${width}%` }}></div>
            </div>
        );
    };

    const getBadgeColor = (count: number) => {
        if (count >= 10) return 'bg-red-100 text-red-800 border-red-200';
        if (count >= 5) return 'bg-orange-100 text-orange-800 border-orange-200';
        return 'bg-blue-100 text-blue-800 border-blue-200';
    };

    if (!data || data.length === 0) return null;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">

            {/* Header Section */}
            <div className="flex items-center gap-3 border-b border-gray-200 pb-4">
                <div className="p-3 bg-indigo-100 text-indigo-700 rounded-xl">
                    <FiActivity className="text-2xl" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-gray-800">Consumer Insights - Repeat Offenders</h2>
                    <p className="text-gray-500">Click on any row to view detailed complaint history</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Card 1: By Mobile */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden flex flex-col h-full">
                    <div className="p-6 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-purple-100">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <span className="p-2 bg-purple-100 text-purple-700 rounded-lg"><FiSmartphone /></span>
                            Top Repeaters by Mobile
                        </h3>
                        <p className="text-sm text-gray-500 mt-1 pl-11">Consolidated by unique mobile number</p>
                    </div>

                    <div className="flex-1 overflow-auto p-0">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider sticky top-0 z-10">
                                <tr>
                                    <th className="px-6 py-3 font-semibold">Rank</th>
                                    <th className="px-6 py-3 font-semibold">Details</th>
                                    <th className="px-6 py-3 font-semibold text-center">Complaints</th>
                                    <th className="px-6 py-3 font-semibold text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {byMobile.slice(0, limit).map((item, idx) => (
                                    <tr
                                        key={idx}
                                        onClick={() => handleRowClick('mobile', item)}
                                        className="hover:bg-purple-50 transition-colors cursor-pointer group"
                                    >
                                        <td className="px-6 py-4 text-center w-16 font-bold text-gray-400 group-hover:text-purple-600">#{idx + 1}</td>
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-gray-900 font-mono text-base group-hover:text-purple-700 transition-colors flex items-center gap-2">
                                                {item.mobile}
                                                <FiList className="opacity-0 group-hover:opacity-100 text-purple-500" size={14} />
                                            </div>
                                            <div className="text-sm text-gray-600 truncate max-w-[200px]" title={item.name}>{item.name}</div>
                                            <div className="text-xs text-gray-400 truncate max-w-[200px]" title={item.address}>{item.address}</div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col items-center">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold border ${getBadgeColor(item.total)}`}>
                                                    {item.total} Total
                                                </span>
                                                {renderProgressBar(item.total, byMobile[0]?.total || 1, 'bg-purple-500')}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center text-xs">
                                            <div className="space-y-1">
                                                <div className="text-red-600 font-medium">{item.pending} Pending</div>
                                                <div className="text-green-600 font-medium">{item.closed} Closed</div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {byMobile.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-gray-500 italic">
                                            No repeat patterns found by mobile number.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {byMobile.length > limit && (
                        <div className="p-4 border-t border-gray-100 bg-gray-50 text-center">
                            <button onClick={() => setLimit(l => l + 10)} className="text-indigo-600 hover:text-indigo-800 font-medium text-sm">
                                Show More
                            </button>
                        </div>
                    )}
                </div>

                {/* Card 2: By Name + Address */}
                <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden flex flex-col h-full">
                    <div className="p-6 bg-gradient-to-r from-pink-50 to-rose-50 border-b border-pink-100">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <span className="p-2 bg-pink-100 text-pink-700 rounded-lg"><FiMapPin /></span>
                            Top Repeaters by Address
                        </h3>
                        <p className="text-sm text-gray-500 mt-1 pl-11">Grouped by Name & Address combination</p>
                    </div>

                    <div className="flex-1 overflow-auto p-0">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider sticky top-0 z-10">
                                <tr>
                                    <th className="px-6 py-3 font-semibold">Rank</th>
                                    <th className="px-6 py-3 font-semibold">Consumer</th>
                                    <th className="px-6 py-3 font-semibold text-center">Complaints</th>
                                    <th className="px-6 py-3 font-semibold text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {byNameAddress.slice(0, limit).map((item, idx) => (
                                    <tr
                                        key={idx}
                                        onClick={() => handleRowClick('address', item)}
                                        className="hover:bg-pink-50 transition-colors cursor-pointer group"
                                    >
                                        <td className="px-6 py-4 text-center w-16 font-bold text-gray-400 group-hover:text-pink-600">#{idx + 1}</td>
                                        <td className="px-6 py-4">
                                            <div className="font-bold text-gray-900 group-hover:text-pink-700 transition-colors flex items-center gap-2">
                                                {item.name}
                                                <FiList className="opacity-0 group-hover:opacity-100 text-pink-500" size={14} />
                                            </div>
                                            <div className="text-xs text-gray-500 truncate max-w-[200px]" title={item.address}>{item.address}</div>
                                            <div className="text-xs text-blue-500 mt-1 flex items-center gap-1">
                                                <FiSmartphone size={10} /> {item.mobile}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col items-center">
                                                <span className={`px-2 py-1 rounded-full text-xs font-bold border ${getBadgeColor(item.total)}`}>
                                                    {item.total} Total
                                                </span>
                                                {renderProgressBar(item.total, byNameAddress[0]?.total || 1, 'bg-pink-500')}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center text-xs">
                                            <div className="space-y-1">
                                                <div className="text-red-600 font-medium">{item.pending} Pending</div>
                                                <div className="text-green-600 font-medium">{item.closed} Closed</div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {byNameAddress.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-8 text-center text-gray-500 italic">
                                            No repeat patterns found by name/address.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {byNameAddress.length > limit && (
                        <div className="p-4 border-t border-gray-100 bg-gray-50 text-center">
                            <button onClick={() => setLimit(l => l + 10)} className="text-pink-600 hover:text-pink-800 font-medium text-sm">
                                Show More
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Drill-down Modal */}
            {selectedConsumer && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                        {/* Modal Header */}
                        <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
                            <div>
                                <h3 className="text-xl font-bold flex items-center gap-2">
                                    <FiList className="text-purple-400" />
                                    Complaint History
                                </h3>
                                <p className="text-gray-400 text-sm mt-1">
                                    {selectedConsumer.type === 'mobile' ? (
                                        <>Mobile: <span className="text-white font-mono">{selectedConsumer.key}</span> • {selectedConsumer.details.name}</>
                                    ) : (
                                        <>Consumer: <span className="text-white">{selectedConsumer.details.name}</span> • {selectedConsumer.details.address}</>
                                    )}
                                </p>
                            </div>
                            <button
                                onClick={() => setSelectedConsumer(null)}
                                className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full transition-colors text-gray-400 hover:text-white"
                            >
                                <FiX size={20} />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-auto bg-gray-50 p-0">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-100 text-gray-600 text-xs uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="px-6 py-3 font-semibold border-b">Complaint No.</th>
                                        <th className="px-6 py-3 font-semibold border-b">Division / Substation</th>
                                        <th className="px-6 py-3 font-semibold border-b">Date & Time</th>
                                        <th className="px-6 py-3 font-semibold border-b">Status</th>
                                        <th className="px-6 py-3 font-semibold border-b">Closed Status</th>
                                        <th className="px-6 py-3 font-semibold border-b">Remarks</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 bg-white">
                                    {selectedConsumer.complaints.map((c, i) => (
                                        <tr key={i} className="hover:bg-blue-50 transition-colors">
                                            <td className="px-6 py-4 font-mono font-medium text-blue-600 whitespace-nowrap">
                                                {c['Complaint Number']}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-700">
                                                <div className="font-semibold">{c['Division']}</div>
                                                <div className="text-xs text-gray-500">{c['Sub Station']}</div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                                {c['Complaint Date and Time']}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                {String(c['Status']).includes('Pending') ? (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                        Pending
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                        Closed
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                                {c['Closed Status'] || '-'}
                                                {c['Closed Date'] && <div className="text-xs text-gray-400 mt-1">{c['Closed Date']}</div>}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={c['Closing Remarks']}>
                                                {c['Closing Remarks'] || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Modal Footer */}
                        <div className="bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-between items-center shrink-0">
                            <div className="text-sm text-gray-500">
                                Total Records: <span className="font-bold text-gray-900">{selectedConsumer.complaints.length}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ConsumerInsights;
