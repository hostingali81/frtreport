'use client';

import { useEffect, useState } from 'react';
import { ComplaintFilters, getDefaultTodayFilters, useData } from '../context/DataContext';

export type ShiftPreset =
    | 'today_morning' | 'today_day' | 'today_night'
    | 'yesterday_morning' | 'yesterday_day' | 'yesterday_night'
    | 'today_field_a' | 'today_field_b' | 'today_field_c'
    | 'yesterday_field_a' | 'yesterday_field_b' | 'yesterday_field_c';

export type CustomShift = 'morning' | 'day' | 'night' | 'field_a' | 'field_b' | 'field_c';

export type RangePreset = 'fromNov2025ToNow' | 'today' | 'last24h' | 'thisMonth' | 'toNow' | 'yesterday';

const formatDateTimeLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const SHIFT_LABELS: Record<string, string> = {
    morning: 'Control Room Morning (07:00 AM–03:00 PM)',
    day: 'Control Room Day (03:00 PM–11:00 PM)',
    night: 'Control Room Night (11:00 PM–07:00 AM)',
    field_a: 'Field Shift A (08:00 AM–04:00 PM)',
    field_b: 'Field Shift B (04:00 PM–12:00 AM)',
    field_c: 'Field Shift C (12:00 AM–08:00 AM)'
};

// [startHour, endHour, endIsNextDay] per shift type.
const SHIFT_HOURS: Record<CustomShift, [number, number, boolean]> = {
    morning: [7, 15, false],
    day: [15, 23, false],
    night: [23, 7, true],
    field_a: [8, 16, false],
    field_b: [16, 0, true],
    field_c: [0, 8, false] // starts at midnight AFTER the chosen date (next day)
};

function shiftRange(baseDate: Date, shiftType: CustomShift): { start: Date; end: Date } {
    const day = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const [startHour, endHour, endNextDay] = SHIFT_HOURS[shiftType];

    if (shiftType === 'field_c') {
        // Field C belongs to the chosen date's roster but runs 12AM-8AM the next day.
        const start = new Date(day.getTime() + 24 * 60 * 60 * 1000);
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime());
        end.setHours(8, 0, 0, 0);
        return { start, end };
    }

    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), startHour, 0, 0);
    const end = endNextDay
        ? (() => {
            const e = new Date(day.getTime() + 24 * 60 * 60 * 1000);
            e.setHours(endHour, 0, 0, 0);
            return e;
        })()
        : new Date(day.getFullYear(), day.getMonth(), day.getDate(), endHour, 0, 0);
    return { start, end };
}

// All the shared filter state + preset logic for the analytics/report pages.
// Returns a props bundle that spreads straight into <FilterBar> (the caller
// adds onApply/loading) and buildFilters() for applyFilters calls.
export function useComplaintFilters() {
    const { filterOptions, currentFilters } = useData();

    const defaultFilters = currentFilters ?? getDefaultTodayFilters();

    const [fromDT, setFromDT] = useState(defaultFilters.fromDT);
    const [toDT, setToDT] = useState(defaultFilters.toDT);
    const [statusFilter, setStatusFilter] = useState(defaultFilters.status);
    const [divisionFilter, setDivisionFilter] = useState(defaultFilters.division);
    const [subDivisionFilter, setSubDivisionFilter] = useState(defaultFilters.subDivision);
    const [subStationFilter, setSubStationFilter] = useState(defaultFilters.subStation);
    const [closedStatusFilter, setClosedStatusFilter] = useState(defaultFilters.closedStatus);
    const [monthFilter, setMonthFilter] = useState(defaultFilters.monthFilter);
    const [selectedShift, setSelectedShift] = useState('');
    const [customDate, setCustomDate] = useState('');
    const [activePreset, setActivePreset] = useState('');

    useEffect(() => {
        setFromDT(currentFilters.fromDT);
        setToDT(currentFilters.toDT);
        setStatusFilter(currentFilters.status);
        setDivisionFilter(currentFilters.division);
        setSubDivisionFilter(currentFilters.subDivision);
        setSubStationFilter(currentFilters.subStation);
        setClosedStatusFilter(currentFilters.closedStatus);
        setMonthFilter(currentFilters.monthFilter);
    }, [currentFilters]);

    const setRange = (start: Date, end: Date) => {
        setFromDT(formatDateTimeLocal(start));
        setToDT(formatDateTimeLocal(end));
    };

    const applyShiftPreset = (shift: ShiftPreset) => {
        setActivePreset('');
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const isYesterday = shift.startsWith('yesterday');
        const base = isYesterday ? new Date(today.getTime() - 24 * 60 * 60 * 1000) : today;
        const shiftType = shift.replace(/^(today|yesterday)_/, '') as CustomShift;

        const { start, end } = shiftRange(base, shiftType);
        setRange(start, end);
        setSelectedShift(`${isYesterday ? 'Yesterday' : 'Today'} - ${SHIFT_LABELS[shiftType]}`);
    };

    const applyCustomDateShift = (shiftType: CustomShift) => {
        if (!customDate) {
            alert('⚠️ Please select a date first!');
            return;
        }
        setActivePreset('');
        const { start, end } = shiftRange(new Date(customDate), shiftType);
        setRange(start, end);
        setSelectedShift(`${customDate} - ${SHIFT_LABELS[shiftType]}`);
    };

    const applyPreset = (type: RangePreset) => {
        const now = new Date();
        if (type === 'fromNov2025ToNow') {
            setFromDT('2025-11-01T00:00');
            setToDT(formatDateTimeLocal(now));
        } else if (type === 'today') {
            setRange(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0), now);
        } else if (type === 'yesterday') {
            setRange(
                new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0),
                new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
            );
        } else if (type === 'last24h') {
            setRange(new Date(now.getTime() - 24 * 60 * 60 * 1000), now);
        } else if (type === 'thisMonth') {
            setRange(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0), now);
        } else if (type === 'toNow') {
            setToDT(formatDateTimeLocal(now));
        }
        setActivePreset(type);
    };

    const handleMonthChange = (val: string) => {
        setMonthFilter(val);
        if (val) {
            setFromDT('');
            setToDT('');
            setActivePreset('');
            setSelectedShift('');
            setCustomDate('');
        }
    };

    const clearAllFilters = () => {
        const todayFilters = getDefaultTodayFilters();
        setDivisionFilter(todayFilters.division);
        setSubDivisionFilter(todayFilters.subDivision);
        setSubStationFilter(todayFilters.subStation);
        setStatusFilter(todayFilters.status);
        setClosedStatusFilter(todayFilters.closedStatus);
        setFromDT(todayFilters.fromDT);
        setToDT(todayFilters.toDT);
        setMonthFilter(todayFilters.monthFilter);
        setSelectedShift('');
        setActivePreset('');
        setCustomDate('');
    };

    const buildFilters = (): ComplaintFilters => ({
        division: divisionFilter,
        subDivision: subDivisionFilter,
        subStation: subStationFilter,
        status: statusFilter,
        closedStatus: closedStatusFilter,
        fromDT,
        toDT,
        monthFilter
    });

    const filterBarProps = {
        divisionFilter, setDivisionFilter, divisionOptions: filterOptions.divisions,
        subDivisionFilter, setSubDivisionFilter, subDivisionOptions: filterOptions.subDivisions,
        subStationFilter, setSubStationFilter, subStationOptions: filterOptions.subStations,
        statusFilter, setStatusFilter, statusOptions: filterOptions.statuses,
        closedStatusFilter, setClosedStatusFilter, closedStatusOptions: filterOptions.closedStatuses,
        fromDT, setFromDT, toDT, setToDT,
        selectedShift, setSelectedShift,
        activePreset, applyPreset, applyShiftPreset,
        customDate, setCustomDate, applyCustomDateShift,
        clearAllFilters,
        monthFilter, setMonthFilter: handleMonthChange, monthOptions: filterOptions.months
    };

    return { filterBarProps, buildFilters };
}
